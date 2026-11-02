import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { mainnetManifest, PROJECT_ROOT } from '../profiles/mainnet';
import { digest, resolveSettlementAssets } from '../intents/settlement';

const CIRCLE_REGISTRY = 'https://developers.circle.com/stablecoins/usdc-contract-addresses';
const ONECLICK_TOKENS = 'https://1click.chaindefuser.com/v0/tokens';
const atomic = z.string().regex(/^(0|[1-9][0-9]{0,38})$/).refine((v) => BigInt(v) < 2n ** 128n);

/** Only public GETs and NEAR status/query calls. No credentials, quotes, registration or signing. */
export async function verifyMainnetAssets(raw: unknown, request: typeof fetch = fetch, options: { chainOnly?: boolean } = {}) {
  const manifest = mainnetManifest(raw);
  async function get(url: string, init?: RequestInit) {
    const response = await request(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`Public verification HTTP error: ${response.status}`);
    return response;
  }
  async function rpc(method: 'status' | 'query', params: unknown) {
    const body = await (await get(manifest.rpc.url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'carecart-mn01', method, params }),
    })).json() as { error?: unknown; result?: unknown };
    if (body.error || body.result == null) throw new Error('Mainnet verification RPC error');
    return body.result;
  }
  async function view(method: string, args: object) {
    const result = z.object({ block_height: z.number().int(), block_hash: z.string(), result: z.array(z.number().int().min(0).max(255)) }).parse(
      await rpc('query', { request_type: 'call_function', finality: 'final', account_id: manifest.token.accountId,
        method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString('base64') }),
    );
    return { blockHeight: result.block_height, blockHash: result.block_hash,
      value: JSON.parse(Buffer.from(result.result).toString('utf8')) as unknown };
  }
  const chain = z.object({
    chain_id: z.literal('mainnet'), genesis_hash: z.string().optional(),
    sync_info: z.object({ syncing: z.literal(false), latest_block_height: z.number().optional(), latest_block_hash: z.string().optional(), latest_block_time: z.string().optional() }),
  }).parse(await rpc('status', []));
  const registryText = await (await get(CIRCLE_REGISTRY)).text();
  if (!registryText.includes(manifest.token.accountId) || !registryText.includes('NEAR'))
    throw new Error('Native NEAR USDC candidate absent from current Circle registry');
  const metadataObservation = await view('ft_metadata', {});
  const metadata = { ...metadataObservation, value: z.object({ spec: z.literal('ft-1.0.0'), name: z.string(), symbol: z.literal('USDC'), decimals: z.literal(6) }).parse(metadataObservation.value) };
  const boundsObservation = await view('storage_balance_bounds', {});
  const bounds = { ...boundsObservation, value: z.object({ min: atomic.refine((v) => BigInt(v) > 0n), max: atomic.nullable() }).parse(boundsObservation.value) };
  if (bounds.value.max !== null && BigInt(bounds.value.max) < BigInt(bounds.value.min))
    throw new Error('Invalid live token storage bounds');
  const assets = options.chainOnly ? null : resolveSettlementAssets(await (await get(ONECLICK_TOKENS)).json());
  if (assets && assets.origin.assetId !== manifest.token.oneClickAssetId)
    throw new Error('Manifest 1Click asset identity mismatch');
  const accounts: Array<{ accountId: string; observation: Awaited<ReturnType<typeof view>> }> = [];
  if (manifest.deployment) {
    for (const accountId of [manifest.deployment.vault, manifest.deployment.treasury]) {
      const observation = await view('storage_balance_of', { account_id: accountId });
      if (observation.value !== null) z.object({ total: atomic, available: atomic }).parse(observation.value);
      accounts.push({ accountId, observation });
    }
  }
  return {
    verifiedAt: new Date().toISOString(), manifestId: manifest.id, manifestFingerprint: digest(manifest), fundingAuthorized: false,
    sources: { circle: CIRCLE_REGISTRY, rpc: manifest.rpc.url, oneClick: ONECLICK_TOKENS },
    registry: { sha256: createHash('sha256').update(registryText).digest('hex'), candidateListed: true },
    chain, metadata, storageBounds: bounds, assets,
    oneClickVerification: assets ? 'verified' : 'not-verified',
    registrations: { status: manifest.deployment ? 'observed-only' : 'pending-G0B', accounts },
  };
}

if (require.main === module) {
  const [manifestPath = resolve(PROJECT_ROOT, 'profiles/mainnet.candidate.json'), outputPath, mode] = process.argv.slice(2);
  if (mode && mode !== '--chain-only') throw new Error('Unknown verification mode');
  void verifyMainnetAssets(JSON.parse(readFileSync(manifestPath, 'utf8')), fetch, { chainOnly: mode === '--chain-only' }).then((report) => {
    const json = `${JSON.stringify(report, null, 2)}\n`;
    if (outputPath) writeFileSync(outputPath, json, { flag: 'wx' });
    else console.info(json);
  }).catch((error: unknown) => { console.error('Mainnet asset verification failed:', error); process.exitCode = 1; });
}

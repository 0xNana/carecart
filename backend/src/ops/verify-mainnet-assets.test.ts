import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { verifyMainnetAssets } from './verify-mainnet-assets';
import { NEAR_USDC, BASE_USDC } from '../intents/settlement';
const candidate = JSON.parse(readFileSync(resolve(__dirname, '../../..', 'profiles/mainnet.candidate.json'), 'utf8'));
const meta = { spec: 'ft-1.0.0', name: 'USD Coin', symbol: 'USDC', decimals: 6 };
const tokens = [
  { blockchain: 'near', contractAddress: NEAR_USDC, symbol: 'USDC', decimals: 6, assetId: `nep141:${NEAR_USDC}` },
  { blockchain: 'base', contractAddress: BASE_USDC, symbol: 'USDC', decimals: 6, assetId: 'nep141:base-usdc.omft.near' },
];
function transport(change: { chain?: string; metadata?: object; tokens?: unknown; bounds?: object; registry?: string } = {}) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes('circle.com')) return new Response(change.registry ?? `<td>NEAR</td><td>${NEAR_USDC}</td>`);
    if (String(url).includes('/tokens')) return Response.json(change.tokens ?? tokens);
    const body = JSON.parse(String(init?.body));
    if (!['status', 'query'].includes(body.method)) throw new Error('Unexpected side effect');
    if (body.method === 'status') return Response.json({ result: { chain_id: change.chain ?? 'mainnet', sync_info: { syncing: false } } });
    const result = body.params.method_name === 'ft_metadata' ? change.metadata ?? meta : change.bounds ?? { min: '1250000000000000000000', max: '1250000000000000000000' };
    return Response.json({ result: { block_height: 123, block_hash: 'fixture', result: [...Buffer.from(JSON.stringify(result))] } });
  }) as unknown as typeof fetch;
}
describe('read-only mainnet asset verification', () => {
  it('records the observed asset and bounds without certifying absent deployment registrations', async () => {
    const report = await verifyMainnetAssets(candidate, transport());
    expect(report.metadata.value.decimals).toBe(6);
    expect(report.assets?.origin.assetId).toBe(candidate.token.oneClickAssetId);
    expect(report.registrations).toEqual({ status: 'pending-G0B', accounts: [] });
    expect(report.fundingAuthorized).toBe(false);
  });
  it('labels chain-only evidence as incomplete and never requests tokens', async () => {
    const request = transport();
    const report = await verifyMainnetAssets(candidate, request, { chainOnly: true });
    expect(report.assets).toBeNull();
    expect(report.oneClickVerification).toBe('not-verified');
    expect(vi.mocked(request).mock.calls.some(([url]) => String(url).includes('/tokens'))).toBe(false);
  });
  it.each([
    { chain: 'testnet' }, { metadata: { ...meta, decimals: 0 } },
    { metadata: { ...meta, symbol: 'USDC.e' } }, { tokens: [] },
    { tokens: [...tokens, tokens[0]] }, { registry: 'USDC not listed here' },
    { bounds: { min: '0', max: null } },
    { bounds: { min: '100', max: '99' } },
  ])('rejects inconsistent live observations %j', async (change) => {
    await expect(verifyMainnetAssets(candidate, transport(change))).rejects.toThrow();
  });
  it('rejects HTTP and RPC errors rather than emitting success evidence', async () => {
    await expect(verifyMainnetAssets(candidate, (async () => new Response('', { status: 503 })) as typeof fetch)).rejects.toThrow();
    await expect(verifyMainnetAssets(candidate, (async () => Response.json({ error: { message: 'RPC unavailable' } })) as typeof fetch)).rejects.toThrow();
  });
});

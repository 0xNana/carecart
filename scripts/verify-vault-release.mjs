// Read-only testnet evidence. This module has no signer, wallet or broadcast capability.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function wasmHash(bytes) {
  const digest = createHash('sha256').update(bytes).digest();
  let value = BigInt(`0x${digest.toString('hex')}`), encoded = '';
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  while (value) { encoded = alphabet[Number(value % 58n)] + encoded; value /= 58n; }
  for (const byte of digest) { if (byte !== 0) break; encoded = '1' + encoded; }
  return { sha256: digest.toString('hex'), nearCodeHash: encoded, bytes: bytes.length };
}

export async function verifyVaultRelease(profile, artifact, transport = fetch) {
  if (profile.network !== 'testnet' || profile.rpcUrl !== 'https://test.rpc.fastnear.com')
    throw new Error('Pinned testnet only; no network fallback');
  async function read(method, params) {
    const response = await transport(profile.rpcUrl, { method: 'POST', redirect: 'error',
      signal: AbortSignal.timeout(20000), headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'carecart-vault-release', method, params }) });
    if (!response.ok) throw new Error(`Testnet RPC HTTP ${response.status}`);
    const body = await response.json();
    if (body.error || body.result === undefined) throw new Error(`Read-only RPC rejected ${method}: ${JSON.stringify(body.error)}`);
    return body.result;
  }
  if ((await read('status', [])).chain_id !== 'testnet') throw new Error('RPC network mismatch');
  const block = await read('block', { finality: 'final' });
  const query = (account_id, request_type, extra = {}) => read('query', { account_id, request_type, block_id: block.header.hash, ...extra });
  const view = async (account, method_name, args = {}) => {
    const value = await query(account, 'call_function', { method_name, args_base64: Buffer.from(JSON.stringify(args)).toString('base64') });
    return JSON.parse(Buffer.from(value.result).toString('utf8'));
  };
  const [account, code, token, metadata, state, keys, treasuryBalance, vaultBalance] = await Promise.all([
    query(profile.vault, 'view_account'), query(profile.vault, 'view_code'), query(profile.token, 'view_account'),
    view(profile.token, 'ft_metadata'), view(profile.vault, 'get_state'), query(profile.vault, 'view_access_key_list'),
    view(profile.token, 'ft_balance_of', { account_id: profile.treasury }),
    view(profile.token, 'ft_balance_of', { account_id: profile.vault }),
  ]);
  const deployed = wasmHash(Buffer.from(code.code_base64, 'base64')), local = wasmHash(artifact);
  if (deployed.nearCodeHash !== account.code_hash) throw new Error('RPC code bytes do not match account code hash');
  const suppliers = await Promise.all(profile.suppliers.map(async accountId => ({ accountId,
    roles: await view(profile.vault, 'get_roles', { account: accountId }),
    balance: await view(profile.token, 'ft_balance_of', { account_id: accountId }),
  })));
  const restrictedRoles = await Promise.all(['committer','requester'].map(async role => ({
    role, accountId: profile[role], publicKey: profile[`${role}PublicKey`],
    accessKeys: (await query(profile[role], 'view_access_key_list')).keys,
    roles: await view(profile.vault, 'get_roles', {account:profile[role]}),
    tokenBalance: await view(profile.token, 'ft_balance_of', {account_id:profile[role]}),
  })));
  return { observedAt: new Date().toISOString(), network: 'testnet', readOnly: true,
    block: { hash: block.header.hash, height: block.header.height }, vault: profile.vault, token: profile.token,
    artifact: local, deployed, artifactMatchesDeployment: local.nearCodeHash === deployed.nearCodeHash,
    profileMatchesDeployment: profile.codeHash === deployed.nearCodeHash, tokenCodeHash: token.code_hash,
    metadata, state, vaultAccessKeys: keys.keys, treasuryBalance, vaultBalance, suppliers, restrictedRoles, publicTransactionsSubmitted: 0 };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [profilePath, artifactPath] = process.argv.slice(2);
  if (!profilePath || !artifactPath) throw new Error('Usage: node scripts/verify-vault-release.mjs PROFILE WASM');
  const activation = JSON.parse(readFileSync(profilePath, 'utf8'));
  const evidence = await verifyVaultRelease({ ...activation.profile, suppliers: activation.suppliers }, readFileSync(artifactPath));
  console.log(JSON.stringify(evidence, null, 2));
}

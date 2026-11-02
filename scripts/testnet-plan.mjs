import { createHash } from 'node:crypto';

export const RPC = 'https://test.rpc.fastnear.com';
export const ACCOUNTS = Object.freeze({
  vault: 'vault.carecart.testnet', token: 'token.carecart.testnet',
  admin: 'admin.carecart.testnet', treasury: 'treasury.carecart.testnet',
  committer: 'committer.carecart.testnet', agent: 'agent.carecart.testnet',
  alpha: 'medsupply-a.carecart.testnet', beta: 'medsupply-b.carecart.testnet',
  rogue: 'rogue.carecart.testnet',
});
export const POLICY = Object.freeze({ token_id: ACCOUNTS.token,
  per_order_cap: '2000', daily_cap: '5000', balance_cap: '10000' });
export const TOKEN_METADATA = Object.freeze({ name: 'CareCart Local Test Token', symbol: 'CCTEST', decimals: 0 });
export const EMPTY_CODE = '11111111111111111111111111111111';

export function artifact(buffer, path) {
  if (!buffer.subarray(0, 8).equals(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]))) throw new Error('Not a Wasm v1 artifact');
  const hash = createHash('sha256').update(buffer).digest();
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let value = BigInt(`0x${hash.toString('hex')}`), encoded = '';
  while (value > 0n) { encoded = alphabet[Number(value % 58n)] + encoded; value /= 58n; }
  for (const byte of hash) { if (byte !== 0) break; encoded = '1' + encoded; }
  return { path, bytes: buffer.length, sha256: hash.toString('hex'), codeHash: encoded };
}

export function assertRestrictedKey(entries, method) {
  if (!entries.some(({ public_key, access_key }) => {
    const permission = access_key.permission?.FunctionCall;
    return public_key.startsWith('ed25519:') && permission?.receiver_id === ACCOUNTS.vault
      && permission.method_names.length === 1 && permission.method_names[0] === method
      && permission.allowance !== null && BigInt(permission.allowance) > 0n;
  })) throw new Error(`Missing funded, exact-method Ed25519 function-call key: ${method}`);
}

const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
export function transactions(artifacts) {
  const rows = [];
  function deploy(id, file, args) {
    rows.push({ id, signer: id, receiver: id, method: 'new', args, depositNear: '0', gasTgas: 100,
      artifactSha256: file.sha256,
      command: `near contract deploy ${id} use-file ${quote(file.path)} with-init-call new json-args ${quote(JSON.stringify(args))} prepaid-gas '100 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-keychain send` });
  }
  function call(receiver, signer, method, args, deposit = '0', yocto = false) {
    rows.push({ signer, receiver, method, args, attachedDeposit: `${deposit} ${yocto ? 'yoctoNEAR' : 'NEAR'}`,
      depositNear: yocto ? '0.000000000000000000000001' : deposit, gasTgas: 100,
      command: `near contract call-function as-transaction ${receiver} ${method} json-args ${quote(JSON.stringify(args))} prepaid-gas '100 Tgas' attached-deposit '${deposit} ${yocto ? 'yoctoNEAR' : 'NEAR'}' sign-as ${signer} network-config testnet sign-with-keychain send` });
  }
  deploy(ACCOUNTS.token, artifacts.token, { owner_id: ACCOUNTS.treasury, total_supply: '1000000' });
  deploy(ACCOUNTS.vault, artifacts.vault, { admin: ACCOUNTS.admin, policy: POLICY });
  call(ACCOUNTS.vault, ACCOUNTS.admin, 'set_paused', { paused: true });
  for (const supplier_id of [ACCOUNTS.alpha, ACCOUNTS.beta]) call(ACCOUNTS.vault, ACCOUNTS.admin, 'set_supplier_allowed', { supplier_id, allowed: true }, '0.01');
  call(ACCOUNTS.vault, ACCOUNTS.admin, 'set_po_committer', { committer: ACCOUNTS.committer, allowed: true }, '0.01');
  call(ACCOUNTS.vault, ACCOUNTS.admin, 'set_payment_requester', { requester: ACCOUNTS.agent, allowed: true }, '0.01');
  call(ACCOUNTS.vault, ACCOUNTS.admin, 'fund_commit_storage', {}, '0.1');
  for (const account_id of [ACCOUNTS.vault, ACCOUNTS.alpha, ACCOUNTS.beta]) call(ACCOUNTS.token, ACCOUNTS.admin, 'storage_deposit', { account_id, registration_only: true }, '0.01');
  call(ACCOUNTS.token, ACCOUNTS.treasury, 'ft_transfer', { receiver_id: ACCOUNTS.vault, amount: '10000', memo: 'CC-15 synthetic testnet funding' }, '1', true);
  return rows.map((row, index) => ({ step: index + 1, ...row }));
}

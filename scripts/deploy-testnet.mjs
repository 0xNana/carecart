import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ACCOUNTS, EMPTY_CODE, POLICY, RPC, TOKEN_METADATA, artifact, assertRestrictedKey, transactions } from './testnet-plan.mjs';
import { sourceManifest } from './testnet-source.mjs';

// Deliberately has no signing, keychain, subprocess or broadcast capability.
const args = process.argv.slice(2);
if (!['--artifacts', '--verify', '--verify-token'].includes(args[0]) || (args[0] === '--artifacts' ? args.length !== 2 : args.length !== 3 || args[1] !== '--artifacts')) {
  console.error('Usage: bash scripts/deploy-testnet.sh [--verify | --verify-token] --artifacts DIRECTORY');
  process.exit(1);
}
const verify = args[0] === '--verify';
const verifyToken = args[0] === '--verify-token';
const directory = resolve(args.at(-1));
async function rpc(method, params) {
  const response = await fetch(RPC, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 'cc15-read-only', method, params }) });
  if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error || !payload.result) throw new Error(`RPC ${method} failed; no transaction was attempted`);
  return payload.result;
}
async function view(account_id, method_name, arguments_ = {}) {
  const value = await rpc('query', { request_type: 'call_function', finality: 'final', account_id, method_name,
    args_base64: Buffer.from(JSON.stringify(arguments_)).toString('base64') });
  return JSON.parse(Buffer.from(value.result).toString('utf8'));
}
try {
  const source = sourceManifest();
  assert.deepEqual(JSON.parse(readFileSync(resolve(directory, 'source.json'), 'utf8')), source,
    'Contract source changed since build; rebuild and obtain a new review');
  const files = { vault: 'carecart_vault.wasm', token: 'carecart_test_ft.wasm' };
  const artifacts = Object.fromEntries(Object.entries(files).map(([name, file]) => {
    const path = resolve(directory, file);
    return [name, artifact(readFileSync(path), path)];
  }));
  assert.equal((await rpc('status', [])).chain_id, 'testnet', 'RPC network mismatch');
  const accounts = await Promise.all(Object.entries(ACCOUNTS).map(async ([role, account_id]) => {
    const state = await rpc('query', { request_type: 'view_account', finality: 'final', account_id });
    return { role, accountId: account_id, balanceYocto: state.amount, lockedYocto: state.locked,
      storageBytes: state.storage_usage, codeHash: state.code_hash, blockHeight: state.block_height };
  }));
  for (const [role, method] of [['committer', 'commit_purchase_order'], ['agent', 'request_payment']]) {
    const { keys } = await rpc('query', { request_type: 'view_access_key_list', finality: 'final', account_id: ACCOUNTS[role] });
    assertRestrictedKey(keys, method);
  }
  if (verifyToken) {
    assert.equal(accounts.find((a) => a.role === 'token').codeHash, artifacts.token.codeHash, 'token code hash mismatch');
    const metadata = await view(ACCOUNTS.token, 'ft_metadata');
    for (const [key, value] of Object.entries(TOKEN_METADATA)) assert.equal(metadata[key], value, `Token metadata ${key}`);
    assert.equal(await view(ACCOUNTS.token, 'ft_total_supply'), '1000000');
    assert.equal(await view(ACCOUNTS.token, 'ft_balance_of', { account_id: ACCOUNTS.treasury }), '1000000');
    const storageBounds = await view(ACCOUNTS.token, 'storage_balance_bounds');
    assert.ok(BigInt(storageBounds.min) <= 10n ** 22n, 'Registration exceeds reviewed 0.01 NEAR per account');
    console.log(JSON.stringify({ result: 'verified-initial-test-token', network: 'testnet', artifacts, metadata, storageBounds,
      next: 'Obtain separate explicit approval for vault deployment and setup steps 2–12. No transaction was performed by this check.' }, null, 2));
  } else if (verify) {
    for (const role of ['vault', 'token']) assert.equal(accounts.find((a) => a.role === role).codeHash, artifacts[role].codeHash, `${role} code hash mismatch`);
    const metadata = await view(ACCOUNTS.token, 'ft_metadata');
    for (const [key, value] of Object.entries(TOKEN_METADATA)) assert.equal(metadata[key], value, `Token metadata ${key}`);
    assert.equal(await view(ACCOUNTS.token, 'ft_total_supply'), '1000000');
    assert.equal(await view(ACCOUNTS.vault, 'get_admin'), ACCOUNTS.admin);
    assert.deepEqual(await view(ACCOUNTS.vault, 'get_policy'), POLICY);
    assert.equal(await view(ACCOUNTS.vault, 'is_paused'), true);
    assert.equal(await view(ACCOUNTS.vault, 'get_commit_storage_reserve'), '100000000000000000000000');
    for (const supplier_id of [ACCOUNTS.alpha, ACCOUNTS.beta]) assert.equal(await view(ACCOUNTS.vault, 'is_supplier_allowed', { supplier_id }), true);
    assert.equal(await view(ACCOUNTS.vault, 'is_supplier_allowed', { supplier_id: ACCOUNTS.rogue }), false);
    assert.equal(await view(ACCOUNTS.vault, 'is_po_committer', { account_id: ACCOUNTS.committer }), true);
    for (const account_id of [ACCOUNTS.vault, ACCOUNTS.alpha, ACCOUNTS.beta]) assert.ok(await view(ACCOUNTS.token, 'storage_balance_of', { account_id }));
    const storageBounds = await view(ACCOUNTS.token, 'storage_balance_bounds');
    assert.ok(BigInt(storageBounds.min) <= 10n ** 22n, 'Registration exceeds reviewed 0.01 NEAR per account');
    assert.equal(await view(ACCOUNTS.token, 'ft_balance_of', { account_id: ACCOUNTS.vault }), '10000');
    assert.equal(await view(ACCOUNTS.token, 'ft_balance_of', { account_id: ACCOUNTS.treasury }), '990000');
    console.log(JSON.stringify({ result: 'verified-initial-paused-setup', network: 'testnet', rpc: RPC, source, artifacts, accounts, metadata, storageBounds,
      limitation: 'Does not verify wallet ownership, requester role receipt, backend configuration or a live payment. Run before any spending.' }, null, 2));
  } else {
    const blockers = [];
    for (const role of ['vault', 'token']) {
      const state = accounts.find((a) => a.role === role);
      if (state.codeHash !== EMPTY_CODE) blockers.push(`${role} already has code: fresh deployments only; stop and reconcile`);
      // Conservative proposal budget: code bytes + existing state + 10 KB state headroom + 0.05 gas buffer.
      const required = BigInt(artifacts[role].bytes + state.storageBytes + 10000) * 10n ** 19n + 5n * 10n ** 22n;
      if (BigInt(state.balanceYocto) < required) blockers.push(`${state.accountId} needs additional funding review; proposed minimum ${required} yoctoNEAR`);
    }
    if (BigInt(accounts.find((a) => a.role === 'admin').balanceYocto) < 27n * 10n ** 22n) blockers.push('Admin balance below 0.17 attached-deposit budget plus 0.1 gas buffer');
    if (BigInt(accounts.find((a) => a.role === 'treasury').balanceYocto) < 5n * 10n ** 22n) blockers.push('Treasury balance below proposed gas buffer');
    console.log(JSON.stringify({ status: 'PROPOSAL_ONLY_NOT_AUTHORIZED', generatedAt: new Date().toISOString(), network: 'testnet', rpc: RPC,
      source, artifacts, accounts, expectedTokenMetadata: TOKEN_METADATA, tokenMetadataStatus: 'Source-derived proposal; STOP after transaction 1 and verify live metadata before any vault/setup transaction', policy: POLICY,
      policySemantics: 'All three are automatic-payment thresholds; balance_cap is cumulative spend. Human approval can override caps. No holdings cap or treasury withdrawal exists.',
      blockers, attachedDepositBudget: '0.17 test NEAR plus 1 yoctoNEAR; storage excess refunded; gas additional (12 calls x 100 Tgas prepaid)',
      endState: 'Vault paused, 10000 valueless CCTEST in vault, 990000 at treasury. No PO, payment, resume, key export or cross-chain action is authorized.',
      transactions: transactions(artifacts), approval: 'Review exact artifacts, accounts, deposits and arguments. Explicit human approval is required before signing each listed transaction or this exact batch. Stop on a failure or changed state; do not blindly replay.' }, null, 2));
    if (blockers.length) process.exitCode = 2;
  }
} catch (error) {
  console.error(`CC-15 read-only check failed: ${error.message}`);
  process.exitCode = 1;
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTransaction, MAX_U128, type VaultState } from '../src/lib/near.ts';
import { createReview, submitReviewed, WalletResponsePendingError } from '../src/lib/wallet-transactions.ts';
import { vaultConfig, vaultReader } from '../src/lib/vault-rpc.ts';
const config = vaultConfig({});
const state: VaultState = { ...config, network: 'testnet', deployment: 'ready', checkedAt: '', paused: false,
  policy: { token_id: config.tokenId, per_order_cap: '100', daily_cap: '1000', balance_cap: '5000' } };
const pending = { purchaseOrder: { po_id: 'po-000001', supplier_id: 'medsupply-a.carecart.testnet', token_id: config.tokenId, amount: '500' },
  payment: { state: 'PendingApproval', reason: null, approval_reasons: ['PerOrderCap'], human_approved: false } };
test('only the configured admin can build testnet transactions for a ready vault', () => {
  const action = { method: 'set_paused', args: { paused: true } } as const;
  assert.throws(() => buildTransaction(state, 'agent.carecart.testnet', action), /admin wallet/);
  assert.throws(() => buildTransaction({ ...state, deployment: 'not_deployed' }, config.adminId, action), /not ready/);
  assert.throws(() => vaultConfig({ CARECART_VAULT_ID: 'vault.near' }), /testnet accounts/);
  const tx = buildTransaction(state, config.adminId, action);
  assert.equal(tx.network, 'testnet'); assert.equal(tx.actions[0].params.deposit, '0');
});
test('policy keeps the test token fixed and validates exact positive u128 atomic limits', () => {
  for (const cap of ['0', '-1', '1.5', '1e3', (MAX_U128 + BigInt(1)).toString()]) {
    assert.throws(() => buildTransaction(state, config.adminId, { method: 'set_policy', args: { policy: { ...state.policy!, per_order_cap: cap } } }), /positive whole/);
  }
  assert.throws(() => buildTransaction(state, config.adminId, { method: 'set_policy', args: { policy: { ...state.policy!, token_id: 'other.testnet' } } }), /test token/);
});
test('review does not sign; confirmation rechecks wallet identity and canonical payment', async () => {
  let signed = 0;
  const wallet = { getAccounts: async () => [{ accountId: config.adminId }], signAndSendTransaction: async () => { signed++; return { status: { SuccessValue: '' } }; } };
  const review = createReview(state, config.adminId, { method: 'approve_payment', args: { po_id: 'po-000001' } }, pending);
  assert.equal(signed, 0);
  await assert.rejects(submitReviewed(review, { ...wallet, getAccounts: async () => [{ accountId: 'other.testnet' }] }, async () => state, async () => pending), /account changed/);
  await assert.rejects(submitReviewed(review, wallet, async () => state, async () => ({ ...pending, payment: { ...pending.payment, state: 'Paid' } })), /no longer pending/);
  await assert.rejects(submitReviewed(review, wallet, async () => state, async () => ({ ...pending, purchaseOrder: { ...pending.purchaseOrder, amount: '999' } })), /order changed/);
  await assert.rejects(submitReviewed(review, wallet, async () => ({ ...state, paused: true }), async () => pending), /vault is paused/);
  assert.equal(signed, 0);
  const result = await submitReviewed(review, wallet, async () => state, async () => pending);
  assert.equal(signed, 1); assert.equal(result.confirmed, true);
});
test('wallet rejection, failed receipts and redirects never report success', async () => {
  const review = createReview(state, config.adminId, { method: 'set_paused', args: { paused: true } });
  const wallet = { getAccounts: async () => [{ accountId: config.adminId }], signAndSendTransaction: async (): Promise<unknown> => { throw new Error('User rejected'); } };
  await assert.rejects(submitReviewed(review, wallet, async () => state, async () => pending), /User rejected/);
  await assert.rejects(submitReviewed(review, { ...wallet, signAndSendTransaction: async () => ({ status: { SuccessValue: '' }, receipts_outcome: [{ outcome: { status: { Failure: {} } } }] }) }, async () => state, async () => pending), /receipt failed/);
  assert.equal((await submitReviewed(review, { ...wallet, signAndSendTransaction: async () => undefined }, async () => state, async () => pending)).confirmed, false);
});
test('an unanswered preflight times out without ever handing a transaction to the wallet', async () => {
  let signed = 0;
  let finishAccounts!: (accounts: { accountId: string }[]) => void;
  const accounts = new Promise<{ accountId: string }[]>((resolve) => { finishAccounts = resolve; });
  const wallet = { getAccounts: () => accounts, signAndSendTransaction: async () => { signed++; } };
  const review = createReview(state, config.adminId, { method: 'set_paused', args: { paused: false } });
  await assert.rejects(submitReviewed(review, wallet, async () => state, async () => pending, { preflightMs: 5 }), /account check timed out/);
  finishAccounts([{ accountId: config.adminId }]);
  await Promise.resolve();
  assert.equal(signed, 0, 'late preflight completion must not trigger signing');
});
test('a timed-out wallet signature remains unresolved and a late response is observed without retry', async () => {
  let signed = 0;
  let finish!: (result: unknown) => void;
  const response = new Promise<unknown>((resolve) => { finish = resolve; });
  const wallet = { getAccounts: async () => [{ accountId: config.adminId }], signAndSendTransaction: () => { signed++; return response; } };
  const review = createReview(state, config.adminId, { method: 'set_paused', args: { paused: false } });
  let timedOut: WalletResponsePendingError | undefined;
  try { await submitReviewed(review, wallet, async () => state, async () => pending, { signingMs: 5 }); }
  catch (cause) { assert.ok(cause instanceof WalletResponsePendingError); timedOut = cause; }
  assert.ok(timedOut); assert.equal(signed, 1);
  finish({ transaction: { hash: 'late-public-hash' }, status: { SuccessValue: '' } });
  assert.deepEqual(await timedOut.completion, { confirmed: true, hash: 'late-public-hash' });
  assert.equal(signed, 1);
});
test('late failed wallet receipts remain failed rather than becoming a retry or success', async () => {
  let finish!: (result: unknown) => void;
  const response = new Promise<unknown>((resolve) => { finish = resolve; });
  const review = createReview(state, config.adminId, { method: 'set_paused', args: { paused: false } });
  const wallet = { getAccounts: async () => [{ accountId: config.adminId }], signAndSendTransaction: () => response };
  let timeout: WalletResponsePendingError | undefined;
  try { await submitReviewed(review, wallet, async () => state, async () => pending, { signingMs: 5 }); }
  catch (cause) { assert.ok(cause instanceof WalletResponsePendingError); timeout = cause; }
  assert.ok(timeout);
  finish({ status: { Failure: {} } });
  await assert.rejects(timeout.completion, /receipt failed/);
});
test('read-only RPC fails closed on a network mismatch and reports undeployed accounts honestly', async () => {
  let calls = 0;
  const fetcher = (async (_url, options) => {
    calls++; const body = JSON.parse(String(options?.body));
    return Response.json({ result: body.method === 'status' ? { chain_id: 'mainnet' } : {} });
  }) as typeof fetch;
  await assert.rejects(vaultReader(config, fetcher).state(), /network mismatch/); assert.equal(calls, 1);
  const undeployed = (async (_url, options) => {
    const body = JSON.parse(String(options?.body));
    return Response.json({ result: body.method === 'status' ? { chain_id: 'testnet' } : { code_hash: '11111111111111111111111111111111' } });
  }) as typeof fetch;
  assert.equal((await vaultReader(config, undeployed).state()).deployment, 'not_deployed');
});
test('RPC checks deployed admin, token metadata and exact amounts before enabling controls', async () => {
  const views: Record<string, unknown> = { get_admin: config.adminId, get_policy: state.policy, is_paused: false,
    get_usage_state: { day: '20759', daily_spent: '0', daily_reserved: '0', total_spent: '0', total_reserved: '0' },
    get_commit_storage_reserve: '100000000000000000000', ft_balance_of: '10000', ft_metadata: { symbol: 'CCTEST', decimals: 0 } };
  const fetcher = (async (_url, options) => {
    const body = JSON.parse(String(options?.body));
    const result = body.method === 'status' ? { chain_id: 'testnet' }
      : body.params.request_type === 'view_account' ? { code_hash: 'deployed' }
      : { result: Array.from(Buffer.from(JSON.stringify(views[body.params.method_name]))) };
    return Response.json({ result });
  }) as typeof fetch;
  assert.equal((await vaultReader(config, fetcher).state()).balance, '10000');
  views.get_admin = 'other.testnet';
  await assert.rejects(vaultReader(config, fetcher).state(), /admin or token differs/);
  views.get_admin = config.adminId; views.ft_metadata = { symbol: 'USDC', decimals: 6 };
  await assert.rejects(vaultReader(config, fetcher).state(), /CCTEST test token/);
  views.ft_metadata = { symbol: 'CCTEST', decimals: 0 }; views.ft_balance_of = '1e10';
  await assert.rejects(vaultReader(config, fetcher).state(), /Invalid vault response/);
});

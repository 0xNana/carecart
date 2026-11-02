/** Invoked only by the Rust local Sandbox lifecycle test. Never accepts public RPCs. */
import assert from 'node:assert/strict';
import { Account, JsonRpcProvider, KeyPair, type KeyPairString } from 'near-api-js';
import { allocateId, closeDatabase, openDatabase } from '../db';
import { seedSyntheticData } from '../seed';
import { NearApiVaultClient } from '../near/client';
import { VaultPaymentAdapter } from './adapter';
import { createServer } from '../server';

async function main() {
  const rpcUrl = process.argv[2];
  assert.equal(new URL(rpcUrl).hostname, '127.0.0.1');
  const provider = new JsonRpcProvider({ url: rpcUrl });
  const sandboxChainId = (await provider.viewNodeStatus()).chain_id;
  assert.match(sandboxChainId, /^test-chain-[A-Za-z0-9]+$/);
  const fixtureKey = process.env.CARECART_SANDBOX_KEY as KeyPairString;
  assert.ok(fixtureKey);
  const admin = new Account('admin.sandbox', provider, fixtureKey);
  const call = async (contractId: string, methodName: string, args: object, deposit = 0n) =>
    admin.callFunction({ contractId, methodName, args, deposit, waitUntil: 'FINAL', gas: 120_000_000_000_000n });
  await call('token.sandbox', 'set_transfers_paused', { paused: false });
  await call('vault.sandbox', 'set_paused', { paused: false });
  await call('token.sandbox', 'ft_transfer', { receiver_id: 'vault.sandbox', amount: '10000' }, 1n);
  await call('vault.sandbox', 'fund_commit_storage', {}, 10n ** 24n);
  const committerKey = KeyPair.fromRandom('ed25519');
  const requesterKey = KeyPair.fromRandom('ed25519');
  for (const [accountId, key, method] of [
    ['procurement.sandbox', committerKey, 'commit_purchase_order'],
    ['agent.sandbox', requesterKey, 'request_payment'],
  ] as const) {
    await new Account(accountId, provider, fixtureKey).addFunctionCallAccessKey({
      publicKey: key.getPublicKey(), contractId: 'vault.sandbox', methodNames: [method], allowance: 10n ** 24n,
    });
  }
  const client = new NearApiVaultClient({ rpcUrl, vaultAccountId: 'vault.sandbox',
    committerAccountId: 'procurement.sandbox', committerPrivateKey: committerKey.toString(),
    requesterAccountId: 'agent.sandbox', requesterPrivateKey: requesterKey.toString(), sandboxChainId });
  const database = openDatabase(':memory:');
  try {
    seedSyntheticData(database);
    database.prepare("UPDATE suppliers SET near_account_id = 'supplier.sandbox' WHERE id = 'supplier-000001'").run();
    const adapter = new VaultPaymentAdapter(database, client, { tokenAccountId: 'token.sandbox', assetCode: 'CCTEST' });
    const app = createServer({ database, paymentAdapter: adapter, clock: () => new Date('2026-11-01T12:00:00Z') });
    await app.ready();
    try {
      const newPo = () => {
        const quoteId = allocateId(database, 'quote');
        const poId = allocateId(database, 'purchaseOrder');
        database.prepare(`INSERT INTO quotes SELECT ?, supplier_id, item_id, quantity, unit_price_atomic,
          total_amount_atomic, asset_code, quoted_at, expires_at FROM quotes WHERE id = 'quote-000001'`).run(quoteId);
        database.prepare(`INSERT INTO purchase_orders (id, quote_id, supplier_id, item_id, quantity,
          amount_atomic, asset_code, status, created_at) SELECT ?, ?, supplier_id, item_id, quantity,
          amount_atomic, asset_code, 'draft', created_at FROM purchase_orders WHERE id = 'po-000001'`).run(poId, quoteId);
        return poId;
      };
      const createPipelinePo = async () => {
        const inventory = await app.inject({ method: 'GET', url: '/api/inventory' });
        assert.equal(inventory.statusCode, 200);
        assert.equal(inventory.json().items[0].isLowStock, true);
        const forecast = await app.inject({ method: 'GET', url: '/api/inventory/item-000001/forecast' });
        assert.equal(forecast.statusCode, 200);
        assert.equal(forecast.json().observedUsageUnits, 27);
        const quotes = await app.inject({ method: 'POST', url: '/api/supplier-quotes', payload: { itemId: 'item-000001' } });
        assert.equal(quotes.statusCode, 201);
        const quote = quotes.json().quotes.find((entry: { supplierId: string }) => entry.supplierId === 'supplier-000001');
        const po = await app.inject({ method: 'POST', url: '/api/purchase-orders', payload: {
          itemId: 'item-000001', quoteId: quote.quoteId, requestId: 'sandbox-http-flow-0001',
        } });
        assert.equal(po.statusCode, 201);
        assert.equal(po.json().purchaseOrder.amountAtomic, quote.totalAmountAtomic);
        return po.json().purchaseOrder.id as string;
      };
      for (const expected of ['paid', 'pending_approval', 'blocked', 'failed'] as const) {
        const poId = expected === 'paid' ? await createPipelinePo() : newPo();
        await call('vault.sandbox', 'set_policy', { policy: { token_id: 'token.sandbox',
          per_order_cap: expected === 'pending_approval' ? '100' : '1000000', daily_cap: '1000000', balance_cap: '1000000' } });
        if (expected === 'blocked') {
          await adapter.ensurePurchaseOrderCommitted(poId);
          await call('vault.sandbox', 'set_paused', { paused: true });
        }
        if (expected === 'failed') await call('token.sandbox', 'set_transfers_paused', { paused: true });
        const response = await app.inject({ method: 'POST', url: '/api/payments', payload: { purchaseOrderId: poId } });
        assert.equal(response.statusCode, 200, response.body);
        const outcome = response.json().payment;
        assert.equal(outcome.status, expected);
        assert.ok(outcome.requestTransactionHash);
        assert.ok(outcome.commitTransactionHash);
        const persisted = database.prepare('SELECT status FROM payments WHERE purchase_order_id = ?').get(poId);
        assert.deepEqual(persisted, { status: expected });
        const auditCount = () => database.prepare("SELECT count(*) FROM audit_events WHERE entity_type = 'payment' AND entity_id = ?").pluck().get(poId);
        assert.equal(auditCount(), 1);
        assert.equal((await adapter.requestPayment(poId)).status, expected);
        assert.equal(auditCount(), 1);
        await call('vault.sandbox', 'set_paused', { paused: false });
      }
    } finally { await app.close(); }
    console.info('Backend Sandbox adapter: paid, pending, blocked, failed, restricted keys, hashes and replay audits passed');
  } finally { closeDatabase(database); }
}
void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });

import {PUBLIC_TOKENS} from '../near/token-registry';
import { afterEach, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { Account, JsonRpcProvider, KeyPair, baseEncode } from 'near-api-js';
import { quoteHash, type QuoteResponse } from '@defuse-protocol/one-click-sdk-typescript';
import { PROJECT_ROOT } from '../profiles/storage';
import { safetyProfile } from '../near/safety-profile';
import { SafetyOrderSchema, type SafetyOrder } from '../near/commitments';
import { BASE_USDC, NEAR_USDC, digest, buildSettlementRequest, verifySettlementQuote, type SettlementOrder } from '../intents/settlement';
import { signed } from '../intents/fixtures/settlement';
import { SettlementJournal } from '../intents/journal';
import { syntheticLocalCatalog } from './v2-catalog';
import { V2ProcurementStore } from './v2-store';
import { executeProcurementRole, reconcileProcurement } from './v2-bridge';

const now = new Date('2026-11-03T12:00:00Z');
const stores: V2ProcurementStore[] = [];
const directories: string[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
  vi.restoreAllMocks();
});

function fixture(options: { base?: boolean; aboveAuto?: boolean } = {}) {
  const parent = join(PROJECT_ROOT, 'backend/data/local-v2'); mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(join(parent, 'bridge-test-')); directories.push(directory);
  const committer = KeyPair.fromRandom('ed25519'), requester = KeyPair.fromRandom('ed25519');
  const profile = safetyProfile({ version: 2, network: 'mainnet', rpcUrl: 'https://rpc.mainnet.near.org',
    vault: 'vault.demo.near', admin: 'admin.demo.near', guardian: 'guardian.demo.near', treasury: 'treasury.demo.near',
    committer: 'committer.demo.near', requester: 'requester.demo.near', token: NEAR_USDC, decimals: 6,
    committerPublicKey: committer.getPublicKey().toString(), requesterPublicKey: requester.getPublicKey().toString(),
    maxKeyAllowanceYocto: '20000000000000000000000', codeHash: '1'.repeat(44), databasePath: join(directory, 'state.sqlite'),
  }).profile;
  const route = { route_id: 'base-alpha', version: 1, supplier: 'supplier-a.demo.near', recipient: `0x${'a'.repeat(40)}`,
    asset_id: `nep141:base-${BASE_USDC}.omft.near`, active: true };
  const catalog = syntheticLocalCatalog(['a', 'b', 'c'].map((letter, index) => ({ id: `mn-supplier-${index + 1}`,
    account: `supplier-${letter}.demo.near`, destination: options.base && index === 0 ? { Base: route } : 'Near' })));
  if (options.aboveAuto) for (const entry of catalog.entries) if (entry.itemId === 'mn-item-1') entry.unitPriceAtomic = '1000001';
  const store = new V2ProcurementStore(profile, catalog); stores.push(store);
  const orders = new Map<string, SafetyOrder>();
  const payments = new Map<string, { status: string; reason: string; attempt_id: string; reserved_day: number }>();
  const faults = { wrongNetwork: false, wrongDecimals: false, unknownSupplier: false, timeout: false, noEffect: false };
  // Real v2 client and journals; RPC/signing transport alone is replaced. No transaction is signed.
  vi.spyOn(JsonRpcProvider.prototype, 'viewNodeStatus').mockImplementation(async () => ({ chain_id: faults.wrongNetwork ? 'testnet' : 'mainnet' }) as never);
  vi.spyOn(JsonRpcProvider.prototype, 'viewAccount').mockImplementation(async({accountId})=>({code_hash:accountId===profile.token?PUBLIC_TOKENS[profile.network].codeHash:profile.codeHash}) as never);
  vi.spyOn(JsonRpcProvider.prototype, 'viewAccessKey').mockImplementation(async ({ accountId }) => ({ permission: { FunctionCall: {
    receiver_id: profile.vault, allowance: '10000000000000000000000',
    method_names: accountId === profile.committer ? ['commit_purchase_order', 'commit_quote'] : ['request_payment', 'request_crosschain'],
  } } }) as never);
  vi.spyOn(JsonRpcProvider.prototype, 'callFunction').mockImplementation(async ({ method, args }) => {
    const input = args as Record<string, string>;
    if (method === 'ft_metadata') return { decimals: faults.wrongDecimals ? 0 : 6, symbol: 'USDC',spec:'ft-1.0.0' };
    if (method === 'get_state') return { profile: 'mainnet', admin: profile.admin, guardian: profile.guardian, treasury: profile.treasury, token: profile.token };
    if (method === 'get_roles') return { supplier: !faults.unknownSupplier, committer: input.account === profile.committer, requester: input.account === profile.requester };
    if (method === 'get_purchase_order') return orders.get(input.po_id);
    if (method === 'get_payment') return payments.get(input.po_id);
    if (method === 'get_route') return route;
    throw new Error(`Unexpected fixture RPC ${method}`);
  });
  const transport = vi.spyOn(Account.prototype, 'callFunctionRaw').mockImplementation(async function (this: Account, input) {
    if (input.methodName === 'commit_purchase_order') {
      expect(this.accountId).toBe(profile.committer);
      const order = SafetyOrderSchema.parse((input.args as { order: unknown }).order);
      orders.set(order.po_id, order);
      payments.set(order.po_id, { status: 'Committed', reason: 'None', attempt_id: '', reserved_day: 0 });
    } else if (input.methodName === 'request_payment') {
      expect(this.accountId).toBe(profile.requester);
      const { po_id } = input.args as { po_id: string };
      expect(Object.keys(input.args!)).toEqual(['po_id']);
      if (!faults.noEffect) payments.set(po_id, { status: BigInt(orders.get(po_id)!.amount) > 10_000_000n ? 'PendingApproval' : 'Dispatching',
        reason: options.aboveAuto ? 'AutoThreshold' : 'None', attempt_id: '', reserved_day: 1 });
      if (faults.timeout) throw new Error('fixture RPC timeout');
    } else throw new Error('Unexpected signing capability');
    return { transaction: { hash: `mock-transaction-${transport.mock.calls.length}` } } as never;
  });
  const env = (role: 'committer' | 'requester') => ({ CARECART_SAFETY_WRITES: 'approved',
    ...(role === 'committer' ? { SAFETY_COMMITTER_PRIVATE_KEY: committer.toString() } : { SAFETY_REQUESTER_PRIVATE_KEY: requester.toString() }) });
  const select = (itemId = 'mn-item-1') => {
    store.inventoryEvent({ eventId: 'inventory-1', itemId }, now);
    const order = store.selectQuote({ eventId: 'inventory-1' }, now);
    return { order, input: { poId: order.canonical.po_id, expectedHash: digest(order.canonical) } };
  };
  return { store, profile, catalog, transport, orders, payments, faults, env, select };
}

it('connects persisted procurement to separate restricted commit and ID-only request, without duplicate obligations', async () => {
  const f = fixture(); const { order, input } = f.select();
  expect(order.canonical.amount).toBe('1000000');
  await executeProcurementRole(f.store, 'committer', input, f.env('committer'), now);
  await executeProcurementRole(f.store, 'committer', input, f.env('committer'), now);
  expect(f.transport).toHaveBeenCalledTimes(1);
  const result = await executeProcurementRole(f.store, 'requester', input, f.env('requester'), now);
  expect(result.vaultPayment.status).toBe('Dispatching'); // mocked source state, never a real settlement
  await executeProcurementRole(f.store, 'requester', input, f.env('requester'), now);
  expect(f.transport).toHaveBeenCalledTimes(2);
  expect(f.store.inspect(input.poId).operations).toHaveLength(2);
  expect(f.store.inspect(input.poId).observations).toHaveLength(4);
});

it('refuses payment for a draft, a conflicting onchain PO, or a stale operator hash', async () => {
  const f = fixture(); const { order, input } = f.select();
  await expect(executeProcurementRole(f.store, 'requester', input, f.env('requester'), now)).rejects.toThrow(/unavailable|committed/);
  await expect(executeProcurementRole(f.store, 'committer', { ...input, expectedHash: 'b'.repeat(64) }, f.env('committer'), now)).rejects.toThrow(/authorization/);
  f.orders.set(input.poId, { ...order.canonical, amount: '2000000' });
  await expect(executeProcurementRole(f.store, 'committer', input, f.env('committer'), now)).rejects.toThrow(/conflict/);
  await expect(executeProcurementRole(f.store, 'requester', input, f.env('requester'), now)).rejects.toThrow(/conflict/);
  expect(f.transport).not.toHaveBeenCalled();
});

it('isolates an unknown supplier at 4 USDC, below both payout and automatic limits', async () => {
  const f = fixture(); const { order, input } = f.select('mn-item-4');
  expect(order.canonical.amount).toBe('4000000'); f.faults.unknownSupplier = true;
  await expect(executeProcurementRole(f.store, 'committer', input, f.env('committer'), now)).rejects.toThrow(/supplier.*allowlisted/);
  expect(f.transport).not.toHaveBeenCalled();
});

it.each(['network', 'decimals'])('rejects RPC %s mismatch before the commit transport', async (fault) => {
  const f = fixture(); const { input } = f.select();
  f.faults.wrongNetwork = fault === 'network'; f.faults.wrongDecimals = fault === 'decimals';
  await expect(executeProcurementRole(f.store, 'committer', input, f.env('committer'), now)).rejects.toThrow(/mismatch/);
  expect(f.transport).not.toHaveBeenCalled();
});

it('rejects missing authorization, arbitrary payment fields and role crossover before any transport', async () => {
  const f = fixture(); const { input } = f.select();
  for (const env of [{}, { CARECART_SAFETY_WRITES: 'approved' }, f.env('requester'), { ...f.env('committer'), AGENT_FC_PRIVATE_KEY: 'legacy-crossover' }])
    await expect(executeProcurementRole(f.store, 'committer', input, env, now)).rejects.toThrow();
  await expect(executeProcurementRole(f.store, 'committer', { ...input, amount: '4000000' }, f.env('committer'), now)).rejects.toThrow();
  await expect(executeProcurementRole(f.store, 'requester', { ...input, recipient: 'attacker.near' }, f.env('requester'), now)).rejects.toThrow();
  await expect(executeProcurementRole(f.store, 'admin' as never, input, f.env('committer'), now)).rejects.toThrow();
  expect(f.transport).not.toHaveBeenCalled();
});

it('keeps no-effect timeouts frozen across reopen, then reconciles only observed effects without another request', async () => {
  const f = fixture(); const { input } = f.select();
  await executeProcurementRole(f.store, 'committer', input, f.env('committer'), now);
  f.faults.timeout = true; f.faults.noEffect = true;
  await expect(executeProcurementRole(f.store, 'requester', input, f.env('requester'), now)).rejects.toThrow(/ambiguous/);
  f.store.close();
  const reopened = new V2ProcurementStore(f.profile, f.catalog); stores.push(reopened);
  expect(reopened.inspect(input.poId).operations).toEqual(expect.arrayContaining([expect.objectContaining({ state: 'Ambiguous' })]));
  await expect(reconcileProcurement(reopened, { poId: input.poId, operation: 'request' }, now)).rejects.toThrow(/unresolved/);
  await expect(executeProcurementRole(reopened, 'requester', input, f.env('requester'), now)).rejects.toThrow(/reconcile/);
  expect(f.transport).toHaveBeenCalledTimes(2);
  f.payments.set(input.poId, { status: 'Dispatching', reason: 'None', attempt_id: '', reserved_day: 1 });
  const result = await reconcileProcurement(reopened, { poId: input.poId, operation: 'request' }, now);
  expect(result.operation).toEqual({ transactionHash: null, reconciled: true });
  expect(f.transport).toHaveBeenCalledTimes(2);
});

it('records above-auto pending state without asserting a funded five-USDC launch scenario', async () => {
  const f = fixture({ aboveAuto: true }); const { input } = f.select();
  expect(f.store.inspect(input.poId).exceedsInitialDepositCeiling).toBe(true);
  await executeProcurementRole(f.store, 'committer', input, f.env('committer'), now);
  const result = await executeProcurementRole(f.store, 'requester', input, f.env('requester'), now);
  expect(result.vaultPayment.status).toBe('PendingApproval');
});

it('binds Base recipient/route in the invoice and forbids ID-only cross-chain initiation without human review', async () => {
  const f = fixture({ base: true }); const { order, input } = f.select();
  expect(order.canonical.destination).toHaveProperty('Base.route_id', 'base-alpha');
  await executeProcurementRole(f.store, 'committer', input, f.env('committer'), now);
  await expect(executeProcurementRole(f.store, 'requester', input, f.env('requester'), now)).rejects.toThrow(/human review/);
  expect(f.transport).toHaveBeenCalledTimes(1);
});

it('rejects first commitment after quote expiry but allows identical committed-PO reconciliation', async () => {
  const f = fixture(); const { input } = f.select();
  const expired = new Date(now.getTime() + 8 * 86400000);
  await expect(executeProcurementRole(f.store, 'committer', input, f.env('committer'), expired)).rejects.toThrow(/expired/);
  expect(f.transport).not.toHaveBeenCalled();
  await executeProcurementRole(f.store, 'committer', input, f.env('committer'), now);
  await executeProcurementRole(f.store, 'committer', input, f.env('committer'), expired);
  expect(f.transport).toHaveBeenCalledTimes(1);
});

it('recovers a commit timeout by comparing the persisted order with finalized canonical effects', async () => {
  const f = fixture(); const { order, input } = f.select();
  f.transport.mockImplementationOnce(async () => { throw new Error('fixture timeout'); });
  await expect(executeProcurementRole(f.store, 'committer', input, f.env('committer'), now)).rejects.toThrow(/ambiguous/);
  await expect(executeProcurementRole(f.store, 'committer', input, f.env('committer'), now)).rejects.toThrow(/reconcile/);
  expect(f.transport).toHaveBeenCalledTimes(1);
  f.orders.set(input.poId, order.canonical);
  f.payments.set(input.poId, { status: 'Committed', reason: 'None', attempt_id: '', reserved_day: 0 });
  const result = await reconcileProcurement(f.store, { poId: input.poId, operation: 'commit' }, now);
  expect(result.operation).toEqual({ transactionHash: null, reconciled: true });
  expect(f.transport).toHaveBeenCalledTimes(1);
});

it('does not use cached procurement observations as payment authority after source state changes', async () => {
  const f = fixture(); const { order, input } = f.select();
  await executeProcurementRole(f.store, 'committer', input, f.env('committer'), now);
  f.orders.set(input.poId, { ...order.canonical, supplier: 'changed.near' });
  await expect(executeProcurementRole(f.store, 'requester', input, f.env('requester'), now)).rejects.toThrow(/conflict/);
  expect(f.transport).toHaveBeenCalledTimes(1);
});

it('rejects a compromised persisted Base recipient before the committer can use it', async () => {
  const f = fixture({ base: true }); const { order, input } = f.select();
  const db = new Database(f.profile.databasePath);
  try {
    const row = db.prepare("SELECT body_json FROM v2_procurement_records WHERE kind='quote' AND id=?").get(order.quoteId) as { body_json: string };
    const quote = JSON.parse(row.body_json); quote.destination.Base.recipient = `0x${'b'.repeat(40)}`;
    db.prepare("UPDATE v2_procurement_records SET body_json=? WHERE kind='quote' AND id=?").run(JSON.stringify(quote), order.quoteId);
  } finally { db.close(); }
  await expect(executeProcurementRole(f.store, 'committer', input, f.env('committer'), now)).rejects.toThrow(/trusted terms/);
  expect(f.transport).not.toHaveBeenCalled();
});

it('links a separately prepared settlement-journal attempt to the persisted procurement PO without claiming settlement', async () => {
  const f = fixture({ base: true }); const { order, input } = f.select();
  const supplier = f.catalog.suppliers[0];
  if (supplier.destination === 'Near') throw new Error('Base fixture required');
  const route = supplier.destination.Base;
  const settlementOrder: SettlementOrder = { profile: 'local-usdc-v2', poId: input.poId, vault: f.profile.vault,
    treasury: f.profile.treasury, supplier: order.canonical.supplier, token: NEAR_USDC, amount: order.canonical.amount,
    invoiceDigest: order.canonical.invoice_digest, routeId: route.route_id, routeVersion: route.version,
    recipient: route.recipient, destinationChain: 'base', destinationToken: BASE_USDC, maxFeeAtomic: '100000' };
  const tokens = [{ assetId: `nep141:${NEAR_USDC}`, blockchain: 'near', contractAddress: NEAR_USDC, symbol: 'USDC', decimals: 6 },
    { assetId: route.asset_id, blockchain: 'base', contractAddress: BASE_USDC, symbol: 'USDC', decimals: 6 }];
  const expected = buildSettlementRequest(settlementOrder, tokens, now);
  const { raw, key } = await signed(); // Offline ephemeral provider fixture; never a NEAR transaction signer.
  raw.timestamp = now.toISOString(); raw.quoteRequest = expected;
  raw.quote.deadline = expected.deadline; raw.quote.timeWhenInactive = expected.deadline;
  raw.signature = baseEncode(key.sign(new TextEncoder().encode(quoteHash(raw as unknown as QuoteResponse))).signature);
  const verified = verifySettlementQuote(settlementOrder, raw, expected, now, key.getPublicKey().toString());
  const journal = new SettlementJournal(f.profile.databasePath, f.store.fingerprint);
  try {
    journal.prepare('mock-base-attempt', verified);
    expect(f.store.inspect(input.poId).settlement).toEqual([expect.objectContaining({ id: 'mock-base-attempt', state: 'PendingApproval', source_evidence: null })]);
    expect(f.store.inspect(input.poId).evidenceNotice).toContain('not independent receipt proofs');
    expect(f.transport).not.toHaveBeenCalled();
  } finally { journal.close(); }
});

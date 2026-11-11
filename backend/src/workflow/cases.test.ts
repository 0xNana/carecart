import { afterEach, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { KeyPair } from 'near-api-js';
import Database from 'better-sqlite3';
import { PROJECT_ROOT } from '../profiles/storage';
import { safetyProfile } from '../near/safety-profile';
import { NEAR_USDC, digest } from '../intents/settlement';
import { syntheticLocalCatalog } from '../procurement/v2-catalog';
import { V2ProcurementStore } from '../procurement/v2-store';
import { ReplenishmentWorkflow } from './cases';

const now = new Date('2026-11-03T12:00:00Z');
const cleanup: (() => void)[] = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); });
function fixture() {
  const parent = join(PROJECT_ROOT, 'backend/data/local-v2'); mkdirSync(parent, { recursive: true });
  const dir = mkdtempSync(join(parent, 'case-test-')); cleanup.push(() => rmSync(dir, { recursive: true }));
  const profile = safetyProfile({ version: 2, network: 'mainnet', rpcUrl: 'https://rpc.mainnet.near.org',
    vault: 'vault.demo.near', admin: 'admin.demo.near', guardian: 'guardian.demo.near', treasury: 'treasury.demo.near',
    committer: 'committer.demo.near', requester: 'requester.demo.near', token: NEAR_USDC, decimals: 6,
    committerPublicKey: KeyPair.fromRandom('ed25519').getPublicKey().toString(), requesterPublicKey: KeyPair.fromRandom('ed25519').getPublicKey().toString(),
    maxKeyAllowanceYocto: '20000000000000000000000', codeHash: '1'.repeat(44), databasePath: join(dir, 'state.sqlite'),
  }).profile;
  const catalog = syntheticLocalCatalog(['a', 'b', 'c'].map((l, i) => ({ id: `mn-supplier-${i+1}`, account: `supplier-${l}.demo.near`, destination: 'Near' })));
  const store = new V2ProcurementStore(profile, catalog); cleanup.push(() => store.close());
  const workflow = new ReplenishmentWorkflow(store); cleanup.push(() => workflow.close());
  return { store, profile, catalog, workflow };
}
const event = { caseId: 'case-1', idempotencyKey: 'inventory-1', eventId: 'inventory-1', itemId: 'mn-item-1' };
it('creates one durable case, reconstructs trusted terms and resumes after reopen before commitment', () => {
  const f = fixture(); const first = f.workflow.ingest(event, now);
  expect(first.state).toBe('PoDrafted');
  expect(first.nextAction).toBe('AuthorizeCommitment');
  expect(first.domain?.quote.amountAtomic).toBe('1000000');
  expect(first.timeline.map(e => e.resultingState)).toEqual(['Opened','InventoryRecorded','ForecastEvaluated','QuotesAvailable','SupplierSelected','PoDrafted']);
  expect(f.workflow.ingest(event, now)).toEqual(first);
  f.workflow.close(); f.store.close();
  const store = new V2ProcurementStore(f.profile, f.catalog); cleanup.push(() => store.close());
  const reopened = new ReplenishmentWorkflow(store); cleanup.push(() => reopened.close());
  expect(reopened.get(event.caseId)).toEqual(first);
  expect(reopened.list()).toHaveLength(1);
});
it('refuses conflicting case IDs, idempotency keys, events and arbitrary authority fields', () => {
  const { workflow } = fixture(); workflow.ingest(event, now);
  for (const changed of [{ caseId: 'case-2' }, { itemId: 'mn-item-2' }, { idempotencyKey: 'other' }, { eventId: 'other' }, { amount: '4000000' }])
    expect(() => workflow.ingest({ ...event, ...changed }, now)).toThrow();
});
it('never adopts changed canonical PO terms from workflow or procurement rows', () => {
  const { workflow } = fixture(); const c = workflow.ingest(event, now);
  expect(c.poHash).toMatch(/^[a-f0-9]{64}$/);
  expect(c.vault).toBeNull();
  expect(c.paymentState).toBe('Unobserved');
  expect(() => workflow.ingest({ ...event, state: 'SameChainConfirmed' }, now)).toThrow();
});

it('reconstructs event/quote and PO/case boundaries after interrupted local updates', () => {
  const f=fixture();
  f.store.inventoryEvent({eventId:event.eventId,itemId:event.itemId},now);
  const order=f.store.selectQuote({eventId:event.eventId},now);
  const c=f.workflow.ingest(event,now);
  expect(c.poId).toBe(order.canonical.po_id);
  expect(f.workflow.list()).toHaveLength(1);
});
it('uses optimistic versions to reject a concurrent authorized action before transport', async () => {
  const f=fixture(); const c=f.workflow.ingest(event,now);
  const second=new ReplenishmentWorkflow(f.store); cleanup.push(() => second.close());
  const stale=second.get(c.caseId).version;
  // Preparation replay is idempotent and does not silently change revisions.
  expect(second.prepare(c.caseId,now).version).toBe(stale);
  await expect(second.act({caseId:c.caseId,role:'committer',expectedVersion:stale-1,expectedHash:c.poHash},
    {CARECART_SAFETY_WRITES:'approved',SAFETY_COMMITTER_PRIVATE_KEY:'invalid-fixture'},now)).rejects.toThrow(/Concurrent/);
  expect(f.workflow.get(c.caseId).version).toBe(stale);
});
it('records supplier-quote expiry after reopening an inventory event persisted before case creation', () => {
  const f=fixture(); f.store.inventoryEvent({eventId:event.eventId,itemId:event.itemId},now);
  const c=f.workflow.ingest(event,new Date(now.getTime()+8*86400000));
  expect(c.state).toBe('Expired'); expect(c.poId).toBeNull(); expect(c.nextAction).toBe('InspectTerminalEvidence');
});

it('rejects corrupt/missing audit events and altered case identity rather than trusting cached state', async () => {
 const f=fixture();f.workflow.ingest(event,now);
 const db=new Database(f.profile.databasePath);
 try {
  db.prepare("UPDATE replenishment_cases SET identity_json=?").run(JSON.stringify({...event,itemId:'mn-item-2'}));
  expect(()=>f.workflow.get(event.caseId)).toThrow(/audit evidence/);
  db.prepare('UPDATE replenishment_cases SET identity_json=?').run(JSON.stringify(event));
  db.prepare('DELETE FROM replenishment_events WHERE version=2').run();
  expect(()=>f.workflow.get(event.caseId)).toThrow(/audit evidence/);
 } finally {db.close();}
});
it('case projection rejects recomputed supplier selection or canonical amount tampering', async () => {
 const f=fixture();const c=f.workflow.ingest(event,now);
 const db=new Database(f.profile.databasePath);
 try {
  const row=db.prepare('SELECT body_json FROM v2_procurement_orders WHERE po_id=?').get(c.poId) as {body_json:string};
  const order=JSON.parse(row.body_json);order.canonical.amount='4000000';
  db.prepare('UPDATE v2_procurement_orders SET body_json=? WHERE po_id=?').run(JSON.stringify(order),c.poId);
  expect(()=>f.workflow.get(event.caseId)).toThrow(/Conflicting PO/);
 } finally {db.close();}
});
it('recomputes the winning supplier before projecting a compromised procurement decision',()=>{
 const f=fixture();const c=f.workflow.ingest(event,now);const order=c.domain!.purchaseOrder;const other=c.inventory!.quotes[1];
 const reference=`synthetic:${event.eventId}:${other.id}`;
 const forged={...order,quoteId:other.id,quoteDigest:digest(other),invoiceReference:reference,
  canonical:{...order.canonical,supplier:other.supplierAccount,amount:other.amountAtomic,
   invoice_digest:digest([f.store.fingerprint,c.inventory!.event,other,reference])}};
 const db=new Database(f.profile.databasePath);
 try {db.prepare('UPDATE v2_procurement_orders SET quote_id=?,body_json=? WHERE po_id=?').run(other.id,JSON.stringify(forged),c.poId);
  expect(()=>f.workflow.get(c.caseId)).toThrow(/selection/);
 } finally {db.close();}
});

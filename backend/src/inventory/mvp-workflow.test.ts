import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { InventoryLedger, gloves } from './ledger';

const cleanups: (() => void)[] = [];
afterEach(() => { for (const close of cleanups.splice(0).reverse()) close(); });
function fixture(initial = 30) {
  const dir = mkdtempSync(join(tmpdir(), 'carecart-mvp-')); cleanups.push(() => rmSync(dir, { recursive: true }));
  let time = Date.UTC(2026, 10, 7, 12);
  const ledger = new InventoryLedger(join(dir, 'stock.sqlite'), 'a'.repeat(64), [gloves], () => time);
  cleanups.push(() => ledger.close());
  ledger.move({ id: 'opening', productId: gloves.id, kind: 'Opening', quantity: initial, unit: 'base', source: 'synthetic' }, 'synthetic-seed');
  return { ledger, advance: (days: number) => { time += days * 86400000; }, now: () => time };
}
const movement = (id: string, kind: string, quantity: number) => ({ id, kind, quantity, productId: gloves.id, unit: 'base', source: 'manual' });

it('receives packs with attributable supplier/batch/date evidence exactly once and preserves it on reopen', () => {
  const { ledger, now } = fixture();
  const receipt = { ...movement('receipt', 'Receive', 2), unit: 'pack', supplierId: 'mn-supplier-1', batch: 'LOT-7', receivedAt: new Date(now() - 60000).toISOString(), receiptReference: 'DO-7-LINE-1', expiresAt: new Date(now() + 86400000).toISOString() };
  const saved = ledger.move(receipt, 'operator:staff');
  expect(ledger.move(receipt, 'operator:staff')).toEqual(saved);
  expect(() => ledger.move({ ...receipt, id: 'duplicate' }, 'operator:staff')).toThrow();
  expect(ledger.balance(gloves.id).onHand).toBe(50);
  expect(saved).toMatchObject({ supplierId: 'mn-supplier-1', batch: 'LOT-7', actor: 'operator:staff', receivedAt: receipt.receivedAt });
  const path = ledger.path; ledger.close();
  const reopened = new InventoryLedger(path, 'a'.repeat(64), [gloves], now); cleanups.push(() => reopened.close());
  expect(reopened.history(gloves.id).at(-1)).toEqual(saved);
});

it('dispensing and direct consumption are alternative deductions; the same reference cannot deduct twice', () => {
  const { ledger } = fixture();
  const dispense = { ...movement('dispense', 'Dispense', 4), destination: 'Outpatient storeroom use', reference: 'OUT-7' };
  const saved = ledger.move(dispense, 'operator:staff');
  expect(ledger.move(dispense, 'operator:staff')).toEqual(saved);
  expect(ledger.balance(gloves.id).onHand).toBe(26);
  expect(() => ledger.move({ ...movement('double-count', 'Consume', 4), reference: 'OUT-7' }, 'operator:staff')).toThrow();
  expect(ledger.history(gloves.id)).toHaveLength(2);
  ledger.move({ ...movement('direct-consumption', 'Consume', 2), reference: 'CONSUME-8' }, 'operator:staff');
  expect(ledger.balance(gloves.id).onHand).toBe(24);
  expect(ledger.db.prepare('SELECT generation FROM inventory_jobs').pluck().get()).toBe(3);
});

it('dispensing cannot exceed available stock, cannot forge its actor, and requires a meaningful destination', () => {
  const { ledger } = fixture();
  ledger.move(movement('reserved', 'Reserve', 28), 'operator:staff');
  const draft = { ...movement('dispense', 'Dispense', 3), destination: 'Treatment room' };
  expect(() => ledger.move(draft, 'operator:staff')).toThrow(/Insufficient/);
  expect(() => ledger.move({ ...draft, quantity: 1, destination: '  ' }, 'operator:staff')).toThrow();
  expect(() => ledger.move({ ...draft, quantity: 1, actor: 'admin' }, 'operator:staff')).toThrow();
  expect(ledger.balance(gloves.id).onHand).toBe(30);
});

it('adjustments retain immutable history and reject blank reasons and invalid balances; future receipt dates fail', () => {
  const { ledger, now } = fixture();
  expect(() => ledger.move({ ...movement('blank', 'AdjustUp', 1), reason: '  ' }, 'operator:staff')).toThrow();
  expect(() => ledger.move({ ...movement('negative', 'AdjustDown', 31), reason: 'Count correction' }, 'operator:staff')).toThrow();
  expect(() => ledger.move({ ...movement('future', 'Receive', 1), receiptReference: 'DO-FUTURE', receivedAt: new Date(now() + 1).toISOString() }, 'operator:staff')).toThrow();
  ledger.move({ ...movement('count', 'AdjustDown', 1), reason: 'Counted one damaged box' }, 'operator:staff');
  expect(ledger.balance(gloves.id).onHand).toBe(29);
  expect(() => ledger.db.prepare("DELETE FROM inventory_movements WHERE id='count'").run()).toThrow(/Append-only/);
});

it('forecast demand includes dispensing and consumption once, over the same persisted movement history', () => {
  const { ledger, advance } = fixture(100);
  ledger.move({ ...movement('day-one', 'Dispense', 8), destination: 'Treatment room' }, 'operator:staff');
  advance(3); ledger.move(movement('day-four', 'Consume', 4), 'operator:staff');
  advance(4); ledger.move({ ...movement('day-eight', 'Dispense', 8), destination: 'Treatment room' }, 'operator:staff');
  advance(1);
  expect(ledger.forecast(gloves.id)).toMatchObject({ basis: 'consumption-history', observedDays: 3, observedConsumptionUnits: 20, dailyDemand: 3 });
});

it('dispensing triggers one durable replenishment; physical receipt and restart never duplicate the order',async()=>{
  const {randomUUID}=await import('node:crypto');const {dirname}=await import('node:path');
  const {openInventoryOperations}=await import('./local.js');const {localOperationsProfile}=await import('../operations/local.js');
  const name='test-'+randomUUID();let time=Date.UTC(2026,10,7,12);let local=openInventoryOperations(name,()=>time,{dataset:'clinic'});
  cleanups.push(()=>{local.close();rmSync(dirname(localOperationsProfile(name).databasePath),{recursive:true,force:true});});
  local.inventory.configure({...local.inventory.config(),monitoring:true,automaticCases:true,automaticPreparation:true},'operator:staff');
  local.inventory.move({...movement('dispensed-trigger','Dispense',4),destination:'Treatment room',reference:'ISSUE-DEMO'},'operator:staff');
  expect(local.inventory.balance(gloves.id).onHand).toBe(26);
  for(let i=0;i<6;i++)expect(local.monitor.runOnce('mvp-worker')?.state).toBe('Completed');
  const row=local.inventory.db.prepare('SELECT case_id FROM inventory_obligations WHERE product_id=?').get(gloves.id) as {case_id:string};
  const proposal=local.workflow.get(row.case_id);expect(proposal.state).toBe('PoDrafted');expect(proposal.paymentState).toBe('Unobserved');
  expect(proposal.domain!.quote.supplierId).toBe('mn-supplier-1');
  const quantity=proposal.domain!.quote.quantity;
  const receipt={...movement('goods-arrived','Receive',quantity),orderId:proposal.poId,receiptReference:'DO-DEMO-LINE-1',supplierId:'mn-supplier-1',batch:'LOT-DEMO',receivedAt:new Date(time).toISOString()};
  local.inventory.move(receipt,'operator:staff');expect(()=>local.inventory.move({...receipt,id:'duplicate-goods'},'operator:staff')).toThrow();
  expect(local.inventory.balance(gloves.id).onHand).toBe(26+quantity);
  expect(local.monitor.runOnce('mvp-worker')?.state).toBe('Completed');
  local.close();time+=31000;local=openInventoryOperations(name,()=>time,{dataset:'clinic'});
  for(let i=0;i<6;i++)local.monitor.runOnce('restarted-worker');
  expect(local.inventory.db.prepare('SELECT count(*) FROM v2_procurement_orders').pluck().get()).toBe(1);
  expect(local.workflow.get(row.case_id).poId).toBe(proposal.poId);
  expect(local.workflow.get(row.case_id).paymentState).toBe('Unobserved');
});

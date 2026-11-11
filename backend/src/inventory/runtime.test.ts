import { it, expect, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { rmSync } from 'node:fs';
import { openInventoryOperations } from './local';
import { InventoryMonitor } from './monitor';
import { InventoryLedger } from './ledger';
import { createOperationsApp } from '../operations/api';
import {openLocalOperations} from '../operations/local';
const opened: ReturnType<typeof openInventoryOperations>[] = [];
function fixture() { const local = openInventoryOperations('test-' + randomUUID()); opened.push(local); return local; }
afterEach(() => { for (const l of opened.splice(0)) {
    l.close();
    rmSync(dirname(l.store.profile.databasePath), { recursive: true, force: true });
} });
it('LOCAL SQLITE: compensating consumption corrections update demand and cannot over-correct',()=>{
 const l=fixture();const common={productId:'mn-item-1',unit:'base',source:'synthetic'};
 l.inventory.move({...common,id:'wrong-use',kind:'Consume',quantity:4},'operator');
 l.inventory.move({...common,id:'undo-two',kind:'AdjustUp',quantity:2,corrects:'wrong-use',reason:'Two boxes were not dispensed'},'operator');
 expect(()=>l.inventory.move({...common,id:'over-correction',kind:'AdjustUp',quantity:3,corrects:'wrong-use',reason:'Incorrect correction'},'operator')).toThrow(/excessive/);
 l.inventory.move({...common,id:'undo-correction',kind:'AdjustDown',quantity:1,corrects:'undo-two',reason:'One box actually used'},'operator');
 expect(l.inventory.balance('mn-item-1').onHand).toBe(9);
 expect(l.inventory.forecast('mn-item-1').observedConsumptionUnits).toBe(3);
 expect(l.inventory.history('mn-item-1').filter(m=>m.kind==='Consume')).toHaveLength(1);
});
it('LOCAL SQLITE: new consumption recomputes live forecast but cannot rewrite an existing PO',()=>{
 const l=fixture();l.monitor.runOnce('prepare');const c=l.workflow.get(l.inventory.dashboard().obligations[0].caseId);
 const before=l.store.resolve(c.poId!);
 l.inventory.move({id:'later-use',productId:'mn-item-1',kind:'Consume',quantity:4,unit:'base',source:'synthetic'},'operator');
 expect(l.store.inventoryForecast('mn-item-1').item.onHand).toBe(8);
 expect(l.store.resolve(c.poId!)).toEqual(before);l.monitor.runOnce('re-evaluate');
 expect(l.inventory.dashboard().obligations).toHaveLength(1);expect(l.workflow.get(c.caseId).poHash).toBe(c.poHash);
});
it('LOCAL SQLITE: consumption automatically prepares one canonical PO at the financial boundary and survives restart', () => {
    const l = fixture();
    l.inventory.move({ id: 'consumption-1', productId: 'mn-item-1', kind: 'Consume', quantity: 4, unit: 'base', source: 'synthetic' }, 'operator');
    expect(l.inventory.balance('mn-item-1').onHand).toBe(8);
    const run = l.monitor.runOnce('worker-1');
    expect(run?.state).toBe('Completed');
    const dashboard = l.inventory.dashboard();
    expect(dashboard.items[0].forecast.reorderPoint).toBe(28);
    expect(dashboard.items[0].forecast.basis).toBe('configured-baseline');
    const obligation = dashboard.obligations[0];
    const c = l.workflow.get(obligation.caseId);
    expect(c.state).toBe('PoDrafted');
    expect(c.nextAction).toBe('AuthorizeCommitment');
    expect(c.paymentState).toBe('Unobserved');
    expect(c.domain?.quote.quantity).toBe(40);
    expect(c.domain?.purchaseOrder.canonical.amount).toBe('2000000');
    l.monitor.runOnce('worker-1');
    expect(l.inventory.dashboard().obligations).toHaveLength(1);
    l.inventory.move({ id: 'incoming', productId: 'mn-item-1', kind: 'ConfirmInbound', quantity: 40, unit: 'base', orderId: c.poId!, source: 'synthetic',confirmationReference:'SYNTHETIC-ORDER-1',confirmedAt:new Date(l.inventory.clock()).toISOString() }, 'operator');
    expect(l.inventory.balance('mn-item-1').inventoryPosition).toBe(48);
    expect(l.inventory.balance('mn-item-1').onHand).toBe(8);
    l.inventory.move({ id: 'physical-receipt', productId: 'mn-item-1', kind: 'Receive', quantity: 4, unit: 'pack', orderId: c.poId!, source: 'synthetic',receiptReference:'DELIVERY-1-LINE-1' }, 'operator');
    expect(l.inventory.balance('mn-item-1')).toMatchObject({ onHand: 48, incoming: 0 });
    expect(l.workflow.get(c.caseId).paymentState).toBe('Unobserved');
    const before = l.workflow.get(c.caseId);
    l.close();
    const restarted = openInventoryOperations(l.name);
    opened.push(restarted);
    expect(restarted.workflow.get(c.caseId)).toEqual(before);
    expect(restarted.inventory.balance('mn-item-1').onHand).toBe(48);
});
it('LOCAL SQLITE: duplicate movements are idempotent, conflicting IDs and negative balances fail', () => {
    const l = fixture();
    const m = { id: 'consume', productId: 'mn-item-1', kind: 'Consume', quantity: 4, unit: 'base', source: 'synthetic' };
    l.inventory.move(m, 'staff');
    l.inventory.move(m, 'staff');
    expect(l.inventory.balance(m.productId).onHand).toBe(8);
    expect(() => l.inventory.move({ ...m, quantity: 5 }, 'staff')).toThrow(/Conflicting/);
    expect(() => l.inventory.move({ ...m, id: 'overdraw', quantity: 9 }, 'staff')).toThrow(/Insufficient/);
    expect(() => l.inventory.move({ ...m, id: 'fraction', quantity: 0.5 }, 'staff')).toThrow();
    expect(() => l.inventory.db.prepare('DELETE FROM inventory_movements').run()).toThrow(/Append-only/);
});
it('LOCAL SQLITE: concurrent connections serialize consumption and cannot overdraw', () => {
    const l = fixture();
    const other = new InventoryLedger(l.inventory.path, l.inventory.fingerprint);
    try {
        l.inventory.move({ id: 'a', productId: 'mn-item-1', kind: 'Consume', quantity: 8, unit: 'base', source: 'synthetic' }, 'staff');
        expect(() => other.move({ id: 'b', productId: 'mn-item-1', kind: 'Consume', quantity: 8, unit: 'base', source: 'synthetic' }, 'staff')).toThrow();
        expect(other.balance('mn-item-1').onHand).toBe(4);
    }
    finally {
        other.close();
    }
});
it('LOCAL SQLITE: pack conversions, reservations, release and compensating corrections preserve history', () => {
    const l = fixture();
    const move = (kind: string, quantity: number, extra = {}) => l.inventory.move({ id: randomUUID(), productId: 'mn-item-1', kind, quantity, unit: 'base', source: 'synthetic', ...extra }, 'staff');
    move('Reserve', 10);
    expect(l.inventory.balance('mn-item-1').available).toBe(2);
    expect(() => move('Consume', 3)).toThrow();
    move('Release', 10);
    const used = move('Consume', 1);
    move('AdjustUp', 1, { reason: 'Correction of entry', corrects: used.id });
    expect(l.inventory.balance('mn-item-1').onHand).toBe(12);
    expect(() => move('AdjustUp', 1)).toThrow(/reason/);
    expect(() => move('AdjustUp', 1, { reason: 'bad', corrects: 'missing' })).toThrow();
    move('AdjustUp', 2, { unit: 'pack', reason: 'Counted two packs' });
    expect(l.inventory.balance('mn-item-1').onHand).toBe(32);
    expect(() => move('AdjustUp', 1000000, { unit: 'pack', reason: 'overflow' })).toThrow(/conversion/);
});
it('LOCAL SQLITE: expired lots are unusable immediately and get auditable expiry movements', () => {
    const l = fixture();
    l.inventory.move({ id: 'expired', productId: 'mn-item-1', kind: 'Receive', quantity: 10, unit: 'base', source: 'synthetic', expiresAt: '2020-01-01T00:00:00Z',receiptReference:'EXPIRED-DELIVERY-1' }, 'staff');
    expect(l.inventory.balance('mn-item-1')).toMatchObject({ onHand: 22, available: 12, expired: 10 });
    l.monitor.runOnce('expiry');
    expect(l.inventory.balance('mn-item-1')).toMatchObject({ onHand: 12, expired: 0 });
    expect(l.inventory.history('mn-item-1').some(m => m.kind === 'Expire')).toBe(true);
});
it('LOCAL SQLITE: monitoring controls do not grant financial permissions', () => {
    const l = fixture();
    expect(() => l.inventory.configure({ ...l.inventory.config(), financialExecution: true }, 'operator')).toThrow();
    l.inventory.configure({ ...l.inventory.config(), monitoring: false }, 'operator');
    expect(l.monitor.runOnce('off')).toBeNull();
    l.inventory.configure({ ...l.inventory.config(), monitoring: true, automaticCases: false }, 'operator');
    l.monitor.runOnce('read-only');
    expect(l.inventory.dashboard().obligations).toHaveLength(0);
    l.inventory.configure({ ...l.inventory.config(), automaticCases: true, automaticPreparation: false }, 'operator');
    l.monitor.runOnce('case-only');
    const o = l.inventory.dashboard().obligations[0];
    expect(l.workflow.get(o.caseId).state).toBe('Opened');
    l.inventory.configure({ ...l.inventory.config(), automaticPreparation: true }, 'operator');
    l.monitor.runOnce('prepare');
    expect(l.workflow.get(o.caseId).state).toBe('PoDrafted');
});
it('LOCAL SQLITE: two workers cannot own the same job and stale completion is fenced', () => {
    const l = fixture();
    const other = new InventoryLedger(l.inventory.path, l.inventory.fingerprint);
    other.registerCatalog(l.inventory.catalogDefinition(),'test-worker');
    const worker = new InventoryMonitor(other, l.workflow);
    try {
        const job = l.monitor.claim('first')!;
        expect(worker.claim('second')).toBeNull();
        l.inventory.db.prepare('UPDATE inventory_jobs SET lease_until=0').run();
        const takeover = worker.claim('second')!;
        expect(() => l.monitor.execute(job)).toThrow(/lease lost/);
        expect(worker.execute(takeover).state).toBe('Completed');
        expect(l.inventory.dashboard().obligations).toHaveLength(1);
    }
    finally {
        other.close();
    }
});
it('LOCAL SQLITE: restart after durable obligation but before case resumes the same event, not a new PO', () => {
    const l = fixture();
    const failed = l.monitor.runOnce('crash', () => { throw new Error('simulated interruption before case'); });
    expect(failed?.state).toBe('Failed');
    const obligation = l.inventory.dashboard().obligations[0];
    expect(() => l.workflow.get(obligation.caseId)).toThrow();
    l.inventory.db.prepare('UPDATE inventory_jobs SET next_due=0').run();
    l.monitor.runOnce('restart');
    expect(l.inventory.dashboard().obligations).toHaveLength(1);
    expect(l.workflow.get(obligation.caseId).state).toBe('PoDrafted');
});
it('LOCAL SQLITE: uncertain financial state is neither retried nor converted to success by monitoring', () => {
    const l = fixture();
    l.monitor.runOnce('first');
    const c = l.workflow.get(l.inventory.dashboard().obligations[0].caseId);
    expect(c.paymentState).toBe('Unobserved');
    expect(c.operationIds).toHaveLength(2);
    l.inventory.db.prepare('UPDATE inventory_jobs SET next_due=0').run();
    l.monitor.runOnce('again');
    expect(l.workflow.get(c.caseId)).toEqual(c);
    expect(l.store.inspect(c.poId!).operations).toHaveLength(0);
});
it('LOCAL SQLITE: corrupt evaluation blocks PO reconstruction; failures stop after three attempts', () => {
    const l = fixture();
    l.monitor.runOnce('first');
    const o = l.inventory.dashboard().obligations[0];
    l.inventory.db.prepare("UPDATE inventory_evaluations SET body_json='{}' WHERE event_id=?").run(o.eventId);
    expect(() => l.workflow.get(o.caseId)).toThrow(/corrupt/);
    for (let n = 0; n < 3; n++) {
        l.inventory.db.prepare('UPDATE inventory_jobs SET next_due=0').run();
        expect(l.monitor.runOnce('failed')?.state).toBe('Failed');
    }
    expect(l.monitor.runOnce('blocked')).toBeNull();
    expect(l.inventory.dashboard().obligations).toHaveLength(1);
});
it('LOCAL SQLITE: stale supplier quotes expire the existing case without creating a replacement obligation', () => {
    const name = 'test-' + randomUUID();
    let now = Date.now();
    const l = openInventoryOperations(name, () => now);
    opened.push(l);
    l.inventory.configure({ ...l.inventory.config(), automaticPreparation: false }, 'operator');
    l.monitor.runOnce('open');
    const o = l.inventory.dashboard().obligations[0];
    now += 3601000;
    l.inventory.configure({ ...l.inventory.config(), automaticPreparation: true }, 'operator');
    l.monitor.runOnce('stale');
    expect(l.workflow.get(o.caseId).state).toBe('Expired');
    expect(l.inventory.dashboard().obligations).toHaveLength(1);
});
it('LOCAL SQLITE: sufficient consumption history replaces the explicitly labeled baseline', () => {
    const name = 'test-' + randomUUID();
    let now = Date.now();
    const l = openInventoryOperations(name, () => now);
    opened.push(l);
    for (let day = 0; day < 8; day++) {
        l.inventory.move({ id: 'usage-' + day, productId: 'mn-item-1', kind: 'Consume', quantity: 1, unit: 'base', source: 'synthetic' }, 'staff');
        now += 86400000;
    }
    const f = l.inventory.forecast('mn-item-1');
    expect(f.basis).toBe('consumption-history');
    expect(f.dailyDemand).toBe(1);
    expect(f.reorderPoint).toBe(13);
});
it('LOCAL SQLITE: foreign profile, signing credentials and modified persisted product are rejected', () => {
    const l = fixture();
    expect(() => new InventoryLedger(l.inventory.path, 'f'.repeat(64))).toThrow(/profile/);
    l.inventory.db.prepare("UPDATE inventory_products SET body_json='{}'").run();
    expect(() => l.inventory.balance('mn-item-1')).toThrow(/changed/);
});
it('LOCAL SQLITE: additive migration rejects future schemas and preserves unrelated existing workspaces',()=>{
 const l=fixture();l.inventory.db.prepare('INSERT INTO inventory_schema_migrations VALUES(5,?)').run(new Date().toISOString());
 expect(()=>openInventoryOperations(l.name)).toThrow(/Unsupported inventory schema/);
 const name='test-'+randomUUID();const old=openLocalOperations(name);
 try{expect(()=>openInventoryOperations(name)).toThrow(/existing non-inventory database is preserved/);}
 finally{old.close();rmSync(dirname(old.store.profile.databasePath),{recursive:true,force:true});}
});
it('AUTHENTICATED API / LOCAL SQLITE: viewer, CSRF, replay, arbitrary fields and fake incoming PO are blocked', async () => {
    const l = fixture();
    const origin = 'http://127.0.0.1:3005';
    const app = createOperationsApp({ workflow: l.workflow, inventory: l.inventory, origin, operatorCredential: 'operator-'.repeat(5), viewerCredential: 'viewer-'.repeat(6) });
    try {
        expect((await app.inject('/api/operations/stock')).statusCode).toBe(401);
        const login = async (credential: string) => {
            const r = await app.inject({ method: 'POST', url: '/api/operations/login', headers: { origin }, payload: { credential } });
            const cookie = r.headers['set-cookie']!.toString().split(';')[0];
            const s = (await app.inject({ url: '/api/operations/session', headers: { cookie } })).json();
            return { cookie, origin, 'x-csrf-token': s.csrf, 'x-operation-nonce': s.nonce };
        };
        const payload = { requestId: randomUUID(), movement: { id: 'api-use', productId: 'mn-item-1', kind: 'Consume', quantity: 4, unit: 'base', source: 'manual' } };
        expect((await app.inject({ method: 'POST', url: '/api/operations/stock/movements', headers: await login('viewer-'.repeat(6)), payload })).statusCode).toBe(403);
        const headers = await login('operator-'.repeat(5));
        expect((await app.inject({ method: 'POST', url: '/api/operations/stock/movements', headers: { ...headers, 'x-csrf-token': 'wrong' }, payload })).statusCode).toBe(403);
        const post = () => app.inject({ method: 'POST', url: '/api/operations/stock/movements', headers, payload });
        expect((await post()).statusCode).toBe(200);
        expect((await post()).statusCode).toBe(200);
        expect(l.inventory.balance('mn-item-1').onHand).toBe(8);
        expect((await app.inject({ method: 'POST', url: '/api/operations/stock/movements', headers, payload: { ...payload, requestId: randomUUID() } })).statusCode).toBe(409);
        const fresh = await login('operator-'.repeat(5));
        expect((await app.inject({ method: 'POST', url: '/api/operations/stock/movements', headers: fresh, payload: { requestId: randomUUID(), movement: { ...payload.movement, id: 'tamper', recipient: 'attacker.near' } } })).statusCode).toBe(400);
        expect((await app.inject({ method: 'POST', url: '/api/operations/stock/movements', headers: fresh, payload: { requestId: randomUUID(), movement: { ...payload.movement, id: 'fake-incoming', kind: 'ConfirmInbound', orderId: 'unknown' } } })).statusCode).not.toBe(200);
        const dashboard = (await app.inject({ url: '/api/operations/stock', headers })).json();
        expect(dashboard.financialExecution).toBe(false);
        expect(dashboard.items[0].balance.onHand).toBe(8);
    }
    finally {
        await app.close();
    }
});

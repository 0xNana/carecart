import {afterEach, expect, it, vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {rmSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {PROJECT_ROOT} from '../profiles/storage';
import {digest} from '../intents/settlement';
import {openInventoryOperations} from './local';
import {gloves} from './ledger';

const START=Date.UTC(2026,10,6,12);
const cleanups:(()=>void)[]=[];
afterEach(()=>{for(const close of cleanups.splice(0).reverse())close();vi.restoreAllMocks();});
function fixture(){
 let now=START;const name='p4a-monitor-'+randomUUID();
 const owned=join(PROJECT_ROOT,'backend/data/local-v2/local-operations',name);
 const local=openInventoryOperations(name,()=>now,{dataset:'clinic'});
 expect(dirname(local.store.profile.databasePath)).toBe(owned);
 cleanups.push(()=>rmSync(owned,{recursive:true,force:true}),()=>local.close());
 const gloveOnly=()=>local.inventory.db.prepare('UPDATE inventory_jobs SET next_due=? WHERE product_id<>?').run(now+86400000,gloves.id);
 const enable=(extra={})=>{local.inventory.configure({...local.inventory.config(),monitoring:true,automaticCases:true,automaticPreparation:true,...extra},'operator:test');gloveOnly();};
 const consume=()=>local.inventory.move({id:'consume-'+randomUUID(),productId:gloves.id,kind:'Consume',quantity:4,unit:'base',source:'manual'},'operator:test');
 const due=()=>{local.inventory.db.prepare('UPDATE inventory_jobs SET next_due=0 WHERE product_id=?').run(gloves.id);gloveOnly();};
 return {local,enable,consume,due,gloveOnly,advance:(milliseconds:number)=>{now+=milliseconds;},clock:()=>now};
}

it('P4A MONITOR / REAL SQLITE: clinic bootstrap contains six supplies and three trusted suppliers with autonomy explicitly off',()=>{
 const f=fixture();const dashboard=f.local.inventory.dashboard();
 expect(dashboard.items).toHaveLength(6);
 expect(f.local.store.registeredCatalog().suppliers).toHaveLength(3);
 expect(dashboard.config).toMatchObject({monitoring:false,automaticCases:false,automaticPreparation:false,financialExecution:false});
 expect(f.local.inventory.balance(gloves.id).onHand).toBe(30);
 expect(f.local.monitor.runOnce('disabled-worker')).toBeNull();
 expect(f.local.workflow.list()).toHaveLength(0);
});

it('P4A MONITOR / REAL SQLITE: every healthy and shortage evaluation persists calculation inputs even when case creation is disabled',()=>{
 const f=fixture();f.enable({automaticCases:false,automaticPreparation:false});
 expect(f.local.monitor.runOnce('observer')?.state).toBe('Completed');
 f.consume();expect(f.local.monitor.runOnce('observer')?.state).toBe('Completed');
 const rows=f.local.inventory.db.prepare('SELECT body_json,body_hash FROM inventory_evaluations WHERE product_id=? ORDER BY rowid').all(gloves.id) as {body_json:string;body_hash:string}[];
 expect(rows).toHaveLength(2);
 const values=rows.map(row=>{const value=JSON.parse(row.body_json);expect(digest(value)).toBe(row.body_hash);return value;});
 expect(values[0]).toMatchObject({dailyDemand:4,leadTimeDays:5,safetyStock:8,reorderPoint:28,inventoryPosition:30,shortage:false});
 expect(values[1]).toMatchObject({dailyDemand:4,leadTimeDays:5,safetyStock:8,reorderPoint:28,inventoryPosition:26,shortage:true});
 expect(values.every(value=>value.issuedAt===new Date(START).toISOString())).toBe(true);
 expect(f.local.workflow.list()).toHaveLength(0);expect(f.local.inventory.dashboard().obligations).toHaveLength(0);
});

it('P4A FRESHNESS / REAL SQLITE: stale inventory inputs fail closed before case or PO creation',()=>{
 const f=fixture();f.enable({maxInventoryAgeSeconds:60,maxCatalogAgeSeconds:3600});f.consume();f.advance(61_000);
 const run=f.local.monitor.runOnce('stale-inventory');
 expect(run?.state).toBe('Failed');expect(run?.error).toMatch(/inventory.*stale|stale.*inventory/i);
 expect(f.local.workflow.list()).toHaveLength(0);expect(f.local.inventory.dashboard().obligations).toHaveLength(0);
 expect(f.local.inventory.db.prepare('SELECT count(*) FROM v2_procurement_orders').pluck().get()).toBe(0);
});

it('P4A FRESHNESS / REAL SQLITE: fresh stock movement does not disguise a stale supplier catalog',()=>{
 const f=fixture();f.enable({maxInventoryAgeSeconds:3600,maxCatalogAgeSeconds:60});f.consume();f.advance(61_000);
 f.local.inventory.move({id:'count-verification',productId:gloves.id,kind:'AdjustUp',quantity:1,unit:'base',source:'manual',reason:'Validated physical count'},'operator:test');
 const run=f.local.monitor.runOnce('stale-catalog');
 expect(run?.state).toBe('Failed');expect(run?.error).toMatch(/catalog.*stale|stale.*catalog|supplier.*stale|stale.*supplier/i);
 expect(f.local.workflow.list()).toHaveLength(0);expect(f.local.inventory.dashboard().obligations).toHaveLength(0);
});

it('P4A SUPPLIER TRUST / REAL SQLITE: a missing persisted catalog snapshot cannot produce an obligation or PO',()=>{
 const f=fixture();f.enable();f.consume();
 expect(f.local.inventory.db.prepare("DELETE FROM inventory_sources WHERE id='supplier-catalog'").run().changes).toBe(1);
 const run=f.local.monitor.runOnce('missing-catalog');
 expect(run?.state).toBe('Failed');expect(run?.error).toMatch(/catalog|supplier/i);
 expect(f.local.workflow.list()).toHaveLength(0);
 expect(f.local.inventory.db.prepare('SELECT count(*) FROM v2_procurement_orders').pluck().get()).toBe(0);
});

it('P4A SUPPLIER TRUST / REAL SQLITE: unavailable approved catalog capabilities fail before procurement preparation',()=>{
 const f=fixture();f.enable();f.consume();vi.spyOn(f.local.store,'registeredCatalog').mockReturnValue(undefined as never);
 const run=f.local.monitor.runOnce('unavailable-catalog');
 expect(run?.state).toBe('Failed');expect(run?.error).toMatch(/catalog|supplier/i);
 expect(f.local.workflow.list()).toHaveLength(0);expect(f.local.inventory.dashboard().obligations).toHaveLength(0);
});

it('P4A WORKER HEALTH / REAL SQLITE: heartbeat and successful evaluations distinguish unknown, healthy, stopped and stale workers',()=>{
 const f=fixture();f.enable({intervalSeconds:5});const worker='health-worker';
 expect(f.local.inventory.dashboard().workerHealth).toMatchObject({status:'unobserved',lastSuccessfulEvaluation:null});
 f.local.inventory.heartbeat(worker,'Running');
 expect(f.local.inventory.dashboard().workerHealth.status).toBe('healthy');
 expect(f.local.monitor.runOnce(worker)?.state).toBe('Completed');
 expect(f.local.inventory.dashboard().workerHealth.lastSuccessfulEvaluation).toBe(new Date(START).toISOString());
 f.local.inventory.heartbeat(worker,'Stopped');expect(f.local.inventory.dashboard().workerHealth.status).toBe('stopped');
 f.local.inventory.heartbeat(worker,'Running');f.advance(300_000);
 expect(f.local.inventory.dashboard().workerHealth.status).toBe('stale');
 expect(f.local.inventory.dashboard().workerHealth.lastSuccessfulEvaluation).toBe(new Date(START).toISOString());
 f.local.inventory.heartbeat(worker,'Running');expect(f.local.inventory.dashboard().workerHealth.status).toBe('healthy');
});

it('P4A RETRIES / REAL SQLITE: failed evaluations stop after three claims until an explicit operator reset',()=>{
 const f=fixture();f.enable();f.consume();const catalog=vi.spyOn(f.local.store,'registeredCatalog').mockReturnValue(undefined as never);
 for(let attempt=0;attempt<3;attempt++){f.due();expect(f.local.monitor.runOnce('retry-worker')?.state).toBe('Failed');}
 f.due();expect(f.local.monitor.runOnce('retry-worker')).toBeNull();
 expect(f.local.inventory.db.prepare('SELECT failures FROM inventory_job_failures WHERE product_id=?').pluck().get(gloves.id)).toBe(3);
 expect(f.local.workflow.list()).toHaveLength(0);
 catalog.mockRestore();f.enable();expect(f.local.monitor.runOnce('retry-worker')?.state).toBe('Completed');
 expect(f.local.workflow.list()).toHaveLength(1);
 expect(f.local.inventory.db.prepare('SELECT count(*) FROM inventory_job_failures WHERE product_id=?').pluck().get(gloves.id)).toBe(0);
});

it('P4A DELIVERY RECOVERY / REAL SQLITE: correcting an already closed delivery never creates a second PO for the old shortage',()=>{
 const f=fixture();f.enable();f.consume();expect(f.local.monitor.runOnce('initial-shortage')?.state).toBe('Completed');
 const original=f.local.inventory.dashboard().obligations[0];const c=f.local.workflow.get(original.caseId);const quantity=c.domain!.quote.quantity;
 f.local.inventory.move({id:'full-goods-receipt',productId:gloves.id,kind:'Receive',quantity,unit:'base',source:'manual',orderId:c.poId!,receiptReference:'SYNTHETIC-DELIVERY-001'},'operator:test');
 expect(f.local.monitor.runOnce('close-complete-delivery')?.state).toBe('Completed');
 expect(f.local.inventory.dashboard().obligations.find(o=>o.caseId===c.caseId)?.closedAt).not.toBeNull();
 f.local.inventory.move({id:'undo-false-receipt',productId:gloves.id,kind:'AdjustDown',quantity,unit:'base',source:'manual',corrects:'full-goods-receipt',reason:'Receipt was entered before goods arrived'},'operator:test');
 const resumed=f.local.monitor.runOnce('recover-corrected-delivery');
 expect(f.local.workflow.list()).toHaveLength(1);
 expect(f.local.inventory.db.prepare('SELECT count(*) FROM v2_procurement_orders').pluck().get()).toBe(1);
 expect(f.local.inventory.dashboard().obligations).toHaveLength(1);
 if(resumed?.state==='Completed')expect(f.local.inventory.dashboard().obligations[0].closedAt).toBeNull();
 else {expect(resumed?.state).toBe('Failed');expect(resumed?.error).toMatch(/delivery|correction|reconcil/i);}
 expect(f.local.workflow.get(c.caseId).paymentState).toBe('Unobserved');
});

it('P4A FRESHNESS / REAL SQLITE: automatic expiry cannot make a stale physical stock observation fresh',()=>{
 const f=fixture();f.enable({maxInventoryAgeSeconds:60,maxCatalogAgeSeconds:3600});
 f.local.inventory.move({id:'dated-stock',productId:gloves.id,kind:'Receive',quantity:2,unit:'base',source:'manual',receiptReference:'EXPIRING-LINE',expiresAt:new Date(f.clock()+30_000).toISOString()},'operator:test');
 f.advance(61_000);f.due();const run=f.local.monitor.runOnce('expiry-stale');
 expect(run?.state).toBe('Failed');expect(run?.error).toMatch(/Inventory inputs stale/);
 expect(f.local.inventory.history(gloves.id).some(m=>m.kind==='Expire')).toBe(true);
 expect(f.local.workflow.list()).toHaveLength(0);
});

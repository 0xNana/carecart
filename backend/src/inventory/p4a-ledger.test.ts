import Database from 'better-sqlite3';
import {afterEach, expect, it} from 'vitest';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {digest} from '../intents/settlement';
import {PROJECT_ROOT} from '../profiles/storage';
import {InventoryLedger, gloves, type Product} from './ledger';
import {openInventoryOperations} from './local';

const NOW=Date.UTC(2026,10,6,12);
const fingerprint='f'.repeat(64);
const cleanups:(()=>void)[]=[];
afterEach(()=>{for(const close of cleanups.splice(0).reverse())close();});
const gauze:Product={...gloves,id:'mn-item-2',sku:'GAUZE-PACK',name:'Sterile gauze (synthetic)',baseUnit:'pack',packSize:5};
function path(){const root=mkdtempSync(join(tmpdir(),'carecart-p4a-ledger-'));cleanups.push(()=>rmSync(root,{recursive:true,force:true}));return join(root,'state.sqlite');}
function open(file=path(),products:Product[]=[gloves]){
 const ledger=new InventoryLedger(file,fingerprint,products,()=>NOW);cleanups.push(()=>ledger.close());return ledger;
}
function stocked(){const ledger=open();ledger.move({id:'opening',productId:gloves.id,kind:'Opening',quantity:12,unit:'base',source:'synthetic'},'synthetic-seed');return ledger;}
function link(ledger:InventoryLedger,quantity=40,orderId='proposal-1'){
 return ledger.registerOrderLink({orderId,productId:gloves.id,caseId:'case-1',quantity,canonicalHash:'a'.repeat(64)},'inventory-monitor');
}
const confirmation={confirmationReference:'SYNTHETIC-ORDER-001',confirmedAt:new Date(NOW-60_000).toISOString()};

/** Exact previous on-disk schema; do not manufacture a v1 database with the new constructor. */
function legacyFixture(inbound=false){
 const file=path();const db=new Database(file);
 db.exec(`CREATE TABLE inventory_schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);
  CREATE TABLE inventory_identity(id INTEGER PRIMARY KEY CHECK(id=1),fingerprint TEXT NOT NULL,products_hash TEXT NOT NULL);
  CREATE TABLE inventory_locations(clinic_id TEXT NOT NULL,storeroom_id TEXT NOT NULL,PRIMARY KEY(clinic_id,storeroom_id));
  CREATE TABLE inventory_products(id TEXT PRIMARY KEY,body_json TEXT NOT NULL);
  CREATE TABLE inventory_movements(seq INTEGER PRIMARY KEY,id TEXT UNIQUE NOT NULL,product_id TEXT NOT NULL,kind TEXT NOT NULL,order_id TEXT,body_json TEXT NOT NULL,body_hash TEXT NOT NULL);
  CREATE UNIQUE INDEX inventory_opening_once ON inventory_movements(product_id) WHERE kind='Opening';
  CREATE UNIQUE INDEX inventory_inbound_once ON inventory_movements(order_id) WHERE kind='ConfirmInbound';
  CREATE TRIGGER inventory_movement_no_update BEFORE UPDATE ON inventory_movements BEGIN SELECT RAISE(ABORT,'Append-only inventory history'); END;
  CREATE TRIGGER inventory_movement_no_delete BEFORE DELETE ON inventory_movements BEGIN SELECT RAISE(ABORT,'Append-only inventory history'); END;
  CREATE TABLE inventory_audit(seq INTEGER PRIMARY KEY,body_json TEXT NOT NULL,body_hash TEXT NOT NULL);
  CREATE TABLE inventory_requests(request_id TEXT PRIMARY KEY,payload_hash TEXT NOT NULL,result_json TEXT NOT NULL);
  CREATE TABLE inventory_autonomy(id INTEGER PRIMARY KEY CHECK(id=1),body_json TEXT NOT NULL);
  CREATE TABLE inventory_jobs(product_id TEXT PRIMARY KEY,next_due INTEGER NOT NULL,generation INTEGER NOT NULL,lease_owner TEXT,lease_until INTEGER,lease_token TEXT);
  CREATE TABLE inventory_job_failures(product_id TEXT PRIMARY KEY,failures INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE inventory_monitor_runs(id TEXT PRIMARY KEY,product_id TEXT NOT NULL,worker TEXT NOT NULL,state TEXT NOT NULL,started_at INTEGER NOT NULL,completed_at INTEGER,evidence_json TEXT,error TEXT);
  CREATE TABLE inventory_evaluations(event_id TEXT PRIMARY KEY,product_id TEXT NOT NULL,body_json TEXT NOT NULL,body_hash TEXT NOT NULL);
  CREATE TABLE inventory_obligations(id TEXT PRIMARY KEY,product_id TEXT NOT NULL,event_id TEXT UNIQUE NOT NULL,case_id TEXT UNIQUE NOT NULL,closed_at INTEGER);
  CREATE UNIQUE INDEX inventory_active_obligation ON inventory_obligations(product_id) WHERE closed_at IS NULL;`);
 db.prepare('INSERT INTO inventory_schema_migrations VALUES(1,?)').run(new Date(NOW-600_000).toISOString());
 db.prepare('INSERT INTO inventory_identity VALUES(1,?,?)').run(fingerprint,digest([gloves]));
 db.prepare('INSERT INTO inventory_locations VALUES(?,?)').run(gloves.clinicId,gloves.storeroomId);
 db.prepare('INSERT INTO inventory_products VALUES(?,?)').run(gloves.id,JSON.stringify(gloves));
 db.prepare('INSERT INTO inventory_autonomy VALUES(1,?)').run(JSON.stringify({monitoring:true,automaticCases:true,automaticPreparation:true,financialExecution:false,intervalSeconds:30}));
 db.prepare('INSERT INTO inventory_jobs VALUES(?,?,0,NULL,NULL,NULL)').run(gloves.id,NOW);
 const opening={id:'legacy-opening',productId:gloves.id,kind:'Opening',quantity:12,unit:'base',source:'synthetic',baseQuantity:12,actor:'synthetic-seed',timestamp:new Date(NOW-600_000).toISOString(),allocations:[],previousHash:null};
 const consumption={id:'legacy-consume',productId:gloves.id,kind:'Consume',quantity:4,unit:'base',source:'manual',baseQuantity:4,actor:'operator:legacy',timestamp:new Date(NOW-300_000).toISOString(),allocations:[{lotId:opening.id,quantity:4}],previousHash:digest(opening)};
 const movements:unknown[]=[opening,consumption];
 if(inbound)movements.push({id:'legacy-incoming',productId:gloves.id,kind:'ConfirmInbound',quantity:40,unit:'base',source:'manual',orderId:'proposal-1',baseQuantity:40,actor:'operator:legacy',timestamp:new Date(NOW-240_000).toISOString(),allocations:[],previousHash:digest(consumption)});
 for(const raw of movements){const m=raw as typeof opening&{orderId?:string};db.prepare('INSERT INTO inventory_movements(id,product_id,kind,order_id,body_json,body_hash) VALUES(?,?,?,?,?,?)').run(m.id,m.productId,m.kind,m.orderId??null,JSON.stringify(m),digest(m));}
 const audit={type:'LegacyCountValidated',actor:'operator:legacy',timestamp:new Date(NOW-600_000).toISOString(),evidence:{productId:gloves.id,quantity:12}};
 db.prepare('INSERT INTO inventory_audit(body_json,body_hash) VALUES(?,?)').run(JSON.stringify(audit),digest(audit));
 const oldMovements=db.prepare('SELECT id,body_json,body_hash FROM inventory_movements ORDER BY seq').all();
 const oldAudit=db.prepare('SELECT body_json,body_hash FROM inventory_audit WHERE seq=1').get();db.close();
 return {file,oldMovements,oldAudit};
}

it('P4A MIGRATION / REAL SQLITE: v1 upgrades additively, keeps exact movement/audit evidence and allows appended SKUs',()=>{
 const old=legacyFixture();const ledger=open(old.file,[gloves,gauze]);
 expect(ledger.db.prepare('SELECT MAX(version) FROM inventory_schema_migrations').pluck().get()).toBe(4);
 expect(ledger.db.prepare("SELECT id,body_json,body_hash FROM inventory_movements WHERE id LIKE 'legacy-%' ORDER BY seq").all()).toEqual(old.oldMovements);
 expect(ledger.db.prepare('SELECT body_json,body_hash FROM inventory_audit WHERE seq=1').get()).toEqual(old.oldAudit);
 expect(ledger.balance(gloves.id).onHand).toBe(8);expect(ledger.balance(gauze.id).onHand).toBe(0);
 const firstVersions=ledger.db.prepare('SELECT version,applied_at FROM inventory_schema_migrations ORDER BY version').all();
 ledger.close();const reopened=open(old.file,[gloves,gauze]);
 expect(reopened.db.prepare('SELECT version,applied_at FROM inventory_schema_migrations ORDER BY version').all()).toEqual(firstVersions);
 expect(()=>reopened.db.prepare("UPDATE inventory_movements SET body_hash='rewritten'").run()).toThrow(/Append-only/);
});

it.each([
 ['changed pack',[{...gloves,packSize:20}]],
 ['changed demand',[{...gloves,baselineDailyDemand:9}]],
 ['removed SKU',[gauze]],
] as const)('P4A MIGRATION / REAL SQLITE: %s cannot rewrite trusted existing product configuration',(_label,products)=>{
 const old=legacyFixture();expect(()=>open(old.file,[...products])).toThrow();
 const db=new Database(old.file,{readonly:true});try{
  expect(db.prepare('SELECT body_json FROM inventory_products WHERE id=?').pluck().get(gloves.id)).toBe(JSON.stringify(gloves));
  expect(db.prepare('SELECT MAX(version) FROM inventory_schema_migrations').pluck().get()).toBe(1);
  expect(db.prepare('SELECT id,body_json,body_hash FROM inventory_movements ORDER BY seq').all()).toEqual(old.oldMovements);
 }finally{db.close();}
});

it.each([{packSize:0},{packSize:1.5},{baselineDailyDemand:NaN},{baselineDailyDemand:-1},{leadTimeDays:-1},{safetyStock:0.5}])(
 'P4A UNITS / REAL SQLITE: rejects invalid product accounting configuration %j',change=>{
  expect(()=>open(path(),[{...gloves,...change}])).toThrow();
 });

it('P4A RECEIVING / REAL SQLITE: a receipt reference is mandatory and cannot be replayed under another movement ID',()=>{
 const ledger=stocked();const receipt={id:'receipt-1',productId:gloves.id,kind:'Receive',quantity:2,unit:'base',source:'manual'};
 expect(()=>ledger.move(receipt,'operator:staff')).toThrow();
 const recorded=ledger.move({...receipt,receiptReference:'DELIVERY-001-LINE-1'},'operator:staff');
 expect(ledger.move({...receipt,receiptReference:'DELIVERY-001-LINE-1'},'operator:staff')).toEqual(recorded);
 expect(()=>ledger.move({...receipt,id:'receipt-forged-replay',receiptReference:'DELIVERY-001-LINE-1'},'operator:staff')).toThrow();
 expect(ledger.balance(gloves.id).onHand).toBe(14);expect(ledger.history(gloves.id)).toHaveLength(2);
});

it('P4A INCOMING / REAL SQLITE: a proposal is not inbound and confirmation requires a reference and nonfuture timestamp',()=>{
 const ledger=stocked();link(ledger);expect(ledger.balance(gloves.id).incoming).toBe(0);
 const incoming={id:'confirm-1',productId:gloves.id,kind:'ConfirmInbound',quantity:40,unit:'base',source:'manual',orderId:'proposal-1'};
 expect(()=>ledger.move(incoming,'operator:staff')).toThrow();
 expect(()=>ledger.move({...incoming,confirmationReference:'ORDER-001'},'operator:staff')).toThrow();
 expect(()=>ledger.move({...incoming,...confirmation,confirmedAt:new Date(NOW+1).toISOString()},'operator:staff')).toThrow();
 expect(ledger.balance(gloves.id)).toMatchObject({onHand:12,incoming:0,inventoryPosition:12});
 ledger.move({...incoming,...confirmation},'operator:staff');
 expect(ledger.balance(gloves.id)).toMatchObject({onHand:12,incoming:40,inventoryPosition:52});
});

it('P4A MIGRATION / REAL SQLITE: old unevidenced incoming stays unverified until explicitly attested without doubling stock',()=>{
 const old=legacyFixture(true);const ledger=open(old.file);
 expect(ledger.balance(gloves.id)).toMatchObject({onHand:8,incoming:0,unverifiedIncoming:40,inventoryPosition:8});
 link(ledger);
 ledger.move({id:'attest-legacy-order',productId:gloves.id,kind:'ConfirmInbound',quantity:40,unit:'base',source:'manual',orderId:'proposal-1',...confirmation},'operator:staff');
 expect(ledger.balance(gloves.id)).toMatchObject({onHand:8,incoming:40,unverifiedIncoming:0,inventoryPosition:48});
 expect(ledger.db.prepare("SELECT id,body_json,body_hash FROM inventory_movements WHERE id LIKE 'legacy-%' ORDER BY seq").all()).toEqual(old.oldMovements);
});

it('P4A DELIVERY / REAL SQLITE: proposal linkage permits partial physical receipt without inventing confirmed inbound',()=>{
 const ledger=stocked();link(ledger);
 const proposal={orderId:'proposal-1',productId:gloves.id,caseId:'case-1',quantity:40,canonicalHash:'a'.repeat(64)};
 ledger.registerOrderLink(proposal,'inventory-monitor');
 expect(()=>ledger.registerOrderLink({...proposal,quantity:41},'inventory-monitor')).toThrow();
 expect(ledger.delivery('proposal-1')).toMatchObject({expected:40,received:0,remaining:40,confirmedIncoming:0});
 ledger.move({id:'partial-receipt',productId:gloves.id,kind:'Receive',quantity:5,unit:'base',source:'manual',orderId:'proposal-1',receiptReference:'DELIVERY-002-LINE-1'},'operator:staff');
 expect(ledger.delivery('proposal-1')).toMatchObject({expected:40,received:5,remaining:35,confirmedIncoming:0});
 expect(ledger.balance(gloves.id)).toMatchObject({onHand:17,incoming:0});
 ledger.move({id:'confirm-after-partial',productId:gloves.id,kind:'ConfirmInbound',quantity:40,unit:'base',source:'manual',orderId:'proposal-1',...confirmation},'operator:staff');
 expect(ledger.balance(gloves.id)).toMatchObject({onHand:17,incoming:35,inventoryPosition:52});
});

it('P4A CORRECTIONS / REAL SQLITE: corrected receipts restore outstanding delivery once and prevent over-receiving',()=>{
 const ledger=stocked();link(ledger);
 ledger.move({id:'confirm-delivery',productId:gloves.id,kind:'ConfirmInbound',quantity:40,unit:'base',source:'manual',orderId:'proposal-1',...confirmation},'operator:staff');
 ledger.move({id:'full-receipt',productId:gloves.id,kind:'Receive',quantity:40,unit:'base',source:'manual',orderId:'proposal-1',receiptReference:'DELIVERY-003-LINE-1'},'operator:staff');
 expect(ledger.delivery('proposal-1')).toMatchObject({received:40,remaining:0,confirmedIncoming:0});
 ledger.move({id:'receipt-correction',productId:gloves.id,kind:'AdjustDown',quantity:5,unit:'base',source:'manual',corrects:'full-receipt',reason:'Five boxes were recorded but not delivered'},'operator:staff');
 expect(ledger.delivery('proposal-1')).toMatchObject({received:35,remaining:5,confirmedIncoming:5});
 ledger.move({id:'correction-correction',productId:gloves.id,kind:'AdjustUp',quantity:2,unit:'base',source:'manual',corrects:'receipt-correction',reason:'Two of those boxes were physically present'},'operator:staff');
 expect(ledger.delivery('proposal-1')).toMatchObject({received:37,remaining:3,confirmedIncoming:3});
 expect(ledger.balance(gloves.id)).toMatchObject({onHand:49,incoming:3});
 expect(()=>ledger.move({id:'too-many-arrivals',productId:gloves.id,kind:'Receive',quantity:4,unit:'base',source:'manual',orderId:'proposal-1',receiptReference:'DELIVERY-004-LINE-1'},'operator:staff')).toThrow();
 expect(ledger.delivery('proposal-1')).toMatchObject({received:37,remaining:3});
});

it('P4A DELIVERY / REAL SQLITE WORKFLOW: a corrected full receipt cannot prematurely close its replenishment obligation',()=>{
 const name='p4a-net-delivery-'+randomUUID();const owned=join(PROJECT_ROOT,'backend/data/local-v2/local-operations',name);
 const local=openInventoryOperations(name,()=>NOW);expect(dirname(local.store.profile.databasePath)).toBe(owned);
 cleanups.push(()=>rmSync(owned,{recursive:true,force:true}),()=>local.close());
 local.inventory.configure({...local.inventory.config(),monitoring:true,automaticCases:true,automaticPreparation:true},'operator:staff');
 expect(local.monitor.runOnce('prepare-before-receipt')?.state).toBe('Completed');
 const obligation=local.inventory.dashboard().obligations[0];const c=local.workflow.get(obligation.caseId);const quantity=c.domain!.quote.quantity;
 local.inventory.registerOrderLink({orderId:c.poId!,productId:gloves.id,caseId:c.caseId,quantity,canonicalHash:c.poHash!},'inventory-monitor');
 local.inventory.move({id:'receipt-with-correction',productId:gloves.id,kind:'Receive',quantity,unit:'base',source:'manual',orderId:c.poId!,receiptReference:'DELIVERY-005-LINE-1'},'operator:staff');
 local.inventory.move({id:'missing-delivered-boxes',productId:gloves.id,kind:'AdjustDown',quantity:5,unit:'base',source:'manual',corrects:'receipt-with-correction',reason:'Physical receiving count corrected'},'operator:staff');
 expect(local.monitor.runOnce('recheck-delivery')?.state).toBe('Completed');
 expect(local.inventory.dashboard().obligations.find(o=>o.caseId===c.caseId)?.closedAt).toBeNull();
 expect(local.inventory.delivery(c.poId!)).toMatchObject({received:quantity-5,remaining:5});
 expect(local.workflow.get(c.caseId).paymentState).toBe('Unobserved');
});

it('P4A RESERVATIONS / REAL SQLITE: expiry retains committed demand without subtracting backorders twice',()=>{
 let now=NOW;const ledger=new InventoryLedger(path(),fingerprint,[gloves],()=>now);cleanups.push(()=>ledger.close());
 ledger.move({id:'dated-opening',productId:gloves.id,kind:'Opening',quantity:12,unit:'base',source:'synthetic',expiresAt:new Date(NOW+1000).toISOString()},'synthetic-seed');
 ledger.move({id:'reserve-twelve',productId:gloves.id,kind:'Reserve',quantity:12,unit:'base',source:'manual'},'operator:staff');
 now+=2000;ledger.expire(gloves.id);
 expect(ledger.balance(gloves.id)).toMatchObject({onHand:0,reserved:12,available:0,backorders:12,inventoryPosition:-12});
 expect(ledger.history(gloves.id).some(m=>m.kind==='Release')).toBe(false);
});

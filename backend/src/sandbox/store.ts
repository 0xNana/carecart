import type {TenantExecutionPermit} from '../tenancy/treasury-authority';
import Database from 'better-sqlite3';import {mkdirSync,chmodSync} from 'node:fs';import {dirname} from 'node:path';
import {z} from 'zod';import {digest} from '../intents/settlement';import {SafetyOrderSchema} from '../near/commitments';
import {forecastQuantity} from '../procurement/forecast';import type {ProcurementOrder} from '../procurement/v2-store';
import type {WorkflowProcurement,WorkflowQuote} from '../workflow/procurement-port';import {sandboxProfile,type SandboxProfile} from './profile';
/** Separate test-only domain/DB/token/ID namespace. No native-USDC or mainnet record is translated or reused. */
export class SandboxProcurementStore implements WorkflowProcurement {
 readonly profile:SandboxProfile;readonly fingerprint:string;readonly db:Database.Database;
 readonly item={id:'sb-item-1',name:'Synthetic Sandbox supply',onHand:0,reorderPoint:1,usageUnits:30};
 readonly supplier='supplier.testnet';
 constructor(raw:SandboxProfile){this.profile=sandboxProfile(raw);this.fingerprint=digest(this.profile);
  mkdirSync(dirname(this.profile.databasePath),{recursive:true});this.db=new Database(this.profile.databasePath);chmodSync(this.profile.databasePath,0o600);
  this.db.pragma('journal_mode=WAL');this.db.pragma('synchronous=FULL');
  if(this.db.prepare("SELECT 1 FROM sqlite_master WHERE name IN ('v2_procurement_profile','purchase_orders')").get())throw new Error('Sandbox cannot reuse mainnet/CCTEST procurement state');
  this.db.exec(`CREATE TABLE IF NOT EXISTS sandbox_domain(id INTEGER PRIMARY KEY CHECK(id=1),fingerprint TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS sandbox_inventory(event_id TEXT PRIMARY KEY,body_json TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS sandbox_orders(po_id TEXT PRIMARY KEY,event_id TEXT UNIQUE NOT NULL,body_json TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS sandbox_domain_observations(id INTEGER PRIMARY KEY,po_id TEXT NOT NULL,stage TEXT NOT NULL,body_json TEXT NOT NULL,observed_at TEXT NOT NULL);`);
  const prior=this.db.prepare('SELECT fingerprint FROM sandbox_domain WHERE id=1').get() as {fingerprint:string}|undefined;
  if(prior&&prior.fingerprint!==this.fingerprint)throw new Error('Sandbox genesis/profile/database conflict');
  this.db.prepare('INSERT OR IGNORE INTO sandbox_domain VALUES(1,?)').run(this.fingerprint);
 }
 close(){if(this.db.open)this.db.close();}
 registeredInventory(){return [structuredClone(this.item)];}
 inventoryForecast(id:unknown){if(id!==this.item.id)throw new Error('Registered Sandbox inventory required');return {item:structuredClone(this.item),usageWindowDays:30,
  suppliers:[{supplierId:'sb-supplier-1',leadTimeDays:1,...forecastQuantity(this.item.onHand,this.item.reorderPoint,this.item.usageUnits,1)}]};}
 inventoryEvent(raw:unknown,now=new Date()){
  const input=z.object({eventId:z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),itemId:z.literal('sb-item-1')}).strict().parse(raw);
  const prior=this.db.prepare('SELECT body_json FROM sandbox_inventory WHERE event_id=?').get(input.eventId) as {body_json:string}|undefined;
  if(prior){const e=JSON.parse(prior.body_json) as {eventId:string;itemId:string;issuedAt:string};if(e.itemId!==input.itemId)throw new Error('Conflicting Sandbox event');return {...e,quotes:this.eventSnapshot(input.eventId).quotes};}
  const event={...input,issuedAt:now.toISOString()};this.db.prepare('INSERT INTO sandbox_inventory VALUES(?,?)').run(input.eventId,JSON.stringify(event));return {...event,quotes:this.eventSnapshot(input.eventId).quotes};
 }
 eventSnapshot(id:string){const row=this.db.prepare('SELECT body_json FROM sandbox_inventory WHERE event_id=?').get(id) as {body_json:string}|undefined;if(!row)throw new Error('Unknown Sandbox inventory event');
  const event=z.object({eventId:z.string(),itemId:z.literal('sb-item-1'),issuedAt:z.iso.datetime()}).strict().parse(JSON.parse(row.body_json));if(event.eventId!==id)throw new Error('Sandbox event conflict');
  const forecast=this.inventoryForecast(event.itemId).suppliers[0];const quantity=forecast.recommendedQuantity;
  const quote:WorkflowQuote={id:'sb-quote-'+digest([this.fingerprint,event]).slice(0,48),eventId:id,itemId:this.item.id,supplierId:'sb-supplier-1',supplierAccount:this.supplier,
   quantity,unitPriceAtomic:'500000',amountAtomic:(BigInt(quantity)*500000n).toString(),profile:'sandbox-v2',token:this.profile.token,decimals:6,asset:'CCUSD',destination:'Near',
   issuedAt:event.issuedAt,expiresAt:new Date(Date.parse(event.issuedAt)+3600000).toISOString()};
  return {event,item:structuredClone(this.item),quotes:[quote],forecasts:[forecast]};
 }
 #construct(id:string):ProcurementOrder{const snapshot=this.eventSnapshot(id);const q=snapshot.quotes[0];const invoiceReference='sandbox-invoice:'+id;
  return {eventId:id,quoteId:q.id,quoteDigest:digest(q),invoiceReference,decisionPolicy:'lowest-total-then-supplier-id-v1',
   canonical:SafetyOrderSchema.parse({po_id:'sb-po-'+digest([this.fingerprint,id]).slice(0,56),profile:'testnet',supplier:q.supplierAccount,token:this.profile.token,
    amount:q.amountAtomic,invoice_digest:digest([this.fingerprint,snapshot.event,q,invoiceReference]),destination:'Near'})};}
 selectQuote(raw:unknown,now=new Date()){const {eventId}=z.object({eventId:z.string()}).strict().parse(raw);return this.db.transaction(()=>{
  const order=this.#construct(eventId);const existing=this.db.prepare('SELECT po_id FROM sandbox_orders WHERE event_id=?').get(eventId) as {po_id:string}|undefined;
  if(existing)return this.resolve(existing.po_id);
  if(Date.parse(this.eventSnapshot(eventId).quotes[0].expiresAt)<=now.getTime())throw new Error('Supplier quote expired');
  this.db.prepare('INSERT INTO sandbox_orders VALUES(?,?,?)').run(order.canonical.po_id,eventId,JSON.stringify(order));return order;
 }).immediate();}
 resolve(raw:unknown){const id=z.string().regex(/^sb-po-[a-f0-9]{56}$/).parse(raw);const row=this.db.prepare('SELECT event_id,body_json FROM sandbox_orders WHERE po_id=?').get(id) as {event_id:string;body_json:string}|undefined;
  if(!row)throw new Error('Unknown Sandbox PO');const canonical=this.#construct(row.event_id);
  if(canonical.canonical.po_id!==id||digest(JSON.parse(row.body_json))!==digest(canonical))throw new Error('Sandbox immutable PO conflict');return canonical;}
 quoteExpiry(id:string){return this.eventSnapshot(this.resolve(id).eventId).quotes[0].expiresAt;}
 recordObservation(poId:string,stage:'commit'|'request'|'reconcile',observation:unknown,now=new Date()){
  this.resolve(poId);this.db.prepare('INSERT INTO sandbox_domain_observations(po_id,stage,body_json,observed_at) VALUES(?,?,?,?)').run(poId,stage,JSON.stringify(observation),now.toISOString());}
 inspect(poId:string){const purchaseOrder=this.resolve(poId);const snapshot=this.eventSnapshot(purchaseOrder.eventId);
  const exists=this.db.prepare("SELECT 1 FROM sqlite_master WHERE name='backend_operations'").get();
  return {purchaseOrder,canonicalHash:digest(purchaseOrder.canonical),event:snapshot.event,quote:snapshot.quotes[0],operations:exists?this.db.prepare('SELECT operation_key,state,evidence FROM backend_operations WHERE operation_key IN (?,?)').all(`commit_purchase_order:${poId}`,`request_payment:${poId}`):[],
   settlement:[],observations:this.db.prepare('SELECT stage,body_json,observed_at FROM sandbox_domain_observations WHERE po_id=?').all(poId),exceedsInitialDepositCeiling:BigInt(purchaseOrder.canonical.amount)>5_000_000n,
   evidenceNotice:'Local Sandbox CCUSD test token; never native USDC or public mainnet settlement.'};}
 async executeSandboxRole(role:'committer'|'requester',poId:string,environment:NodeJS.ProcessEnv,tenantPermit?:TenantExecutionPermit){const {executeSandboxRole}=require('./worker') as typeof import('./worker');await executeSandboxRole(this,role,poId,environment,tenantPermit);}
}

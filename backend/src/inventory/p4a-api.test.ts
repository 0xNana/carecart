import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {rmSync} from 'node:fs';
import {dirname} from 'node:path';
import {openInventoryOperations} from './local';
import {observeVault} from '../workflow/capabilities';
import type {VaultReader} from '../near/vault-reader';
import {localOperationsProfile} from '../operations/local';
import {createOperationsApp} from '../operations/api';
it('P4A HTTP / REAL SQLITE: catalog refresh and canonical physical receipt use existing operator auth; no financial operations',async()=>{
 const l=openInventoryOperations('test-'+randomUUID(),Date.now,{dataset:'clinic'}),origin='http://127.0.0.1:3005';
 const app=createOperationsApp({workflow:l.workflow,inventory:l.inventory,origin,operatorCredential:'operator-'.repeat(5),viewerCredential:'viewer-'.repeat(6)});
 async function headers(viewer=false){const login=await app.inject({method:'POST',url:'/api/operations/login',headers:{origin},payload:{credential:(viewer?'viewer-'.repeat(6):'operator-'.repeat(5))}});const cookie=String(login.headers['set-cookie']).split(';')[0];const s=(await app.inject({url:'/api/operations/session',headers:{cookie}})).json();return {cookie,origin,'x-csrf-token':s.csrf,'x-operation-nonce':s.nonce};}
 const post=async(path:string,payload:object,viewer=false)=>app.inject({method:'POST',url:'/api/operations/'+path,payload,headers:await headers(viewer)});
 try{
  expect((await app.inject({method:'POST',url:'/api/operations/stock/catalog-refresh',payload:{requestId:randomUUID()}})).statusCode).toBe(401);
  expect((await post('stock/catalog-refresh',{requestId:randomUUID()},true)).statusCode).toBe(403);
  expect((await post('stock/catalog-refresh',{requestId:randomUUID()})).statusCode).toBe(200);
  l.inventory.configure({...l.inventory.config(),monitoring:true,automaticCases:true,automaticPreparation:true},'test');
  const movement={productId:'mn-item-1',unit:'base',source:'manual'};
  expect((await post('stock/movements',{requestId:randomUUID(),movement:{...movement,id:'consume-http',kind:'Consume',quantity:4}})).statusCode).toBe(200);
  for(let i=0;i<6;i++)expect(l.monitor.runOnce('http-test')?.state).toBe('Completed');
  const c=l.workflow.get(l.inventory.dashboard().obligations[0].caseId);
  expect(c.state).toBe('PoDrafted');expect(l.inventory.balance('mn-item-1').incoming).toBe(0);
  const receipt={...movement,id:'receive-http',kind:'Receive',quantity:10,orderId:c.poId,receiptReference:'DELIVERY-LINE-1'};
  const beforeReceipt=l.inventory.history('mn-item-1');
  const wrongSupplier=(l.store.registeredCatalog().suppliers.find(s=>s.id!==c.domain!.quote.supplierId))!.id;
  const conflict=await post('stock/movements',{requestId:randomUUID(),movement:{...receipt,supplierId:wrongSupplier}});
  expect(conflict.statusCode).toBe(409);
  expect(conflict.json().error.code).toBe('INBOUND_CANONICAL_CONFLICT');
  expect(l.inventory.history('mn-item-1')).toEqual(beforeReceipt);
  expect(l.inventory.delivery(c.poId!).received).toBe(0);
  expect((await post('stock/movements',{requestId:randomUUID(),movement:receipt},true)).statusCode).toBe(403);
  expect((await post('stock/movements',{requestId:randomUUID(),movement:{...receipt,receiptReference:undefined}})).statusCode).not.toBe(200);
  expect((await post('stock/movements',{requestId:randomUUID(),movement:{...receipt,supplierId:c.domain!.quote.supplierId}})).statusCode).toBe(200);
  expect((await post('stock/movements',{requestId:randomUUID(),movement:{...receipt,id:'duplicate-document'}})).statusCode).not.toBe(200);
  expect(l.inventory.balance('mn-item-1').onHand).toBe(36);
  expect(l.inventory.delivery(c.poId!).remaining).toBe(20);
  expect(c.paymentState).toBe('Unobserved');expect(l.store.inspect(c.poId!).operations).toHaveLength(0);
  const dashboard=(await app.inject({url:'/api/operations/stock',headers:await headers()})).json();
  expect(dashboard.items).toHaveLength(6);expect(dashboard.workerHealth.status).toBe('unobserved');expect(dashboard.items[0].freshness.issues).toEqual([]);
 }finally{await app.close();l.close();rmSync(dirname(l.inventory.path),{recursive:true,force:true});}
});

it('P4A PAYMENT SEPARATION / REAL SQLITE + MOCKED READS: confirmed payment never receives physical goods',async()=>{
 const l=openInventoryOperations('test-'+randomUUID());
 try{
  l.monitor.runOnce('payment-separation');const c=l.workflow.get(l.inventory.dashboard().obligations[0].caseId);
  const before=l.inventory.balance('mn-item-1');const history=l.inventory.history('mn-item-1');
  const unused=async()=>{throw new Error('Unexpected financial method');};
  const reader:VaultReader={profile:l.store.profile,readOnly:true,injectedReads:true,canonicalOrder:async()=>l.store.resolve(c.poId!).canonical,
   view:async<T>()=>({status:'Paid',reason:'None',attempt_id:'',reserved_day:1} as T),approvalReview:unused,revalidateApproval:unused,finalTransaction:unused};
  const observation=await observeVault(l.store,c.poId!,'mocked-rpc',new Date(),reader);
  expect(l.workflow.observe(c.caseId,observation).state).toBe('SameChainConfirmed');
  expect(l.inventory.balance('mn-item-1')).toEqual(before);expect(l.inventory.history('mn-item-1')).toEqual(history);
  expect(l.inventory.delivery(c.poId!).received).toBe(0);expect(l.inventory.dashboard().obligations[0].closedAt).toBeNull();
  expect(l.store.inspect(c.poId!).operations).toHaveLength(0);
 }finally{l.close();rmSync(dirname(l.inventory.path),{recursive:true,force:true});}
});
it('P4A BOOTSTRAP: safely initializes an empty SQLite file but preserves foreign schemas transactionally',async()=>{
 const {default:Database}=await import('better-sqlite3');const {mkdirSync}=await import('node:fs');
 const name='test-'+randomUUID(),profile=localOperationsProfile(name);mkdirSync(dirname(profile.databasePath),{recursive:true});
 const empty=new Database(profile.databasePath);empty.close();
 let local:ReturnType<typeof openInventoryOperations>|undefined;
 try{local=openInventoryOperations(name,Date.now,{dataset:'clinic'});expect(local.inventory.dashboard().items).toHaveLength(6);}
 finally{local?.close();rmSync(dirname(profile.databasePath),{recursive:true,force:true});}
 const foreignName='test-'+randomUUID(),foreign=localOperationsProfile(foreignName);mkdirSync(dirname(foreign.databasePath),{recursive:true});
 const db=new Database(foreign.databasePath);db.exec('CREATE TABLE unrelated(value TEXT); INSERT INTO unrelated VALUES (\'preserve\')');
 try{expect(()=>openInventoryOperations(foreignName)).toThrow(/existing non-inventory database is preserved/);expect(db.prepare('SELECT value FROM unrelated').pluck().get()).toBe('preserve');expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'inventory_%'").all()).toEqual([]);}
 finally{db.close();rmSync(dirname(foreign.databasePath),{recursive:true,force:true});}
});

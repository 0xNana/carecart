import {afterEach, expect, it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {rmSync} from 'node:fs';
import {join} from 'node:path';
import Database from 'better-sqlite3';
import {PROJECT_ROOT} from '../profiles/storage';
import {openLocalOperations} from './local';
import {createOperationsApp} from './api';
import {OperatorAuth} from './auth';
import {PlaygroundRuns} from '../../test-support/synthetic-scenario.js';

const cleanup: (() => Promise<unknown> | void)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function fixture() {
 const name = `phase2-${randomUUID()}`;
 const local = openLocalOperations(name);
 const app = createOperationsApp({workflow:local.workflow, origin:'http://localhost:3000',
  operatorCredential:'operator-'.repeat(5), viewerCredential:'viewer-'.repeat(6)});
 cleanup.push(() => {
  const db=new Database(local.store.profile.databasePath,{readonly:true,fileMustExist:true});
  try {
   const rows=db.prepare('SELECT workspace FROM playground_runs').all() as {workspace:string}[];
   for(const row of rows){
    if(!/^playground-[a-f0-9]{48}$/.test(row.workspace))throw new Error('Refuse invalid test-owned simulation path');
    rmSync(join(PROJECT_ROOT,'backend/data/local-v2/local-operations',row.workspace),{recursive:true,force:true});
   }
  } finally {db.close();}
  rmSync(join(PROJECT_ROOT,'backend/data/local-v2/local-operations',name),{recursive:true,force:true});
 });
 cleanup.push(() => local.close());
 cleanup.push(() => app.close());
 const login = async (viewer=false) => {
  const response = await app.inject({method:'POST',url:'/api/operations/login',headers:{origin:'http://localhost:3000'},payload:{credential:viewer?'viewer-'.repeat(6):'operator-'.repeat(5)}});
  const values=response.headers['set-cookie'];const cookies=Array.isArray(values)?values:[values!];
  const cookie=cookies.find(c=>c.startsWith('carecart_ops='))!.split(';')[0];
  const session=(await app.inject({url:'/api/operations/session',headers:{cookie}})).json();
  return {cookie,origin:'http://localhost:3000','x-csrf-token':session.csrf,'x-operation-nonce':session.nonce};
 };
 const scenarioAuth=new OperatorAuth(local.store,'http://localhost:3000','operator-'.repeat(5),'viewer-'.repeat(6));const scenario=new PlaygroundRuns(scenarioAuth);cleanup.push(()=>scenarioAuth.close());
 const simulate=(headers:Record<string,string>,payload:unknown)=>{const session=scenarioAuth.session(headers.cookie?.split('=')[1]??'');const nonce=scenarioAuth.authorizeMutation(session,headers.origin,headers['x-csrf-token'],headers['x-operation-nonce']);return scenario.run(payload,session,nonce);};
 return {app,local,login,simulate};
}
it('test-only deterministic fixture consumes stock and prepares an isolated canonical PO with no financial execution',async()=>{
 const {local,login,simulate}=await fixture();const headers=await login();const payload={requestId:randomUUID()};const result=simulate(headers,payload);
 expect(result.execution).toBe('local-simulation');expect(result.network).toBe('none');expect(result.financialExecution).toBe(false);
 expect(result.stock.items[0].balance.onHand).toBe(8);expect(result.stock.items[0].forecast.reorderPoint).toBe(28);
 const c=result.projection.cases[0];expect(c.state).toBe('PoDrafted');expect(c.paymentState).toBe('Unobserved');
 expect(c.domain!.purchaseOrder.canonical.amount).toBe('2000000');expect(c.domain!.purchaseOrder.canonical.supplier).toBe('supplier-a.local-ops.near');
 expect(c.inventory!.quotes).toHaveLength(2);expect(result.projection.profileFingerprint).not.toBe(local.store.fingerprint);expect(local.workflow.list()).toHaveLength(0);
 const again=simulate(headers,payload);expect(again.projection.cases[0].poHash).toBe(c.poHash);expect(again.stock.items[0].balance.onHand).toBe(8);
});
it('test-only reset keeps the previous scenario and operational records isolated',async()=>{
 const {local,login,simulate}=await fixture();const first=simulate(await login(),{requestId:randomUUID()});const second=simulate(await login(),{requestId:randomUUID()});
 expect(first.projection.profileFingerprint).not.toBe(second.projection.profileFingerprint);expect(second.stock.items[0].balance.onHand).toBe(8);expect(local.workflow.list()).toHaveLength(0);
});
it('test-only fixture still rejects anonymous, viewer, CSRF and caller-selected network or payment terms',async()=>{
 const {login,simulate}=await fixture();const payload={requestId:randomUUID()},awaitViewer=await login(true);expect(()=>simulate({},payload)).toThrow();expect(()=>simulate(awaitViewer,payload)).toThrow();
 const headers=await login();expect(()=>simulate({...headers,'x-csrf-token':'invalid'},payload)).toThrow();
 for(const extra of [{network:'mainnet'},{amount:'1'},{recipient:'attacker.near'},{workspace:'workspace'}])expect(()=>simulate(headers,{...payload,...extra})).toThrow();
});
it('authenticated catalog reads use registered supplier identities before any case exists',async()=>{
 const {app,local,login}=await fixture();
 expect((await app.inject('/api/operations/catalog')).statusCode).toBe(401);
 const response=await app.inject({url:'/api/operations/catalog',headers:await login(true)});
 expect(response.statusCode).toBe(200);const catalog=response.json();
 expect(catalog.dataOrigin).toBe('synthetic');expect(catalog.profileFingerprint).toBe(local.store.fingerprint);
 expect(catalog.suppliers).toHaveLength(3);expect(catalog.entries.length).toBeGreaterThan(0);
 expect(local.workflow.list()).toHaveLength(0);
});

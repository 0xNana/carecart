import {afterEach,expect,it,vi} from 'vitest';
import {Account} from 'near-api-js';
import {randomUUID} from 'node:crypto';
import {dirname} from 'node:path';
import {rmSync} from 'node:fs';
import {openLocalOperations} from './local';
import {createOperationsApp} from './api';
import {executeProcurementRole} from '../procurement/v2-bridge';

const cleanup:(()=>void|Promise<unknown>)[]=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();vi.restoreAllMocks();});
function fixture(){
 let now=Date.now();const local=openLocalOperations('p3c-auth-'+randomUUID());
 const sign=vi.spyOn(Account.prototype,'callFunctionRaw').mockRejectedValue(new Error('SIGNING_FORBIDDEN'));
 const origin='http://localhost:3000';const operator='operator-'.repeat(5),viewer='viewer-'.repeat(6);
 const app=createOperationsApp({workflow:local.workflow,origin,operatorCredential:operator,viewerCredential:viewer,clock:()=>now});
 cleanup.push(()=>rmSync(dirname(local.store.profile.databasePath),{recursive:true,force:true}),()=>local.close(),()=>app.close());
 const login=async(role:'operator'|'viewer'='operator')=>{
  const response=await app.inject({method:'POST',url:'/api/operations/login',headers:{origin},payload:{credential:role==='operator'?operator:viewer}});
  expect(response.statusCode).toBe(200);const values=response.headers['set-cookie'];const cookies=Array.isArray(values)?values:[values!];
  const cookie=cookies.find(value=>value.startsWith('carecart_ops='))!.split(';')[0];
  const session=(await app.inject({url:'/api/operations/session',headers:{cookie}})).json();
  return {cookie,origin,'x-csrf-token':session.csrf,'x-operation-nonce':session.nonce};
 };
 return {local,app,sign,login,advance:(ms:number)=>{now+=ms;}};
}
const request=()=>({requestId:randomUUID(),mode:'deterministic',target:{kind:'item',itemId:'mn-item-1',eventId:'p3c-event'}});
it('HTTP: forged identity fields and missing or malformed sessions cannot create procurement work',async()=>{
 const f=fixture();
 for(const cookie of ['', 'carecart_ops=invalid','carecart_ops='+'a'.repeat(64)]){
  const result=await f.app.inject({method:'POST',url:'/api/operations/runs',headers:{cookie,origin:'http://localhost:3000','x-role':'operator'},payload:{...request(),role:'operator',userId:'admin',environment:'mainnet'}});
  expect(result.statusCode).toBe(401);
 }
 const result=await f.app.inject({method:'POST',url:'/api/operations/login',headers:{origin:'http://localhost:3000'},payload:{credential:'viewer-'.repeat(6),role:'operator'}});
 expect(result.statusCode).toBe(400);expect(f.local.workflow.list()).toHaveLength(0);expect(f.sign).not.toHaveBeenCalled();
});
it('HTTP: a viewer remains read-only even with correct CSRF and nonce and forged role claims',async()=>{
 const f=fixture();const headers=await f.login('viewer');
 for(const path of ['runs','stock/movements','stock/autonomy','playground/runs','cases/forged/wallet-reviews']){
  const r=await f.app.inject({method:'POST',url:'/api/operations/'+path,headers:{...headers,'x-role':'operator'},payload:{...request(),role:'operator'}});
  expect(r.statusCode,path).toBe(403);
 }
 expect(f.local.workflow.list()).toHaveLength(0);expect(f.sign).not.toHaveBeenCalled();
});
it('HTTP: operators can prepare exactly one durable draft but obtain no financial role or endpoint',async()=>{
 const f=fixture();const headers=await f.login();const payload=request();
 const responses=await Promise.all(Array.from({length:4},()=>f.app.inject({method:'POST',url:'/api/operations/runs',headers,payload})));
 expect(responses.every(r=>r.statusCode===200)).toBe(true);
 expect(new Set(responses.map(r=>r.json().run.id)).size).toBe(1);
 const cases=f.local.workflow.list();expect(cases).toHaveLength(1);const c=cases[0];
 expect(c.state).toBe('PoDrafted');expect(c.paymentState).toBe('Unobserved');expect(c.nextAction).toBe('AuthorizeCommitment');
 for(const path of ['payments','request_payment','commit_purchase_order'])
  expect((await f.app.inject({method:'POST',url:'/api/operations/'+path,headers,payload:{poId:c.poId,role:'requester'}})).statusCode).toBe(404);
 await expect(executeProcurementRole(f.local.store,'committer',{poId:c.poId,expectedHash:c.poHash},{CARECART_SAFETY_WRITES:'approved'})).rejects.toThrow(/credential/);
 const conflict=await f.app.inject({method:'POST',url:'/api/operations/runs',headers,payload:{...payload,target:{...payload.target,eventId:'changed'}}});
 expect(conflict.statusCode).toBe(409);expect(f.local.workflow.list()).toHaveLength(1);expect(f.sign).not.toHaveBeenCalled();
});
it('HTTP: expired sessions and nonces and missing CSRF fail before any mutation or signing',async()=>{
 const f=fixture();const headers=await f.login();const payload=request();
 const withoutCsrf={...headers,'x-csrf-token':''};
 expect((await f.app.inject({method:'POST',url:'/api/operations/runs',headers:withoutCsrf,payload})).statusCode).toBe(403);
 f.advance(6*60_000);
 expect((await f.app.inject({method:'POST',url:'/api/operations/runs',headers,payload})).statusCode).toBe(403);
 f.advance(25*60_000);
 expect((await f.app.inject({url:'/api/operations/session',headers})).statusCode).toBe(401);
 expect((await f.app.inject({method:'POST',url:'/api/operations/runs',headers,payload})).statusCode).toBe(401);
 expect(f.local.workflow.list()).toHaveLength(0);expect(f.sign).not.toHaveBeenCalled();
});

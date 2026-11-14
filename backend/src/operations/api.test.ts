import { afterEach,expect,it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';import { join } from 'node:path';
import { PROJECT_ROOT } from '../profiles/storage';
import Database from 'better-sqlite3';import { openLocalOperations,assertNoSigningCredentials } from './local';import { createOperationsApp } from './api';
const cleanup:(()=>Promise<unknown>|void)[]=[];afterEach(async()=>{for(const c of cleanup.splice(0).reverse())await c();});
async function fixture(){const name=`api-${randomUUID()}`;const local=openLocalOperations(name);const app=createOperationsApp({workflow:local.workflow,origin:'http://localhost:3000',operatorCredential:'operator-'.repeat(5),viewerCredential:'viewer-'.repeat(6)});
 cleanup.push(()=>rmSync(join(PROJECT_ROOT,'backend/data/local-v2/local-operations',name),{recursive:true,force:true}));cleanup.push(()=>local.close());cleanup.push(()=>app.close());
 const login=async(role='operator')=>{const r=await app.inject({method:'POST',url:'/api/operations/login',headers:{origin:'http://localhost:3000'},payload:{credential:role==='operator'?'operator-'.repeat(5):'viewer-'.repeat(6)}});
 expect(r.statusCode).toBe(200);const cookie=r.headers['set-cookie']!.toString().split(';')[0];const session=(await app.inject({url:'/api/operations/session',headers:{cookie}})).json();return {cookie,...session};};return {local,app,login};}
it('issues separate operations and app cookies, then refreshes the app-scoped cookie on session reads',async()=>{
 const {app}=await fixture();const login=await app.inject({method:'POST',url:'/api/operations/login',headers:{origin:'http://localhost:3000'},payload:{credential:'operator-'.repeat(5)}});
 const header=login.headers['set-cookie'];const cookies=Array.isArray(header)?header:[header??''];expect(login.statusCode).toBe(200);expect(cookies).toHaveLength(2);
 const opsCookie=cookies.find(value=>value.startsWith('carecart_ops='))!.split(';')[0];
 expect(cookies.find(value=>value.startsWith('carecart_app='))).toContain('Path=/app');
 const session=await app.inject({url:'/api/operations/session',headers:{cookie:opsCookie}});
 expect(session.statusCode).toBe(200);expect(session.headers['set-cookie']).toContain('Path=/app');
});
it('requires authentication, enforces viewer permissions, strict origins and bounded requests',async()=>{
 const {app,login}=await fixture();expect((await app.inject('/api/operations/cases')).statusCode).toBe(401);
 const viewer=await login('viewer');const headers={cookie:viewer.cookie,origin:'http://localhost:3000','x-csrf-token':viewer.csrf,'x-operation-nonce':viewer.nonce};
 expect((await app.inject({method:'POST',url:'/api/operations/runs',headers,payload:{}})).statusCode).toBe(403);
 expect((await app.inject({url:'/api/operations/cases?limit=999',headers})).statusCode).toBe(400);
 expect((await app.inject({url:'/api/operations/cases?databasePath=other',headers})).statusCode).toBe(400);
});
it('connects authenticated run to persisted case, paginated reads and durable trace without a payment capability',async()=>{
 const {app,login,local}=await fixture();const session=await login();const headers={cookie:session.cookie,origin:'http://localhost:3000','x-csrf-token':session.csrf,'x-operation-nonce':session.nonce};
 const payload={requestId:randomUUID(),mode:'deterministic',target:{kind:'item',itemId:'mn-item-1',eventId:'event-1'}};
 const r=await app.inject({method:'POST',url:'/api/operations/runs',headers,payload});expect(r.statusCode).toBe(200);const run=r.json().run;expect(run.state).toBe('Completed');
 const list=(await app.inject({url:'/api/operations/cases?limit=1',headers:{cookie:session.cookie}})).json();expect(list.projection.cases).toHaveLength(1);
 expect(list.projection.cases[0].caseId).toBe(run.caseId);expect(local.workflow.get(run.caseId).state).toBe('PoDrafted');
 const repeat=await app.inject({method:'POST',url:'/api/operations/runs',headers,payload});expect(repeat.json().run.id).toBe(run.id);
 const replay=await app.inject({method:'POST',url:'/api/operations/runs',headers,payload:{...payload,requestId:randomUUID()}});expect(replay.statusCode).toBe(409);
 const csrf=await app.inject({method:'POST',url:'/api/operations/runs',headers:{...headers,origin:'http://evil.invalid'},payload});expect(csrf.statusCode).toBe(403);
});
it('rejects oversized input, invalid identifiers, case corruption and financial endpoint attempts',async()=>{
 const {app,login,local}=await fixture();const s=await login();const headers={cookie:s.cookie,origin:'http://localhost:3000','x-csrf-token':s.csrf,'x-operation-nonce':s.nonce};
 expect((await app.inject({url:'/api/operations/cases/'+ 'x'.repeat(65),headers})).statusCode).toBe(400);
 expect((await app.inject({method:'POST',url:'/api/operations/runs',headers,payload:{text:'x'.repeat(20000)}})).statusCode).toBe(413);
 expect((await app.inject({method:'POST',url:'/api/operations/request_payment',headers,payload:{poId:'x'}})).statusCode).toBe(404);
 const c=local.workflow.ingest({caseId:'corrupt',eventId:'corrupt',idempotencyKey:'corrupt',itemId:'mn-item-1'});
 const db=new Database(local.store.profile.databasePath);
 try{db.prepare('DELETE FROM replenishment_events WHERE case_id=? AND version=2').run(c.caseId);
  const result=await app.inject({url:`/api/operations/cases/${c.caseId}`,headers});expect(result.statusCode).toBe(503);expect(result.body).not.toContain('PoDrafted');
 }finally{db.close();}
});
it('rejects live profile activation and signing credentials in the separate service boundary',async()=>{
 const {local}=await fixture();

 expect(()=>assertNoSigningCredentials({SAFETY_REQUESTER_PRIVATE_KEY:'fixture-secret'})).toThrow(/forbidden/);
 expect(()=>assertNoSigningCredentials({PO_COMMITTER_PRIVATE_KEY:'fixture-secret'})).toThrow(/forbidden/);
 expect(()=>assertNoSigningCredentials({ADMIN_SEED_PHRASE:'fixture-secret'})).toThrow(/forbidden/);
 const fake={procurement:{profile:{...local.store.profile,vault:'operational.near'}}};
 expect(()=>createOperationsApp({workflow:fake as never,origin:'http://localhost:3000',operatorCredential:'operator-'.repeat(5)})).toThrow(/local-synthetic/);
});
it('registers read-only payment routes behind authentication and reports unavailable configuration without a missing-route 404',async()=>{
 const {app,login}=await fixture();
 const routes=[['funding','FUNDING_UNAVAILABLE'],['automatic-purchasing','AUTOMATIC_POLICY_UNAVAILABLE']] as const;
 for(const [path] of routes)expect((await app.inject('/api/operations/'+path)).statusCode).toBe(401);
 const s=await login();
 for(const [path,code] of routes){
  const response=await app.inject({url:'/api/operations/'+path,headers:{cookie:s.cookie,origin:'http://localhost:3000'}});
  expect(response.statusCode).toBe(503);expect(response.json()).toMatchObject({error:{code}});
 }
});

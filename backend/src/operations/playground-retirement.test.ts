import {afterEach,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {rmSync} from 'node:fs';
import {dirname} from 'node:path';
import Database from 'better-sqlite3';
import {openLocalOperations} from './local';
import {createOperationsApp} from './api';
const cleanup:(()=>Promise<unknown>|void)[]=[];
afterEach(async()=>{for(const f of cleanup.splice(0).reverse())await f();vi.unstubAllGlobals();});
it('retired Playground routes preserve authentication and mutation guards and cannot create a simulation or payment',async()=>{
 const local=openLocalOperations('retirement-'+randomUUID());const app=createOperationsApp({workflow:local.workflow,origin:'http://localhost:3000',operatorCredential:'operator-'.repeat(5),viewerCredential:'viewer-'.repeat(6)});
 cleanup.push(()=>rmSync(dirname(local.store.profile.databasePath),{recursive:true,force:true}),()=>local.close(),()=>app.close());
 const external=vi.fn(()=>{throw new Error('No external calls permitted')});vi.stubGlobal('fetch',external);
 const login=async(viewer=false)=>{const r=await app.inject({method:'POST',url:'/api/operations/login',headers:{origin:'http://localhost:3000'},payload:{credential:viewer?'viewer-'.repeat(6):'operator-'.repeat(5)}});const values=r.headers['set-cookie'];const cookie=(Array.isArray(values)?values:[values!]).find(c=>c.startsWith('carecart_ops='))!.split(';')[0];const s=(await app.inject({url:'/api/operations/session',headers:{cookie}})).json();return {cookie,origin:'http://localhost:3000','x-csrf-token':s.csrf,'x-operation-nonce':s.nonce};};
 for(const method of ['GET','POST'] as const){const url='/api/operations/playground'+(method==='POST'?'/runs':'');expect((await app.inject({method,url,payload:method==='POST'?{requestId:randomUUID()}:undefined})).statusCode).toBe(401);}
 const viewer=await login(true);expect((await app.inject({url:'/api/operations/playground',headers:viewer})).statusCode).toBe(410);expect((await app.inject({method:'POST',url:'/api/operations/playground/runs',headers:viewer,payload:{requestId:randomUUID()}})).statusCode).toBe(403);
 const headers=await login();const payload={requestId:randomUUID()};expect((await app.inject({method:'POST',url:'/api/operations/playground/runs',headers:{...headers,'x-csrf-token':'invalid'},payload})).statusCode).toBe(403);
 expect((await app.inject({method:'POST',url:'/api/operations/playground/runs',headers:{...headers,origin:'https://evil.invalid'},payload})).statusCode).toBe(403);
 for(const body of [payload,{...payload,network:'mainnet',recipient:'attacker.near',amount:'1'}]){const r=await app.inject({method:'POST',url:'/api/operations/playground/runs',headers,payload:body});expect(r.statusCode).toBe(410);expect(r.json().error.code).toBe('PLAYGROUND_RETIRED');}
 expect(local.workflow.list()).toHaveLength(0);expect(external).not.toHaveBeenCalled();
 const db=new Database(local.store.profile.databasePath,{readonly:true});try{expect(db.prepare("SELECT name FROM sqlite_master WHERE name='playground_runs'").get()).toBeUndefined();}finally{db.close();}
});

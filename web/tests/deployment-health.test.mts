import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {resolve,join} from 'node:path';import {pathToFileURL} from 'node:url';import ts from 'typescript';

test('public readiness is bounded and redacted; missing identity or upstream failure never reports ready',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'carecart-readiness-'));const originalFetch=globalThis.fetch,env={...process.env};let calls=0;
 try{
  const source=readFileSync('src/app/api/health/route.ts','utf8').replace("'@/lib/auth-config'",JSON.stringify(pathToFileURL(resolve('src/lib/auth-config.ts')).href));
  writeFileSync(join(folder,'health.mjs'),ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
  const {GET}=await import(pathToFileURL(join(folder,'health.mjs')).href);
  process.env.CARECART_AUTH_MODE='supabase';delete process.env.SUPABASE_URL;
  globalThis.fetch=async()=>{calls++;return Response.json({status:'ok',private:'must not expose'});};
  assert.equal((await GET()).status,503);assert.equal(calls,0);
  Object.assign(process.env,{SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture_value',CARECART_PUBLIC_ORIGIN:'https://carecart.example',CARECART_OPERATIONS_API_URL:'http://127.0.0.1:3002'});
  globalThis.fetch=async(input,init)=>{calls++;assert.equal(String(input),'http://127.0.0.1:3002/healthz');assert.equal(init?.cache,'no-store');assert.equal(init?.redirect,'error');assert.ok(init?.signal);return Response.json({status:'ok',private:'must not expose'});};
  const ready=await GET();assert.equal(ready.status,200);assert.deepEqual(await ready.json(),{status:'ok'});assert.equal(ready.headers.get('cache-control'),'no-store');
  globalThis.fetch=async()=>Response.json({status:'unavailable'},{status:503});const failed=await GET();assert.equal(failed.status,503);assert.deepEqual(await failed.json(),{status:'unavailable'});
  process.env.CARECART_OPERATIONS_API_URL='https://api.carecart.example';globalThis.fetch=async(input)=>{assert.equal(String(input),'https://api.carecart.example/healthz');return Response.json({status:'ok'});};assert.equal((await GET()).status,200);
  process.env.CARECART_OPERATIONS_API_URL='https://external.example';assert.equal((await GET()).status,503);
 }finally{globalThis.fetch=originalFetch;for(const key of Object.keys(process.env))if(!(key in env))delete process.env[key];Object.assign(process.env,env);rmSync(folder,{recursive:true,force:true});}
});

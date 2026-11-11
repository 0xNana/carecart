import { test } from 'node:test';import assert from 'node:assert/strict';
import { proxyOperatorRequest } from '../src/lib/operator-proxy.ts';
import { OperatorClient,acceptCaseRevision } from '../src/lib/operator-client.ts';

test('default operator transport preserves the browser fetch receiver for login and authenticated reads',async()=>{
 const original=globalThis.fetch;
 const calls:string[]=[];
 globalThis.fetch=async function(this:unknown,input,init){
  if(this!==globalThis)throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
  calls.push(String(input));
  assert.equal(init?.credentials,'same-origin');
  if(String(input).endsWith('/login'))return Response.json({authenticated:true});
  if(String(input).endsWith('/inventory'))return Response.json({items:[]});
  return Response.json({role:'operator',csrf:'a'.repeat(64),nonce:'b'.repeat(48),profileFingerprint:'c'.repeat(64),providerAvailable:false,model:null});
 };
 try{
  const client=new OperatorClient();
  assert.equal((await client.login('fixture-operator-credential')).role,'operator');
  assert.deepEqual(await client.inventory(),[]);
  assert.deepEqual(calls,['/api/operations/login','/api/operations/session','/api/operations/inventory']);
 }finally{globalThis.fetch=original;}
});

test('operator proxy forwards only cookie/CSRF to a fixed loopback service, never a role or bearer credential',async()=>{
 let captured:RequestInit|undefined;
 const response=await proxyOperatorRequest(new Request('http://localhost:3000/api/operations/cases',{headers:{cookie:`carecart_ops=${'a'.repeat(64)}; unrelated=secret`,authorization:'Bearer forbidden'}}),['cases'],'http://127.0.0.1:3002',async(_url,init)=>{captured=init;return Response.json({cases:[]});});
 assert.equal(response.status,200);const headers=new Headers(captured!.headers);assert.equal(headers.get('authorization'),null);assert.equal(headers.get('cookie'),`carecart_ops=${'a'.repeat(64)}`);
});
test('proxy refuses CSRF, arbitrary endpoints, external services and oversized input',async()=>{
 const noFetch=async()=>{throw new Error('transport must not run');};
 for(const [url,method,origin,path,upstream] of [
  ['http://localhost:3000/api/operations/runs','POST','http://evil.invalid',['runs'],'http://127.0.0.1:3002'],
  ['http://localhost:3000/api/operations/sign','POST','http://localhost:3000',['sign'],'http://127.0.0.1:3002'],
  ['http://localhost:3000/api/operations/cases','GET','http://localhost:3000',['cases'],'https://attacker.invalid'],
 ] as const){const result=await proxyOperatorRequest(new Request(url,{method,headers:{origin}}),[...path],upstream,noFetch);assert.ok(result.status>=400);}
 const large=await proxyOperatorRequest(new Request('http://localhost:3000/api/operations/runs',{method:'POST',headers:{origin:'http://localhost:3000'},body:'x'.repeat(20000)}),['runs'],'http://127.0.0.1:3002',noFetch);assert.equal(large.status,413);
});
test('client expires authentication, rejects stale revisions and never mixes live case data with offline imports',async()=>{
 const client=new OperatorClient(async()=>Response.json({error:{code:'AUTH_EXPIRED'}},{status:401}));
 await assert.rejects(client.session(),/AUTH_EXPIRED/);assert.equal(client.authenticated,false);
 assert.equal(acceptCaseRevision('live-a',9,'live-a',8),false);assert.equal(acceptCaseRevision('live-a',9,'live-a',10),true);
 assert.equal(acceptCaseRevision('live-a',9,'offline-b',10),false);
});
test('client refuses a cross-profile projection even after authentication',async()=>{
 const client=new OperatorClient(async url=>Response.json(String(url).endsWith('session')?{role:'operator',csrf:'a'.repeat(64),nonce:'b'.repeat(48),profileFingerprint:'c'.repeat(64),providerAvailable:false,model:null}:
  {projection:{format:'carecart-workflow-v1',dataOrigin:'synthetic',generatedAt:'2026-11-03T12:00:00Z',profileFingerprint:'d'.repeat(64),cases:[]},total:0,nextOffset:null}));
 await client.session();await assert.rejects(client.cases(),/PROFILE_MISMATCH/);
});
test('authenticated reads never place credentials in JavaScript storage or authorization headers',async()=>{
 const requests:{path:string;init:RequestInit|undefined}[]=[];
 const client=new OperatorClient(async(url,init)=>{requests.push({path:String(url),init});return Response.json(String(url).endsWith('login')?{authenticated:true}:
  {role:'viewer',csrf:'a'.repeat(64),nonce:'b'.repeat(48),profileFingerprint:'c'.repeat(64),providerAvailable:false,model:null});});
 await client.login('entered-at-runtime');
 assert.equal(requests[1].init?.body,undefined);assert.equal(new Headers(requests[1].init?.headers).has('Authorization'),false);
 assert.equal(requests[0].init?.credentials,'same-origin');
});
test('client rejects an older response after a newer authenticated case revision',async()=>{
 const record=(revision:number)=>({caseId:'case-1',eventId:'e',itemId:'mn-item-1',state:'Opened',version:revision,poId:null,poHash:null,nextAction:'ResumePreparation',humanInterventions:[],
  createdAt:'2026-11-03T12:00:00Z',updatedAt:'2026-11-03T12:00:00Z',inventory:null,domain:null,vault:null,settlement:null,paymentState:'Unobserved',evidenceKind:'local-only',timeline:[]});
 let count=0;const client=new OperatorClient(async url=>Response.json(String(url).endsWith('session')?{role:'operator',csrf:'a'.repeat(64),nonce:'b'.repeat(48),profileFingerprint:'c'.repeat(64),providerAvailable:false,model:null}:
  {projection:{format:'carecart-workflow-v1',dataOrigin:'synthetic',generatedAt:'2026-11-03T12:00:00Z',profileFingerprint:'c'.repeat(64),cases:[record(++count===1?10:9)]},revision:count===1?10:9,eventCount:0,runs:[]}));
 await client.session();await client.detail('case-1');await assert.rejects(client.detail('case-1'),/STALE_RESPONSE/);
});
test('live workspace renders an authentication boundary and keeps offline imports in a separate mode',async()=>{
 const {mkdtempSync,writeFileSync,symlinkSync,readFileSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');
 const {join,resolve}=await import('node:path');const {pathToFileURL}=await import('node:url');const {default:ts}=await import('typescript');
 const {createElement}=await import('react');const {renderToStaticMarkup}=await import('react-dom/server');const folder=mkdtempSync(join(tmpdir(),'carecart-live-ui-'));
 try{symlinkSync(resolve('node_modules'),join(folder,'node_modules'),'dir');
  for(const [source,target] of [['src/lib/financial-review.ts','financial-review.mjs'],['src/lib/workflow.ts','workflow.mjs'],['src/lib/inventory.ts','inventory.mjs'],['src/components/inventory-operations.tsx','inventory-operations.mjs'],['src/lib/operator-client.ts','client.mjs'],['src/lib/v2-wallet.ts','v2-wallet.mjs'],['src/components/v2-wallet-review.tsx','v2-wallet-review.mjs'],['src/components/operations-workspace.tsx','offline.mjs'],['src/components/live-operations.tsx','live.mjs']]){
   let code=ts.transpileModule(readFileSync(source,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
   for(const [from,to] of [['../lib/product-copy',pathToFileURL(resolve('src/lib/product-copy.ts')).href],['./product-copy.ts',pathToFileURL(resolve('src/lib/product-copy.ts')).href],['../lib/workflow','./workflow.mjs'],['./financial-review.ts','./financial-review.mjs'],['./v2-wallet.ts','./v2-wallet.mjs'],['./workflow.ts','./workflow.mjs'],['./inventory.ts','./inventory.mjs'],['./inventory-operations','./inventory-operations.mjs'],['../lib/operator-client','./client.mjs'],['../lib/v2-wallet','./v2-wallet.mjs'],['./v2-wallet-review','./v2-wallet-review.mjs'],['./operations-workspace','./offline.mjs'],['next/link','next/link.js']])code=code.replaceAll(`'${from}'`,`'${to}'`).replaceAll(`"${from}"`,`"${to}"`);
   writeFileSync(join(folder,target),code);
  }
  const {OperationsHub}=await import(pathToFileURL(join(folder,'live.mjs')).href);const html=renderToStaticMarkup(createElement(OperationsHub));
  assert.match(html,/Authenticated live workspace/);assert.match(html,/Offline JSON inspection/);assert.match(html,/Checking operator session/);
  assert.doesNotMatch(html,/type="file"/);assert.doesNotMatch(html,/PRIVATE_KEY|NEAR_CLOUD_API_KEY|operator-operator/);
 }finally{rmSync(folder,{recursive:true,force:true});}
});

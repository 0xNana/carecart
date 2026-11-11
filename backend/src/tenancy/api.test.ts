import {signMessage} from 'near-api-js/nep413';
import {it,expect,vi} from 'vitest';import {generateKeyPair,exportJWK,SignJWT,decodeJwt} from 'jose';import {randomUUID} from 'node:crypto';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,dirname} from 'node:path';import {Account,JsonRpcProvider,KeyPair} from 'near-api-js';
import {SupabaseIdentity} from './identity';import {ClinicRegistry} from './registry';import {createTenantApp} from './api';import {ClinicRuntimePool,openClinicRuntime} from './runtime';import {MockWalletLedger} from '../operations/mock-wallet-ledger';import {FinancialAuthorizations} from '../operations/financial-authorizations';import {VaultPaymentAdapter} from '../payments/adapter';
async function fixture(withWallet=false){
 const folder=mkdtempSync(join(tmpdir(),'carecart-tenant-api-')),registry=new ClinicRegistry(join(folder,'registry.sqlite'));const pool=new ClinicRuntimePool(),origin='http://127.0.0.1:3000',key=await generateKeyPair('ES256');const users=new Map<string,string>();
 const identity=new SupabaseIdentity({url:'https://fixture.supabase.co',publishableKey:'sb_publishable_fixture_only',origin},async(input,init)=>String(input).includes('jwks')?Response.json({keys:[{...await exportJWK(key.publicKey),kid:'fixture',alg:'ES256'}]}):Response.json({id:decodeJwt(String(new Headers(init?.headers).get('Authorization')).slice(7)).sub,email:users.get(String(decodeJwt(String(new Headers(init?.headers).get('Authorization')).slice(7)).sub)),email_confirmed_at:new Date().toISOString()}),true);
 const app=createTenantApp(registry,identity,origin,pool,withWallet?{network:'testnet',rpcUrl:'https://test.rpc.fastnear.com'}:undefined),runtimePaths:string[]=[];
 const signing=vi.spyOn(Account.prototype,'callFunctionRaw').mockRejectedValue(new Error('SIGNING_FORBIDDEN'));const adapter=vi.spyOn(VaultPaymentAdapter.prototype,'requestPayment').mockRejectedValue(new Error('ADAPTER_FORBIDDEN'));
 async function login(){const id=randomUUID(),email=id+'@example.invalid',sid=randomUUID();users.set(id,email);const jwt=await new SignJWT({sub:id,session_id:sid,role:'authenticated',email}).setProtectedHeader({alg:'ES256',kid:'fixture'}).setIssuer('https://fixture.supabase.co/auth/v1').setAudience('authenticated').setIssuedAt().setExpirationTime('1h').sign(key.privateKey);const r=await app.inject({method:'POST',url:'/api/identity/session',headers:{origin,authorization:'Bearer '+jwt,cookie:'carecart_identity='+'f'.repeat(64)},payload:{}});expect(r.statusCode).toBe(200);expect(r.json().token).not.toBe('f'.repeat(64));return {id,email,jwt,cookie:'carecart_identity='+r.json().token};}
 const headers=(u:Awaited<ReturnType<typeof login>>,clinic?:string)=>({origin,authorization:'Bearer '+u.jwt,cookie:u.cookie,...(clinic?{'x-carecart-clinic':clinic}:{}),'x-user-id':'forged','x-role':'Clinic Admin','x-carecart-internal-request':'forged'});
 async function central(u:Awaited<ReturnType<typeof login>>,path:string,body:object){const ctx=(await app.inject({url:'/api/identity/context',headers:headers(u)})).json();return app.inject({method:'POST',url:'/api/identity/'+path,headers:{...headers(u),'x-csrf-token':ctx.csrf,'x-operation-nonce':ctx.nonce},payload:{requestId:randomUUID(),...body}});}
 async function operation(u:Awaited<ReturnType<typeof login>>,clinic:string,path:string,body:object){const session=(await app.inject({url:'/api/operations/session',headers:headers(u,clinic)})).json();return app.inject({method:'POST',url:'/api/operations/'+path,headers:{...headers(u,clinic),'x-csrf-token':session.csrf,'x-operation-nonce':session.nonce},payload:body});}
 const setup={name:'Isolated clinic',country:'GH',timezone:'Africa/Accra',storeroom:'Main',syntheticDemo:true};
 return {app,registry,origin,signing,adapter,login,headers,central,operation,setup,runtimePaths,async close(){await app.close();signing.mockRestore();adapter.mockRestore();for(const p of runtimePaths)rmSync(p,{recursive:true,force:true});rmSync(folder,{recursive:true,force:true});}};
}
it('MOCKED IDP / REAL HTTP HANDLERS + SQLITE: verified sessions, five roles, CSRF, clinic/PO/job isolation, invite/role boundaries, logout and zero signing',async()=>{
 const f=await fixture(),{app,registry,origin,signing,adapter,login,headers,central,operation,setup,runtimePaths}=f;
 try{
  expect((await app.inject('/api/operations/stock')).statusCode).toBe(401);const a=await login(),b=await login();
  const ca=(await central(a,'clinics',{clinic:setup})).json().clinic,cb=(await central(b,'clinics',{clinic:setup})).json().clinic;
  for(const id of [ca.id,cb.id]){const p=openClinicRuntime(registry.clinic(id));runtimePaths.push(dirname(p.inventory.path));p.close();}
  // Close explicit path probes immediately; actual operations use the pooled application services.
  for(const id of [ca.id,cb.id]){const p=openClinicRuntime(registry.clinic(id));p.close();}
  expect((await app.inject({url:'/api/operations/stock',headers:headers(b,ca.id)})).statusCode).toBe(403);
  const view=await login(),officer=await login(),finance=await login(),procurement=await login();
  for(const [u,role] of [[view,'Viewer'],[officer,'Inventory Officer'],[finance,'Finance Officer'],[procurement,'Procurement Officer']] as const){const invite=await central(a,'clinics/'+ca.id+'/invitations',{email:u.email,role});expect(invite.statusCode).toBe(200);const accepted=await central(u,'invitations/accept',{token:invite.json().token});expect(accepted.statusCode).toBe(200);expect((await central(u,'invitations/accept',{token:invite.json().token})).statusCode).toBe(403);}
  expect((await central(view,'clinics/'+ca.id+'/members',{userId:view.id,role:'Clinic Admin',status:'Active'})).statusCode).toBe(403);
  const movement={requestId:randomUUID(),movement:{id:'consume-one',productId:'mn-item-1',kind:'Consume',quantity:4,unit:'base',source:'manual'}};
  expect((await operation(view,ca.id,'stock/movements',movement)).statusCode).toBe(403);expect((await operation(finance,ca.id,'stock/movements',movement)).statusCode).toBe(403);expect((await operation(procurement,ca.id,'stock/movements',movement)).statusCode).toBe(403);
  expect((await operation(officer,ca.id,'stock/movements',movement)).statusCode).toBe(200);
  expect((await operation(officer,ca.id,'cases/fake/financial-authorizations',{requestId:randomUUID(),role:'committer'})).statusCode).toBe(403);
  const direct=(await app.inject({url:'/api/operations/session',headers:headers(a,ca.id)})).json();expect((await app.inject({method:'POST',url:'/api/operations/stock/movements',headers:{...headers(a,ca.id),'x-csrf-token':'wrong','x-operation-nonce':direct.nonce},payload:movement})).statusCode).toBe(403);
  const local=openClinicRuntime(registry.clinic(ca.id));try{local.inventory.configure({...local.inventory.config(),monitoring:true,automaticCases:true,automaticPreparation:true},'internal-worker-fixture');for(let n=0;n<6;n++)local.monitor.runOnce('worker-fixture');const c=local.workflow.get(local.inventory.dashboard().obligations[0].caseId);
   expect((await app.inject({url:'/api/operations/cases/'+c.caseId,headers:headers(b,cb.id)})).statusCode).toBe(404);
   const mock=new MockWalletLedger(local.workflow),financial=new FinancialAuthorizations(local.workflow,mock.financialBinding);try{await expect(financial.authorize(c.caseId,{requestId:randomUUID(),role:'committer',expectedRevision:c.version,expectedHash:c.poHash},'test-verified-actor')).rejects.toThrow('TENANT_FINANCIAL_EXECUTION_DISABLED');expect(financial.db.prepare('SELECT COUNT(*) FROM financial_authorizations').pluck().get()).toBe(0);expect((await operation(b,cb.id,'financial-authorizations/'+randomUUID()+'/reconcile',{requestId:randomUUID()})).statusCode).toBe(404);}finally{financial.close();mock.close();}
  }finally{local.close();}
  const stockA=(await app.inject({url:'/api/operations/stock',headers:headers(a,ca.id)})).json(),stockB=(await app.inject({url:'/api/operations/stock',headers:headers(b,cb.id)})).json();expect(stockA.items[0].balance.onHand).toBe(26);expect(stockB.items[0].balance.onHand).toBe(30);expect(stockB.obligations).toHaveLength(0);
  const demo=await operation(officer,ca.id,'playground/runs',{requestId:randomUUID()});expect(demo.statusCode).toBe(410);expect(demo.json().error.code).toBe('PLAYGROUND_RETIRED');expect((await app.inject({url:'/api/operations/stock',headers:headers(a,ca.id)})).json().items[0].balance.onHand).toBe(26);
  expect((await central(a,'clinics/'+ca.id+'/members',{userId:officer.id,role:'Inventory Officer',status:'Suspended'})).statusCode).toBe(200);expect((await app.inject({url:'/api/operations/stock',headers:headers(officer,ca.id)})).statusCode).toBe(403);
  expect((await central(a,'logout',{})).statusCode).toBe(200);expect((await app.inject({url:'/api/operations/stock',headers:headers(a,ca.id)})).statusCode).toBe(401);expect((await app.inject({method:'POST',url:'/api/identity/session',headers:headers(a),payload:{}})).statusCode).toBe(401);
  for(const p of ['supplier-quotes','purchase-orders','payments','agent/tasks','agent/tick'])expect((await app.inject({method:'POST',url:'/api/'+p,headers:{origin},payload:{}})).statusCode).toBe(410);
  expect(signing).not.toHaveBeenCalled();expect(adapter).not.toHaveBeenCalled();
 }finally{await f.close();}
});

it('TREASURY PREFLIGHT / MOCKED IDP: no implicit wallet binding, no public financial authority and revoked finance roles reject old session/nonce evidence',async()=>{
 const f=await fixture(),{app,registry,origin,signing,adapter,login,headers,central,operation,setup,runtimePaths}=f;
 let local:ReturnType<typeof openClinicRuntime>|undefined;
 try{
  const a=await login(),finance=await login();
  const ca=(await central(a,'clinics',{clinic:setup})).json().clinic,cb=(await central(a,'clinics',{clinic:setup})).json().clinic;
  for(const id of [ca.id,cb.id]){const p=openClinicRuntime(registry.clinic(id));runtimePaths.push(dirname(p.inventory.path));p.close();}
  const invite=await central(a,'clinics/'+ca.id+'/invitations',{email:finance.email,role:'Finance Officer'});
  expect((await central(finance,'invitations/accept',{token:invite.json().token})).statusCode).toBe(200);
  local=openClinicRuntime(registry.clinic(ca.id));
  local.inventory.move({id:'finance-review-consumption',productId:'mn-item-1',kind:'Consume',quantity:4,unit:'base',source:'manual'},'review');
  local.inventory.configure({...local.inventory.config(),monitoring:true,automaticCases:true,automaticPreparation:true},'review');
  for(let n=0;n<6;n++)local.monitor.runOnce('review');
  // A finance membership is not a wallet binding. Old CSRF/nonce evidence also loses authority after role revocation.
  const caseId=local.inventory.dashboard().obligations[0].caseId;
  const reviewed=(await app.inject({url:'/api/operations/cases/'+caseId+'/financial-review',headers:headers(finance,ca.id)})).json().review;
  const financialInput={requestId:randomUUID(),role:'committer',expectedRevision:reviewed.revision,expectedHash:reviewed.canonicalHash};
  const disabled=await operation(finance,ca.id,'cases/'+caseId+'/financial-authorizations',financialInput);
  expect(disabled.statusCode).toBe(403);expect(disabled.json().error.code).toBe('FINANCIAL_EXECUTION_DISABLED');
  expect((await central(finance,'wallet-bindings',{walletAddress:'admin.near',role:'Clinic Admin'})).statusCode).toBe(404);
  const staleFinance=(await app.inject({url:'/api/operations/session',headers:headers(finance,ca.id)})).json();
  expect((await central(a,'clinics/'+ca.id+'/members',{userId:finance.id,role:'Viewer',status:'Active'})).statusCode).toBe(200);
  const revoked=await app.inject({method:'POST',url:'/api/operations/cases/'+caseId+'/financial-authorizations',headers:{...headers(finance,ca.id),'x-csrf-token':staleFinance.csrf,'x-operation-nonce':staleFinance.nonce},payload:financialInput});
  expect(revoked.statusCode).toBe(403);expect(revoked.json().error.code).toBe('CLINIC_PERMISSION_REQUIRED');
  expect((await app.inject({url:'/api/operations/cases/'+caseId,headers:headers(finance,cb.id)})).statusCode).toBe(403);

  expect(signing).not.toHaveBeenCalled();expect(adapter).not.toHaveBeenCalled();
 }finally{local?.close();await f.close();}
});

it('WALLET HTTP: verified identity/CSRF/clinic scope, genuine NEP413 signatures, replay prevention and revocation; zero transactions',async()=>{
 const key=KeyPair.fromRandom('ed25519');vi.spyOn(JsonRpcProvider.prototype,'viewNodeStatus').mockResolvedValue({chain_id:'testnet'} as never);vi.spyOn(JsonRpcProvider.prototype,'viewAccessKey').mockResolvedValue({permission:'FullAccess',nonce:0n} as never);
 const f=await fixture(true),{app,login,headers,central,setup,signing,adapter}=f;
 try{
  const u=await login(),c=(await central(u,'clinics',{clinic:setup})).json().clinic;
  expect((await app.inject({method:'POST',url:'/api/identity/clinics/'+c.id+'/wallet-challenges',headers:{origin:'http://127.0.0.1:3000'},payload:{}})).statusCode).toBe(401);
  const challenge=(await central(u,'clinics/'+c.id+'/wallet-challenges',{accountId:'owner.testnet',network:'testnet'})).json();
  const signed=await signMessage({signerAccount:new Account('owner.testnet',new JsonRpcProvider({url:'https://test.rpc.fastnear.com'}),key.toString()),payload:{...challenge.payload,nonce:new Uint8Array(Buffer.from(challenge.payload.nonce,'base64'))}});
  const proof={challengeId:challenge.id,accountId:'owner.testnet',publicKey:key.getPublicKey().toString(),signature:Buffer.from(signed.signature).toString('base64')};
  const bound=await central(u,'clinics/'+c.id+'/wallet-bindings',proof);expect(bound.statusCode,bound.body).toBe(200);expect(bound.json().financialAuthorization).toBe(false);
  expect((await central(u,'clinics/'+c.id+'/wallet-bindings',proof)).statusCode).toBe(409);
  expect((await central(u,'clinics/'+c.id+'/wallet-bindings/revoke',{bindingId:bound.json().id})).json().status).toBe('Revoked');
  expect((await app.inject({url:'/api/identity/clinics/'+c.id+'/wallet-bindings',headers:headers(u)})).json().bindings[0].status).toBe('Revoked');
  expect(signing).not.toHaveBeenCalled();expect(adapter).not.toHaveBeenCalled();
 }finally{await f.close();vi.restoreAllMocks();}
});

import {afterEach,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';import {rmSync} from 'node:fs';import {dirname} from 'node:path';
import {openInventoryOperations} from '../inventory/local';import {MockWalletLedger} from './mock-wallet-ledger';
import {FinancialAuthorizations} from './financial-authorizations';import {createOperationsApp} from './api';
const close:(()=>void)[]=[];afterEach(()=>{for(const c of close.splice(0).reverse())c();});
function fixture(){const l=openInventoryOperations('p4b-'+randomUUID());close.push(()=>rmSync(dirname(l.inventory.path),{recursive:true,force:true}),()=>l.close());l.monitor.runOnce('headless');const c=l.workflow.get(l.inventory.dashboard().obligations[0].caseId);const mock=new MockWalletLedger(l.workflow);close.push(()=>mock.close());const f=new FinancialAuthorizations(l.workflow,mock.financialBinding);close.push(()=>f.close());return {l,c,mock,f};}
const input=(c:{version:number;poHash:string|null},role='committer')=>({requestId:randomUUID(),role,expectedRevision:c.version,expectedHash:c.poHash});
it('P4B: headless canonical PO uses separate authorizations, simulated restricted operations and independent observations; no goods receipt',async()=>{
 const {l,c,f}=fixture();const original=l.inventory.balance('mn-item-1').onHand;
 const review=await f.assess(c.caseId);expect(review.publicSigningEnabled).toBe(false);expect(review.requiredAuthority).toBe('committer');expect(review.policy.blocks).toEqual([]);
 const a=await f.authorize(c.caseId,input(c),'operator-session');expect(a.state).toBe('Authorized');
 expect(await f.authorize(c.caseId,{...input(c),requestId:a.id},'operator-session')).toEqual(a);
 await f.executeMock(a.id,'operator-session');expect(l.workflow.get(c.caseId).state).toBe('PoDrafted');
 expect((await f.reconcile(a.id)).state).toBe('Observed');const committed=l.workflow.get(c.caseId);expect(committed.state).toBe('PoCommitted');
 const b=await f.authorize(c.caseId,input(committed,'requester'),'operator-session');await f.executeMock(b.id,'operator-session');
 expect(l.workflow.get(c.caseId).paymentState).toBe('Committed');await f.reconcile(b.id);expect(l.workflow.get(c.caseId).paymentState).toBe('Dispatching');
 expect(l.inventory.balance('mn-item-1').onHand).toBe(original);expect(l.inventory.delivery(c.poId!).received).toBe(0);
 await expect(f.authorize(c.caseId,input(l.workflow.get(c.caseId),'requester'),'operator-session')).rejects.toThrow();
 expect(l.store.inspect(c.poId!).operations).toHaveLength(2);
});
it('P4B: missing configuration, forged terms, stale revision, wrong role and other sessions fail closed',async()=>{
 const {l,c,f}=fixture();const disabled=new FinancialAuthorizations(l.workflow);close.push(()=>disabled.close());
 await expect(disabled.authorize(c.caseId,input(c),'operator')).rejects.toThrow(/DISABLED/);
 await expect(f.authorize(c.caseId,{...input(c),amount:'1'},'operator')).rejects.toThrow();
 await expect(f.authorize(c.caseId,{...input(c),expectedHash:'a'.repeat(64)},'operator')).rejects.toThrow();
 await expect(f.authorize(c.caseId,input(c,'requester'),'operator')).rejects.toThrow();
 const a=await f.authorize(c.caseId,input(c),'operator');await expect(f.executeMock(a.id,'other-session')).rejects.toThrow();
 expect(l.store.inspect(c.poId!).operations).toHaveLength(0);
});
it('P4B: concurrent execution claims exactly once and interrupted authorization never permits a resend',async()=>{
 const {l,c,f}=fixture();const a=await f.authorize(c.caseId,input(c),'operator');
 const results=await Promise.allSettled([f.executeMock(a.id,'operator'),f.executeMock(a.id,'operator')]);expect(results.filter(r=>r.status==='fulfilled').length).toBeGreaterThan(0);
 expect(l.store.inspect(c.poId!).operations).toHaveLength(1);
 f.db.prepare("UPDATE financial_authorizations SET state='Executing' WHERE id=?").run(a.id);
 await expect(f.executeMock(a.id,'operator')).rejects.toThrow(/RECONCILIATION/);
 await f.reconcile(a.id);expect(f.get(a.id).state).toBe('Observed');
});
it('P4B HTTP: anonymous/viewer/CSRF/forged payment fields cannot authorize or simulate financial work',async()=>{
 const {l,c,mock}=fixture(),origin='http://127.0.0.1:3000';const app=createOperationsApp({workflow:l.workflow,inventory:l.inventory,financial:mock.financialBinding,humanReview:mock.binding,origin,operatorCredential:'operator-'.repeat(5),viewerCredential:'viewer-'.repeat(6)});close.push(()=>void app.close());
 const path='/api/operations/cases/'+c.caseId+'/financial-authorizations';expect((await app.inject({method:'POST',url:path,payload:input(c)})).statusCode).toBe(401);
 async function headers(viewer=false){const login=await app.inject({method:'POST',url:'/api/operations/login',headers:{origin},payload:{credential:viewer?'viewer-'.repeat(6):'operator-'.repeat(5)}});const cookie=String(login.headers['set-cookie']).split(';')[0];const s=(await app.inject({url:'/api/operations/session',headers:{cookie}})).json();return {cookie,origin,'x-csrf-token':s.csrf,'x-operation-nonce':s.nonce};}
 expect((await app.inject({method:'POST',url:path,headers:await headers(true),payload:input(c)})).statusCode).toBe(403);
 expect((await app.inject({method:'POST',url:path,headers:{...await headers(),'x-csrf-token':'wrong'},payload:input(c)})).statusCode).toBe(403);
 expect((await app.inject({method:'POST',url:path,headers:await headers(),payload:{...input(c),recipient:'attacker.near'}})).statusCode).toBe(400);
 const r=await app.inject({method:'POST',url:path,headers:await headers(),payload:input(c)});expect(r.statusCode).toBe(200);expect(r.json().authorization.state).toBe('Authorized');expect(l.store.inspect(c.poId!).operations).toHaveLength(0);
 await app.close();
});
it('P4B policy review: hard cap, pause, supplier membership, reserve, wrong network and stale quotes fail closed',async()=>{
 const {l,c,mock}=fixture();const {financialPolicy}=await import('../near/human-review.js');
 const order=l.store.resolve(c.poId!).canonical;
 expect((await financialPolicy(mock.binding.client,{...order,amount:'26000000'})).blocks).toContain('HardPayoutLimit');
 const {vi}=await import('vitest');const original=mock.binding.client.view.bind(mock.binding.client);
 for(const [field,value,expected] of [['paused',true,'Paused'],['spendable','0','InsufficientFunds']] as const){
  const spy=vi.spyOn(mock.binding.client,'view').mockImplementation(async(method,args)=>{const result=await original(method,args);return method==='get_state'?{...result as object,[field]:value}:result;});
  const f=new FinancialAuthorizations(l.workflow,mock.financialBinding);try{expect((await f.assess(c.caseId)).policy.blocks).toContain(expected);await expect(f.authorize(c.caseId,input(c),'operator')).rejects.toThrow();}finally{f.close();spy.mockRestore();}
 }
 const supplier=vi.spyOn(mock.binding.client,'view').mockImplementation(async(method,args)=>method==='get_roles'&&args.account===order.supplier?{supplier:false,committer:false,requester:false}:original(method,args));
 expect((await financialPolicy(mock.binding.client,order)).blocks).toContain('UnknownSupplier');supplier.mockRestore();
 const network=vi.spyOn(mock.binding.client,'view').mockImplementation(async(method,args)=>{const result=await original(method,args);return method==='get_state'?{...result as object,profile:'testnet'}:result;});
 await expect(financialPolicy(mock.binding.client,order)).rejects.toThrow(/identity/);network.mockRestore();
 const stale=new FinancialAuthorizations(l.workflow,mock.financialBinding,undefined,()=>Date.now()+3601000);try{expect((await stale.assess(c.caseId)).policy.blocks).toContain('SupplierQuoteExpired');await expect(stale.authorize(c.caseId,input(c),'operator')).rejects.toThrow();}finally{stale.close();}
 expect(l.store.inspect(c.poId!).operations).toHaveLength(0);
});
it('P4B: cross-environment bindings and public-mode substitutions are rejected before authorization',()=>{
 const {l,mock}=fixture();expect(()=>new FinancialAuthorizations(l.workflow,{...mock.financialBinding,kind:'sandbox-rpc'})).toThrow(/environment/);
 expect(()=>new FinancialAuthorizations(l.workflow,{...mock.financialBinding,kind:'public-rpc'} as never)).toThrow(/environment/);
 expect(()=>new FinancialAuthorizations(l.workflow,{...mock.financialBinding,client:{...mock.binding.client,readOnly:false} as never})).toThrow(/authority/);
});

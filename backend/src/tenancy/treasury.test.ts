import {it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {ClinicRegistry} from './registry';
import {ClinicTreasuries} from './treasury';
it('TREASURY: unconfigured clinics have no treasury and schema migrates without assigning ownership',()=>{
 const dir=mkdtempSync(join(tmpdir(),'carecart-registry-')),registry=new ClinicRegistry(join(dir,'registry.sqlite'));try{expect(registry.db.prepare('SELECT MAX(version) FROM tenancy_migrations').pluck().get()).toBe(3);expect(new ClinicTreasuries(registry).list('00000000-0000-4000-8000-000000000001')).toEqual([]);}finally{registry.close();rmSync(dir,{recursive:true,force:true});}
});

import {treasuryFixture} from '../../test-support/tenant-finance-fixture';
import {randomUUID} from 'node:crypto';
import {assertTenantExecution} from './treasury-authority';
import {OperationJournal} from '../near/operation-journal';
import {HumanReviews} from '../operations/human-reviews';
import {OperatorAuth} from '../operations/auth';
import {vi,afterEach} from 'vitest';
import {Account} from 'near-api-js';import {VaultPaymentAdapter} from '../payments/adapter';
afterEach(()=>vi.restoreAllMocks());
it('TREASURY: configuration ownership, versions, audited revocation and no implicit environment fallback',async()=>{
 const f=await treasuryFixture();try{
  expect(f.active.status).toBe('Active');expect(f.active.treasuryOwner).toBe(f.p.treasury);
  expect(()=>f.treasuries.get(f.clinic.id,'near-mainnet')).toThrow('UNCONFIGURED');
  const other=f.registry.createClinic(f.user,{name:'Other clinic',country:'GH',timezone:'UTC',storeroom:'Main',syntheticDemo:false});
  expect(()=>f.treasuries.configure('operator:test',other.id,'local-sandbox',f.p,['committer'],0)).toThrow('OWNER_MISMATCH');
  expect(()=>f.treasuries.configure('operator:test',f.clinic.id,'near-testnet',f.p,['committer'],0)).toThrow();
  expect(()=>f.treasuries.configure('operator:test',f.clinic.id,'local-sandbox',f.p,['committer'],0)).toThrow('VERSION_CHANGED');
  const draft=f.treasuries.configure('operator:test',f.clinic.id,'local-sandbox',f.p,['committer'],f.active.version);expect(draft.status).toBe('Draft');expect(()=>f.treasuries.assertCurrent(f.active)).toThrow();
  const revoked=f.treasuries.transition('operator:test',f.clinic.id,'local-sandbox',draft.version,'Revoked');expect(revoked.version).toBe(4);
  const events=f.registry.db.prepare("SELECT event FROM tenant_audit WHERE event LIKE 'Treasury%' ORDER BY id").all() as {event:string}[];expect(events.map(e=>e.event)).toEqual(['TreasuryCreated','TreasuryActivatedLocal','TreasuryUpdated','TreasuryRevoked']);
  expect(()=>f.registry.db.prepare('UPDATE clinic_treasury_versions SET body_hash=?').run('f')).toThrow('Immutable');
 }finally{f.close();}
});
it('TENANT FINANCE: scoped approval, restart before consumption, separate roles and no inventory credit on payment',async()=>{
 const f=await treasuryFixture();let finance=f.finance();try{
  const a=await finance.authorize(f.c.caseId,f.input(),f.actor,()=>{},f.approval);expect(a.terms.tenantScope.treasuryVersion).toBe(2);expect(a.terms.clinicId).toBe(f.clinic.id);
  finance.close();finance=f.finance();await finance.executeSandbox(a.id,'committer',f.env('committer'));expect(finance.get(a.id).state).toBe('Submitted');await finance.reconcile(a.id);
  const b=await finance.authorize(f.c.caseId,f.input('requester'),f.actor,()=>{},f.approval);await finance.executeSandbox(b.id,'requester',f.env('requester'));await finance.reconcile(b.id);
  expect(f.workflow.get(f.c.caseId).state).toBe('DispatchInProgress');expect(f.inventory.balance(gloveId()).onHand).toBe(0);expect(f.effects()).toBe(2);
  await expect(finance.executeSandbox(a.id,'committer',f.env('committer'))).rejects.toThrow('RECONCILIATION');expect(f.effects()).toBe(2);
 }finally{finance.close();f.close();}
});
function gloveId(){return 'mn-item-1';}
it('TENANT FINANCE: two clinics execute concurrently with isolated scope and no transferable permits',async()=>{
 const a=await treasuryFixture(),b=await treasuryFixture(a.registry),fa=a.finance(),fb=b.finance();try{
  const [ta,tb]=await Promise.all([fa.authorize(a.c.caseId,a.input(),a.actor,()=>{},a.approval),fb.authorize(b.c.caseId,b.input(),b.actor,()=>{},b.approval)]);
  await expect(fb.executeSandbox(ta.id,'committer',b.env('committer'))).rejects.toThrow('NOT_FOUND');
  await Promise.all([fa.executeSandbox(ta.id,'committer',a.env('committer')),fb.executeSandbox(tb.id,'committer',b.env('committer'))]);expect([a.effects(),b.effects()]).toEqual([1,1]);
  expect(ta.terms.tenantScope.idempotencyKey).not.toBe(tb.terms.tenantScope.idempotencyKey);
 }finally{fa.close();fb.close();b.close();a.close();}
});
it('TENANT FINANCE: duplicate queues and simultaneous workers produce exactly one effect',async()=>{
 const f=await treasuryFixture(),one=f.finance(),two=f.finance();try{
  const input=f.input();const t=await one.authorize(f.c.caseId,input,f.actor,()=>{},f.approval);
  expect((await two.authorize(f.c.caseId,input,f.actor,()=>{},f.approval)).id).toBe(t.id);
  await expect(two.authorize(f.c.caseId,{...input,requestId:randomUUID()},f.actor,()=>{},f.approval)).rejects.toThrow('ALREADY_RECORDED');
  const outcomes=await Promise.allSettled([one.executeSandbox(t.id,'committer',f.env('committer')),two.executeSandbox(t.id,'committer',f.env('committer'))]);expect(outcomes.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect(f.effects()).toBe(1);
 }finally{one.close();two.close();f.close();}
});
it.each(['treasury','membership','wallet','configuration','logout'] as const)('TENANT FINANCE: %s revocation/change invalidates queued work',async fault=>{
  const f=await treasuryFixture(),finance=f.finance();try{
   const t=await finance.authorize(f.c.caseId,f.input(),f.actor,()=>{},f.approval);
   if(fault==='treasury')f.treasuries.transition('operator:test',f.clinic.id,'local-sandbox',f.active.version,'Revoked');
   if(fault==='configuration')f.treasuries.configure('operator:test',f.clinic.id,'local-sandbox',f.p,['committer'],f.active.version);
   if(fault==='wallet')f.wallets.revoke(f.user,f.clinic.id,f.wallet.id);
   if(fault==='logout')f.registry.logout(f.session);
   if(fault==='membership'){const admin={...f.user,userId:randomUUID(),email:'other@example.invalid'};f.registry.acceptInvite(admin,f.registry.invite(f.user,f.clinic.id,{email:admin.email,role:'Clinic Admin'}).token);f.registry.updateMember(admin,f.clinic.id,{userId:f.user.userId,role:'Inventory Officer',status:'Active'});}
   await expect(finance.executeSandbox(t.id,'committer',f.env('committer'))).rejects.toThrow();expect(f.effects()).toBe(0);expect(finance.get(t.id).state).toBe('Authorized');
  }finally{finance.close();f.close();}
});
it.each(['wrongNetwork','wrongToken','wrongRole','wrongWalletKey','paused','revision','commitment','expired'] as const)('TENANT FINANCE: %s cannot reach restricted execution',async fault=>{const f=await treasuryFixture(),finance=f.finance();try{
  const t=await finance.authorize(f.c.caseId,f.input(),f.actor,()=>{},f.approval);
  if(fault==='revision')f.workflow.recordAgentEvent(f.c.caseId,{runId:randomUUID(),type:'ManualAgentRunRequested',execution:'deterministic'});
  else if(fault==='commitment'){const original=f.store.resolve.bind(f.store);f.store.resolve=id=>({...original(id),canonical:{...original(id).canonical,amount:'1'}});}
  else if(fault==='expired')f.store.quoteExpiry=()=>new Date(Date.now()-1).toISOString();else f.faults[fault]=true;
  await expect(finance.executeSandbox(t.id,'committer',f.env('committer'))).rejects.toThrow();expect(f.effects()).toBe(0);
 }finally{finance.close();f.close();}
});
it('TENANT FINANCE: interruption after effect freezes retries across restart; independent reconciliation never resubmits',async()=>{
 const f=await treasuryFixture();let finance=f.finance();try{
  const t=await finance.authorize(f.c.caseId,f.input(),f.actor,()=>{},f.approval);f.faults.interrupted=true;
  await expect(finance.executeSandbox(t.id,'committer',f.env('committer'))).rejects.toThrow();expect(finance.get(t.id).state).toBe('RequiresReconciliation');expect(f.effects()).toBe(1);
  finance.close();finance=f.finance();await expect(finance.executeSandbox(t.id,'committer',f.env('committer'))).rejects.toThrow('RECONCILIATION');
  // Observation is allowed after revocation, to resolve already-started work without issuing another permit.
  f.treasuries.transition('operator:test',f.clinic.id,'local-sandbox',f.active.version,'Revoked');await finance.reconcile(t.id);expect(finance.get(t.id).state).toBe('Observed');expect(f.effects()).toBe(1);
 }finally{finance.close();f.close();}
});
it('TENANT FINANCE: raw P2/journal/human-wallet paths cannot bypass registry; forged permits call no signer/adapter',async()=>{
 const f=await treasuryFixture();const signing=vi.spyOn(Account.prototype,'callFunctionRaw').mockRejectedValue(new Error('FORBIDDEN'));const adapter=vi.spyOn(VaultPaymentAdapter.prototype,'requestPayment').mockRejectedValue(new Error('FORBIDDEN'));const auth=new OperatorAuth(f.store,'http://127.0.0.1:3000','test-'.repeat(10));try{
  expect(()=>assertTenantExecution(f.p.databasePath,'committer',f.c.poId!,{kind:'tenant-financial-operation'})).toThrow('DISABLED');
  await expect(f.workflow.act({caseId:f.c.caseId,role:'committer',expectedVersion:f.c.version,expectedHash:f.c.poHash},f.env('committer'))).rejects.toThrow('DISABLED');
  const journal=new OperationJournal(f.p.databasePath,f.store.fingerprint);try{expect(()=>journal.begin('commit_purchase_order:'+f.c.poId,{method:'commit_purchase_order',args:{order:f.store.resolve(f.c.poId!).canonical}})).toThrow('DISABLED');}finally{journal.close();}
  const human=new HumanReviews(f.workflow,auth,{kind:'sandbox-rpc',client:new (await import('../sandbox/client.js')).SandboxVaultClient(f.p)});const login=auth.login('test-'.repeat(10)),s=auth.session(login.token);
  await expect(human.prepare(f.c.caseId,{requestId:randomUUID(),action:'approve',expectedRevision:f.c.version},s,auth.issueNonce(s))).rejects.toThrow('TENANT_HUMAN_HANDOFF_DISABLED');
  expect(signing).not.toHaveBeenCalled();expect(adapter).not.toHaveBeenCalled();expect(f.effects()).toBe(0);
 }finally{auth.close();f.close();}
});
it('TREASURY MIGRATION: v2 registry preserves identity, wallet ownership and audit; no configuration is assigned on upgrade',async()=>{
 const f=await treasuryFixture();try{
  const prior=f.registry.db.prepare('SELECT count(*) FROM tenant_audit').pluck().get();
  f.registry.db.exec('DROP TABLE tenant_financial_operations; DROP TABLE clinic_treasury_heads; DROP TABLE clinic_treasury_versions; DELETE FROM tenancy_migrations WHERE version=3');f.registry.close();
  const upgraded=new ClinicRegistry(f.registry.path);try{expect(upgraded.membership(f.user.userId,f.clinic.id).role).toBe('Clinic Admin');expect(upgraded.db.prepare('SELECT count(*) FROM tenant_audit').pluck().get()).toBe(prior);expect(upgraded.db.prepare('SELECT status FROM clinic_wallet_bindings WHERE id=?').pluck().get(f.wallet.id)).toBe('Verified');expect(new ClinicTreasuries(upgraded).list(f.clinic.id)).toEqual([]);}finally{upgraded.close();}
 }finally{f.close();}
});
it('TENANT FINANCE: raw scopes cannot mint a permit without fresh observations and the matching durable authorization transition',async()=>{
 const f=await treasuryFixture(),finance=f.finance();try{
  const ticket=await finance.authorize(f.c.caseId,f.input(),f.actor,()=>{},f.approval),scope=ticket.terms.tenantScope;
  expect(()=>f.authority.consume(scope,()=>{})).toThrow('FRESH_TREASURY_OBSERVATION_REQUIRED');
  await f.authority.validate(scope);expect(()=>f.authority.consume(scope,()=>{})).toThrow('CURRENT_AUTHORIZATION_REQUIRED');expect(f.authority.operation(scope)).toBeUndefined();expect(f.effects()).toBe(0);
 }finally{finance.close();f.close();}
});
it('TENANT WORKER CLI: public environment aliases are refused before opening a registry or loading credentials',async()=>{
 const {tenantFinancialMain}=await import('../ops/tenant-financial.js');
 for(const environment of ['near-testnet','near-mainnet','testnet','mainnet'])await expect(tenantFinancialMain(['execute','/tmp/not-a-treasury-registry',randomUUID(),environment,'/tmp/not-a-profile',randomUUID(),'committer'],{CARECART_TENANT_FINANCIAL_MODE:'local-sandbox'})).rejects.toThrow('public execution disabled');
});

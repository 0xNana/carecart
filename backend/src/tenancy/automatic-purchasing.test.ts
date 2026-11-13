import {it,expect} from 'vitest';
import {treasuryFixture} from '../../test-support/tenant-finance-fixture';

// Real durable authorizations/permits; RPC and effects are the explicitly mocked fixture.
async function configured(){
 const f=await treasuryFixture();
 const input={expectedVersion:0,enabled:true,suppliers:[f.store.supplier],itemIds:[f.store.item.id],maxAutomaticAmount:'5000000',walletBindingId:f.wallet.id};
 await f.authority.automatic.configure(input,f.approval);return {...f,policyInput:input};
}
it('standing consent authorizes both roles without a per-order user session; canonical amounts and inventory remain unchanged',async()=>{
 const f=await configured(),finance=f.finance();try{
  f.registry.logout(f.session);
  const before=f.inventory.balance('mn-item-1');
  const a=await finance.authorizeAutomatic(f.c.caseId);expect(a.terms.tenantScope.automaticPolicyVersion).toBe(1);
  expect((await finance.authorizeAutomatic(f.c.caseId)).id).toBe(a.id);
  await finance.executeSandbox(a.id,'committer',f.env('committer'));await finance.reconcile(a.id);
  const b=await finance.authorizeAutomatic(f.c.caseId);expect(b.role).toBe('requester');
  await finance.executeSandbox(b.id,'requester',f.env('requester'));await finance.reconcile(b.id);
  expect(f.effects()).toBe(2);expect(f.inventory.balance('mn-item-1')).toEqual(before);
  await expect(finance.executeSandbox(b.id,'requester',f.env('requester'))).rejects.toThrow('RECONCILIATION');expect(f.effects()).toBe(2);
 }finally{finance.close();f.close();}
});
it.each(['disabled','supplier','sku','amount','paused','wallet','admin','treasury'] as const)('automatic execution rechecks %s before a signing permit is consumed',async fault=>{
 const f=await configured(),finance=f.finance();try{
  const a=await finance.authorizeAutomatic(f.c.caseId);
  if(fault==='disabled')await f.authority.automatic.configure({...f.policyInput,expectedVersion:1,enabled:false},f.approval);
  if(fault==='supplier'||fault==='sku'||fault==='amount'){
   // Simulate changed trusted policy terms; immutable old version remains untouched.
   const p=f.authority.automatic.get()!;
   const changed={...p,version:2,...(fault==='supplier'?{suppliers:['unknown.testnet']}:fault==='sku'?{itemIds:['other-item']}:{maxAutomaticAmount:'1'})};
   const {digest}=await import('../intents/settlement.js');f.registry.db.prepare('INSERT INTO clinic_automatic_policy_versions VALUES(?,?,?,?,?)').run(f.clinic.id,'local-sandbox',2,JSON.stringify(changed),digest(changed));
  }
  if(fault==='paused')f.faults.paused=true;
  if(fault==='wallet')f.wallets.revoke(f.user,f.clinic.id,f.wallet.id);
  if(fault==='admin')f.registry.db.prepare("UPDATE clinic_memberships SET role='Finance Officer' WHERE clinic_id=? AND user_id=?").run(f.clinic.id,f.user.userId);
  if(fault==='treasury')f.treasuries.transition('operator:test',f.clinic.id,'local-sandbox',f.active.version,'Revoked');
  await expect(finance.executeSandbox(a.id,'committer',f.env('committer'))).rejects.toThrow();expect(f.effects()).toBe(0);
 }finally{finance.close();f.close();}
});
it('defaults to disabled and rejects invented catalog identities, raised caps and non-admin configuration',async()=>{
 const f=await treasuryFixture(),finance=f.finance();try{
  expect(f.authority.automatic.snapshot().enabled).toBe(false);
  await expect(finance.authorizeAutomatic(f.c.caseId)).rejects.toThrow('UNCONFIGURED');
  const input={expectedVersion:0,enabled:true,suppliers:[f.store.supplier],itemIds:[f.store.item.id],maxAutomaticAmount:'5000000',walletBindingId:f.wallet.id};
  for(const changed of [{suppliers:['rogue.testnet']},{itemIds:['unregistered']},{maxAutomaticAmount:'10000001'}])await expect(f.authority.automatic.configure({...input,...changed},f.approval)).rejects.toThrow();
  f.registry.db.prepare("UPDATE clinic_memberships SET role='Finance Officer' WHERE clinic_id=? AND user_id=?").run(f.clinic.id,f.user.userId);
  await expect(f.authority.automatic.configure(input,f.approval)).rejects.toThrow('ADMIN_REQUIRED');
 }finally{finance.close();f.close();}
});
it('revocation while live policy reads are in flight cannot create new standing consent',async()=>{
 const f=await treasuryFixture();try{
  const verify=f.authority.binding.verify;f.authority.binding.verify=async()=>{await verify();f.registry.logout(f.session);};
  await expect(f.authority.automatic.configure({expectedVersion:0,enabled:true,suppliers:[f.store.supplier],itemIds:[f.store.item.id],maxAutomaticAmount:'5000000',walletBindingId:f.wallet.id},f.approval)).rejects.toThrow('AUTH_EXPIRED');
  expect(f.authority.automatic.get()).toBeNull();
 }finally{f.close();}
});

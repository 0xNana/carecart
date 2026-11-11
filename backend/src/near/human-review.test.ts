import {PUBLIC_TOKENS} from './token-registry';
import {afterEach,expect,it,vi} from 'vitest';
import {JsonRpcProvider} from 'near-api-js';
import {openLocalOperations} from '../operations/local';
import {SafetyVaultClient} from './safety-client';
import {paymentReview} from './human-review';
import {rmSync} from 'node:fs';import {dirname} from 'node:path';import {randomUUID} from 'node:crypto';
afterEach(()=>vi.restoreAllMocks());
async function adversarialReview(attack:string){
 const local=openLocalOperations(`human-attack-${randomUUID()}`);
 try{
  const c=local.workflow.ingest({caseId:'human-case',itemId:'mn-item-1',eventId:'human-event',idempotencyKey:'human-event'});
  const p=local.store.profile;const order=structuredClone(c.domain!.purchaseOrder.canonical);order.amount=attack==='payout-max'?'25000000':attack==='over-payout-max'?'25000001':attack==='above-auto'?'11000000':'4000000';
  const observed=structuredClone(order);if(attack==='amount')observed.amount='1';if(attack==='recipient')observed.supplier='attacker.near';
  if(attack==='token')observed.token='cctest.local-ops.near';if(attack==='profile')observed.profile='testnet';
  vi.spyOn(JsonRpcProvider.prototype,'viewNodeStatus').mockResolvedValue({chain_id:attack==='network'?'testnet':p.network} as never);
  vi.spyOn(JsonRpcProvider.prototype,'viewAccount').mockImplementation(async({accountId})=>({code_hash:attack==='contract'?'2'.repeat(44):accountId===p.token?PUBLIC_TOKENS[p.network].codeHash:p.codeHash}) as never);
  vi.spyOn(JsonRpcProvider.prototype,'callFunction').mockImplementation(async({method,args})=>{
   if(method==='ft_metadata')return {decimals:attack==='cctest'?0:6,symbol:'USDC',spec:'ft-1.0.0'};
   // Large synthetic balances below are isolated boundary tests, never evidence of a funded launch.
   if(method==='get_state')return {...p,profile:p.network,paused:attack==='paused',spendable:'25000000',
    policy:attack==='abi'?{}:{auto_per_po_limit:'10000000',hard_payout_limit:'25000000',daily_dispatch_limit:attack==='hard-policy'?'26000000':'25000000',accepted_deposit_ceiling:'5000000'},
    usage:{spent:attack==='daily-cap'?'25000000':'0',reserved:'0'}};
   if(method==='get_roles')return {supplier:attack!=='supplier',committer:attack==='role-crossover'&&(args as {account:string}).account===p.admin,requester:false};
   if(method==='get_purchase_order')return attack==='missing-commitment'?undefined:observed;
   if(method==='get_payment')return {status:attack==='rejected'?'Rejected':'PendingApproval',reason:attack==='above-auto'?'AutoThreshold':'DailyCap',attempt_id:'',reserved_day:0};
   throw new Error('Unexpected RPC');
  });
  return await paymentReview(new SafetyVaultClient(p),order,'approve');
 }finally{local.close();rmSync(dirname(local.store.profile.databasePath),{recursive:true,force:true});}
}
it.each(['network','contract','abi','cctest','role-crossover','amount','recipient','token','profile','missing-commitment','rejected','paused','daily-cap','hard-policy'])
 ('MOCKED RPC: refuses %s before generating an approval',async attack=>{await expect(adversarialReview(attack)).rejects.toThrow();});
it('MOCKED RPC: 4-USDC unknown supplier isolates supplier authorization',async()=>{await expect(adversarialReview('supplier')).rejects.toThrow(/UnknownSupplier/);});
it('MOCKED RPC: 25-USDC payout boundary is separate from supplier authorization (unfunded policy test)',async()=>{
 expect((await adversarialReview('payout-max')).order.amount).toBe('25000000');vi.restoreAllMocks();
 await expect(adversarialReview('over-payout-max')).rejects.toThrow(/HardPayoutLimit/);
});
it('MOCKED RPC: above-auto-threshold review retains required human authority (unfunded policy test)',async()=>{
 const r=await adversarialReview('above-auto');expect(r.order.amount).toBe('11000000');expect(r.payment.status).toBe('PendingApproval');
 expect(r.transaction.signerId).toBe('admin.local-ops.near');
});
it('MOCKED RPC: same-chain v2 review binds a persisted PO and attaches exactly one yocto without signing',async()=>{
 const local=openLocalOperations(`human-review-${randomUUID()}`);
 try{
  const c=local.workflow.ingest({caseId:'human-case',itemId:'mn-item-1',eventId:'human-event',idempotencyKey:'human-event'});
  const p=local.store.profile;const order=c.domain!.purchaseOrder.canonical;
  vi.spyOn(JsonRpcProvider.prototype,'viewNodeStatus').mockResolvedValue({chain_id:p.network} as never);
  vi.spyOn(JsonRpcProvider.prototype,'viewAccount').mockImplementation(async({accountId})=>({code_hash:accountId===p.token?PUBLIC_TOKENS[p.network].codeHash:p.codeHash}) as never);
  vi.spyOn(JsonRpcProvider.prototype,'callFunction').mockImplementation(async({method})=>{
   if(method==='ft_metadata')return {decimals:6,symbol:'USDC',spec:'ft-1.0.0'};
   if(method==='get_state')return {...p,profile:p.network,paused:false,spendable:'5000000',policy:{auto_per_po_limit:'10000000',hard_payout_limit:'25000000',daily_dispatch_limit:'25000000',accepted_deposit_ceiling:'5000000'},usage:{spent:'0',reserved:'0'}};
   if(method==='get_roles')return {supplier:true,committer:false,requester:false};
   if(method==='get_purchase_order')return order;
   if(method==='get_payment')return {status:'PendingApproval',reason:'DailyCap',attempt_id:'',reserved_day:0};
   throw new Error('Unexpected RPC');
  });
  const review=await paymentReview(new SafetyVaultClient(p),order,'approve');
  expect(review.transaction.actions[0].params).toEqual({methodName:'approve_payment',args:{po_id:order.po_id,expected_quote_hash:null,expected_commitment_hash:null},deposit:'1',gas:'120000000000000'});
  expect(review.recipient).toBe(order.supplier);expect(review.canonicalHash).toMatch(/^[a-f0-9]{64}$/);
 }finally{local.close();rmSync(dirname(local.store.profile.databasePath),{recursive:true,force:true});}
});

/** Mocked RPC effects only; real ledger/P1/P2/NEP-413/tenant permits. No public submissions. */
import {it,expect,vi,afterEach} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,dirname} from 'node:path';import {randomUUID} from 'node:crypto';
import {Account,JsonRpcProvider,KeyPair} from 'near-api-js';import {signMessage} from 'near-api-js/nep413';
import {ClinicRegistry} from './registry';import {WalletBindings} from './wallet-bindings';import {ClinicTreasuries} from './treasury';import {TenantTreasuryAuthority} from './treasury-authority';import {principalHash} from './runtime';
import {testnetPayments} from '../profiles/testnet-payments';import {PROJECT_ROOT} from '../profiles/storage';import {openInventoryOperations} from '../inventory/local';import {SafetyVaultClient} from '../near/safety-client';import {FinancialAuthorizations} from '../operations/financial-authorizations';import {executeProcurementRole} from '../procurement/v2-bridge';
const cleanup:(()=>void)[]=[];afterEach(()=>{for(const c of cleanup.splice(0).reverse())c();vi.restoreAllMocks();});
async function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'carecart-public-auth-test-')),registry=new ClinicRegistry(join(dir,'registry.sqlite'));cleanup.push(()=>{registry.close();rmSync(dir,{recursive:true,force:true});});
 const user={userId:randomUUID(),sessionId:randomUUID(),email:'fixture@example.invalid',expires:Date.now()+3600000},clinic=registry.createClinic(user,{name:'Synthetic public fixture',country:'GH',timezone:'Africa/Accra',storeroom:'Main',syntheticDemo:true}),session=registry.session(user,registry.createSession(user).token);
 const owner=KeyPair.fromRandom('ed25519'),committer=KeyPair.fromRandom('ed25519'),requester=KeyPair.fromRandom('ed25519');
 const grant=testnetPayments({version:1,ownerApproved:true,clinicId:clinic.id,suppliers:['medsupply-a.carecart.testnet','medsupply-b.carecart.testnet','medsupply-v2-c.carecart.testnet'],profile:{version:2,network:'testnet',rpcUrl:'https://test.rpc.fastnear.com',vault:'safety-v2.carecart.testnet',token:'token-v2.carecart.testnet',decimals:6,admin:'admin.carecart.testnet',guardian:'guardian-v2.carecart.testnet',treasury:'treasury.carecart.testnet',committer:'committer-v2.carecart.testnet',requester:'agent-v2.carecart.testnet',committerPublicKey:committer.getPublicKey().toString(),requesterPublicKey:requester.getPublicKey().toString(),maxKeyAllowanceYocto:'200000000000000000000000',codeHash:'BCpcRunpuzhjrshyq1yrKtsmABrAAPy6ZFmMrUvUUqK3',testToken:{symbol:'CCUSD',codeHash:'8SHC5cfTSwdgKTtuCJPnsgNCj8Q9P3LpsAhLNDpMd6FW'},databasePath:join(PROJECT_ROOT,'backend/data/testnet-v2/clinics',clinic.id,'state.sqlite')}});
 cleanup.push(()=>rmSync(dirname(grant.profile.databasePath),{recursive:true,force:true}));const local=openInventoryOperations(clinic.workspace,Date.now,{dataset:'clinic',tenant:{clinicId:clinic.id,storeroomId:'default-storeroom',syntheticDemo:true},testnet:grant});cleanup.push(()=>local.close());
 local.inventory.configure({...local.inventory.config(),monitoring:true,automaticCases:true,automaticPreparation:true},'test');local.inventory.move({id:'deplete',productId:'mn-item-1',kind:'Consume',quantity:4,unit:'base',source:'manual'},'test');for(let i=0;i<6;i++)local.monitor.runOnce('test');
 const c=local.workflow.get(local.inventory.dashboard().obligations[0].caseId),p=grant.profile,orders=new Map<string,unknown>(),payments=new Map<string,unknown>();let effects=0;
 vi.spyOn(JsonRpcProvider.prototype,'viewNodeStatus').mockResolvedValue({chain_id:'testnet'} as never);vi.spyOn(JsonRpcProvider.prototype,'viewAccount').mockImplementation(async a=>({code_hash:a.accountId===p.token?p.testToken!.codeHash:p.codeHash}) as never);
 vi.spyOn(JsonRpcProvider.prototype,'viewAccessKey').mockImplementation(async a=>({nonce:0,permission:a.accountId===p.admin?'FullAccess':{FunctionCall:{allowance:p.maxKeyAllowanceYocto,receiver_id:p.vault,method_names:[a.accountId===p.committer?'commit_purchase_order':'request_payment']}}}) as never);
 vi.spyOn(JsonRpcProvider.prototype,'callFunction').mockImplementation(async a=>{
  const args=a.args as Record<string,string>;
  if(a.method==='ft_metadata')return {symbol:'CCUSD',decimals:6,spec:'ft-1.0.0'} as never;
  if(a.method==='get_state')return {profile:'testnet',admin:p.admin,guardian:p.guardian,treasury:p.treasury,token:p.token,paused:false,spendable:'5000000',usage:{spent:'0',reserved:'0'},policy:{auto_per_po_limit:'10000000',hard_payout_limit:'25000000',daily_dispatch_limit:'25000000',accepted_deposit_ceiling:'5000000'}} as never;
  if(a.method==='get_roles')return {committer:args.account===p.committer,requester:args.account===p.requester,supplier:grant.suppliers.includes(args.account)} as never;
  if(a.method==='get_purchase_order')return (orders.get(args.po_id)??null) as never;if(a.method==='get_payment')return (payments.get(args.po_id)??null) as never;throw new Error('Unexpected mocked RPC method');
 });
 const send=vi.spyOn(Account.prototype,'callFunctionRaw').mockImplementation(async function(a){effects++;const args=a.args as {order?:{po_id:string};po_id?:string};const id=args.order?.po_id??args.po_id!;if(a.methodName==='commit_purchase_order')orders.set(id,args.order);else if(a.methodName!=='request_payment')throw new Error('Unauthorized method');payments.set(id,{status:a.methodName==='commit_purchase_order'?'Committed':'Paid',reason:'None',attempt_id:'',reserved_day:0});return {final_execution_status:'FINAL',status:{SuccessValue:''},transaction:{hash:'1'.repeat(43)+String(effects)},receipts_outcome:[]} as never;});
 vi.spyOn(JsonRpcProvider.prototype,'viewTransactionStatusWithReceipts').mockImplementation(async q=>{
  const order=local.store.resolve(c.poId!).canonical,a='2'.repeat(44),b='3'.repeat(44);
  return {final_execution_status:'FINAL',status:{SuccessValue:''},transaction:{hash:q.txHash,signer_id:p.requester,receiver_id:p.vault,actions:[{FunctionCall:{method_name:'request_payment',args:Buffer.from(JSON.stringify({po_id:order.po_id})).toString('base64'),deposit:'0',gas:120000000000000}}]},transaction_outcome:{id:q.txHash,outcome:{executor_id:p.requester,receipt_ids:[a],logs:[],status:{SuccessReceiptId:a}}},receipts_outcome:[{id:a,outcome:{executor_id:p.token,receipt_ids:[b],status:{SuccessValue:''},logs:['EVENT_JSON:'+JSON.stringify({standard:'nep141',event:'ft_transfer',data:[{old_owner_id:p.vault,new_owner_id:order.supplier,amount:order.amount}]})]}},{id:b,outcome:{executor_id:p.vault,receipt_ids:[],status:{SuccessValue:''},logs:['EVENT_JSON:'+JSON.stringify({standard:'carecart_safety_vault',event:'payment_state',data:[{po_id:order.po_id,payment:{status:'Paid'}}]})]}}]} as never;
 });
 const wallets=new WalletBindings(registry,'http://127.0.0.1:3000',{network:'testnet',rpcUrl:p.rpcUrl});const challenge=wallets.challenge(user,session,clinic.id,{accountId:p.admin,network:'testnet'});const signed=await signMessage({signerAccount:new Account(p.admin,new JsonRpcProvider({url:p.rpcUrl}),owner.toString()),payload:{...challenge.payload,nonce:new Uint8Array(Buffer.from(challenge.payload.nonce,'base64'))}});
 const wallet=await wallets.verify(user,session,clinic.id,{challengeId:challenge.id,accountId:p.admin,publicKey:owner.getPublicKey().toString(),signature:Buffer.from(signed.signature).toString('base64')},work=>work());
 const treasuries=new ClinicTreasuries(registry),draft=treasuries.configure('operator:test',clinic.id,'near-testnet',p,['committer','requester'],0);expect(()=>treasuries.transition('operator:test',clinic.id,'near-testnet',draft.version,'Active')).toThrow('ACTIVATION_DISABLED');treasuries.transition('operator:test',clinic.id,'near-testnet',draft.version,'Active',grant);
 const client=new SafetyVaultClient(p),binding={kind:'public-rpc' as const,client,verify:()=>client.verify(),testnet:grant},authority=new TenantTreasuryAuthority(registry,wallets,local.workflow,binding,clinic.id,'near-testnet'),finance=new FinancialAuthorizations(local.workflow,binding,undefined,Date.now,authority);cleanup.push(()=>finance.close());
 const input=(role:'committer'|'requester')=>{const now=local.workflow.get(c.caseId);return {requestId:randomUUID(),role,expectedRevision:now.version,expectedHash:now.poHash!,walletBindingId:wallet.id};};
 const env=(role:'committer'|'requester')=>({CARECART_TENANT_FINANCIAL_MODE:'near-testnet',CARECART_SAFETY_WRITES:'approved',[role==='committer'?'SAFETY_COMMITTER_PRIVATE_KEY':'SAFETY_REQUESTER_PRIVATE_KEY']:(role==='committer'?committer:requester).toString()});
 return {registry,clinic,user,session,grant,local,c,finance,send,env,input,approval:{user,session,walletBindingId:wallet.id},actor:principalHash(session.hash,clinic.id,'Clinic Admin'),effects:()=>effects};
}
it('public native testnet effects require two distinct scoped role authorizations and independent observation; payment never credits stock',async()=>{
 const f=await fixture();for(const role of ['committer','requester'] as const){const ticket=await f.finance.authorize(f.c.caseId,f.input(role),f.actor,()=>{},f.approval);await f.finance.executeTestnet(ticket.id,role,f.env(role));await f.finance.reconcile(ticket.id);await expect(f.finance.executeTestnet(ticket.id,role,f.env(role))).rejects.toThrow();}
 expect(f.effects()).toBe(2);expect(f.local.workflow.get(f.c.caseId).paymentState).toBe('Paid');expect(f.local.inventory.balance('mn-item-1').onHand).toBe(26);
});
it('cloud credentials, raw bridge calls, serialized permits and revoked sessions cannot reach public signing',async()=>{
 const f=await fixture();await expect(executeProcurementRole(f.local.store,'committer',{poId:f.c.poId,expectedHash:f.c.poHash},f.env('committer'))).rejects.toThrow('activation is disabled');
 const a=await f.finance.authorize(f.c.caseId,f.input('committer'),f.actor,()=>{},f.approval);f.registry.logout(f.session);await expect(f.finance.executeTestnet(a.id,'committer',f.env('committer'))).rejects.toThrow();expect(f.send).not.toHaveBeenCalled();
});
it('concurrent public role consumers and restarts cannot submit the same operation twice',async()=>{
 const f=await fixture(),ticket=await f.finance.authorize(f.c.caseId,f.input('committer'),f.actor,()=>{},f.approval);
 const outcomes=await Promise.allSettled([f.finance.executeTestnet(ticket.id,'committer',f.env('committer')),f.finance.executeTestnet(ticket.id,'committer',f.env('committer'))]);
 expect(outcomes.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(f.effects()).toBe(1);await f.finance.reconcile(ticket.id);await expect(f.finance.executeTestnet(ticket.id,'committer',f.env('committer'))).rejects.toThrow();expect(f.effects()).toBe(1);
});
it('MOCKED RPC: glove consumption runs monitor, supplier selection, standing policy, both restricted roles and independent receipt verification without per-order approval',async()=>{
 const f=await fixture(),authority=f.finance.tenantAuthority!;
 await authority.automatic.configure({expectedVersion:0,enabled:true,suppliers:[f.grant.suppliers[0]],itemIds:['mn-item-1'],maxAutomaticAmount:'3000000',walletBindingId:f.approval.walletBindingId},f.approval);
 f.registry.logout(f.session); // The administrator's standing consent survives their interactive login.
 const onHand=f.local.inventory.balance('mn-item-1').onHand;
 for(const role of ['committer','requester'] as const){
  const ticket=await f.finance.authorizeAutomatic(f.c.caseId);expect(ticket.role).toBe(role);
  await f.finance.executeTestnet(ticket.id,role,f.env(role));await f.finance.reconcile(ticket.id);
 }
 const c=f.local.workflow.get(f.c.caseId);expect(c.paymentState).toBe('Paid');expect(f.effects()).toBe(2);
 expect(f.local.inventory.balance('mn-item-1').onHand).toBe(onHand);
 const receipt={id:'automatic-goods-receipt',productId:'mn-item-1',kind:'Receive' as const,quantity:c.domain!.quote.quantity,unit:'base' as const,source:'manual' as const,orderId:c.poId!,supplierId:c.domain!.quote.supplierId,batch:'TEST-LOT',receivedAt:new Date().toISOString(),receiptReference:'DELIVERY-AUTO-1'};
 f.local.inventory.move(receipt,'clinic-staff');f.local.inventory.move(receipt,'clinic-staff');
 expect(f.local.inventory.balance('mn-item-1').onHand).toBe(onHand+receipt.quantity);
});
it('MOCKED RPC: the approved host sprint grant binds one synthetic canonical PO and cannot be renewed or invoked with a wider envelope',async()=>{
 const f=await fixture(),a=f.finance.tenantAuthority!;
 expect(()=>a.automatic.configureSprintGrant(f.c.caseId,'operator:other','BCpcRunpuzhjrshyq1yrKtsmABrAAPy6ZFmMrUvUUqK3:3000000')).toThrow('APPROVAL_REQUIRED');
 expect(()=>a.automatic.configureSprintGrant(f.c.caseId,'operator:owner-approved-sprint','any-amount')).toThrow('APPROVAL_REQUIRED');
 a.automatic.configureSprintGrant(f.c.caseId,'operator:owner-approved-sprint','BCpcRunpuzhjrshyq1yrKtsmABrAAPy6ZFmMrUvUUqK3:3000000');
 expect(()=>a.automatic.configureSprintGrant(f.c.caseId,'operator:owner-approved-sprint','BCpcRunpuzhjrshyq1yrKtsmABrAAPy6ZFmMrUvUUqK3:3000000')).toThrow('ALREADY_RECORDED');
 f.registry.logout(f.session);
 for(const role of ['committer','requester'] as const){const ticket=await f.finance.authorizeAutomatic(f.c.caseId);expect(ticket.terms.tenantScope.user).toBeNull();await f.finance.executeTestnet(ticket.id,role,f.env(role));await f.finance.reconcile(ticket.id);}
 expect(f.effects()).toBe(2);expect(f.local.workflow.get(f.c.caseId).paymentState).toBe('Paid');
});

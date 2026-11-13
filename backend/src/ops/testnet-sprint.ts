import {readFileSync,writeFileSync,mkdirSync,existsSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {testnetPayments} from '../profiles/testnet-payments';
import {PROJECT_ROOT} from '../profiles/storage';
import {ClinicRegistry} from '../tenancy/registry';
import {openClinicRuntime} from '../tenancy/runtime';
import {WalletBindings,walletConfiguration} from '../tenancy/wallet-bindings';
import {TenantTreasuryAuthority} from '../tenancy/treasury-authority';
import {SafetyVaultClient} from '../near/safety-client';
import {assertNoSigningCredentials} from '../operations/local';
import dotenv from 'dotenv';

/** Owner control plane for the explicitly approved ONE-PO synthetic test. Never an API/model tool. */
async function prepare(){
 assertNoSigningCredentials(process.env);
 const envelope='BCpcRunpuzhjrshyq1yrKtsmABrAAPy6ZFmMrUvUUqK3:3000000';
 if(process.env.CARECART_APPROVED_TESTNET_SPRINT!==envelope)throw new Error('Exact owner-approved envelope required');
 const grant=testnetPayments(JSON.parse(readFileSync(join(PROJECT_ROOT,'profiles/testnet.payments.json'),'utf8')));
 if(grant.clinicId!=='dfa461bd-16f8-443a-9ca7-13e9b4697940')throw new Error('Only the approved synthetic clinic');
 const registry=new ClinicRegistry(join(PROJECT_ROOT,'backend/data/tenancy/registry.sqlite'));
 let local:ReturnType<typeof openClinicRuntime>|undefined;
 try{
  const clinic=registry.clinic(grant.clinicId);if(!clinic.syntheticDemo)throw new Error('Synthetic clinic required');
  const dir=join(PROJECT_ROOT,'backend/data/sprint-20261113');mkdirSync(dir,{recursive:true,mode:0o700});
  if(existsSync(join(dir,'activation.json')))throw new Error('Sprint already prepared; resume the saved activation, never create another PO');
  if(existsSync(join(dir,'registry-before.sqlite'))&&process.env.CARECART_SPRINT_RESUME_BEFORE_CONSUMPTION!=='true')throw new Error('An interrupted preparation needs reconciliation before resume');
  if(!existsSync(join(dir,'registry-before.sqlite')))await registry.db.backup(join(dir,'registry-before.sqlite'));chmodSync(join(dir,'registry-before.sqlite'),0o600);
  local=openClinicRuntime(clinic,grant);if(local.inventory.db.prepare('SELECT 1 FROM inventory_movements WHERE id=?').get('owner-approved-sprint-20261113-consumption'))throw new Error('Consumption already recorded; reconcile instead of replaying preparation');if(!existsSync(join(dir,'clinic-before.sqlite')))await local.inventory.db.backup(join(dir,'clinic-before.sqlite'));chmodSync(join(dir,'clinic-before.sqlite'),0o600);
  const client=new SafetyVaultClient(grant.profile);await client.verify();
  const binding={kind:'public-rpc' as const,client,verify:()=>client.verify(),testnet:grant};
  const authority=new TenantTreasuryAuthority(registry,new WalletBindings(registry,process.env.CARECART_PUBLIC_ORIGIN!,walletConfiguration(process.env)),local.workflow,binding,clinic.id,'near-testnet');
  const before=local.inventory.balance('mn-item-1').onHand;
  if(before<=0)throw new Error('No stock to consume; do not fabricate a movement');
  const quantity=Math.max(1,before-26);
  local.inventory.move({id:'owner-approved-sprint-20261113-consumption',productId:'mn-item-1',kind:'Consume',quantity,unit:'base',source:'manual',reference:'synthetic-sprint-demonstration'},'operator:owner-approved-sprint');
  local.inventory.refreshCatalog('operator:owner-approved-sprint');
  local.inventory.configure({...local.inventory.config(),monitoring:true,automaticCases:true,automaticPreparation:true},'operator:owner-approved-sprint');
  for(let i=0;i<8;i++)local.monitor.runOnce('owner-approved-headless-sprint');
  const obligation=local.inventory.db.prepare('SELECT case_id FROM inventory_obligations WHERE product_id=? AND closed_at IS NULL').get('mn-item-1') as {case_id:string}|undefined;
  if(!obligation)throw new Error('Monitor did not create a shortage case');
  const c=local.workflow.get(obligation.case_id);authority.automatic.configureSprintGrant(c.caseId,'operator:owner-approved-sprint',envelope);
  const result={network:'testnet',clinicId:clinic.id,caseId:c.caseId,poId:c.poId,canonical:c.domain!.purchaseOrder.canonical,canonicalHash:c.poHash,
   inventory:{beforeConsumption:before,consumed:quantity,afterConsumption:local.inventory.balance('mn-item-1').onHand},
   policy:authority.automatic.snapshot(),maximumTotalTestTokenExposure:'3000000',publicTransactionsSubmitted:0,
   approvalSource:'Explicit owner approval in the execution sprint; one canonical PO only; no contract policy changes'};
  writeFileSync(join(dir,'activation.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600,flag:'wx'});console.log(JSON.stringify(result,null,2));
 }finally{local?.close();registry.close();}
}
async function finalize(){
 assertNoSigningCredentials(process.env);
 const dir=join(PROJECT_ROOT,'backend/data/sprint-20261113'),file=join(dir,'completed.json');
 if(existsSync(file)){console.log(readFileSync(file,'utf8'));return;}
 const activation=JSON.parse(readFileSync(join(dir,'activation.json'),'utf8'));
 const grant=testnetPayments(JSON.parse(readFileSync(join(PROJECT_ROOT,'profiles/testnet.payments.json'),'utf8')));
 const registry=new ClinicRegistry(join(PROJECT_ROOT,'backend/data/tenancy/registry.sqlite'));let local:ReturnType<typeof openClinicRuntime>|undefined;
 try{
  const clinic=registry.clinic(grant.clinicId);if(!clinic.syntheticDemo)throw new Error('Synthetic clinic required');local=openClinicRuntime(clinic,grant);
  const c=local.workflow.get(activation.caseId);if(c.state!=='SameChainConfirmed'||c.poHash!==activation.canonicalHash)throw new Error('Independently confirmed exact sprint PO required');
  const before=local.inventory.balance('mn-item-1').onHand;if(before!==activation.inventory.afterConsumption)throw new Error('Inventory changed before the separate delivery step; inspect before proceeding');
  const receipt={id:'owner-approved-sprint-20261113-delivery',productId:'mn-item-1',kind:'Receive' as const,quantity:c.domain!.quote.quantity,unit:'base' as const,source:'manual' as const,orderId:c.poId!,supplierId:c.domain!.quote.supplierId,batch:'SYNTHETIC-SPRINT-LOT',receivedAt:new Date().toISOString(),receiptReference:'SYNTHETIC-SPRINT-DELIVERY-20261113'};
  local.inventory.move(receipt,'operator:synthetic-sprint-delivery');local.inventory.move(receipt,'operator:synthetic-sprint-delivery');
  const after=local.inventory.balance('mn-item-1').onHand;if(after!==before+receipt.quantity)throw new Error('Exactly-once delivery invariant failed');
  const client=new SafetyVaultClient(grant.profile),binding={kind:'public-rpc' as const,client,verify:()=>client.verify(),testnet:grant};
  const authority=new TenantTreasuryAuthority(registry,new WalletBindings(registry,process.env.CARECART_PUBLIC_ORIGIN!,walletConfiguration(process.env)),local.workflow,binding,clinic.id,'near-testnet');authority.automatic.completeSprintGrant(c.caseId);
  const authorizations=local.inventory.db.prepare('SELECT role,state,terms_json FROM financial_authorizations WHERE case_id=? ORDER BY created_at').all(c.caseId) as {role:string;state:string;terms_json:string}[];
  const result={...activation,completedAt:new Date().toISOString(),headless:true,modelInference:false,automaticAuthorization:true,approvalSource:'Bounded owner consent before execution; deterministic policy issued both role permits without an interactive session',
   authorizations:authorizations.map(a=>({role:a.role,state:a.state,automaticPolicyVersion:JSON.parse(a.terms_json).tenantScope.automaticPolicyVersion})),
   inventory:{...activation.inventory,afterConfirmedPayment:before,physicalDelivery:receipt.quantity,afterPhysicalDelivery:after,duplicatePhysicalReceiptAdded:'0'},policyAfterCompletion:authority.automatic.snapshot(),evidenceLevel:'public-testnet-financial-execution-and-local-synthetic-inventory',
   limitations:['Synthetic clinic, quotes and physical delivery; CCUSD has no cash value.','One owner-approved test order; no claim of production activation or mainnet settlement.']};
  writeFileSync(file,JSON.stringify(result,null,2)+'\n',{mode:0o600,flag:'wx'});console.log(JSON.stringify(result,null,2));
 }finally{local?.close();registry.close();}
}
if(require.main===module){dotenv.config({path:join(PROJECT_ROOT,'.env'),quiet:true});void (process.argv[2]==='finalize'?finalize():prepare()).catch(e=>{console.error(e.message);process.exitCode=1;});}

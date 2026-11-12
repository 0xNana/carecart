import {verifyNativePayment} from '../near/human-receipts';
import {assertTestnetPayments,type TestnetPayments} from '../profiles/testnet-payments';
import {SafetyVaultClient} from '../near/safety-client';
import {profileFingerprint} from '../near/safety-profile';
import {financialDatabaseOwner} from '../tenancy/treasury';
import Database from 'better-sqlite3';
import type {TenantTreasuryAuthority,TreasuryApproval,TreasuryScope,TenantExecutionPermit} from '../tenancy/treasury-authority';
import {z} from 'zod';
import {digest} from '../intents/settlement';
import {financialPolicy} from '../near/human-review';
import type {VaultReader} from '../near/vault-reader';
import {OperationJournal} from '../near/operation-journal';
import {isSandboxProfile} from '../sandbox/profile';
import {ReplenishmentWorkflow} from '../workflow/cases';
import {observeVault} from '../workflow/capabilities';
import {OperationsError} from './auth';
export interface FinancialBinding {
 kind:'mocked-rpc'|'sandbox-rpc'|'public-rpc';client:VaultReader;verify:()=>Promise<void>;testnet?:TestnetPayments;
 simulateRole?:(role:'committer'|'requester',caseId:string)=>Promise<void>;
}
export const FinancialInput=z.object({requestId:z.uuid(),role:z.enum(['committer','requester']),expectedRevision:z.number().int().nonnegative(),expectedHash:z.string().regex(/^[a-f0-9]{64}$/),walletBindingId:z.uuid().optional()}).strict();
type Row={id:string;case_id:string;role:'committer'|'requester';actor:string;payload_hash:string;terms_json:string;terms_hash:string;state:string;created_at:string;expires:number;error:string|null};
const initialPolicy={auto_per_po_limit:'10000000',hard_payout_limit:'25000000',daily_dispatch_limit:'25000000',accepted_deposit_ceiling:'5000000'};
/** Application authorization is an audit artifact, never a signing credential or a settlement proof. */
export class FinancialAuthorizations {
 readonly db:Database.Database;readonly owned:boolean;
 constructor(readonly workflow:ReplenishmentWorkflow,readonly binding?:FinancialBinding,connection?:Database.Database,readonly clock=()=>Date.now(),readonly tenantAuthority?:TenantTreasuryAuthority){
  this.owned=!connection;
  if(tenantAuthority&&(tenantAuthority.workflow!==workflow||tenantAuthority.binding!==binding))throw new Error('Tenant authority runtime mismatch');
  if(binding&&(!['mocked-rpc','sandbox-rpc','public-rpc'].includes(binding.kind)||!binding.client.readOnly||profileFingerprint(binding.client.profile)!==workflow.procurement.fingerprint||
    (binding.kind==='sandbox-rpc')!==isSandboxProfile(workflow.procurement.profile)||
    (binding.kind==='mocked-rpc'&&(!binding.client.injectedReads||workflow.procurement.profile.vault!=='vault.local-ops.near'))||
    (binding.kind==='sandbox-rpc'&&(binding.client.injectedReads||binding.simulateRole))))throw new Error('Financial environment/authority mismatch');
  if(binding?.kind==='public-rpc'){
   const owner=financialDatabaseOwner(workflow.procurement.profile.databasePath);
   if(!owner||!tenantAuthority||!(binding.client instanceof SafetyVaultClient)||binding.client.injectedReads||binding.simulateRole)throw new Error('Financial environment requires a real clinic-bound testnet reader and authority');
   assertTestnetPayments(workflow.procurement.profile,owner,binding.testnet);
  }
  this.db=connection??new Database(workflow.procurement.profile.databasePath);this.db.pragma('busy_timeout=3000');this.db.pragma('synchronous=FULL');
  this.db.exec(`CREATE TABLE IF NOT EXISTS financial_authorizations(id TEXT PRIMARY KEY,case_id TEXT NOT NULL,role TEXT NOT NULL,actor TEXT NOT NULL,payload_hash TEXT NOT NULL,
   terms_json TEXT NOT NULL,terms_hash TEXT NOT NULL,state TEXT NOT NULL,created_at TEXT NOT NULL,expires INTEGER NOT NULL,error TEXT);
   CREATE UNIQUE INDEX IF NOT EXISTS financial_role_once ON financial_authorizations(case_id,role);
   CREATE TABLE IF NOT EXISTS financial_authorization_events(seq INTEGER PRIMARY KEY,authorization_id TEXT NOT NULL,body_json TEXT NOT NULL,body_hash TEXT NOT NULL);
   CREATE TRIGGER IF NOT EXISTS financial_event_no_update BEFORE UPDATE ON financial_authorization_events BEGIN SELECT RAISE(ABORT,'Append-only financial events');END;
   CREATE TRIGGER IF NOT EXISTS financial_event_no_delete BEFORE DELETE ON financial_authorization_events BEGIN SELECT RAISE(ABORT,'Append-only financial events');END;`);
 }
 close(){if(this.owned&&this.db.open)this.db.close();}
 #row(id:string){z.uuid().parse(id);const r=this.db.prepare('SELECT * FROM financial_authorizations WHERE id=?').get(id) as Row|undefined;
  if(!r)throw new OperationsError(404,'AUTHORIZATION_NOT_FOUND');
  if(digest(JSON.parse(r.terms_json))!==r.terms_hash||!['Authorized','Executing','Submitted','Observed','RequiresReconciliation'].includes(r.state))throw new Error('Financial authorization evidence invalid');return r;}
 get(id:string){const r=this.#row(id);return {id:r.id,caseId:r.case_id,role:r.role,state:r.state,terms:JSON.parse(r.terms_json),termsHash:r.terms_hash,expiresAt:new Date(r.expires).toISOString(),createdAt:r.created_at,error:r.error,
  execution:this.binding?.kind??'disabled',publicSigningEnabled:this.binding?.kind==='public-rpc',events:(this.db.prepare('SELECT body_json,body_hash FROM financial_authorization_events WHERE authorization_id=? ORDER BY seq').all(id) as {body_json:string;body_hash:string}[]).map(e=>{const b=JSON.parse(e.body_json);if(digest(b)!==e.body_hash)throw new Error('Financial event evidence invalid');return b;})};}
 #event(id:string,state:string,error:string|null=null,nativePayment?:ReturnType<typeof verifyNativePayment>){const now=new Date(this.clock()).toISOString();const body={state,timestamp:now,error,financialSuccess:false,...(nativePayment?{nativePayment}:{})};this.db.prepare('UPDATE financial_authorizations SET state=?,error=? WHERE id=?').run(state,error,id);this.db.prepare('INSERT INTO financial_authorization_events(authorization_id,body_json,body_hash) VALUES(?,?,?)').run(id,JSON.stringify(body),digest(body));}
 async assess(caseId:string){
  const c=this.workflow.get(caseId);if(!c.poId||!c.domain)throw new OperationsError(409,'CANONICAL_PO_REQUIRED');
  const order=this.workflow.procurement.resolve(c.poId).canonical;if(digest(order)!==c.poHash)throw new Error('Canonical PO conflict');
  const quote=c.domain.quote;const expired=Date.parse(quote.expiresAt)<=this.clock();
  let policy:{limits:typeof initialPolicy;spendable:string|null;usage:{spent:string;reserved:string}|null;blocks:string[];observed:boolean;humanRequired:boolean;supplierApproved:boolean|null}={limits:initialPolicy,spendable:null,usage:null,blocks:['FinancialExecutionDisabled'],observed:false,humanRequired:BigInt(order.amount)>10_000_000n,supplierApproved:null};
  if(this.binding){await this.binding.verify();const p=await financialPolicy(this.binding.client,order);policy={limits:p.policy,spendable:p.spendable,usage:p.usage,blocks:p.blocks,observed:true,humanRequired:p.humanRequired,supplierApproved:p.supplierApproved};}
  if(BigInt(order.amount)>25_000_000n&&!policy.blocks.includes('HardPayoutLimit'))policy.blocks.push('HardPayoutLimit');
  if(expired)policy.blocks.push('SupplierQuoteExpired');
  if(order.destination!=='Near')policy.blocks.push('SeparateCrossChainReviewRequired');
  if(c.domain.operations.some(o=>['Sending','Ambiguous'].includes(z.object({state:z.string()}).parse(o).state)))policy.blocks.push('RequiresReconciliation');
  if(this.workflow.get(caseId).version!==c.version||digest(this.workflow.procurement.resolve(c.poId).canonical)!==c.poHash)throw new OperationsError(409,'STALE_CASE');
  return {controller:this.workflow.procurement.profile.admin,profileFingerprint:this.workflow.procurement.fingerprint,caseId,revision:c.version,state:c.state,nextAction:c.nextAction,canonical:order,canonicalHash:c.poHash,quote,quoteExpired:expired,policy,
   requiredAuthority:c.nextAction==='AuthorizeCommitment'?'committer':c.nextAction==='AuthorizePaymentRequest'?'requester':c.nextAction==='HumanWalletReview'?'human-admin':'independent-observer',
   approvalStatus:c.paymentState,operations:c.domain.operations,settlement:c.settlement,execution:this.binding?.kind??'disabled',publicSigningEnabled:this.binding?.kind==='public-rpc',
   authorizations:(this.db.prepare('SELECT id FROM financial_authorizations WHERE case_id=? ORDER BY created_at').all(caseId) as {id:string}[]).map(a=>this.get(a.id))};
 }
 #terms(r:Awaited<ReturnType<FinancialAuthorizations['assess']>>,role:string,tenantScope?:TreasuryScope){const hasTenant=this.db.prepare("SELECT 1 FROM sqlite_master WHERE name='inventory_tenant_binding'").get();const owner=hasTenant?this.db.prepare('SELECT clinic_id FROM inventory_tenant_binding WHERE id=1').get() as {clinic_id:string|null}|undefined:undefined;return {...(tenantScope?{tenantScope}:{}),clinicId:owner?.clinic_id??null,signer:role==='committer'?this.workflow.procurement.profile.committer:this.workflow.procurement.profile.requester,profileFingerprint:this.workflow.procurement.fingerprint,caseId:r.caseId,revision:r.revision,role,canonical:r.canonical,canonicalHash:r.canonicalHash,quote:r.quote,policy:r.policy,execution:r.execution};}
 async authorize(caseId:string,raw:unknown,actor:string,claim=()=>{},approval?:TreasuryApproval){
  const input=FinancialInput.parse(raw);if(!this.binding)throw new OperationsError(403,'FINANCIAL_EXECUTION_DISABLED');
  const owner=this.db.prepare("SELECT 1 FROM sqlite_master WHERE name='inventory_tenant_binding'").get()?(this.db.prepare('SELECT clinic_id FROM inventory_tenant_binding WHERE id=1').get() as {clinic_id:string|null}|undefined)?.clinic_id:null;
  if(owner&&(!this.tenantAuthority||!approval||input.walletBindingId!==approval.walletBindingId))throw new OperationsError(403,'TENANT_FINANCIAL_EXECUTION_DISABLED');
  const payload=digest({caseId,input,actor,...(approval?{walletBindingId:approval.walletBindingId}: {})});const prior=this.db.prepare('SELECT id FROM financial_authorizations WHERE id=?').get(input.requestId);
  if(prior){const row=this.#row(input.requestId);if(owner)await this.tenantAuthority!.validate(JSON.parse(row.terms_json).tenantScope);if(row.payload_hash!==payload)throw new OperationsError(409,'AUTHORIZATION_CONFLICT');claim();return this.get(row.id);}
  const review=await this.assess(caseId);
  if(review.revision!==input.expectedRevision||review.canonicalHash!==input.expectedHash||review.requiredAuthority!==input.role||review.policy.blocks.length)throw new OperationsError(409,'FINANCIAL_REVIEW_BLOCKED_OR_STALE');
  const tenantScope=owner?await this.tenantAuthority!.approve(review,input.role,actor,input.requestId,approval!):undefined;
  const terms=this.#terms(review,input.role,tenantScope);
  this.db.transaction(()=>{claim();if(tenantScope)this.tenantAuthority!.assertLocal(tenantScope);const c=this.workflow.get(caseId);if(c.version!==review.revision||c.poHash!==input.expectedHash)throw new OperationsError(409,'STALE_CASE');
   if(this.db.prepare('SELECT 1 FROM financial_authorizations WHERE case_id=? AND role=?').get(caseId,input.role))throw new OperationsError(409,'AUTHORIZATION_ALREADY_RECORDED');
   this.db.prepare("INSERT INTO financial_authorizations VALUES(?,?,?,?,?,?,?,'Authorized',?,?,NULL)").run(input.requestId,caseId,input.role,actor,payload,JSON.stringify(terms),digest(terms),new Date(this.clock()).toISOString(),Math.min(this.clock()+120000,Date.parse(review.quote.expiresAt)));
   this.#event(input.requestId,'Authorized');
  }).immediate();return this.get(input.requestId);
 }
 async #execute(id:string,role:'committer'|'requester',perform:(permit?:TenantExecutionPermit)=>Promise<unknown>){
  let r=this.#row(id);const terms=JSON.parse(r.terms_json),scope=terms.tenantScope as TreasuryScope|undefined;
  if(terms.clinicId&&(!scope||!this.tenantAuthority||scope.clinicId!==terms.clinicId))throw new OperationsError(403,'TENANT_FINANCIAL_EXECUTION_DISABLED');
  if(r.role!==role||r.state!=='Authorized'||r.expires<=this.clock())throw new OperationsError(409,'AUTHORIZATION_REQUIRES_RECONCILIATION');
  const fresh=await this.assess(r.case_id);if(fresh.policy.blocks.length||fresh.requiredAuthority!==role||digest(this.#terms(fresh,role,scope))!==r.terms_hash)throw new OperationsError(409,'AUTHORIZATION_TERMS_CHANGED');
  if(scope)await this.tenantAuthority!.validate(scope);
  const claim=()=>this.db.transaction(()=>{r=this.#row(id);if(r.state!=='Authorized'||r.expires<=this.clock())throw new OperationsError(409,'AUTHORIZATION_REQUIRES_RECONCILIATION');const c=this.workflow.get(r.case_id);if(c.version!==terms.revision||c.poHash!==terms.canonicalHash)throw new OperationsError(409,'STALE_CASE');this.#event(id,'Executing');}).immediate();
  // Registry lock serializes revocation/configuration with the durable claim. A crash between DB commits freezes execution, never retries it.
  const permit=scope?this.tenantAuthority!.consume(scope,claim):undefined;if(!scope)claim();
  try{await perform(permit);if(scope)this.tenantAuthority!.record(scope,'Submitted');this.db.transaction(()=>this.#event(id,'Submitted')).immediate();}catch(e){if(scope)this.tenantAuthority!.record(scope,'RequiresReconciliation');this.db.transaction(()=>this.#event(id,'RequiresReconciliation','Operation interrupted; inspect exact intent, never resend')).immediate();throw e;}
  return this.get(id);
 }
 async executeMock(id:string,actor:string){const r=this.#row(id);if(r.actor!==actor)throw new OperationsError(403,'AUTHORIZATION_SESSION_MISMATCH');
  if(this.binding?.kind!=='mocked-rpc'||!this.binding.simulateRole)throw new OperationsError(403,'PUBLIC_SIGNING_DISABLED');
  if(['Submitted','Observed'].includes(r.state))return this.get(id);
  return this.#execute(id,r.role,()=>this.binding!.simulateRole!(r.role,r.case_id));}
 async executeSandbox(id:string,role:'committer'|'requester',env:NodeJS.ProcessEnv){
  if(this.binding?.kind!=='sandbox-rpc'||!isSandboxProfile(this.workflow.procurement.profile))throw new OperationsError(403,'PUBLIC_SIGNING_DISABLED');
  return this.#execute(id,role,permit=>{const c=this.workflow.get(this.#row(id).case_id);return this.workflow.act({caseId:c.caseId,role,expectedVersion:c.version,expectedHash:c.poHash!},env,new Date(this.clock()),permit);});
 }
 async executeTestnet(id:string,role:'committer'|'requester',env:NodeJS.ProcessEnv){
  if(this.binding?.kind!=='public-rpc'||env.CARECART_TENANT_FINANCIAL_MODE!=='near-testnet'||!this.tenantAuthority)throw new OperationsError(403,'PUBLIC_SIGNING_DISABLED');
  assertTestnetPayments(this.workflow.procurement.profile,this.tenantAuthority.clinicId,this.binding.testnet);
  return this.#execute(id,role,permit=>{const c=this.workflow.get(this.#row(id).case_id);return this.workflow.act({caseId:c.caseId,role,expectedVersion:c.version,expectedHash:c.poHash!},env,new Date(this.clock()),permit);});
 }
 async reconcile(id:string){const r=this.#row(id);if(!this.binding||r.state==='Authorized')throw new OperationsError(409,'RECORDED_OPERATION_REQUIRED');
  const terms=JSON.parse(r.terms_json);if(terms.clinicId){if(!this.tenantAuthority||!terms.tenantScope)throw new OperationsError(403,'TENANT_FINANCIAL_EXECUTION_DISABLED');this.tenantAuthority.assertReconciliation(terms.tenantScope);}const order=this.workflow.procurement.resolve(terms.canonical.po_id).canonical;
  if(digest(order)!==terms.canonicalHash)throw new Error('Canonical authorization conflict');await this.binding.verify();
  const observation=await observeVault(this.workflow.procurement,order.po_id,this.binding.kind,new Date(this.clock()),this.binding.client);
  if(r.role==='requester'&&observation.payment.status==='Committed')throw new OperationsError(409,'PAYMENT_EFFECT_UNOBSERVED');
  const method=r.role==='committer'?'commit_purchase_order':'request_payment',payload={method,args:r.role==='committer'?{order}:{po_id:order.po_id}};
  const journal=new OperationJournal(this.workflow.procurement.profile.databasePath,this.workflow.procurement.fingerprint);
  try{journal.assertRecorded(method+':'+order.po_id,payload);journal.confirm(method+':'+order.po_id,payload,{transactionHash:null,reconciled:true});}finally{journal.close();}
  let nativePayment:ReturnType<typeof verifyNativePayment>|undefined;
  if(this.binding.kind==='public-rpc'&&r.role==='requester'&&observation.payment.status==='Paid'){
   const op=terms.canonical.po_id;
   const dbOperation=z.array(z.object({operation_key:z.string(),evidence:z.string().nullable()})).parse(this.workflow.procurement.inspect(op).operations).find(o=>o.operation_key==='request_payment:'+op);
   const evidence=dbOperation?.evidence?JSON.parse(dbOperation.evidence) as {transactionHash?:string}:null;
   if(!evidence?.transactionHash)throw new OperationsError(409,'NATIVE_RECEIPT_ATTRIBUTION_REQUIRED');
   const client=this.binding.client;if(!(client instanceof SafetyVaultClient))throw new OperationsError(403,'PUBLIC_READER_REQUIRED');
   nativePayment=verifyNativePayment(client.profile,order,evidence.transactionHash,await client.finalTransaction(evidence.transactionHash,'requester'));
  }
  const c=this.workflow.get(r.case_id);this.workflow.observe(c.caseId,observation,c.version);if(terms.tenantScope)this.tenantAuthority!.record(terms.tenantScope,'Observed');this.db.transaction(()=>this.#event(id,'Observed',null,nativePayment)).immediate();return this.get(id);
 }
}

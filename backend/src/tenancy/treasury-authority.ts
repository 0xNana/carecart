import {assertTestnetPayments} from '../profiles/testnet-payments';
import {SafetyVaultClient} from '../near/safety-client';
import type {SafetyProfile} from '../near/safety-profile';
import Database from 'better-sqlite3';
import {z} from 'zod';
import {createHash} from 'node:crypto';
import {digest} from '../intents/settlement';
import {SafetyOrderSchema} from '../near/commitments';
import type {ReplenishmentWorkflow} from '../workflow/cases';
import type {FinancialBinding,FinancialAuthorizations} from '../operations/financial-authorizations';
import {OperationsError} from '../operations/auth';
import {WalletBindings} from './wallet-bindings';
import {ClinicRegistry,permissionFor,type IdentitySession} from './registry';
import type {VerifiedIdentity} from './identity';
import {ClinicTreasuries,FinancialRole,TreasuryEnvironment,financialDatabaseOwner,type TreasuryConfiguration} from './treasury';
import {SandboxVaultClient} from '../sandbox/client';
import {isSandboxProfile} from '../sandbox/profile';

type Review=Awaited<ReturnType<FinancialAuthorizations['assess']>>;
export interface TreasuryApproval {user:VerifiedIdentity;session:IdentitySession;walletBindingId:string}
const Scope=z.object({version:z.literal(1),clinicId:z.uuid(),environment:TreasuryEnvironment,network:z.enum(['testnet','mainnet']),vault:z.string(),token:z.string(),treasuryVersion:z.number().int().positive(),treasury:TreasurySnapshot(),profileFingerprint:z.string(),canonical:SafetyOrderSchema,canonicalHash:z.string(),caseId:z.string(),caseRevision:z.number().int().nonnegative(),role:FinancialRole,signer:z.string(),authorizationId:z.uuid(),operationId:z.uuid(),idempotencyKey:z.string(),actor:z.string(),user:z.object({userId:z.uuid(),email:z.email(),sessionId:z.uuid(),expires:z.number()}),sessionHash:z.string(),sessionExpires:z.number(),walletBindingId:z.uuid(),walletAccount:z.string(),walletPublicKey:z.string(),expires:z.number()}).strict();
// Configuration validation is performed by ClinicTreasuries; the snapshot is additionally hash-bound to the authorization.
function TreasurySnapshot(){return z.custom<TreasuryConfiguration>(v=>!!v&&typeof v==='object');}
export type TreasuryScope=z.infer<typeof Scope>;
/** Nonserializable, one-operation capability. Only consume() below can mint it. */
export interface TenantExecutionPermit {readonly kind:'tenant-financial-operation'}
const permits=new WeakMap<object,{scope:TreasuryScope;authority:TenantTreasuryAuthority}>();
const actorFor=(session:string,clinic:string,role:string)=>createHash('sha256').update(JSON.stringify([session,clinic,role])).digest('hex');

/** Used by the lowest signing/journal boundaries as well as P1/P2. No JSON can become a permit. */
export function assertTenantExecution(path:string,role:FinancialRole,poId:string,permit?:TenantExecutionPermit,canonicalHash?:string){
 const owner=financialDatabaseOwner(path);if(!owner)return;
 const entry=permit&&permits.get(permit);if(!entry||entry.scope.clinicId!==owner||entry.scope.role!==role||entry.scope.canonical.po_id!==poId||entry.scope.treasury.databasePath!==path||(canonicalHash&&entry.scope.canonicalHash!==canonicalHash))throw new OperationsError(403,'TENANT_FINANCIAL_EXECUTION_DISABLED');
 entry.authority.assertLocal(entry.scope);
 const record=entry.authority.operation(entry.scope);if(record?.state!=='Consumed')throw new OperationsError(409,'TENANT_OPERATION_REQUIRES_RECONCILIATION');
}

/** A profile/configuration file cannot mint a signing permit. The consumed registry operation must match. */
export function assertTenantSigningProfile(profile:SafetyProfile,role:FinancialRole,permit?:TenantExecutionPermit){
 const entry=permit&&permits.get(permit);
 if(!entry||entry.scope.environment!=='near-testnet'||entry.scope.profileFingerprint!==digest(profile))throw new OperationsError(403,'PUBLIC_TREASURY_EXECUTION_DISABLED');
 assertTenantExecution(profile.databasePath,role,entry.scope.canonical.po_id,permit,entry.scope.canonicalHash);
}

/** Server-owned, narrowly scoped authority. No keys, wallet handoff, shell, SQL tool or generic send capability. */
export class TenantTreasuryAuthority {
 readonly treasuries:ClinicTreasuries;
 readonly #checked=new WeakMap<object,{hash:string;expires:number}>();
 constructor(readonly registry:ClinicRegistry,readonly wallets:WalletBindings,readonly workflow:ReplenishmentWorkflow,readonly binding:FinancialBinding,readonly clinicId:string,readonly environment:TreasuryEnvironment){
  z.uuid().parse(clinicId);TreasuryEnvironment.parse(environment);this.treasuries=new ClinicTreasuries(registry);
  if(financialDatabaseOwner(workflow.procurement.profile.databasePath)!==clinicId||digest(binding.client.profile)!==workflow.procurement.fingerprint)throw new Error('Trusted clinic runtime/reader binding required');
 }
 #session(s:TreasuryScope){
  const r=this.registry.db.prepare('SELECT session_id FROM identity_sessions WHERE hash=? AND user_id=? AND expires>? AND session_id NOT IN (SELECT session_id FROM identity_revocations)').get(s.sessionHash,s.user.userId,this.registry.clock()) as {session_id:string}|undefined;
  if(!r||r.session_id!==s.user.sessionId||Math.min(s.expires,s.sessionExpires,s.user.expires)<=this.registry.clock())throw new OperationsError(401,'TREASURY_AUTHORITY_EXPIRED_OR_REVOKED');
 }
 assertLocal(raw:TreasuryScope){
  const s=Scope.parse(raw),p=this.workflow.procurement.profile;this.#session(s);
  if(s.clinicId!==this.clinicId||s.environment!==this.environment)throw new OperationsError(403,'PUBLIC_TREASURY_EXECUTION_DISABLED');
  if(s.environment==='near-testnet'&&this.binding.kind==='public-rpc')assertTestnetPayments(p,s.clinicId,this.binding.testnet);
  else if(s.environment!=='local-sandbox'||this.binding.kind!=='sandbox-rpc'||!isSandboxProfile(p))throw new OperationsError(403,'PUBLIC_TREASURY_EXECUTION_DISABLED');
  const c=this.treasuries.assertCurrent(s.treasury),m=this.registry.membership(s.user.userId,s.clinicId);
  if(!permissionFor(m.role,'finance')||s.actor!==actorFor(s.sessionHash,s.clinicId,m.role))throw new OperationsError(403,'CURRENT_FINANCE_ROLE_REQUIRED');
  const wallet=this.wallets.get(s.user,s.clinicId,s.walletBindingId);
  if(wallet.status!=='Verified'||wallet.accountId!==c.controller||wallet.accountId!==s.walletAccount||wallet.publicKey!==s.walletPublicKey||wallet.network!==s.network)throw new OperationsError(403,'CURRENT_TREASURY_WALLET_REQUIRED');
  if(c.profileFingerprint!==this.workflow.procurement.fingerprint||c.profileFingerprint!==s.profileFingerprint||c.version!==s.treasuryVersion||c.network!==s.network||c.vault!==s.vault||c.token!==s.token||c.controller!==p.admin||c.treasuryOwner!==p.treasury||c.committer!==p.committer||c.requester!==p.requester||!c.permittedRoles.includes(s.role)||s.signer!==p[s.role]||s.authorizationId!==s.operationId||s.idempotencyKey!==digest([s.clinicId,s.environment,s.vault,s.token,s.canonical.po_id,s.role]))throw new OperationsError(403,'TREASURY_SCOPE_CONFLICT');
  const current=this.workflow.get(s.caseId);
  if(current.version!==s.caseRevision&&!(current.version===s.caseRevision+1&&current.timeline.at(-1)?.eventType==='OperationAuthorized'&&current.state===(s.role==='committer'?'CommitmentPending':'PaymentRequestPending')))throw new OperationsError(409,'TENANT_CASE_REVISION_CHANGED');
  if(digest(s.canonical)!==s.canonicalHash||current.poHash!==s.canonicalHash||current.poId!==s.canonical.po_id||digest(this.workflow.procurement.resolve(s.canonical.po_id).canonical)!==s.canonicalHash||s.canonical.profile!==s.network||s.canonical.token!==s.token||s.canonical.destination!=='Near'||BigInt(s.canonical.amount)>25_000_000n||Date.parse(this.workflow.procurement.quoteExpiry(s.canonical.po_id))<=this.registry.clock())throw new OperationsError(409,'TENANT_CANONICAL_TERMS_CHANGED');
 }
 async validate(s:TreasuryScope){
  this.assertLocal(s);await this.binding.verify();await this.wallets.assertCurrent(s.user,s.clinicId,s.walletBindingId);
  const client=this.binding.client;
  if(!(client instanceof SandboxVaultClient)&&!(this.binding.kind==='public-rpc'&&client instanceof SafetyVaultClient&&client.readOnly&&!client.injectedReads))throw new OperationsError(403,'INDEPENDENT_SANDBOX_READER_REQUIRED');
  const access=client instanceof SandboxVaultClient?await client.rpc.viewAccessKey({accountId:s.walletAccount,publicKey:s.walletPublicKey,finalityQuery:{finality:'final'}}):await client.ownerAccessKey(s.walletAccount,s.walletPublicKey);
  if(access.permission!=='FullAccess')throw new OperationsError(403,'VAULT_CONTROLLER_KEY_OWNERSHIP_REQUIRED');
  const roles=z.object({committer:z.boolean(),requester:z.boolean()});
  for(const role of ['committer','requester'] as const){const observed=roles.parse(await this.binding.client.view('get_roles',{account:this.workflow.procurement.profile[role]}));if(!observed[role]||observed[role==='committer'?'requester':'committer'])throw new OperationsError(403,'RESTRICTED_VAULT_ROLE_REQUIRED');}
  // Async observations cannot preserve an authority that was revoked in the meantime.
  this.assertLocal(s);this.#checked.set(s,{hash:digest(s),expires:this.registry.clock()+5000});
 }
 async approve(review:Review,role:FinancialRole,actor:string,id:string,approval:TreasuryApproval){
  const c=this.treasuries.get(this.clinicId,this.environment),w=this.wallets.get(approval.user,this.clinicId,approval.walletBindingId);
  const s=Scope.parse({version:1,clinicId:this.clinicId,environment:this.environment,network:c.network,vault:c.vault,token:c.token,treasuryVersion:c.version,treasury:c,profileFingerprint:c.profileFingerprint,canonical:review.canonical,canonicalHash:review.canonicalHash,caseId:review.caseId,caseRevision:review.revision,role,signer:this.workflow.procurement.profile[role],authorizationId:id,operationId:id,idempotencyKey:digest([this.clinicId,this.environment,c.vault,c.token,review.canonical.po_id,role]),actor,user:approval.user,sessionHash:approval.session.hash,sessionExpires:approval.session.expires,walletBindingId:w.id,walletAccount:w.accountId,walletPublicKey:w.publicKey,expires:Math.min(this.registry.clock()+120000,approval.user.expires,approval.session.expires,Date.parse(review.quote.expiresAt))});
  if(approval.session.userId!==approval.user.userId||approval.session.sessionId!==approval.user.sessionId)throw new OperationsError(403,'TREASURY_SESSION_MISMATCH');await this.validate(s);return s;
 }
 operation(s:TreasuryScope){const r=this.registry.db.prepare('SELECT scope_hash,state FROM tenant_financial_operations WHERE id=? AND clinic_id=? AND environment=?').get(s.operationId,s.clinicId,s.environment) as {scope_hash:string;state:string}|undefined;if(r&&r.scope_hash!==digest(s))throw new Error('Tenant operation scope conflict');return r;}
 #authorization(s:TreasuryScope,state:'Authorized'|'Executing'){
  const db=new Database(this.workflow.procurement.profile.databasePath,{readonly:true,fileMustExist:true});try{
   const r=db.prepare('SELECT terms_json,terms_hash,state,actor,role,case_id,expires FROM financial_authorizations WHERE id=?').get(s.authorizationId) as {terms_json:string;terms_hash:string;state:string;actor:string;role:string;case_id:string;expires:number}|undefined;
   if(!r||r.state!==state||r.actor!==s.actor||r.role!==s.role||r.case_id!==s.caseId||r.expires<=this.registry.clock())throw new OperationsError(409,'CURRENT_AUTHORIZATION_REQUIRED');
   const terms=JSON.parse(r.terms_json);if(digest(terms)!==r.terms_hash||digest(terms.tenantScope)!==digest(s)||terms.clinicId!==s.clinicId)throw new OperationsError(403,'AUTHORIZATION_SCOPE_CONFLICT');
  }finally{db.close();}
 }
 consume(s:TreasuryScope,claim:()=>void){
  return this.registry.db.transaction(()=>{
   const checked=this.#checked.get(s);if(!checked||checked.hash!==digest(s)||checked.expires<=this.registry.clock())throw new OperationsError(403,'FRESH_TREASURY_OBSERVATION_REQUIRED');this.#checked.delete(s);
   this.assertLocal(s);this.#authorization(s,'Authorized');if(this.operation(s))throw new OperationsError(409,'TENANT_OPERATION_REQUIRES_RECONCILIATION');
   const c=this.workflow.get(s.caseId);if(c.version!==s.caseRevision)throw new OperationsError(409,'TENANT_CASE_REVISION_CHANGED');
   this.registry.db.prepare("INSERT INTO tenant_financial_operations VALUES(?,?,?,?,?,?,'Consumed')").run(s.operationId,s.clinicId,s.environment,s.idempotencyKey,JSON.stringify(s),digest(s));
   claim();this.#authorization(s,'Executing');this.registry.audit(s.clinicId,s.user.userId,'TenantFinancialOperationConsumed',{operationId:s.operationId,authorizationId:s.authorizationId,role:s.role,canonicalHash:s.canonicalHash,treasuryVersion:s.treasuryVersion});
   const permit:TenantExecutionPermit=Object.freeze({kind:'tenant-financial-operation'});permits.set(permit,{scope:s,authority:this});return permit;
  }).immediate();
 }
 record(s:TreasuryScope,state:'Submitted'|'RequiresReconciliation'|'Observed'){
  this.registry.db.transaction(()=>{const r=this.operation(s);if(!r)throw new Error('Recorded tenant intent required');if(r.state==='Observed'&&state!=='Observed')throw new Error('Observed intent cannot regress');this.registry.db.prepare('UPDATE tenant_financial_operations SET state=? WHERE id=?').run(state,s.operationId);this.registry.audit(s.clinicId,s.user.userId,'TenantFinancialOperation'+state,{operationId:s.operationId,canonicalHash:s.canonicalHash});}).immediate();
 }
 /** Observation remains possible after role/config revocation; no new submission permit is issued. */
 assertReconciliation(s:TreasuryScope){if(s.clinicId!==this.clinicId||s.environment!==this.environment||s.profileFingerprint!==this.workflow.procurement.fingerprint||financialDatabaseOwner(this.workflow.procurement.profile.databasePath)!==s.clinicId||!this.operation(s))throw new OperationsError(403,'TENANT_RECONCILIATION_SCOPE_CONFLICT');}
}

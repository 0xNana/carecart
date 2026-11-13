import {z} from 'zod';
import {digest} from '../intents/settlement';
import {OperationsError} from '../operations/auth';
import type {TreasuryApproval,TreasuryScope,TenantTreasuryAuthority} from './treasury-authority';

export const AutomaticPolicyInput=z.object({expectedVersion:z.number().int().nonnegative(),enabled:z.boolean(),
 suppliers:z.array(z.string()).min(1).max(3),itemIds:z.array(z.string()).min(1).max(6),
 maxAutomaticAmount:z.string().regex(/^[1-9][0-9]*$/).refine(v=>BigInt(v)<=10_000_000n),walletBindingId:z.uuid()}).strict();
type StandingPolicy={version:number;enabled:boolean;suppliers:string[];itemIds:string[];maxAutomaticAmount:string;
 network:'testnet';token:string;vault:string;treasuryVersion:number;profileFingerprint:string;expires:number;
 approval:TreasuryApproval|null;walletAccount:string|null;walletPublicKey:string|null;hostGrant?:{operator:string;caseId:string;canonicalHash:string;maxExposure:string;approvedAt:number}};

/** Durable, revocable clinic consent. No keys and no send method; onchain limits remain authoritative. */
export class AutomaticPurchasing {
 constructor(readonly authority:TenantTreasuryAuthority){
  authority.registry.db.exec(`CREATE TABLE IF NOT EXISTS clinic_automatic_policy_versions(
   clinic_id TEXT NOT NULL,environment TEXT NOT NULL,version INTEGER NOT NULL,body_json TEXT NOT NULL,body_hash TEXT NOT NULL,
   PRIMARY KEY(clinic_id,environment,version));
   CREATE TRIGGER IF NOT EXISTS automatic_policy_no_update BEFORE UPDATE ON clinic_automatic_policy_versions BEGIN SELECT RAISE(ABORT,'Immutable automatic policy');END;
   CREATE TRIGGER IF NOT EXISTS automatic_policy_no_delete BEFORE DELETE ON clinic_automatic_policy_versions BEGIN SELECT RAISE(ABORT,'Immutable automatic policy');END;`);
 }
 get():StandingPolicy|null{
  const a=this.authority,row=a.registry.db.prepare('SELECT body_json,body_hash FROM clinic_automatic_policy_versions WHERE clinic_id=? AND environment=? ORDER BY version DESC LIMIT 1').get(a.clinicId,a.environment) as {body_json:string;body_hash:string}|undefined;
  if(!row)return null;const body=JSON.parse(row.body_json) as StandingPolicy;
  if(digest(body)!==row.body_hash)throw new Error('Automatic policy evidence conflict');return body;
 }
 snapshot(){const p=this.get();return {version:p?.version??0,enabled:!!p?.enabled&&p.expires>this.authority.registry.clock(),policy:p?{
  suppliers:p.suppliers,itemIds:p.itemIds,maxAutomaticAmount:p.maxAutomaticAmount,network:p.network,token:p.token,vault:p.vault,
  scope:p.hostGrant?'one-order-sprint':'selected-items',hardPerPoLimit:'25000000',dailyDispatchLimit:'25000000',expiresAt:new Date(p.expires).toISOString()}:null};}
 pause(userId:string){
  const a=this.authority,r=a.registry;
  return r.db.transaction(()=>{
   if(r.membership(userId,a.clinicId).role!=='Clinic Admin')throw new OperationsError(403,'CURRENT_CLINIC_ADMIN_REQUIRED');
   const p=this.get();if(!p)return this.snapshot();
   const next={...p,version:p.version+1,enabled:false};
   r.db.prepare('INSERT INTO clinic_automatic_policy_versions VALUES(?,?,?,?,?)').run(a.clinicId,a.environment,next.version,JSON.stringify(next),digest(next));
   r.audit(a.clinicId,userId,'AutomaticPurchasingPaused',{version:next.version});return this.snapshot();
  }).immediate();
 }
 async configure(raw:unknown,approval:TreasuryApproval){
  const input=AutomaticPolicyInput.parse(raw),a=this.authority,r=a.registry,now=r.clock();
  if(a.environment!=='near-testnet'&&a.environment!=='local-sandbox')throw new OperationsError(403,'AUTOMATIC_TESTNET_ONLY');
  if(r.membership(approval.user.userId,a.clinicId).role!=='Clinic Admin'||approval.user.expires<=now||approval.session.expires<=now||approval.session.userId!==approval.user.userId||approval.session.sessionId!==approval.user.sessionId||input.walletBindingId!==approval.walletBindingId)
   throw new OperationsError(403,'CURRENT_CLINIC_ADMIN_REQUIRED');
  if(!r.db.prepare('SELECT 1 FROM identity_sessions WHERE hash=? AND user_id=? AND session_id=? AND expires>? AND session_id NOT IN (SELECT session_id FROM identity_revocations)').get(approval.session.hash,approval.user.userId,approval.user.sessionId,now))throw new OperationsError(401,'AUTH_EXPIRED');
  const treasury=a.treasuries.get(a.clinicId,a.environment);a.treasuries.assertCurrent(treasury);
  const wallet=await a.wallets.assertCurrent(approval.user,a.clinicId,approval.walletBindingId);
  if(wallet.accountId!==treasury.controller)throw new OperationsError(403,'CURRENT_TREASURY_WALLET_REQUIRED');
  const catalog=a.workflow.procurement.registeredCatalog?.();
  const approved=a.binding.testnet?.suppliers??catalog?.suppliers.map(s=>s.account)??[];
  const items=a.workflow.procurement.registeredInventory().map(i=>i.id);
  if(new Set(input.suppliers).size!==input.suppliers.length||new Set(input.itemIds).size!==input.itemIds.length||input.suppliers.some(s=>!approved.includes(s))||input.itemIds.some(id=>!items.includes(id)))throw new OperationsError(403,'AUTOMATIC_CATALOG_SCOPE_INVALID');
  await a.binding.verify();
  const state=z.object({paused:z.boolean(),policy:z.object({auto_per_po_limit:z.string(),hard_payout_limit:z.literal('25000000'),daily_dispatch_limit:z.literal('25000000')})}).parse(await a.binding.client.view('get_state',{}));
  if(input.enabled&&(state.paused||BigInt(input.maxAutomaticAmount)>BigInt(state.policy.auto_per_po_limit)))throw new OperationsError(409,'AUTOMATIC_POLICY_BLOCKED');
  return r.db.transaction(()=>{
   if((this.get()?.version??0)!==input.expectedVersion)throw new OperationsError(409,'AUTOMATIC_POLICY_VERSION_CHANGED');
   a.treasuries.assertCurrent(treasury);
   if(approval.user.expires<=r.clock()||approval.session.expires<=r.clock()||!r.db.prepare('SELECT 1 FROM identity_sessions WHERE hash=? AND user_id=? AND expires>? AND session_id NOT IN (SELECT session_id FROM identity_revocations)').get(approval.session.hash,approval.user.userId,r.clock()))throw new OperationsError(401,'AUTH_EXPIRED');
   if(r.membership(approval.user.userId,a.clinicId).role!=='Clinic Admin'||a.wallets.get(approval.user,a.clinicId,wallet.id).status!=='Verified')throw new OperationsError(403,'CURRENT_CLINIC_ADMIN_REQUIRED');
   const policy:StandingPolicy={version:input.expectedVersion+1,enabled:input.enabled,suppliers:input.suppliers,itemIds:input.itemIds,maxAutomaticAmount:input.maxAutomaticAmount,network:'testnet',token:treasury.token,vault:treasury.vault,treasuryVersion:treasury.version,profileFingerprint:treasury.profileFingerprint,
    expires:Math.min(now+24*3600000,wallet.expires),approval,walletAccount:wallet.accountId,walletPublicKey:wallet.publicKey};
   r.db.prepare('INSERT INTO clinic_automatic_policy_versions VALUES(?,?,?,?,?)').run(a.clinicId,a.environment,policy.version,JSON.stringify(policy),digest(policy));
   r.audit(a.clinicId,approval.user.userId,'AutomaticPurchasingPolicyConfigured',{version:policy.version,enabled:policy.enabled,maxAutomaticAmount:policy.maxAutomaticAmount,suppliers:policy.suppliers,itemIds:policy.itemIds});return this.snapshot();
  }).immediate();
 }
 /** Owner control-plane activation for the single approved synthetic sprint PO. Never exposed to HTTP/model tools. */
 configureSprintGrant(caseId:string,operator:string,approvalEnvelope:string){
  const a=this.authority,r=a.registry,p=a.workflow.procurement.profile;
  if(operator!=='operator:owner-approved-sprint'||approvalEnvelope!=='BCpcRunpuzhjrshyq1yrKtsmABrAAPy6ZFmMrUvUUqK3:3000000'||a.environment!=='near-testnet'||a.binding.kind!=='public-rpc'||!a.binding.testnet||!r.clinic(a.clinicId).syntheticDemo||p.vault!=='safety-v2.carecart.testnet'||p.token!=='token-v2.carecart.testnet'||p.codeHash!=='BCpcRunpuzhjrshyq1yrKtsmABrAAPy6ZFmMrUvUUqK3')throw new OperationsError(403,'EXACT_OWNER_SPRINT_APPROVAL_REQUIRED');
  const c=a.workflow.get(caseId),order=c.domain?.purchaseOrder.canonical;
  if(c.itemId!=='mn-item-1'||!order||order.supplier!=='medsupply-a.carecart.testnet'||order.destination!=='Near'||BigInt(order.amount)>3000000n||c.state!=='PoDrafted')throw new OperationsError(403,'SPRINT_PO_OUTSIDE_APPROVED_ENVELOPE');
  return r.db.transaction(()=>{
   const treasury=a.treasuries.get(a.clinicId,a.environment);a.treasuries.assertCurrent(treasury);
   if(r.db.prepare("SELECT 1 FROM clinic_automatic_policy_versions WHERE clinic_id=? AND environment=? AND json_type(body_json,'$.hostGrant')='object' LIMIT 1").get(a.clinicId,a.environment))throw new OperationsError(409,'SPRINT_GRANT_ALREADY_RECORDED');
   const policy:StandingPolicy={version:(this.get()?.version??0)+1,enabled:true,suppliers:[order.supplier],itemIds:[c.itemId],maxAutomaticAmount:'3000000',network:'testnet',token:p.token,vault:p.vault,treasuryVersion:treasury.version,profileFingerprint:treasury.profileFingerprint,expires:r.clock()+3600000,approval:null,walletAccount:null,walletPublicKey:null,
    hostGrant:{operator,caseId,canonicalHash:c.poHash!,maxExposure:'3000000',approvedAt:r.clock()}};
   r.db.prepare('INSERT INTO clinic_automatic_policy_versions VALUES(?,?,?,?,?)').run(a.clinicId,a.environment,policy.version,JSON.stringify(policy),digest(policy));r.audit(a.clinicId,operator,'OwnerApprovedBoundedSprintPolicy',{caseId,canonicalHash:c.poHash,maxExposure:'3000000',version:policy.version});return this.snapshot();
  }).immediate();
 }
 completeSprintGrant(caseId:string){
  const a=this.authority,r=a.registry;
  return r.db.transaction(()=>{
   const p=this.get();if(!p?.hostGrant||p.hostGrant.caseId!==caseId||a.workflow.get(caseId).state!=='SameChainConfirmed')throw new OperationsError(403,'CONFIRMED_SPRINT_PO_REQUIRED');
   const next={...p,version:p.version+1,enabled:false};r.db.prepare('INSERT INTO clinic_automatic_policy_versions VALUES(?,?,?,?,?)').run(a.clinicId,a.environment,next.version,JSON.stringify(next),digest(next));r.audit(a.clinicId,p.hostGrant.operator,'BoundedSprintCompleted',{caseId,version:next.version});return this.snapshot();
  }).immediate();
 }
 assertScope(s:TreasuryScope){
  const p=this.get(),a=this.authority,c=a.workflow.get(s.caseId);
  if(!p||!p.enabled||p.version!==s.automaticPolicyVersion||p.expires<=a.registry.clock()||p.treasuryVersion!==s.treasuryVersion||p.profileFingerprint!==s.profileFingerprint||p.vault!==s.vault||p.token!==s.token||s.actor!==`automatic:${a.clinicId}:${p.version}`||!p.suppliers.includes(s.canonical.supplier)||!p.itemIds.includes(c.itemId)||BigInt(s.canonical.amount)>BigInt(p.maxAutomaticAmount)||BigInt(s.canonical.amount)>10000000n)throw new OperationsError(403,'AUTOMATIC_POLICY_DISABLED_CHANGED_OR_OUTSIDE_SCOPE');
  if(p.hostGrant){
   if(s.user!==null||a.environment!=='near-testnet'||a.binding.kind!=='public-rpc'||!a.registry.clinic(a.clinicId).syntheticDemo||p.hostGrant.operator!=='operator:owner-approved-sprint'||p.hostGrant.maxExposure!=='3000000'||p.hostGrant.caseId!==s.caseId||p.hostGrant.canonicalHash!==s.canonicalHash||BigInt(s.canonical.amount)>3000000n)throw new OperationsError(403,'EXACT_OWNER_SPRINT_APPROVAL_REQUIRED');
  }else{
   if(!p.approval||!s.user||p.approval.user.userId!==s.user.userId||p.approval.walletBindingId!==s.walletBindingId||p.walletAccount!==s.walletAccount||p.walletPublicKey!==s.walletPublicKey||a.registry.membership(s.user.userId,a.clinicId).role!=='Clinic Admin')throw new OperationsError(403,'AUTOMATIC_POLICY_DISABLED_CHANGED_OR_OUTSIDE_SCOPE');
  }
  return p;
 }
}

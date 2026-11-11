import {assertTestnetPayments,type TestnetPayments} from '../profiles/testnet-payments';
import Database from 'better-sqlite3';
import {z} from 'zod';
import {digest} from '../intents/settlement';
import {SafetyProfileSchema,type SafetyProfile} from '../near/safety-profile';
import {isSandboxProfile} from '../sandbox/profile';
import {OperationsError} from '../operations/auth';
import {ClinicRegistry} from './registry';

export const TreasuryEnvironment=z.enum(['local-sandbox','near-testnet','near-mainnet']);
export type TreasuryEnvironment=z.infer<typeof TreasuryEnvironment>;
export const FinancialRole=z.enum(['committer','requester']);
export type FinancialRole=z.infer<typeof FinancialRole>;
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const Configuration=z.object({clinicId:z.uuid(),environment:TreasuryEnvironment,version:z.number().int().positive(),network:z.enum(['testnet','mainnet']),vault:z.string(),token:z.string(),treasuryOwner:z.string(),controller:z.string(),committer:z.string(),requester:z.string(),profileFingerprint:hash,databasePath:z.string(),permittedRoles:z.array(FinancialRole).min(1).max(2),status:z.enum(['Draft','Active','Revoked']),operator:z.string(),at:z.number().int()}).strict();
export type TreasuryConfiguration=z.infer<typeof Configuration>;
/** Verify the immutable operational DB owner, not a request's clinic field. Never creates a DB. */
export function financialDatabaseOwner(path:string){
 // A new ':memory:' connection has no shared tenant state. Production tenant profiles require a durable owned file.
 if(path===':memory:')return null;
 const db=new Database(path,{readonly:true,fileMustExist:true});try{
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='inventory_tenant_binding'").get())return null;
  const owner=db.prepare('SELECT clinic_id FROM inventory_tenant_binding WHERE id=1').get() as {clinic_id:string|null}|undefined;
  if(!owner)throw new Error('Missing immutable inventory owner');return owner.clinic_id;
 }finally{db.close();}
}
/** Host-operator configuration, never exposed as a browser/model mutation capability. */
export class ClinicTreasuries {
 constructor(readonly registry:ClinicRegistry){}
 #operator(operator:string){if(!/^operator:[A-Za-z0-9_.@-]{1,100}$/.test(operator))throw new Error('Explicit host operator attribution required');}
 get(clinicId:string,environment:TreasuryEnvironment){
  z.uuid().parse(clinicId);TreasuryEnvironment.parse(environment);
  const r=this.registry.db.prepare('SELECT v.body_json,v.body_hash FROM clinic_treasury_heads h JOIN clinic_treasury_versions v USING(clinic_id,environment,version) WHERE h.clinic_id=? AND h.environment=?').get(clinicId,environment) as {body_json:string;body_hash:string}|undefined;
  if(!r)throw new OperationsError(403,'CLINIC_TREASURY_UNCONFIGURED');const c=Configuration.parse(JSON.parse(r.body_json));if(digest(c)!==r.body_hash||c.clinicId!==clinicId||c.environment!==environment)throw new Error('Treasury evidence conflict');return c;
 }
 list(clinicId:string){z.uuid().parse(clinicId);return (this.registry.db.prepare('SELECT environment FROM clinic_treasury_heads WHERE clinic_id=? ORDER BY environment').all(clinicId) as {environment:TreasuryEnvironment}[]).map(r=>this.get(clinicId,r.environment));}
 #append(c:TreasuryConfiguration,event:string){
  this.registry.db.prepare('INSERT INTO clinic_treasury_versions VALUES(?,?,?,?,?)').run(c.clinicId,c.environment,c.version,JSON.stringify(c),digest(c));
  this.registry.db.prepare('INSERT INTO clinic_treasury_heads VALUES(?,?,?) ON CONFLICT(clinic_id,environment) DO UPDATE SET version=excluded.version').run(c.clinicId,c.environment,c.version);
  this.registry.audit(c.clinicId,c.operator,event,{environment:c.environment,version:c.version,profileFingerprint:c.profileFingerprint,status:c.status});return c;
 }
 configure(operator:string,clinicId:string,environment:TreasuryEnvironment,profile:SafetyProfile,permittedRoles:FinancialRole[],expectedVersion:number){
  this.#operator(operator);this.registry.clinic(clinicId);TreasuryEnvironment.parse(environment);z.number().int().nonnegative().parse(expectedVersion);
  const sandbox=isSandboxProfile(profile);if(sandbox!==(environment==='local-sandbox')||(!sandbox&&(SafetyProfileSchema.parse(profile).network!==(environment==='near-testnet'?'testnet':'mainnet'))))throw new Error('Explicit treasury environment/profile mismatch');
  const roles=z.array(FinancialRole).min(1).max(2).parse(permittedRoles);if(new Set(roles).size!==roles.length)throw new Error('Duplicate financial role');
  if(financialDatabaseOwner(profile.databasePath)!==clinicId)throw new OperationsError(403,'TREASURY_DATABASE_OWNER_MISMATCH');
  return this.registry.db.transaction(()=>{
   const previous=this.registry.db.prepare('SELECT version FROM clinic_treasury_heads WHERE clinic_id=? AND environment=?').get(clinicId,environment) as {version:number}|undefined;
   if((previous?.version??0)!==expectedVersion)throw new OperationsError(409,'TREASURY_VERSION_CHANGED');
   return this.#append({clinicId,environment,version:expectedVersion+1,network:profile.network,vault:profile.vault,token:profile.token,treasuryOwner:profile.treasury,controller:profile.admin,committer:profile.committer,requester:profile.requester,profileFingerprint:digest(profile),databasePath:profile.databasePath,permittedRoles:roles,status:'Draft',operator,at:this.registry.clock()},previous?'TreasuryUpdated':'TreasuryCreated');
  }).immediate();
 }
 transition(operator:string,clinicId:string,environment:TreasuryEnvironment,expectedVersion:number,status:'Active'|'Revoked',testnet?:TestnetPayments){
  this.#operator(operator);if(!['Active','Revoked'].includes(status))throw new Error('Invalid treasury transition');
  return this.registry.db.transaction(()=>{
   this.registry.clinic(clinicId);const c=this.get(clinicId,environment);if(c.version!==expectedVersion)throw new OperationsError(409,'TREASURY_VERSION_CHANGED');
   // No public activation path exists in this phase, even for a host administrator.
   if(status==='Active'){
    if(c.status!=='Draft')throw new OperationsError(403,'PUBLIC_TREASURY_ACTIVATION_DISABLED');
    if(environment==='near-testnet'&&testnet){assertTestnetPayments(testnet.profile,clinicId,testnet);if(digest(testnet.profile)!==c.profileFingerprint)throw new OperationsError(403,'TREASURY_SCOPE_CONFLICT');}
    else if(environment!=='local-sandbox')throw new OperationsError(403,'PUBLIC_TREASURY_ACTIVATION_DISABLED');
   }
   if(status==='Active')for(const row of this.registry.db.prepare('SELECT clinic_id FROM clinic_treasury_heads WHERE environment=? AND clinic_id<>?').all(environment,clinicId) as {clinic_id:string}[]){const other=this.get(row.clinic_id,environment);if(other.status==='Active'&&other.vault===c.vault)throw new OperationsError(409,'VAULT_ALREADY_ASSIGNED_TO_CLINIC');}
   return this.#append({...c,version:c.version+1,status,operator,at:this.registry.clock()},status==='Active'?(environment==='near-testnet'?'TreasuryActivatedTestnet':'TreasuryActivatedLocal'):'TreasuryRevoked');
  }).immediate();
 }
 assertCurrent(c:TreasuryConfiguration){this.registry.clinic(c.clinicId);const fresh=this.get(c.clinicId,c.environment);if(fresh.version!==c.version||fresh.status!=='Active'||digest(fresh)!==digest(c)||financialDatabaseOwner(c.databasePath)!==c.clinicId)throw new OperationsError(403,'TREASURY_REVOKED_OR_CHANGED');return fresh;}
}

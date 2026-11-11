import {readFileSync} from 'node:fs';
import {ClinicRegistry} from '../tenancy/registry';import {ClinicTreasuries,TreasuryEnvironment,FinancialRole} from '../tenancy/treasury';
import {safetyProfile} from '../near/safety-profile';import {sandboxProfile} from '../sandbox/profile';import {assertNoSigningCredentials} from '../operations/local';
/** Host-only registry administration; no RPC, keys, deployment or onchain role assignment. No HTTP/model registration. */
export function treasuryMain(args=process.argv.slice(2),env=process.env){
 assertNoSigningCredentials(env);
 const [action,registryPath,clinicId,environment,versionText,profilePath,rolesText]=args;
 if(!['inspect','configure','revoke','activate-local'].includes(action)||!registryPath||!clinicId||!environment)throw new Error('Explicit action registryPath clinicId environment [expectedVersion profilePath commaSeparatedRoles] required');
 const e=TreasuryEnvironment.parse(environment),registry=new ClinicRegistry(registryPath);try{
  const treasuries=new ClinicTreasuries(registry);if(action==='inspect')return treasuries.get(clinicId,e);
  const operator=env.CARECART_TREASURY_OPERATOR??'',version=Number(versionText);if(!Number.isSafeInteger(version)||version<0)throw new Error('Expected configuration version required');
  if(action==='configure'){
   if(!profilePath||!rolesText)throw new Error('Owner-reviewed profile and explicit roles required');const raw=JSON.parse(readFileSync(profilePath,'utf8'));const profile=e==='local-sandbox'?sandboxProfile(raw):safetyProfile(raw).profile;
   return treasuries.configure(operator,clinicId,e,profile,rolesText.split(',').map(r=>FinancialRole.parse(r)),version);
  }
  return treasuries.transition(operator,clinicId,e,version,action==='revoke'?'Revoked':'Active');
 }finally{registry.close();}
}
if(require.main===module){try{console.info(JSON.stringify(treasuryMain()));}catch{console.error('Treasury registry command refused configuration; no chain operation performed');process.exitCode=1;}}

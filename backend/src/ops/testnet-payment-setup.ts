import {readFileSync} from 'node:fs';
import {testnetPayments} from '../profiles/testnet-payments';
import {ClinicRegistry} from '../tenancy/registry';import {ClinicTreasuries} from '../tenancy/treasury';
import {openClinicRuntime} from '../tenancy/runtime';import {assertNoSigningCredentials} from '../operations/local';import {SafetyVaultClient} from '../near/safety-client';import {digest} from '../intents/settlement';
/** Host control plane only. No HTTP/model route, custody key, contract mutation or payment. */
export async function setupTestnetPayments(args=process.argv.slice(2),env=process.env){
 assertNoSigningCredentials(env);const [action,registryPath,activationPath,versionText]=args;
 if(!['prepare','activate'].includes(action)||!registryPath||!activationPath)throw new Error('Use prepare|activate REGISTRY ACTIVATION EXPECTED_VERSION');
 const version=Number(versionText);if(!Number.isSafeInteger(version)||version<0||!/^operator:[A-Za-z0-9_.@-]{1,100}$/.test(env.CARECART_TREASURY_OPERATOR??''))throw new Error('Explicit owner operator and expected configuration version required');
 const grant=testnetPayments(JSON.parse(readFileSync(activationPath,'utf8'))),registry=new ClinicRegistry(registryPath);let local:ReturnType<typeof openClinicRuntime>|undefined;
 try{
  const clinic=registry.clinic(grant.clinicId);if(!clinic.syntheticDemo)throw new Error('Current activation is for the explicitly synthetic clinic only');local=openClinicRuntime(clinic,grant);
  const reader=new SafetyVaultClient(grant.profile);await reader.verify();
  const state=await reader.view<{policy:Record<string,string>}>('get_state',{});if(digest(state.policy)!==digest({auto_per_po_limit:'10000000',hard_payout_limit:'25000000',daily_dispatch_limit:'25000000',accepted_deposit_ceiling:'5000000'}))throw new Error('Existing policy must remain unchanged');
  for(const role of ['committer','requester'] as const){const access=await reader.ownerAccessKey(grant.profile[role],role==='committer'?grant.profile.committerPublicKey:grant.profile.requesterPublicKey),p=typeof access.permission==='string'?null:access.permission.FunctionCall;const method=role==='committer'?'commit_purchase_order':'request_payment';if(!p||p.receiver_id!==grant.profile.vault||p.method_names.length!==1||p.method_names[0]!==method||!p.allowance||BigInt(p.allowance)<=0n||BigInt(p.allowance)>BigInt(grant.profile.maxKeyAllowanceYocto))throw new Error('Exact finite native-only role key required');}
  const t=new ClinicTreasuries(registry),operator=env.CARECART_TREASURY_OPERATOR!;
  return action==='prepare'?t.configure(operator,clinic.id,'near-testnet',grant.profile,['committer','requester'],version):t.transition(operator,clinic.id,'near-testnet',version,'Active',grant);
 }finally{local?.close();registry.close();}
}
if(require.main===module)void setupTestnetPayments().then(c=>console.info(JSON.stringify({clinicId:c.clinicId,status:c.status,version:c.version,network:c.network,profileFingerprint:c.profileFingerprint,contractCalls:0}))).catch(()=>{console.error('Testnet registry setup held; inspect exact profile, finite keys and expected version');process.exitCode=1;});

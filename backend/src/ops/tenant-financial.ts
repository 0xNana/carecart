import {testnetPayments} from '../profiles/testnet-payments';
import {openInventoryOperations} from '../inventory/local';
import {SafetyVaultClient} from '../near/safety-client';
import {readFileSync} from 'node:fs';import {join} from 'node:path';import dotenv from 'dotenv';import {z} from 'zod';
import {PROJECT_ROOT} from '../profiles/storage';
import {ClinicRegistry} from '../tenancy/registry';import {ClinicTreasuries,FinancialRole} from '../tenancy/treasury';
import {WalletBindings,walletConfiguration} from '../tenancy/wallet-bindings';import {TenantTreasuryAuthority} from '../tenancy/treasury-authority';
import {sandboxProfile} from '../sandbox/profile';import {SandboxProcurementStore} from '../sandbox/store';import {SandboxVaultClient} from '../sandbox/client';
import {ReplenishmentWorkflow} from '../workflow/cases';import {FinancialAuthorizations,type FinancialBinding} from '../operations/financial-authorizations';import {digest} from '../intents/settlement';
/** Supervised, one-operation worker. Local Sandbox only; no HTTP/model tool, recipient/amount override or automatic retry. */
async function sandboxFinancialMain(args=process.argv.slice(2),env:NodeJS.ProcessEnv=process.env){
 const [action,registryPath,clinicId,environment,profilePath,authorizationId,roleText]=args;
 if(!['execute','observe'].includes(action)||!registryPath||!profilePath||environment!=='local-sandbox'||env.CARECART_TENANT_FINANCIAL_MODE!=='local-sandbox')throw new Error('Explicit local-Sandbox tenant financial operation required; public execution disabled');
 z.uuid().parse(clinicId);z.uuid().parse(authorizationId);const role=FinancialRole.parse(roleText);
 const registry=new ClinicRegistry(registryPath);let store:SandboxProcurementStore|undefined,workflow:ReplenishmentWorkflow|undefined,financial:FinancialAuthorizations|undefined;
 try{
  const config=new ClinicTreasuries(registry).get(clinicId,'local-sandbox');const p=sandboxProfile(JSON.parse(readFileSync(profilePath,'utf8')));
  if(action==='execute'&&digest(p)!==config.profileFingerprint)throw new Error('Exact registry profile required');
  store=new SandboxProcurementStore(p);workflow=new ReplenishmentWorkflow(store);const client=new SandboxVaultClient(store.profile);
  const binding:FinancialBinding={kind:'sandbox-rpc',client,verify:()=>client.verify()};
  const wallets=new WalletBindings(registry,env.CARECART_PUBLIC_ORIGIN??'',walletConfiguration(env));
  const authority=new TenantTreasuryAuthority(registry,wallets,workflow,binding,clinicId,'local-sandbox');financial=new FinancialAuthorizations(workflow,binding,undefined,Date.now,authority);
  const ticket=financial.get(authorizationId);if(ticket.terms.clinicId!==clinicId||ticket.role!==role||!ticket.terms.tenantScope||ticket.terms.profileFingerprint!==digest(p))throw new Error('Exact tenant/role authorization required');
  const result=action==='observe'?await financial.reconcile(authorizationId):await financial.executeSandbox(authorizationId,role,env);
  return {authorizationId:result.id,clinicId,role,state:result.state,publicChainExecution:false};
 }finally{financial?.close();workflow?.close();store?.close();registry.close();}
}
/** Public testnet uses the same scoped treasury authority and no-resend journal as Sandbox. */
export async function tenantFinancialMain(args=process.argv.slice(2),env:NodeJS.ProcessEnv=process.env){
 if(args[3]==='local-sandbox')return sandboxFinancialMain(args,env);
 const [action,registryPath,clinicId,environment,activationPath,authorizationId,roleText]=args;
 if(!['execute','observe'].includes(action)||environment!=='near-testnet'||env.CARECART_TENANT_FINANCIAL_MODE!=='near-testnet'||!registryPath||!activationPath)throw new Error('Explicit scoped testnet mode required; public execution disabled');
 z.uuid().parse(clinicId);z.uuid().parse(authorizationId);const role=FinancialRole.parse(roleText),grant=testnetPayments(JSON.parse(readFileSync(activationPath,'utf8')));
 if(grant.clinicId!==clinicId)throw new Error('Exact activation clinic required');
 const registry=new ClinicRegistry(registryPath);let local:ReturnType<typeof openInventoryOperations>|undefined,financial:FinancialAuthorizations|undefined;
 try{
  const clinic=registry.clinic(clinicId);
  local=openInventoryOperations(clinic.workspace,Date.now,{dataset:'clinic',tenant:{clinicId,storeroomId:'default-storeroom',syntheticDemo:clinic.syntheticDemo},testnet:{profile:grant.profile,suppliers:grant.suppliers},...(action==='execute'?{financialWorker:role}:{})});
  const client=new SafetyVaultClient(local.store.profile),binding:FinancialBinding={kind:'public-rpc',client,verify:()=>client.verify(),testnet:grant};
  const wallets=new WalletBindings(registry,env.CARECART_PUBLIC_ORIGIN??'',walletConfiguration(env));
  const authority=new TenantTreasuryAuthority(registry,wallets,local.workflow,binding,clinicId,'near-testnet');financial=new FinancialAuthorizations(local.workflow,binding,undefined,Date.now,authority);
  const ticket=financial.get(authorizationId);if(ticket.terms.clinicId!==clinicId||ticket.role!==role||!ticket.terms.tenantScope||ticket.terms.profileFingerprint!==digest(grant.profile))throw new Error('Exact tenant/role authorization required');
  const result=action==='observe'?await financial.reconcile(authorizationId):await financial.executeTestnet(authorizationId,role,env);
  return {authorizationId:result.id,clinicId,role,state:result.state,publicChainExecution:action==='execute'};
 }finally{financial?.close();local?.close();registry.close();}
}
if(require.main===module){dotenv.config({path:join(PROJECT_ROOT,'.env')});void tenantFinancialMain().then(r=>console.info(JSON.stringify(r))).catch(()=>{console.error('Tenant financial operation refused or requires reconciliation; never retry blindly');process.exitCode=1;});}

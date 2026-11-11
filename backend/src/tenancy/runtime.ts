import {assertTestnetPayments,type TestnetPayments} from '../profiles/testnet-payments';
import {SafetyVaultClient} from '../near/safety-client';
import {testnetProfile,type TestnetPreparation} from '../profiles/testnet';
import {join} from 'node:path';import {PROJECT_ROOT} from '../profiles/storage';import {z} from 'zod';
import {TenantTreasuryAuthority} from './treasury-authority';
import {WalletBindings} from './wallet-bindings';
import type {ClinicRegistry,IdentitySession} from './registry';
import type {VerifiedIdentity} from './identity';
import type {FinancialBinding} from '../operations/financial-authorizations';
import type {ProviderBinding} from '../operations/runs';
import type {InjectOptions,LightMyRequestResponse} from 'fastify';import {randomBytes,createHash} from 'node:crypto';
import {openInventoryOperations} from '../inventory/local';import {createOperationsApp} from '../operations/api';import type {Clinic} from './registry';
export interface TenantPrincipal {hash:string;userId:string;clinicId:string;clinicRole:string;permissions:string[];expires:number;treasuryIdentity?:{user:VerifiedIdentity;session:IdentitySession}}
export interface InternalRuntimeClient {inject:(options:InjectOptions)=>Promise<LightMyRequestResponse>}
type RuntimeOptions={preparation?:TestnetPreparation;requireTestnet?:boolean;provider?:ProviderBinding};
export function openClinicRuntime(clinic:Clinic,testnet?:TestnetPayments,options:RuntimeOptions={}){
 if(testnet)assertTestnetPayments(testnet.profile,clinic.id,testnet);
 if(options.requireTestnet&&!testnet&&!options.preparation)throw new Error('Explicit clinic testnet profile required; no mainnet or fixture fallback');
 const prepared=options.preparation?{...options.preparation,profile:testnetProfile({...options.preparation.profile,databasePath:join(PROJECT_ROOT,'backend/data/testnet-v2/clinics',z.uuid().parse(clinic.id),'state.sqlite')}).profile}:undefined;
 const selected=testnet??prepared;
 return openInventoryOperations(clinic.workspace,Date.now,{dataset:'clinic',tenant:{clinicId:clinic.id,storeroomId:'default-storeroom',syntheticDemo:clinic.syntheticDemo},...(selected?{testnet:{profile:selected.profile,suppliers:selected.suppliers}}:{})});
}
export function principalHash(sessionHash:string,clinicId:string,role:string){return createHash('sha256').update(JSON.stringify([sessionHash,clinicId,role])).digest('hex');}
/** Child apps are never socket-bound; verified identities enter only through a server-owned, one-request in-process capability. */
export class ClinicRuntimePool {
 constructor(readonly finance?:{registry:ClinicRegistry;wallets:WalletBindings;testnet:TestnetPayments},readonly options:RuntimeOptions={}){}
 readonly entries=new Map<string,{local:ReturnType<typeof openClinicRuntime>;app:ReturnType<typeof createOperationsApp>;active:number;seen:number;contexts:Map<string,TenantPrincipal>}>();
 async withClinic<T>(clinic:Clinic,principal:TenantPrincipal,run:(app:InternalRuntimeClient)=>Promise<T>):Promise<T>{
  let entry=this.entries.get(clinic.id);
  if(!entry){
   if(this.entries.size>=32){const idle=[...this.entries.entries()].filter(([,e])=>!e.active).sort((a,b)=>a[1].seen-b[1].seen)[0];if(!idle)throw new Error('Clinic runtime capacity reached');this.entries.delete(idle[0]);await idle[1].app.close();}
   entry=this.entries.get(clinic.id);
   if(!entry){const activation=this.finance?.testnet.clinicId===clinic.id?this.finance.testnet:undefined;const local=openClinicRuntime(clinic,activation,this.options);const contexts=new Map<string,TenantPrincipal>();try{let financial:FinancialBinding|undefined,authority:TenantTreasuryAuthority|undefined;
    if(activation&&this.finance){const client=new SafetyVaultClient(local.store.profile);financial={kind:'public-rpc',client,verify:()=>client.verify(),testnet:activation};authority=new TenantTreasuryAuthority(this.finance.registry,this.finance.wallets,local.workflow,financial,clinic.id,'near-testnet');}
    const app=createOperationsApp({financial,treasuryAuthority:authority,provider:this.options.provider,treasuryApproval:(request,walletBindingId)=>{const key=request.headers['x-carecart-internal-request'];const who=typeof key==='string'?contexts.get(key):undefined;if(!who?.treasuryIdentity)throw new Error('Verified treasury identity required');return {...who.treasuryIdentity,walletBindingId};},workflow:local.workflow,inventory:local.inventory,origin:'http://127.0.0.1:3002',operatorCredential:randomBytes(32).toString('hex'),identitySession:request=>{const key=request.headers['x-carecart-internal-request'];const p=typeof key==='string'?contexts.get(key):undefined;if(!p||p.clinicId!==clinic.id)throw new Error('Verified clinic principal required');return p;}});app.addHook('onClose',async()=>local.close());entry={local,app,active:0,seen:Date.now(),contexts};this.entries.set(clinic.id,entry);}catch(e){local.close();throw e;}}
  }
  entry.active++;entry.seen=Date.now();const capability=randomBytes(32).toString('hex');entry.contexts.set(capability,principal);try{await entry.app.ready();return await run({inject:options=>entry!.app.inject({...options,headers:{...options.headers,'x-carecart-internal-request':capability}})});}finally{entry.contexts.delete(capability);entry.active--;}
 }
 async close(){for(const e of this.entries.values())await e.app.close();this.entries.clear();}
}

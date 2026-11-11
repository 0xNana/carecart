/** OFFLINE TEST FIXTURE ONLY. Real SQLite/P1-P2/auth services and NEP-413 crypto; chain reads/effects are MOCKED. No public signer or RPC. */
import {mkdtempSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';import {join,dirname} from 'node:path';import {tmpdir} from 'node:os';import {randomUUID} from 'node:crypto';
import {Account,JsonRpcProvider,KeyPair} from 'near-api-js';import {signMessage} from 'near-api-js/nep413';
import {PROJECT_ROOT} from '../src/profiles/storage';import {ClinicRegistry} from '../src/tenancy/registry';import {WalletBindings} from '../src/tenancy/wallet-bindings';
import {ClinicTreasuries} from '../src/tenancy/treasury';import {TenantTreasuryAuthority} from '../src/tenancy/treasury-authority';import {principalHash} from '../src/tenancy/runtime';
import {sandboxProfile} from '../src/sandbox/profile';import {SandboxProcurementStore} from '../src/sandbox/store';import {SandboxVaultClient} from '../src/sandbox/client';
import {ReplenishmentWorkflow} from '../src/workflow/cases';import {OperationJournal} from '../src/near/operation-journal';import {FinancialAuthorizations,type FinancialBinding} from '../src/operations/financial-authorizations';import {InventoryLedger,gloves} from '../src/inventory/ledger';import {digest} from '../src/intents/settlement';import {assertTenantExecution} from '../src/tenancy/treasury-authority';
import type {VerifiedIdentity} from '../src/tenancy/identity';import type {IdentitySession,Clinic} from '../src/tenancy/registry';import type {SandboxProfile} from '../src/sandbox/profile';
export interface TreasuryFixtureState {dir:string;registryPath:string;user:VerifiedIdentity;session:IdentitySession;clinic:Clinic;walletId:string;profile:SandboxProfile;committerKey:string;requesterKey:string}

export async function treasuryFixture(shared?:ClinicRegistry,saved?:TreasuryFixtureState){
 const dir=saved?.dir??mkdtempSync(join(tmpdir(),'carecart-treasury-'));const registry=shared??new ClinicRegistry(saved?.registryPath??join(dir,'registry.sqlite'));
 const user=saved?.user??{userId:randomUUID(),sessionId:randomUUID(),email:randomUUID()+'@example.invalid',expires:Date.now()+3600000};
 const clinic=saved?.clinic??registry.createClinic(user,{name:'Synthetic treasury clinic',country:'GH',timezone:'UTC',storeroom:'Main',syntheticDemo:false});
 const session=saved?.session??registry.session(user,registry.createSession(user).token),key=KeyPair.fromRandom('ed25519'),committer=saved?KeyPair.fromString(saved.committerKey as `ed25519:${string}`):KeyPair.fromRandom('ed25519'),requester=saved?KeyPair.fromString(saved.requesterKey as `ed25519:${string}`):KeyPair.fromRandom('ed25519');
 const provider=new JsonRpcProvider({url:'https://test.rpc.fastnear.com'});provider.viewNodeStatus=async()=>({chain_id:'testnet'}) as never;provider.viewAccessKey=async()=>({permission:'FullAccess',nonce:0n}) as never;
 const wallets=new WalletBindings(registry,'https://carecart.example',{network:'testnet',rpcUrl:'https://test.rpc.fastnear.com'},provider);
 const admin=saved?.profile.admin??'admin-'+clinic.id.slice(0,8)+'.testnet';
 const wallet=saved?wallets.get(user,clinic.id,saved.walletId):await (async()=>{const challenge=wallets.challenge(user,session,clinic.id,{accountId:admin,network:'testnet'});
 const signed=await signMessage({signerAccount:new Account(admin,provider,key.toString()),payload:{...challenge.payload,nonce:new Uint8Array(Buffer.from(challenge.payload.nonce,'base64'))}});
 return wallets.verify(user,session,clinic.id,{challengeId:challenge.id,accountId:admin,publicKey:key.getPublicKey().toString(),signature:Buffer.from(signed.signature).toString('base64')},work=>work());})();
 const p=sandboxProfile(saved?.profile??{version:2,environment:'sandbox',network:'testnet',chainId:'local-fixture-chain',genesisHash:'1'.repeat(44),rpcUrl:'http://127.0.0.1:39999',vault:'vault-'+clinic.id.slice(0,8)+'.testnet',token:'token.testnet',decimals:6,tokenSymbol:'CCUSD',admin,guardian:'guardian.testnet',treasury:'treasury.testnet',committer:'committer.testnet',requester:'requester.testnet',committerPublicKey:committer.getPublicKey().toString(),requesterPublicKey:requester.getPublicKey().toString(),maxKeyAllowanceYocto:'10000000000000000000000',codeHash:'1'.repeat(44),databasePath:join(PROJECT_ROOT,'backend/data/sandbox-v2','tenant-fixture-'+clinic.id,'state.sqlite')});
 mkdirSync(dirname(p.databasePath),{recursive:true});
 const inventory=new InventoryLedger(p.databasePath,digest(p),[{...gloves,clinicId:clinic.id}],Date.now,undefined,{clinicId:clinic.id,storeroomId:'main-storeroom',syntheticDemo:false});
 const store=new SandboxProcurementStore(p),workflow=new ReplenishmentWorkflow(store);
 workflow.open({caseId:'sb-case-'+clinic.id.slice(0,8),idempotencyKey:'sb-case-key',eventId:'sb-event',itemId:'sb-item-1'});
 const c=workflow.prepare('sb-case-'+clinic.id.slice(0,8));
 store.db.exec('CREATE TABLE IF NOT EXISTS tenant_fixture_chain(po_id TEXT PRIMARY KEY,order_json TEXT NOT NULL,payment_json TEXT NOT NULL)');
 const faults={wrongWalletKey:false,wrongRole:false,wrongNetwork:false,wrongToken:false,interrupted:false,paused:false};let effects=0;
 const client=new SandboxVaultClient(store.profile);
 client.rpc.viewAccessKey=async()=>({permission:faults.wrongWalletKey?{FunctionCall:{receiver_id:p.vault,method_names:[],allowance:'1'}}:'FullAccess',nonce:0n}) as never;
 // Deliberately replaced test transport. Never interpret these reads as genuine Sandbox receipts.
 client.verify=async()=>{if(faults.wrongNetwork||faults.wrongToken)throw new Error('Offline network/token mismatch');};
 client.view=async(method,args)=>{
  if(method==='get_state')return {profile:'testnet',admin:p.admin,guardian:p.guardian,treasury:p.treasury,token:p.token,paused:faults.paused,policy:{auto_per_po_limit:'10000000',hard_payout_limit:'25000000',daily_dispatch_limit:'25000000',accepted_deposit_ceiling:'5000000'},spendable:'5000000',usage:{spent:'0',reserved:'0'}} as never;
  if(method==='get_roles')return {supplier:args.account===store.supplier,committer:!faults.wrongRole&&args.account===p.committer,requester:args.account===p.requester} as never;
  const row=store.db.prepare('SELECT order_json,payment_json FROM tenant_fixture_chain WHERE po_id=?').get(String(args.po_id)) as {order_json:string;payment_json:string}|undefined;
  if(method==='get_purchase_order')return (row?JSON.parse(row.order_json):null) as never;if(method==='get_payment')return (row?JSON.parse(row.payment_json):null) as never;throw new Error('Offline method unsupported');
 };
 client.canonicalOrder=async(poId)=>{await client.verify();const order=await client.view('get_purchase_order',{po_id:poId});if(!order)throw new Error('Offline PO uncommitted');return order as ReturnType<typeof store.resolve>['canonical'];};
 const binding:FinancialBinding={kind:'sandbox-rpc',client,verify:()=>client.verify()};
 // Exercise workflow.act and the real durable journal. This stand-in has ZERO signing or submission code.
 store.executeSandboxRole=async(role,poId,_environment,permit)=>{
  const order=store.resolve(poId).canonical;assertTenantExecution(p.databasePath,role,poId,permit,digest(order));
  const method=role==='committer'?'commit_purchase_order':'request_payment';const payload={method,args:role==='committer'?{order}:{po_id:poId}};const journal=new OperationJournal(p.databasePath,store.fingerprint,permit);
  try{journal.rememberOrder(order);journal.begin(method+':'+poId,payload);if(process.env.CARECART_TENANT_FIXTURE_PAUSE==='before-effect'){writeFileSync(process.env.CARECART_TENANT_FIXTURE_SIGNAL!,'before-effect');await new Promise(()=>{});}effects++;
   store.db.prepare('INSERT INTO tenant_fixture_chain VALUES(?,?,?) ON CONFLICT(po_id) DO UPDATE SET payment_json=excluded.payment_json').run(poId,JSON.stringify(order),JSON.stringify({status:role==='committer'?'Committed':'Dispatching',reason:'None',attempt_id:'',reserved_day:0}));
   if(process.env.CARECART_TENANT_FIXTURE_PAUSE==='after-effect'){writeFileSync(process.env.CARECART_TENANT_FIXTURE_SIGNAL!,'after-effect');await new Promise(()=>{});}
   if(faults.interrupted)throw new Error('Offline effect happened before process interruption');journal.confirm(method+':'+poId,payload,{transactionHash:null,reconciled:false});
  }catch(e){journal.ambiguous(method+':'+poId);throw e;}finally{journal.close();}
 };
 const treasuries=new ClinicTreasuries(registry);const active=saved?treasuries.get(clinic.id,'local-sandbox'):(()=>{const draft=treasuries.configure('operator:test',clinic.id,'local-sandbox',store.profile,['committer','requester'],0);return treasuries.transition('operator:test',clinic.id,'local-sandbox',draft.version,'Active');})();
 const authority=new TenantTreasuryAuthority(registry,wallets,workflow,binding,clinic.id,'local-sandbox');
 const finance=()=>new FinancialAuthorizations(workflow,binding,undefined,Date.now,authority);const approval={user,session,walletBindingId:wallet.id};const actor=principalHash(session.hash,clinic.id,'Clinic Admin');
 const input=(role:'committer'|'requester'='committer')=>{const current=workflow.get(c.caseId);return {requestId:randomUUID(),role,expectedRevision:current.version,expectedHash:current.poHash!,walletBindingId:wallet.id};};
 const env=(role:'committer'|'requester')=>({CARECART_SAFETY_WRITES:'approved',CARECART_SANDBOX_WRITES:'approved',[role==='committer'?'SAFETY_COMMITTER_PRIVATE_KEY':'SAFETY_REQUESTER_PRIVATE_KEY']:role==='committer'?committer.toString():requester.toString()});
 return {registry,clinic,user,session,wallet,wallets,store,workflow,inventory,c,p:store.profile,treasuries,active,authority,finance,approval,actor,input,env,faults,effects:()=>effects,serialize:():TreasuryFixtureState=>({dir,registryPath:registry.path,user,session,clinic,walletId:wallet.id,profile:store.profile,committerKey:committer.toString(),requesterKey:requester.toString()}),close(cleanup=true){inventory.close();workflow.close();store.close();if(!shared)registry.close();if(cleanup){rmSync(dirname(p.databasePath),{recursive:true,force:true});rmSync(dir,{recursive:true,force:true});}}};
}

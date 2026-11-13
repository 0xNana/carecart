import {Account,JsonRpcProvider,KeyPair,type KeyPairString} from 'near-api-js';import {randomBytes,randomUUID} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';import {writeFileSync,mkdirSync,rmSync,readFileSync} from 'node:fs';import {join} from 'node:path';import {createServer} from 'node:net';
import {PROJECT_ROOT} from '../src/profiles/storage';import {sandboxProfile} from '../src/sandbox/profile';import {SandboxProcurementStore} from '../src/sandbox/store';import {SandboxVaultClient} from '../src/sandbox/client';
import {ReplenishmentWorkflow} from '../src/workflow/cases';import {observeVault} from '../src/workflow/capabilities';
import {OperatorClient} from '../../web/src/lib/operator-client';import {V2WalletController} from '../../web/src/lib/v2-wallet';
/** This API-only fixture must not replace its operations cookie with the app-path refresh. */
export function operationsCookie(headers:Headers,previous=''){
 const set=headers.getSetCookie().find(value=>value.startsWith('carecart_ops='));
 return set?set.split(';')[0]:previous;
}
async function freePort(){const server=createServer();await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const port=(server.address() as {port:number}).port;await new Promise<void>(resolve=>server.close(()=>resolve()));return port;}
async function main(){let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>16000)throw new Error('Sandbox setup too large');}
 const setup=JSON.parse(input) as {rpcUrl:string;rootKey:string};const endpoint=new URL(setup.rpcUrl);if(endpoint.hostname!=='127.0.0.1'||endpoint.protocol!=='http:')throw new Error('Local Sandbox only');
 const provider=new JsonRpcProvider({url:setup.rpcUrl});const status=await provider.viewNodeStatus();if(['mainnet','testnet'].includes(status.chain_id))throw new Error('Public network forbidden');
 const keys={committer:KeyPair.fromRandom('ed25519'),requester:KeyPair.fromRandom('ed25519')};
 const directory=join(PROJECT_ROOT,'backend/data/sandbox-v2','combined-'+randomUUID());mkdirSync(directory,{recursive:true});
 const p=sandboxProfile({version:2,environment:'sandbox',network:'testnet',chainId:status.chain_id,genesisHash:status.genesis_hash,rpcUrl:setup.rpcUrl,
  vault:'vault.testnet',token:'token.testnet',decimals:6,tokenSymbol:'CCUSD',admin:'admin.testnet',guardian:'guardian.testnet',treasury:'treasury.testnet',committer:'committer.testnet',requester:'agent.testnet',
  // Sandbox charges ~0.121 test NEAR at 120 Tgas. This finite local-only gas
  // allowance does not change the public profile or installed operational keys.
  committerPublicKey:keys.committer.getPublicKey().toString(),requesterPublicKey:keys.requester.getPublicKey().toString(),maxKeyAllowanceYocto:'200000000000000000000000',
  codeHash:(await provider.viewAccount({accountId:'vault.testnet',blockQuery:{finality:'final'}})).code_hash,databasePath:join(directory,'state.sqlite')});
 const client=new SandboxVaultClient(p);await client.verify();
 for(const role of ['committer','requester'] as const){const outcome=await new Account(p[role],provider,setup.rootKey as KeyPairString).addFunctionCallAccessKey({
  publicKey:keys[role].getPublicKey().toString(),contractId:p.vault,methodNames:role==='committer'?['commit_purchase_order','commit_quote']:['request_payment','request_crosschain'],allowance:BigInt(p.maxKeyAllowanceYocto)});
  await provider.viewTransactionStatusWithReceipts({txHash:outcome.transaction.hash,accountId:p[role],waitUntil:'FINAL'});
 }
 const profileFile=join(directory,'profile.json');writeFileSync(profileFile,JSON.stringify(p),{mode:0o600});
 let store=new SandboxProcurementStore(p),workflow=new ReplenishmentWorkflow(store);const caseId='sb-combined-case';
 let api:ReturnType<typeof spawn>|undefined;
 const baseEnv={PATH:process.env.PATH??'/usr/bin:/bin',HOME:process.env.HOME??'/tmp',TSX_DISABLE_CACHE:'1'};
 const run=(entry:string,args:string[],env:NodeJS.ProcessEnv,stdin?:string)=>{const result=spawnSync(process.execPath,['--import','tsx',entry,...args],{cwd:join(PROJECT_ROOT,'backend'),env:{...baseEnv,...env},input:stdin,encoding:'utf8',timeout:60000});
  if(result.status!==0)throw new Error('Isolated '+entry+' failed: '+result.stderr.slice(0,800));return JSON.parse(result.stdout.trim().split('\n').at(-1)!);};
 try{
  const opened=workflow.ingest({caseId,eventId:'sb-inventory-event',idempotencyKey:'sb-inventory-event',itemId:'sb-item-1'});if(!opened.poId?.startsWith('sb-po-'))throw new Error('Sandbox namespace lost');
  const commandEnv={CARECART_SAFETY_WRITES:'approved',CARECART_SANDBOX_WRITES:'approved'};
  const port=await freePort();const origin='http://127.0.0.1:3999';const credential=randomBytes(32).toString('hex');
  api=spawn(process.execPath,['--import','tsx','src/sandbox/server.ts',profileFile],{cwd:join(PROJECT_ROOT,'backend'),env:{...baseEnv,CARECART_OPERATIONS_MODE:'local-sandbox',CARECART_OPERATIONS_ORIGIN:origin,CARECART_OPERATIONS_PORT:String(port),CARECART_OPERATIONS_OPERATOR_SECRET:credential},stdio:['ignore','pipe','pipe']});
  let stderr='';api.stderr!.on('data',d=>{stderr+=d.toString().slice(0,500);});
  let cookie='';const transport:typeof fetch=async(input,init)=>{const headers=new Headers(init?.headers);headers.set('origin',origin);if(cookie)headers.set('cookie',cookie);
   const response=await fetch(new URL(String(input),'http://127.0.0.1:'+port),{...init,headers});cookie=operationsCookie(response.headers,cookie);return response;};
  const operator=new OperatorClient(transport);
  for(let n=0;;n++){try{await operator.login(credential);break;}catch{if(n>100||api.exitCode!==null)throw new Error('Sandbox API start failed: '+stderr);await new Promise(resolve=>setTimeout(resolve,100));}}
  const session=await operator.session();if(session.walletProfile?.network!=='sandbox')throw new Error('Sandbox mislabeled as public testnet');
  const authorizations:string[]=[];
  for(const role of ['committer','requester'] as const){
   const assessment=await operator.financialReview(caseId);
   const approved=await operator.authorizeFinancial(caseId,role,assessment.revision,assessment.canonicalHash);
   const id=approved.authorization.id;authorizations.push(id);
   run('src/sandbox/authorized-worker.ts',[profileFile,role,id],{...commandEnv,...(role==='committer'?{SAFETY_COMMITTER_PRIVATE_KEY:keys.committer.toString()}:{SAFETY_REQUESTER_PRIVATE_KEY:keys.requester.toString()})});
   if(workflow.get(caseId).state!==(role==='committer'?'CommitmentPending':'PaymentRequestPending'))throw new Error('Submission incorrectly advanced financial observation');
   await operator.reconcileFinancial(id);
  }
  let duplicateBlocked=false;
  try{run('src/sandbox/authorized-worker.ts',[profileFile,'requester',authorizations[1]],{...commandEnv,SAFETY_REQUESTER_PRIVATE_KEY:keys.requester.toString()});}catch{duplicateBlocked=true;}
  if(!duplicateBlocked||workflow.get(caseId).state!=='AwaitingHumanApproval')throw new Error('Role authorization replay or human policy boundary failed');
  const review=await operator.prepareWalletReview(caseId,'approve',workflow.get(caseId).version);const controller=new V2WalletController(session.walletProfile);
  const result=await controller.submit(review,{execution:'sandbox-wallet',getNetwork:async()=>'sandbox',getAccounts:async()=>[{accountId:p.admin}],signAndSendTransaction:async()=>
   run('src/sandbox/wallet.ts',[profileFile,'--human-confirmed'],{SANDBOX_ADMIN_PRIVATE_KEY:setup.rootKey},JSON.stringify({terms:review.terms,termsHash:review.termsHash}))},operator,true);
  if(result.transactionVerified||workflow.get(caseId).state!=='AwaitingHumanApproval')throw new Error('Submission fabricated financial success');
  const reconciled=await operator.reconcileWallet(review.id);if(!reconciled.transactionVerified||!reconciled.transactionEvidence?.transferConfirmed)throw new Error('Final transaction/receipt attribution missing');
  const after=workflow.get(caseId);if(after.state!=='SameChainConfirmed'||after.evidenceKind!=='sandbox-rpc')throw new Error('Wrong Sandbox financial provenance');
  const supplierBalance=await provider.callFunction<string>({contractId:p.token,method:'ft_balance_of',args:{account_id:'supplier.testnet'},blockQuery:{finality:'final'}});
  if(supplierBalance!==after.domain!.purchaseOrder.canonical.amount)throw new Error('Sandbox FT balance mismatch');
  workflow.close();store.close();store=new SandboxProcurementStore(p);workflow=new ReplenishmentWorkflow(store);
  if(workflow.get(caseId).poHash!==after.poHash||workflow.get(caseId).state!=='SameChainConfirmed')throw new Error('Durable Sandbox restart failed');
  const report={status:'passed',execution:'genuine-local-sandbox',publicChainExecution:false,modelInference:false,caseId,poId:after.poId,poHash:after.poHash,
   token:p.token,tokenSymbol:'CCUSD',amountAtomic:after.domain!.purchaseOrder.canonical.amount,supplierBalance,transactionHash:reconciled.transactionHash,receiptEvidence:reconciled.transactionEvidence,
   operations:after.domain!.operations,applicationAuthorizations:authorizations,restrictedDuplicatePrevented:duplicateBlocked,mainnetRecordsReused:false,roleProcessesSeparated:true,browserRuntimeVerified:false};
  mkdirSync('/tmp/carecart-closeout',{recursive:true});
  writeFileSync('/tmp/carecart-closeout/combined-sandbox-evidence.json',JSON.stringify(report,null,2));console.info(JSON.stringify(report));
 }finally{if(api&&api.exitCode===null){api.kill('SIGTERM');await new Promise<void>(resolve=>api!.once('exit',()=>resolve()));}workflow.close();store.close();rmSync(directory,{recursive:true,force:true});}
}
if(require.main===module)void main().catch(e=>{console.error('Combined Sandbox verification failed: '+String((e as Error).message).slice(0,1000));process.exitCode=1;});

import {assertTenantExecution,type TenantExecutionPermit} from '../tenancy/treasury-authority';
import {Account,KeyPair,type KeyPairString} from 'near-api-js';import {readFileSync} from 'node:fs';
import {SandboxProcurementStore} from './store';import {SandboxVaultClient} from './client';import {sandboxProfile} from './profile';
import {OperationJournal} from '../near/operation-journal';import {roleCredentials} from '../ops/role-credentials';import {digest} from '../intents/settlement';
import {ReplenishmentWorkflow} from '../workflow/cases';
/** Dedicated one-role process, exact real loopback FC-key checks, and P0's durable no-resend journal. */
export async function executeSandboxRole(store:SandboxProcurementStore,role:'committer'|'requester',poId:string,env:NodeJS.ProcessEnv,tenantPermit?:TenantExecutionPermit){
 assertTenantExecution(store.profile.databasePath,role,poId,tenantPermit,digest(store.resolve(poId).canonical));
 if(env.CARECART_SANDBOX_WRITES!=='approved')throw new Error('Explicit isolated Sandbox write authorization required');
 const creds=roleCredentials(role,env);const secret=role==='committer'?creds.committer!:creds.requester!;const p=store.profile;const client=new SandboxVaultClient(p);await client.verify();
 const methods=role==='committer'?['commit_purchase_order','commit_quote']:['request_payment','request_crosschain'];
 const publicKey=KeyPair.fromString(secret as KeyPairString).getPublicKey().toString();if(publicKey!==(role==='committer'?p.committerPublicKey:p.requesterPublicKey))throw new Error('Sandbox role key mismatch');
 const access=await client.rpc.viewAccessKey({accountId:p[role],publicKey,finalityQuery:{finality:'final'}});
 const fc=typeof access.permission==='string'?null:access.permission.FunctionCall;
 if(!fc||fc.receiver_id!==p.vault||fc.method_names.length!==methods.length||new Set(fc.method_names).size!==methods.length||methods.some(m=>!fc.method_names.includes(m))||
  !fc.allowance||BigInt(fc.allowance)<=0n||BigInt(fc.allowance)>BigInt(p.maxKeyAllowanceYocto))throw new Error('Restricted Sandbox function-call key required');
 const membership=await client.view<{committer:boolean;requester:boolean}>('get_roles',{account:p[role]});if(!membership[role]||membership[role==='committer'?'requester':'committer'])throw new Error('Sandbox role membership mismatch');
 const canonical=store.resolve(poId).canonical;const method=role==='committer'?'commit_purchase_order':'request_payment';
 if(role==='requester'&&digest(await client.canonicalOrder(poId))!==digest(canonical))throw new Error('Independent Sandbox commitment required');
 const args=role==='committer'?{order:canonical}:{po_id:poId};const payload={method,args};const op=method+':'+poId;
 const journal=new OperationJournal(p.databasePath,store.fingerprint,tenantPermit);
 try{journal.rememberOrder(canonical);if(journal.begin(op,payload))return;
  try{const result=await new Account(p[role],client.rpc,secret as KeyPairString).callFunctionRaw({contractId:p.vault,methodName:method,args,deposit:0n,gas:120_000_000_000_000n,waitUntil:'FINAL'});
   if(typeof result.status!=='object'||'Failure' in result.status||result.receipts_outcome.some(r=>typeof r.outcome.status!=='object'||'Failure' in r.outcome.status))throw new Error('Sandbox receipt failure');
   if(digest(await client.canonicalOrder(poId))!==digest(canonical))throw new Error('Sandbox commitment confirmation mismatch');
   journal.confirm(op,payload,{transactionHash:result.transaction.hash,reconciled:false});
  }catch(error){journal.ambiguous(op);console.error('Sandbox send diagnostic: '+redact(error));throw new Error('Sandbox operation ambiguous; no resend authorized');}
 }finally{journal.close();}
}
async function main(){const [profilePath,role,caseId]=process.argv.slice(2);if(!profilePath||!['committer','requester'].includes(role)||!caseId)throw new Error('Sandbox role CLI arguments required');
 const store=new SandboxProcurementStore(sandboxProfile(JSON.parse(readFileSync(profilePath,'utf8'))));const workflow=new ReplenishmentWorkflow(store);
 try{const c=workflow.get(caseId);const after=await workflow.act({caseId,role,expectedVersion:c.version,expectedHash:c.poHash},process.env);console.info(JSON.stringify({caseId:after.caseId,state:after.state,execution:'sandbox',publicChainExecution:false}));}
 finally{workflow.close();store.close();}
}
function redact(error:unknown){let text=error instanceof Error?error.message:String(error);for(const name of ['SAFETY_COMMITTER_PRIVATE_KEY','SAFETY_REQUESTER_PRIVATE_KEY']){const key=process.env[name];if(key)text=text.replaceAll(key,'[redacted]');}return text.replace(/ed25519:[1-9A-HJ-NP-Za-km-z]{80,}/g,'[redacted]').slice(0,500);}
if(require.main===module)void main().catch(error=>{console.error('Isolated Sandbox worker failed; inspect journal before retry: '+redact(error));process.exitCode=1;});

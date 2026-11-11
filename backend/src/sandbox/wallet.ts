import {financialDatabaseOwner} from '../tenancy/treasury';
import {readFileSync} from 'node:fs';import {Account,type KeyPairString} from 'near-api-js';import {z} from 'zod';
import {sandboxProfile} from './profile';import {SandboxVaultClient} from './client';import {paymentReview} from '../near/human-review';import {digest} from '../intents/settlement';
/** Standalone test-wallet process. It cannot connect to public RPC or receive worker credentials. */
async function main(){
 if(process.argv[3]!=='--human-confirmed'||!process.env.SANDBOX_ADMIN_PRIVATE_KEY||process.env.SAFETY_COMMITTER_PRIVATE_KEY||process.env.SAFETY_REQUESTER_PRIVATE_KEY)throw new Error('Explicit isolated human-wallet boundary required');
 const p=sandboxProfile(JSON.parse(readFileSync(process.argv[2],'utf8')));if(financialDatabaseOwner(p.databasePath))throw new Error('Tenant human-wallet execution remains disabled');const client=new SandboxVaultClient(p);await client.verify();
 let text='';for await(const chunk of process.stdin){text+=chunk;if(text.length>16000)throw new Error('Wallet request too large');}
 const request=z.object({termsHash:z.string().regex(/^[a-f0-9]{64}$/),terms:z.unknown()}).strict().parse(JSON.parse(text));
 const proposed=request.terms as Awaited<ReturnType<typeof paymentReview>>;
 if(digest(proposed)!==request.termsHash||proposed.transaction.network!=='sandbox'||proposed.order.destination!=='Near')throw new Error('Exact Sandbox human review required');
 const canonical=await client.canonicalOrder(proposed.order.po_id);const fresh=await paymentReview(client,canonical,proposed.action);
 if(digest(fresh)!==request.termsHash)throw new Error('Sandbox wallet review changed');
 const call=fresh.transaction.actions[0].params;
 const result=await new Account(p.admin,client.rpc,process.env.SANDBOX_ADMIN_PRIVATE_KEY as KeyPairString).callFunctionRaw({contractId:p.vault,methodName:call.methodName,args:call.args,
  gas:BigInt(call.gas),deposit:1n,waitUntil:'FINAL'});
 console.info(JSON.stringify({transactionHash:result.transaction.hash,execution:'sandbox',publicChainExecution:false}));
}
if(require.main===module)void main().catch(()=>{console.error('Sandbox wallet failed; reconcile before any further signature');process.exitCode=1;});

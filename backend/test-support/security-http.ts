/** P3C disposable HTTP fixture. No production entrypoint imports this module. */
import {Account} from 'near-api-js';
import {createServer} from '../src/server';
import {openDatabase,loadDomainRecords} from '../src/db';
import {seedSyntheticData} from '../src/seed';
import {VaultPaymentAdapter} from '../src/payments/adapter';
import {openLocalOperations} from '../src/operations/local';
import {createOperationsApp} from '../src/operations/api';

async function main(){
 const counts={adapter:0,signing:0,externalSubmission:0};
 VaultPaymentAdapter.prototype.requestPayment=async()=>{counts.adapter++;throw new Error('ADAPTER_FORBIDDEN');};
 Account.prototype.callFunctionRaw=async()=>{counts.signing++;throw new Error('SIGNING_FORBIDDEN');};
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async(input,init)=>{
  const url=new URL(typeof input==='object'&&'url' in input?input.url:String(input));
  if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)){counts.externalSubmission++;throw new Error('EXTERNAL_NETWORK_FORBIDDEN');}
  return originalFetch(input,init);
 };
 const database=openDatabase(':memory:');seedSyntheticData(database);
 const snapshot=()=>JSON.stringify(loadDomainRecords(database),(_key,value)=>typeof value==='bigint'?value.toString():value);
 const initial=snapshot();
 const demo=createServer({database});
 const local=openLocalOperations(process.env.CARECART_P3C_WORKSPACE!);
 const operations=createOperationsApp({workflow:local.workflow,origin:process.env.CARECART_OPERATIONS_ORIGIN!,
  operatorCredential:process.env.CARECART_OPERATIONS_OPERATOR_SECRET!,viewerCredential:process.env.CARECART_OPERATIONS_VIEWER_SECRET});
 demo.get('/__p3c-evidence',async()=>({...counts,syntheticDemoUnchanged:snapshot()===initial,
  operationalCases:local.workflow.list().length}));
 let closing=false;
 const close=async()=>{if(closing)return;closing=true;await operations.close();await demo.close();local.close();database.close();};
 process.once('SIGTERM',()=>void close());process.once('SIGINT',()=>void close());
 await demo.listen({host:'127.0.0.1',port:Number(process.env.CARECART_P3C_LEGACY_PORT)});
 await operations.listen({host:'127.0.0.1',port:Number(process.env.CARECART_OPERATIONS_PORT)});
}
if(require.main===module)void main().catch(error=>{
 let message=error instanceof Error?error.message:'Unknown failure';
 for(const name of ['CARECART_OPERATIONS_OPERATOR_SECRET','CARECART_OPERATIONS_VIEWER_SECRET']){
  const value=process.env[name];if(value)message=message.replaceAll(value,'[redacted]');
 }
 console.error('Isolated P3C fixture failed: '+message.slice(0,500));process.exitCode=1;
});

import {openLocalOperations,assertNoSigningCredentials} from '../operations/local';
import {MockWalletLedger} from '../operations/mock-wallet-ledger';
import {createOperationsApp} from '../operations/api';
/** Explicitly isolated MOCK wallet workspace. No dotenv, provider inference, keys, RPC or real wallet. */
async function main(){
 assertNoSigningCredentials(process.env);
 if(process.env.CARECART_OPERATIONS_MODE!=='local-synthetic'||process.env.CARECART_OPERATIONS_WALLET_MODE!=='isolated-mock')throw new Error('Explicit isolated mock mode required');
 const local=openLocalOperations('wallet-workspace');const ledger=new MockWalletLedger(local.workflow);
 try{
  if(process.argv.includes('--seed')){
   const c=local.workflow.ingest({caseId:'p3b-synthetic-review',itemId:'mn-item-1',eventId:'p3b-synthetic-event',idempotencyKey:'p3b-synthetic-event'});
   // Idempotently preserve all existing reviews/callbacks across process restarts.
   if(c.state==='PoDrafted')await ledger.seedPending(c.caseId);
   console.info(JSON.stringify({caseId:c.caseId,execution:'mocked-rpc',publicChainExecution:false}));
  }
  const port=Number(process.env.CARECART_OPERATIONS_PORT ?? '3002');if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid port');
  const app=createOperationsApp({workflow:local.workflow,origin:process.env.CARECART_OPERATIONS_ORIGIN ?? 'http://127.0.0.1:3000',
   operatorCredential:process.env.CARECART_OPERATIONS_OPERATOR_SECRET ?? '',viewerCredential:process.env.CARECART_OPERATIONS_VIEWER_SECRET,humanReview:ledger.binding});
  app.addHook('onClose',async()=>{ledger.close();local.close();});
  for(const signal of ['SIGTERM','SIGINT'] as const)process.once(signal,()=>void app.close());
  await app.listen({host:'127.0.0.1',port});console.info('Isolated MOCK wallet workspace listening on loopback. No real signing is available.');
 }catch(e){ledger.close();local.close();throw e;}
}
if(require.main===module)void main().catch(()=>{console.error('Mock wallet workspace failed; no public network operation was attempted.');process.exitCode=1;});

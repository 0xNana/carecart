import {openInventoryOperations} from '../inventory/local';
import {MockWalletLedger} from '../operations/mock-wallet-ledger';
import {createOperationsApp} from '../operations/api';
import {assertNoSigningCredentials} from '../operations/local';
/** Explicit, private offline financial fixture. Not imported by the default operations server or worker. */
export async function financialMain(){
 assertNoSigningCredentials(process.env);
 if(process.env.CARECART_OPERATIONS_MODE!=='local-synthetic'||process.env.CARECART_FINANCIAL_MODE!=='offline-fixture')throw new Error('Explicit offline financial fixture mode required');
 const workspace=process.env.CARECART_INVENTORY_WORKSPACE??'financial-fixture-clinic';
 if(!/^(financial-fixture-|p4b-process-)[A-Za-z0-9_-]+$/.test(workspace))throw new Error('Dedicated offline financial workspace required');
 const local=openInventoryOperations(workspace,Date.now,{dataset:'clinic'});
 const mock=new MockWalletLedger(local.workflow);
 try{const app=createOperationsApp({workflow:local.workflow,inventory:local.inventory,humanReview:mock.binding,financial:mock.financialBinding,
  origin:process.env.CARECART_OPERATIONS_ORIGIN??'http://127.0.0.1:3000',operatorCredential:process.env.CARECART_OPERATIONS_OPERATOR_SECRET??'',viewerCredential:process.env.CARECART_OPERATIONS_VIEWER_SECRET});
  app.addHook('onClose',async()=>{mock.close();local.close();});for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>void app.close());
  const port=Number(process.env.CARECART_OPERATIONS_PORT??3006);if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Explicit loopback port required');
  await app.listen({host:'127.0.0.1',port});console.info('Offline financial fixture only. Public-network submission is disabled.');
 }catch(e){mock.close();local.close();throw e;}
}
if(require.main===module)void financialMain().catch(()=>{console.error('Offline financial workspace failed; no public execution available');process.exitCode=1;});

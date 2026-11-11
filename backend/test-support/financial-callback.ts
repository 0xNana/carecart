/** Explicit offline fixture callback only. Never imported by an application or exposed over HTTP. */
import {openInventoryOperations} from '../src/inventory/local';import {MockWalletLedger} from '../src/operations/mock-wallet-ledger';
const [name,poId]=process.argv.slice(2);if(!name?.startsWith('p4b-process-')||!poId)throw new Error('Private acceptance fixture required');
const local=openInventoryOperations(name,Date.now,{dataset:'clinic'}),mock=new MockWalletLedger(local.workflow);
try{mock.callback(poId,'Paid');console.info(JSON.stringify({execution:'mocked-rpc',callback:'Paid',publicChainExecution:false}));}finally{mock.close();local.close();}

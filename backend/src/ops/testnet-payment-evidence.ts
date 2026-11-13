import {z} from 'zod';
import {SafetyOrderSchema} from '../near/commitments';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {PROJECT_ROOT} from '../profiles/storage';
import {verifyNativePayment} from '../near/human-receipts';
import {testnetPayments} from '../profiles/testnet-payments';
import {digest} from '../intents/settlement';
import {assertNoSigningCredentials} from '../operations/local';

/** Existing journal is a lookup hint only. Public FINAL receipts and canonical vault reads prove payment. */
export async function paymentEvidence(activationPath:string,evidencePath:string){
 assertNoSigningCredentials(process.env);
 const raw=JSON.parse(readFileSync(activationPath,'utf8'));
 const grant=testnetPayments({...raw,profile:{...raw.profile,databasePath:join(PROJECT_ROOT,'backend/data/testnet-v2/clinics',raw.clinicId,'state.sqlite')}}),p=grant.profile;
 const lookup=z.object({canonicalOrder:SafetyOrderSchema,proof:z.object({transactionHash:z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,64}$/)})}).parse(JSON.parse(readFileSync(evidencePath,'utf8')));
 const order=lookup.canonicalOrder,poId=order.po_id,hash=lookup.proof.transactionHash;
 if(order.profile!=='testnet'||order.token!==p.token||!grant.suppliers.includes(order.supplier))throw new Error('Reviewed testnet PO required');
  async function rpc<T=unknown>(method:string,params:unknown,endpoint=p.rpcUrl):Promise<T>{
   if(![p.rpcUrl,'https://archival-rpc.testnet.near.org'].includes(endpoint))throw new Error('Reviewed testnet RPC required');
   let failure:unknown;
   for(let attempt=0;attempt<3;attempt++)try{
    const r=await fetch(endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:'carecart-payment-proof',method,params})});
    if(!r.ok)throw new Error('Testnet RPC HTTP '+r.status);const body=await r.json() as {result?:unknown;error?:unknown};if(body.error||body.result===undefined)throw new Error('Testnet RPC read rejected');return body.result as T;
   }catch(e){failure=e;}
   throw failure;

  }
  if((await rpc<{chain_id:string}>('status',[])).chain_id!=='testnet')throw new Error('Wrong network');
  const query=<T>(account_id:string,request_type:string,extra={})=>rpc<T>('query',{account_id,request_type,finality:'final',...extra});
  const view=async(account:string,method_name:string,args={})=>JSON.parse(Buffer.from((await query<{result:number[]}>(account,'call_function',{method_name,args_base64:Buffer.from(JSON.stringify(args)).toString('base64')})).result).toString());
  if((await query<{code_hash:string}>(p.vault,'view_account')).code_hash!==p.codeHash||(await query<{code_hash:string}>(p.token,'view_account')).code_hash!==p.testToken!.codeHash)throw new Error('Deployed code identity mismatch');
  if(digest(await view(p.vault,'get_purchase_order',{po_id:poId}))!==digest(order))throw new Error('Onchain PO conflicts with local canonical PO');
  const transaction=await rpc<{receipts_outcome:{id:string;block_hash:string;outcome:{executor_id:string;logs:string[]}}[]}>('tx',{tx_hash:hash,sender_account_id:p.requester,wait_until:'FINAL'},'https://archival-rpc.testnet.near.org');
  const proof=verifyNativePayment(p,order,hash,transaction);
  const payment=await view(p.vault,'get_payment',{po_id:poId});
  const supplierBalance=await view(p.token,'ft_balance_of',{account_id:order.supplier});
  const archive='https://archival-rpc.testnet.near.org';
  const transfer=transaction.receipts_outcome.find((r:{id:string})=>r.id===proof.transferReceiptIds[0]);
  if(!transfer)throw new Error('Verified transfer receipt is missing');
  const block=await rpc<{header:{height:number;timestamp_nanosec?:string;timestamp:string}}>('block',{block_id:transfer.block_hash},archive);
  const balanceAt=async(account_id:string,height:number)=>{
   const r=await rpc<{result:number[]}>('query',{request_type:'call_function',block_id:height,account_id:p.token,method_name:'ft_balance_of',args_base64:Buffer.from(JSON.stringify({account_id})).toString('base64')},archive);
   return JSON.parse(Buffer.from(r.result).toString()) as string;
  };
  const [supplierBefore,supplierAfter,vaultBefore,vaultAfter]=await Promise.all([balanceAt(order.supplier,block.header.height-1),balanceAt(order.supplier,block.header.height),balanceAt(p.vault,block.header.height-1),balanceAt(p.vault,block.header.height)]);
  if(BigInt(supplierAfter)-BigInt(supplierBefore)!==BigInt(order.amount)||BigInt(vaultBefore)-BigInt(vaultAfter)!==BigInt(order.amount))throw new Error('Historical supplier/vault balance delta mismatch');
  return {observedAt:new Date().toISOString(),readOnly:true,publicTransactionsSubmitted:0,
   historicalBalances:{beforeBlockHeight:block.header.height-1,afterBlockHeight:block.header.height,supplierBefore,supplierAfter,vaultBefore,vaultAfter,deltaVerified:true},
   paymentTimestamp:new Date(Number(BigInt(block.header.timestamp_nanosec??block.header.timestamp)/1000000n)).toISOString(),
   evidenceLevel:'public-testnet-final-receipts',proof,canonicalOrder:order,payment,
   explorer:`https://testnet.nearblocks.io/txns/${hash}`,vaultExplorer:`https://testnet.nearblocks.io/address/${p.vault}`,
   journalLookup:{transactionHash:hash,canonicalHash:digest(order),source:'Published lookup terms; public receipts are verified independently of a private journal'},
   supplierBalanceAtObservation:supplierBalance,
   receiptLogs:transaction.receipts_outcome.filter(r=>r.outcome.logs.length).map(r=>({id:r.id,blockHash:r.block_hash,executor:r.outcome.executor_id,logs:r.outcome.logs})),
   limitations:['This read-only command does not perform a duplicate request; idempotency evidence is recorded separately.','Physical delivery is a separate inventory event.']};
}

if(require.main===module)void paymentEvidence(process.argv[2],process.argv[3]).then(v=>console.log(JSON.stringify(v,null,2))).catch(e=>{console.error(e.message);process.exitCode=1;});

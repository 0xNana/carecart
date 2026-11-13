import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {Account,JsonRpcProvider,KeyPair,type KeyPairString} from 'near-api-js';
import {PROJECT_ROOT} from '../profiles/storage';
import {testnetPayments} from '../profiles/testnet-payments';
import {SafetyVaultClient} from '../near/safety-client';
import {roleCredentials} from './role-credentials';
import {digest} from '../intents/settlement';

/** Negative-path test only: refuses every PO that is not already irreversibly Paid. Cannot initiate a new payout. */
async function duplicate(){
 const grant=testnetPayments(JSON.parse(readFileSync(join(PROJECT_ROOT,'profiles/testnet.payments.json'),'utf8'))),p=grant.profile;
 const activation=JSON.parse(readFileSync(join(PROJECT_ROOT,'backend/data/sprint-20261113/activation.json'),'utf8'));
 const marker=join(PROJECT_ROOT,'backend/data/sprint-20261113/duplicate-attempt.json');
 if(existsSync(marker))throw new Error('Duplicate test already attempted; reconcile the saved intent, never resend');
 const key=roleCredentials('requester',process.env).requester!;
 if(KeyPair.fromString(key as KeyPairString).getPublicKey().toString()!==p.requesterPublicKey)throw new Error('Approved requester key required');
 const reader=new SafetyVaultClient(p);await reader.verify();
 const order=await reader.canonicalOrder(activation.poId),payment=await reader.view<{status:string}>('get_payment',{po_id:activation.poId});
 if(digest(order)!==activation.canonicalHash||order.supplier!=='medsupply-a.carecart.testnet'||order.amount!=='1500000'||order.destination!=='Near'||payment.status!=='Paid')throw new Error('Only the approved already-paid sprint PO may be replayed');
 const provider=new JsonRpcProvider({url:p.rpcUrl},{retries:1,wait:0,backoff:1});
 const access=await provider.viewAccessKey({accountId:p.requester,publicKey:p.requesterPublicKey,finalityQuery:{finality:'final'}});
 const permission=typeof access.permission==='string'?null:access.permission.FunctionCall;
 if(!permission||permission.receiver_id!==p.vault||permission.method_names.length!==1||permission.method_names[0]!=='request_payment'||!permission.allowance||BigInt(permission.allowance)>BigInt(p.maxKeyAllowanceYocto))throw new Error('Exact finite request_payment key required');
 const balance=()=>provider.callFunction<string>({contractId:p.token,method:'ft_balance_of',args:{account_id:order.supplier},blockQuery:{finality:'final'}});
 const before=await balance();writeFileSync(marker,JSON.stringify({state:'Sending',poId:order.po_id,supplierBefore:before}),{mode:0o600,flag:'wx'});
 try{
  const submitted=await new Account(p.requester,provider,key as KeyPairString).callFunctionRaw({contractId:p.vault,methodName:'request_payment',args:{po_id:order.po_id},gas:120000000000000n,deposit:0n});
  const tx=await provider.viewTransactionStatusWithReceipts({txHash:submitted.transaction.hash,accountId:p.requester,waitUntil:'FINAL'});
  const after=await balance(),logs=tx.receipts_outcome.flatMap(r=>r.outcome.logs);
  if(tx.final_execution_status!=='FINAL'||(typeof tx.status!=='object'||!('SuccessValue' in tx.status))||tx.receipts_outcome.some(r=>typeof r.outcome.status!=='object'||'Failure' in r.outcome.status)||before!==after||logs.some(l=>l.startsWith('EVENT_JSON:')&&JSON.parse(l.slice(11)).event==='ft_transfer'))throw new Error('Duplicate test effect requires independent reconciliation');
  const evidence={state:'Confirmed',network:'testnet',evidenceLevel:'public-testnet-onchain-idempotency',poId:order.po_id,transactionHash:tx.transaction.hash,explorer:`https://testnet.nearblocks.io/txns/${tx.transaction.hash}`,vault:p.vault,token:p.token,supplier:order.supplier,supplierBefore:before,supplierAfter:after,additionalTransferAmount:'0',finalExecutionStatus:tx.final_execution_status,logs,observedAt:new Date().toISOString()};
  writeFileSync(marker,JSON.stringify(evidence,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(evidence,null,2));
 }catch{throw new Error('Duplicate attempt is recorded; inspect its exact transaction before any further action. Never resend.');}
}
if(require.main===module)void duplicate().catch(e=>{console.error(e.message);process.exitCode=1;});

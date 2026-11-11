import {z} from 'zod';
import {digest} from '../intents/settlement';
import type {PaymentReview} from './human-review';
const hash=z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,64}$/);
const outcome=z.object({id:hash,outcome:z.object({executor_id:z.string(),receipt_ids:z.array(hash),logs:z.array(z.string()),status:z.record(z.string(),z.unknown())})});
const finalTx=z.object({final_execution_status:z.literal('FINAL'),status:z.record(z.string(),z.unknown()),
 transaction:z.object({hash,signer_id:z.string(),receiver_id:z.string(),actions:z.array(z.object({FunctionCall:z.object({method_name:z.string(),args:z.string(),deposit:z.string(),gas:z.union([z.number().int().positive(),z.string().regex(/^[1-9][0-9]*$/)])}).strict()})).length(1)}),
 transaction_outcome:outcome,receipts_outcome:z.array(outcome).max(2000)});
function receiptGraph(tx:z.infer<typeof finalTx>){
 const receipts=new Map(tx.receipts_outcome.map(r=>[r.id,r]));if(receipts.size!==tx.receipts_outcome.length)throw new Error('Duplicate receipt evidence');
 const reachable=new Set<string>();const queue=[...tx.transaction_outcome.outcome.receipt_ids];
 while(queue.length){const id=queue.pop()!;if(reachable.has(id))continue;reachable.add(id);const r=receipts.get(id);if(!r)throw new Error('Incomplete finalized receipt graph');queue.push(...r.outcome.receipt_ids);}
 if(!reachable.size)throw new Error('No finalized action receipt');
 const checked=[...reachable].map(id=>receipts.get(id)!);
 const succeeded='SuccessValue' in tx.status&&checked.every(r=>!('Failure' in r.outcome.status));
 if(!succeeded&&!('Failure' in tx.status)&&!checked.some(r=>'Failure' in r.outcome.status))throw new Error('Unsupported finalized execution status');
 return {reachable,checked,succeeded};
}
/** Only independently fetched FINAL RPC results enter this verifier; browser proof JSON is never accepted. */
export function verifyHumanTransaction(review:PaymentReview,txHash:string,raw:unknown){
 const tx=finalTx.parse(raw);hash.parse(txHash);const expected=review.transaction;const call=tx.transaction.actions[0].FunctionCall;const terms=expected.actions[0].params;
 if(tx.transaction.hash!==txHash||tx.transaction.signer_id!==expected.signerId||tx.transaction.receiver_id!==expected.receiverId||
  call.method_name!==terms.methodName||call.deposit!=='1'||BigInt(call.gas)!==BigInt(terms.gas))throw new Error('Human transaction identity/ABI mismatch');
 const args=JSON.parse(Buffer.from(call.args,'base64').toString('utf8')) as Record<string,unknown>;
 if(!args||Array.isArray(args)||Object.keys(args).sort().join(',')!==Object.keys(terms.args).sort().join(',')||
  Object.entries(terms.args).some(([key,value])=>args[key]!==value))throw new Error('Human transaction canonical arguments changed');
 const {reachable,checked,succeeded}=receiptGraph(tx);
 let transfer=0n;const transferReceipts:string[]=[];const paymentStates:string[]=[];
 for(const r of checked){if(!('SuccessValue' in r.outcome.status))continue;
  for(const log of r.outcome.logs){if(!log.startsWith('EVENT_JSON:'))continue;let e;try{e=JSON.parse(log.slice(11));}catch{continue;}
   if(!Array.isArray(e?.data))continue;
   if(r.outcome.executor_id===expected.receiverId&&e.standard==='carecart_safety_vault'&&e.event==='payment_state')
    for(const d of e.data)if(d?.po_id===review.order.po_id&&typeof d.payment?.status==='string')paymentStates.push(d.payment.status);
   if(r.outcome.executor_id===review.order.token&&e.standard==='nep141'&&e.event==='ft_transfer'){
    for(const d of e.data)if(d?.old_owner_id===expected.receiverId&&d.new_owner_id===(review.base?.quote.response.quote.depositAddress??review.order.supplier)&&typeof d.amount==='string'&&/^[1-9][0-9]{0,38}$/.test(d.amount)){
     transfer+=BigInt(d.amount);transferReceipts.push(r.id);
    }
   }
  }
 }
 const transferred=transfer===BigInt(review.order.amount)&&transferReceipts.length>0;
 if(transfer>BigInt(review.order.amount))throw new Error('Receipt transfer exceeds reviewed amount');
 if(review.action==='reject'&&transfer!==0n)throw new Error('Rejection transaction cannot dispatch funds');
 return {transactionHash:txHash,termsHash:digest(review),signer:expected.signerId,receiver:expected.receiverId,poId:review.order.po_id,
  finalized:true as const,executionSucceeded:succeeded,action:review.action,receiptIds:[...reachable],paymentStates,
  transferConfirmed:transferred,transfer:transferred?{token:review.order.token,recipient:review.base?.quote.response.quote.depositAddress??review.order.supplier,amount:review.order.amount,receipts:transferReceipts}:null,
  rejectionConfirmed:succeeded&&review.action==='reject'&&paymentStates.includes('Rejected'),
  destinationSettlementVerified:false as const};
}

/** Read-only proof for a native restricted requester call, not browser-supplied receipt JSON. */
export function verifyNativePayment(profile:{network:string;vault:string;token:string;requester:string},order:{po_id:string;profile:string;token:string;supplier:string;amount:string},txHash:string,raw:unknown){
 const tx=finalTx.parse(raw),call=tx.transaction.actions[0].FunctionCall;hash.parse(txHash);
 if(profile.network!=='testnet'||order.profile!=='testnet'||order.token!==profile.token||tx.transaction.hash!==txHash||tx.transaction.signer_id!==profile.requester||tx.transaction.receiver_id!==profile.vault||call.method_name!=='request_payment'||call.deposit!=='0'||BigInt(call.gas)!==120_000_000_000_000n)throw new Error('Native payment transaction identity/ABI mismatch');
 const args=JSON.parse(Buffer.from(call.args,'base64').toString('utf8'));if(!args||Object.keys(args).join(',')!=='po_id'||args.po_id!==order.po_id)throw new Error('Native canonical PO mismatch');
 const {checked,reachable,succeeded}=receiptGraph(tx);if(!succeeded)throw new Error('Native payment receipts failed');
 let transferred=0n;const transferReceipts:string[]=[];let paid=false;
 for(const r of checked){if(!('SuccessValue' in r.outcome.status))continue;for(const line of r.outcome.logs){if(!line.startsWith('EVENT_JSON:'))continue;let e;try{e=JSON.parse(line.slice(11));}catch{continue;}if(!Array.isArray(e?.data))continue;
  for(const d of e.data){
   if(r.outcome.executor_id===profile.vault&&e.standard==='carecart_safety_vault'&&e.event==='payment_state'&&d?.po_id===order.po_id&&d.payment?.status==='Paid')paid=true;
   if(r.outcome.executor_id===profile.token&&e.standard==='nep141'&&e.event==='ft_transfer'&&d?.old_owner_id===profile.vault){if(d.new_owner_id!==order.supplier||typeof d.amount!=='string'||!/^[1-9][0-9]{0,38}$/.test(d.amount))throw new Error('Native transfer recipient/amount mismatch');transferred+=BigInt(d.amount);transferReceipts.push(r.id);}
  }
 }}
 if(!paid||transferred!==BigInt(order.amount)||transferReceipts.length!==1)throw new Error('Exact native transfer and Paid callback evidence required');
 return {kind:'near-native-payment' as const,transactionHash:txHash,poId:order.po_id,canonicalHash:digest(order),network:'testnet' as const,token:order.token,recipient:order.supplier,amount:order.amount,signer:profile.requester,finalized:true,nativeSettlementVerified:true,receiptIds:[...reachable],transferReceiptIds:transferReceipts};
}

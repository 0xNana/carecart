import {expect,it} from 'vitest';import {verifyHumanTransaction} from './human-receipts';import type {PaymentReview} from './human-review';
const h='1'.repeat(44),r='2'.repeat(44);const terms={action:'approve',order:{po_id:'po-1',amount:'1000000',supplier:'supplier.testnet',token:'token.testnet'},base:null,
 transaction:{network:'testnet',signerId:'admin.testnet',receiverId:'vault.testnet',actions:[{type:'FunctionCall',params:{methodName:'approve_payment',args:{po_id:'po-1',expected_quote_hash:null,expected_commitment_hash:null},deposit:'1',gas:'120000000000000'}}]}} as unknown as PaymentReview;
function raw(){return {final_execution_status:'FINAL',status:{SuccessValue:''},transaction:{hash:h,signer_id:'admin.testnet',receiver_id:'vault.testnet',actions:[{FunctionCall:{method_name:'approve_payment',args:Buffer.from(JSON.stringify(terms.transaction.actions[0].params.args)).toString('base64'),deposit:'1',gas:120000000000000}}]},
 transaction_outcome:{id:h,outcome:{executor_id:'admin.testnet',receipt_ids:[r],logs:[],status:{SuccessValue:''}}},
 receipts_outcome:[{id:r,outcome:{executor_id:'token.testnet',receipt_ids:[],status:{SuccessValue:''},logs:['EVENT_JSON:'+JSON.stringify({standard:'nep141',event:'ft_transfer',data:[{old_owner_id:'vault.testnet',new_owner_id:'supplier.testnet',amount:'1000000'}]})]}}]};}
it('MOCK RPC: attributes exact FINAL transaction and canonical-token receipt, never Base destination settlement',()=>{const proof=verifyHumanTransaction(terms,h,raw());expect(proof.transferConfirmed).toBe(true);expect(proof.destinationSettlementVerified).toBe(false);});
it.each(['hash','signer','receiver','deposit','method','args','gas','finality','graph','duplicate'])('MOCK RPC: refuses changed %s evidence',attack=>{
 const tx=raw();const call=tx.transaction.actions[0].FunctionCall;
 if(attack==='hash')tx.transaction.hash=r;if(attack==='signer')tx.transaction.signer_id='agent.testnet';if(attack==='receiver')tx.transaction.receiver_id='other.testnet';
 if(attack==='deposit')call.deposit='0';if(attack==='method')call.method_name='request_payment';if(attack==='args')call.args=Buffer.from('{"po_id":"other"}').toString('base64');
 if(attack==='gas')call.gas=1;if(attack==='finality')tx.final_execution_status='EXECUTED_OPTIMISTIC';if(attack==='graph')tx.transaction_outcome.outcome.receipt_ids=['3'.repeat(44)];if(attack==='duplicate')tx.receipts_outcome.push(tx.receipts_outcome[0]);
 expect(()=>verifyHumanTransaction(terms,h,tx)).toThrow();
});
it('MOCK RPC: no token receipt means no confirmed payment despite successful submission',()=>{const tx=raw();tx.receipts_outcome[0].outcome.logs=[];expect(verifyHumanTransaction(terms,h,tx).transferConfirmed).toBe(false);});
it('MOCK RPC: finalized failure is attributed without claiming payment success',()=>{const tx=raw();Object.assign(tx,{status:{Failure:{error_message:'denied'}}});tx.receipts_outcome[0].outcome.logs=[];expect(verifyHumanTransaction(terms,h,tx).executionSucceeded).toBe(false);});

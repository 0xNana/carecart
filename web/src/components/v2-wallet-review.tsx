'use client';
import {useRef,useState} from 'react';
import {V2WalletController,type WalletReview,type V2Wallet} from '../lib/v2-wallet';
import type {OperatorClient,OperatorSession} from '../lib/operator-client';
import {statusLabel} from '../lib/product-copy';
export function V2WalletReview({client,session,caseId,revision,paymentState,reviews,onRefresh}:{client:OperatorClient;session:OperatorSession;caseId:string;revision:number;
 paymentState:string;reviews:WalletReview[];onRefresh:()=>Promise<void>}){
 const [review,setReview]=useState<WalletReview|null>(reviews[0]??null);const [connected,setConnected]=useState(false);const [confirmed,setConfirmed]=useState(false);
 const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const controller=useRef<V2WalletController|null>(null);
 const available=session.walletMode==='isolated-mock'&&!!session.walletProfile;const operator=session.role==='operator'&&(!session.permissions||session.permissions.includes('finance'));
 async function action(work:()=>Promise<WalletReview>){setBusy(true);setError('');try{setReview(await work());setConfirmed(false);await onRefresh();}
  catch(cause){setError(cause instanceof Error?cause.message:'WALLET_REVIEW_UNAVAILABLE');}finally{setBusy(false);}}
 async function submit(){if(!review||!session.walletProfile||!connected||!confirmed)return;
  if(!controller.current)controller.current=new V2WalletController(session.walletProfile);
  const id=review.id;const profile=session.walletProfile;
  const wallet:V2Wallet={execution:'isolated-mock',getNetwork:async()=>profile.network,getAccounts:async()=>[{accountId:profile.admin}],
   signAndSendTransaction:async()=>client.mockWallet(id)};
  await action(()=>controller.current!.submit(review,wallet,client,true));
 }
 const terms=review?.terms;
 return <section className="ops-panel ops-wallet" aria-label="Payment approval"><h3>Payment approval</h3>
  <p className="ops-attention">{available?'Preview only · no money will move.':'Payment approval is not available for this purchase yet.'}</p>

  <p>Payment status: <strong>{statusLabel(paymentState)}</strong>. A submitted request is not complete until it is verified.</p>
   {!available&&<p>This purchase will stay on hold until an approved payment method is set up.</p>}
  {available&&<><button disabled={busy||!operator} onClick={()=>{setConnected(v=>!v);setConfirmed(false);}}>{connected?'Close preview wallet':'Open preview wallet'}</button>
   <p>{connected?'Preview wallet ready.':'No preview wallet is open.'}</p>
   <div className="ops-pagination"><button disabled={busy||!operator||paymentState!=='PendingApproval'} onClick={()=>void action(()=>client.prepareWalletReview(caseId,'approve',revision))}>Review approval</button>
    <button disabled={busy||!operator||paymentState!=='PendingApproval'} onClick={()=>void action(()=>client.prepareWalletReview(caseId,'reject',revision))}>Review rejection</button></div>
  </>}
  {error&&<p role="alert" className="ops-error">Payment approval could not be updated. Refresh and check the status before trying again.</p>}
  {busy&&<p role="status">Saving approval details…</p>}
  {review&&<><p>Approval status: <strong>{statusLabel(review.state)}</strong></p>
   {terms&&<details><summary>Advanced transaction details</summary><dl><dt>Action</dt><dd>{terms.action}</dd><dt>Order reference</dt><dd>{terms.order.po_id}</dd><dt>Order fingerprint</dt><dd>{terms.canonicalHash}</dd>
    <dt>Supplier / recipient</dt><dd>{terms.order.supplier} / {terms.recipient}</dd><dt>Token / six-decimal atomic amount</dt><dd>{terms.order.token} / {terms.order.amount}</dd>
    <dt>Network / contract</dt><dd>{terms.transaction.network} / {terms.transaction.receiverId} (execution: {review.execution})</dd><dt>Reviewed code hash</dt><dd>{terms.codeHash}</dd>
    <dt>Admin signer / attached deposit</dt><dd>{terms.transaction.signerId} / exactly 1 yoctoNEAR</dd><dt>Review expires</dt><dd>{review.expiresAt}</dd></dl>
    {terms.base&&<details open><summary>Bound Base quote, fees, minimum output, recipient and refund terms</summary><pre>{JSON.stringify(terms.base,null,2)}</pre></details>}
    <details><summary>Transaction and payment limits</summary><pre>{JSON.stringify({transaction:terms.transaction,policy:terms.policy,spendable:terms.spendable,usage:terms.usage,approvalBlocks:terms.approvalBlocks},null,2)}</pre></details></details>
   }
   {review.state==='Prepared'&&available&&<><label><input type="checkbox" checked={confirmed} disabled={busy||!operator||paymentState!=='PendingApproval'} onChange={e=>setConfirmed(e.target.checked)}/> I reviewed these details and confirm the preview.</label>
    <div className="ops-pagination"><button disabled={busy||!operator||!connected||!confirmed||paymentState!=='PendingApproval'} onClick={()=>void submit()}>Confirm preview</button>
    <button disabled={busy||!operator} onClick={()=>void action(()=>client.report(review.id,'Cancelled',null))}>Cancel review</button></div></>}
   {['Handoff','Submitted','Ambiguous'].includes(review.state)&&<p className="ops-attention">This action may still be processing. Don’t repeat it yet; check the status below.</p>}
   <div className="ops-pagination"><button disabled={busy} onClick={()=>void action(()=>client.walletReview(review.id))}>Refresh approval status</button>
    <button disabled={busy||!operator} onClick={()=>void action(()=>client.reconcileWallet(review.id))}>Check payment status</button></div>
   <details><summary>Approval history</summary><ol>{review.events.map((e,i)=><li key={i}><strong>{statusLabel(e.eventType)}</strong> · {e.timestamp}<details><summary>Activity details</summary><pre>{JSON.stringify(e.evidence,null,2)}</pre></details></li>)}</ol></details>
  </>}
 </section>;
}

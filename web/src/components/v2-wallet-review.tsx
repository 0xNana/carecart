'use client';
import {useRef,useState} from 'react';
import {V2WalletController,type WalletReview,type V2Wallet} from '../lib/v2-wallet';
import type {OperatorClient,OperatorSession} from '../lib/operator-client';
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
 return <section className="ops-panel ops-wallet" aria-label="V2 human wallet review"><h3>Human payment approval</h3>
  <p className="ops-attention">{available?'Isolated mock wallet · simulated execution only · no keys or public-chain transactions':'Public wallet approval is not yet available'}</p>

  <p>Independently recorded payment: <strong>{paymentState}</strong>. Wallet submission is not payment completion.</p>
   {!available&&<p>{session.walletMode==='local-sandbox'?'Genuine local Sandbox RPC / CCUSD test tokens. Browser signing is unavailable; the isolated process harness exercises the wallet protocol separately.':'Orders requiring human approval remain on hold until an authorized wallet review is available.'}</p>}
  {available&&<><button disabled={busy||!operator} onClick={()=>{setConnected(v=>!v);setConfirmed(false);}}>{connected?'Disconnect isolated mock admin':'Connect isolated mock admin'}</button>
   <p>{connected?`Mock identity: ${session.walletProfile!.admin} · profile ${session.walletProfile!.network} (simulated)`:'No isolated wallet identity selected.'}</p>
   <div className="ops-pagination"><button disabled={busy||!operator||paymentState!=='PendingApproval'} onClick={()=>void action(()=>client.prepareWalletReview(caseId,'approve',revision))}>Prepare unsigned approval</button>
    <button disabled={busy||!operator||paymentState!=='PendingApproval'} onClick={()=>void action(()=>client.prepareWalletReview(caseId,'reject',revision))}>Prepare unsigned rejection</button></div>
  </>}
  {error&&<p role="alert" className="ops-error">{error}. Refresh saved review and canonical state before any further action.</p>}
  {busy&&<p role="status">Validating and saving the wallet boundary…</p>}
  {review&&<><p>Review <code>{review.id}</code> · <strong>{review.state}</strong> · {review.execution==='mocked-rpc'?'MOCKED evidence; no actual USDC settlement':review.execution==='sandbox-rpc'?'Genuine local Sandbox RPC; CCUSD test token, no public USDC settlement':'Recorded public RPC evidence; revalidation required'}</p>
   <p>Transaction report: {review.transactionHash??'None'} · verified transaction attribution: {String(review.transactionVerified)}</p>
   {terms&&<><dl><dt>Action</dt><dd>{terms.action}</dd><dt>Canonical PO</dt><dd>{terms.order.po_id}</dd><dt>Canonical hash</dt><dd>{terms.canonicalHash}</dd>
    <dt>Supplier / recipient</dt><dd>{terms.order.supplier} / {terms.recipient}</dd><dt>Token / six-decimal atomic amount</dt><dd>{terms.order.token} / {terms.order.amount}</dd>
    <dt>Network / contract</dt><dd>{terms.transaction.network} / {terms.transaction.receiverId} (execution: {review.execution})</dd><dt>Reviewed code hash</dt><dd>{terms.codeHash}</dd>
    <dt>Admin signer / attached deposit</dt><dd>{terms.transaction.signerId} / exactly 1 yoctoNEAR</dd><dt>Review expires</dt><dd>{review.expiresAt}</dd></dl>
    {terms.base&&<details open><summary>Bound Base quote, fees, minimum output, recipient and refund terms</summary><pre>{JSON.stringify(terms.base,null,2)}</pre></details>}
    <details><summary>Exact unsigned v2 transaction and policy snapshot</summary><pre>{JSON.stringify({transaction:terms.transaction,policy:terms.policy,spendable:terms.spendable,usage:terms.usage,approvalBlocks:terms.approvalBlocks},null,2)}</pre></details>
   </>}
   {review.state==='Prepared'&&available&&<><label><input type="checkbox" checked={confirmed} disabled={busy||!operator||paymentState!=='PendingApproval'} onChange={e=>setConfirmed(e.target.checked)}/> I reviewed these exact terms and authorize only an isolated mock wallet action.</label>
    <div className="ops-pagination"><button disabled={busy||!operator||!connected||!confirmed||paymentState!=='PendingApproval'} onClick={()=>void submit()}>Confirm simulated wallet {terms?.action==='reject'?'rejection':'approval'}</button>
    <button disabled={busy||!operator} onClick={()=>void action(()=>client.report(review.id,'Cancelled',null))}>Cancel before wallet handoff</button></div></>}
   {['Handoff','Submitted','Ambiguous'].includes(review.state)&&<p className="ops-attention">An action may already have executed. Do not resend. Read-only canonical reconciliation is required.</p>}
   <div className="ops-pagination"><button disabled={busy} onClick={()=>void action(()=>client.walletReview(review.id))}>Refresh saved review</button>
    <button disabled={busy||!operator} onClick={()=>void action(()=>client.reconcileWallet(review.id))}>Observe canonical state (read only)</button></div>
   <h4>Approval activity</h4><ol>{review.events.map((e,i)=><li key={i}><strong>{e.eventType}</strong> · {e.timestamp} · {e.actor}<pre>{JSON.stringify(e.evidence,null,2)}</pre></li>)}</ol>
  </>}
 </section>;
}

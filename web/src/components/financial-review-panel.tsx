'use client';
import {confirmedSupplierPayment,paymentStage} from '../lib/payment-presentation';
import {identityRequest} from '../lib/identity-client';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {OperatorClient} from '../lib/operator-client';
import type {FinancialReview} from '../lib/financial-review';
import {usdc} from '../lib/workflow';
import {actionError,displayTime,statusLabel,testnetTransactionUrl} from '../lib/product-copy';
import styles from './application-view.module.css';

export function FinancialReviewPanel({client,caseId,revision,operator,onRefresh}:{client:OperatorClient;caseId:string;revision:number;operator:boolean;onRefresh:()=>Promise<void>}){
 const submitting=useRef(false);
 const [review,setReview]=useState<FinancialReview|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[confirmedFor,setConfirmedFor]=useState(''),[message,setMessage]=useState('');
 const confirmationKey=review?JSON.stringify([caseId,review.revision,review.canonicalHash,review.requiredAuthority]):'';
 const confirmed=!!confirmationKey&&confirmedFor===confirmationKey;
 const refresh=useCallback(async()=>{try{setReview(await client.financialReview(caseId));setError('');}catch(e){setReview(null);setError(e instanceof Error?e.message:'Financial review unavailable');}},[client,caseId]);
 useEffect(()=>{let active=true;client.financialReview(caseId).then(r=>{if(active){setReview(r);setError('');}}).catch(e=>{if(active){setReview(null);setError(e instanceof Error?e.message:'Financial review unavailable');}});return()=>{active=false;};},[client,caseId,revision]);
 async function action(work:()=>Promise<unknown>){if(submitting.current)return;submitting.current=true;setBusy(true);setConfirmedFor('');setMessage('');setError('');try{await work();await refresh();await onRefresh();setMessage('Purchase update saved. Check the status below.');}catch(e){await refresh();await onRefresh();setError(actionError(e,'This purchase could not be updated. Refresh and check its status before trying again.'));}finally{submitting.current=false;setBusy(false);}}
 const [wallets,setWallets]=useState<{id:string;accountId:string}[]>([]),[walletBindingId,setWalletBindingId]=useState('');
 useEffect(()=>{let active=true;if(review?.execution==='public-rpc')void client.session().then(s=>{if(!s.clinicId)throw new Error('Clinic required');return identityRequest('clinics/'+s.clinicId+'/wallet-bindings');}).then(d=>{if(active){const current=(d.bindings as {id:string;accountId:string;status:string}[]).filter(b=>b.status==='Verified'&&b.accountId===review.controller);setWallets(current);setWalletBindingId(current.length===1?current[0].id:'');}}).catch(()=>{if(active){setWallets([]);setWalletBindingId('');}});return()=>{active=false;};},[client,review?.execution,review?.controller]);
 const role=review?.requiredAuthority==='committer'?'committer':review?.requiredAuthority==='requester'?'requester':null;
 const moneyLabel=review?.quote.asset==='CCUSD'?'CCUSD':'demo credits';
 const environment=review?.execution==='public-rpc'?'Demo purchase · no real money is involved.':review?.execution==='sandbox-rpc'?'Preview only · no payment will be sent.':review?.execution==='mocked-rpc'?'Simulation only · no payment will be sent.':'Payment actions are unavailable here.';
 const nativeReceipt=review?confirmedSupplierPayment(review):undefined;
 const stage=review?paymentStage(review):null;
 const transactionUrl=nativeReceipt?'https://testnet.nearblocks.io/txns/'+nativeReceipt.transactionHash:review?.operations.map(o=>testnetTransactionUrl(review.execution,review.canonical.profile,o.evidence)).filter(Boolean).at(-1);
 const confirmLabel=role==='committer'?'Confirm order details':'Confirm payment request';
 return <section className={styles.panel+' '+styles.financialReview} aria-label="Purchase review">
  <header className={styles.paymentHeading}><div><p className={styles.eyebrow}>PAYMENT REVIEW</p><h2>Review purchase</h2></div>{stage&&<span className={styles.paymentStage} data-state={stage}>{stage}</span>}</header>
  {review&&<p><strong>{environment}</strong></p>}
  <p>Check the supplier, amount and delivery details before confirming this step.</p>
  {error&&<p className={styles.error} role="alert">{actionError(new Error(error),'Purchase details are unavailable. Refresh before taking action.')}</p>}
  {!review&&!error&&<p role="status">Loading purchase details…</p>}
  {review&&<>
   <div className={styles.paymentAmount}><strong>{usdc(review.canonical.amount)} <span>{moneyLabel}</span></strong><p>{review.execution==='public-rpc'?'NEAR Testnet · demonstration token with no cash value':review.execution==='sandbox-rpc'?'Local Sandbox · no real-money payment':review.execution==='mocked-rpc'?'Simulation · no real-money payment':'Execution disabled'}</p></div>
   <dl className={styles.facts}>
    <dt>Order reference</dt><dd>{review.canonical.po_id}</dd>
    <dt>Supplier</dt><dd>{review.quote.supplierId.replace(/^Synthetic Demo Supplier /i,'Supplier ')}</dd>
    <dt>Amount</dt><dd>{usdc(review.canonical.amount)} {moneyLabel}</dd>
    <dt>Selected offer</dt><dd>{review.quote.quantity} units × {usdc(review.quote.unitPriceAtomic)} {moneyLabel} each</dd>
    <dt>Offer expires</dt><dd>{displayTime(review.quote.expiresAt)} · {review.quoteExpired?'Expired':'Available'}</dd>
    <dt>Next step</dt><dd>{statusLabel(review.nextAction)}</dd>
    <dt>Payment status</dt><dd>{statusLabel(review.approvalStatus)} · {statusLabel(review.state)}</dd>
    <dt>Network</dt><dd>{review.canonical.profile==='testnet'?'NEAR Testnet':'Local demo · financial execution disabled'}</dd>
    <dt>Policy outcome</dt><dd>{review.policy.blocks.length?'Blocked: '+review.policy.blocks.map(statusLabel).join(', '):review.policy.observed?'Within current limits':'Limits not independently checked'}</dd>
    <dt>Verified payment</dt><dd>{nativeReceipt?'Supplier transfer independently confirmed':'No independently confirmed supplier transfer'}</dd>
    <dt>Transaction</dt><dd>{transactionUrl?<><a className={styles.inlineLink} href={transactionUrl} target="_blank" rel="noreferrer">{transactionUrl.split('/').at(-1)} ↗</a><small>{nativeReceipt?'Verified supplier payment':'Latest operation · payment confirmation pending'}</small></>:'No public transaction recorded'}</dd>
    <dt>Approval</dt><dd>{review.policy.humanRequired||review.approvalStatus==='PendingApproval'?'Clinic approval required':'Within set limits; confirmation required'}</dd>
   </dl>
   <details><summary>Payment limits</summary><ul>{Object.entries(review.policy.limits).map(([key,value])=><li key={key}>{({auto_per_po_limit:'Automatic payment limit',hard_payout_limit:'Maximum payment',daily_dispatch_limit:'Daily payment limit',accepted_deposit_ceiling:'Maximum balance'} as Record<string,string>)[key]??key}: {usdc(value)} {moneyLabel}</li>)}</ul></details>
   <details><summary>Advanced payment details</summary><dl className={styles.facts}>
    <dt>Payment account</dt><dd>{review.canonical.destination==='Near'?review.canonical.supplier:'External account · extra review required'}</dd>
    <dt>Token contract / amount</dt><dd>{review.canonical.token} / {review.canonical.amount}</dd>
    <dt>Offer reference</dt><dd>{review.quote.id}</dd><dt>Order fingerprint</dt><dd>{review.canonicalHash}</dd><dt>Required service role</dt><dd>{review.requiredAuthority}</dd>
    <dt>Balance check</dt><dd>{review.policy.observed?'Live balance and limits checked':'No live balance check available'}</dd>
    <dt>Available / daily use</dt><dd>{review.policy.spendable??'Not checked'} / {review.policy.usage?JSON.stringify(review.policy.usage):'Not checked'}</dd>
   </dl></details>
   <p role="status">{review.policy.blocks.length?'This purchase is on hold: '+review.policy.blocks.map(statusLabel).join(', '):'This purchase meets the current limits.'}</p>
   {review.execution==='public-rpc'&&<label>Clinic approval wallet<select value={walletBindingId} onChange={e=>setWalletBindingId(e.target.value)}><option value="">Set up the approval wallet in Settings</option>{wallets.map(w=><option key={w.id} value={w.id}>{w.accountId}</option>)}</select></label>}
   {role&&<><label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmedFor(e.target.checked?confirmationKey:'')} disabled={!operator||busy||review.execution==='disabled'||!!review.policy.blocks.length}/> I checked the supplier, amount and delivery details.</label>
    <button className={styles.evidenceButton} disabled={!operator||busy||!confirmed||review.execution==='disabled'||!!review.policy.blocks.length||review.authorizations.some(a=>a.role===role)||(review.execution==='public-rpc'&&!walletBindingId)} onClick={()=>void action(()=>client.authorizeFinancial(caseId,role,review.revision,review.canonicalHash,walletBindingId||undefined))}>{review.execution==='disabled'?'Action unavailable':confirmLabel}</button></>}
   {!operator&&<p>Your access is view only.</p>}
   {(review.policy.humanRequired||review.approvalStatus==='PendingApproval')&&review.execution==='public-rpc'&&<p>This purchase needs a clinic approver. Set up the approval wallet in Settings before continuing.</p>}
   <h3>Purchase activity</h3>{!review.authorizations.length&&<p>No confirmations yet.</p>}
   {review.authorizations.map(a=><article key={a.id}><h4>{a.role==='committer'?'Order confirmation':'Payment request'} · {statusLabel(a.state)}</h4>
    <details><summary>Confirmation details</summary><p>{a.id} · {a.role} · expires {displayTime(a.expiresAt)}</p></details>
    {a.error&&<p role="status">This step needs attention. Refresh its status for the latest information.</p>}
    {review.execution==='mocked-rpc'&&a.state==='Authorized'&&<button className={styles.evidenceButton} disabled={!operator||busy} onClick={()=>void action(()=>client.simulateFinancial(a.id))}>Complete demo payment</button>}
    {['sandbox-rpc','public-rpc'].includes(review.execution)&&a.state==='Authorized'&&<p>This may take a moment. You can leave the page and check back later.</p>}
    {['Executing','RequiresReconciliation'].includes(a.state)&&<p>This step may still be processing. Don’t repeat it yet; check its status below.</p>}
    {a.state!=='Authorized'&&<button className={styles.evidenceButton} disabled={!operator||busy} onClick={()=>void action(()=>client.reconcileFinancial(a.id))}>Refresh status</button>}
    <details><summary>Activity details</summary><pre className={styles.evidenceJson}>{JSON.stringify(a.events,null,2)}</pre></details>
   </article>)}
   <h3>Payment updates</h3>{review.operations.length?<ul>{review.operations.map(o=>{const url=testnetTransactionUrl(review.execution,review.canonical.profile,o.evidence);return <li key={o.operation_key}><strong>{statusLabel(o.state)}</strong>{url&&<p><a className={styles.inlineLink} href={url} target="_blank" rel="noreferrer">View payment record ↗</a></p>}<details><summary>Payment record details</summary><p>{o.operation_key}</p><pre className={styles.evidenceJson}>{o.evidence??'No payment details saved'}</pre></details></li>;})}</ul>:<p>No payment activity yet.</p>}
   <p>Payment is complete once confirmed. Record delivered supplies in Inventory.</p>
   <details><summary>Supplier payment status</summary><p>{nativeReceipt?'Supplier payment confirmed independently.':review.settlement?'Receipt details are available in the order history.':'No supplier receipt has been recorded yet.'} Delivery is tracked separately.</p>{nativeReceipt&&<p><a className={styles.inlineLink} href={`https://testnet.nearblocks.io/txns/${encodeURIComponent(nativeReceipt.transactionHash)}`} target="_blank" rel="noreferrer">View confirmed supplier transfer ↗</a></p>}</details>
   <button className={styles.evidenceButton} disabled={busy} onClick={()=>void refresh()}>Refresh purchase status</button>
  </>}
  <p role="status">{busy?'Saving your update…':message}</p>
 </section>;
}

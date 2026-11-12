'use client';
import { useState } from 'react';
import Link from 'next/link';
import { caseStateLabel, parseWorkflowProjection, terminalStates, usdc, type WorkflowProjection } from '../lib/workflow';
import {displayTime,statusLabel} from '../lib/product-copy';

export function OperationsWorkspace({initialProjection=null,source='offline',publicPayments=false,testnetAssets=false}:{initialProjection?:WorkflowProjection|null;source?:'offline'|'authenticated';publicPayments?:boolean;testnetAssets?:boolean}) {
 const [snapshot,setSnapshot]=useState(initialProjection);
 const [selected,setSelected]=useState(initialProjection?.cases[0]?.caseId ?? '');
 const [filter,setFilter]=useState('all'); const [error,setError]=useState('');
 const cases=snapshot?.cases.filter(c=>filter==='all'||(filter==='active'?!terminalStates.has(c.state):c.humanInterventions.length>0)) ?? [];
 const current=cases.find(c=>c.caseId===selected) ?? cases[0];
 const sandbox=current?.itemId.startsWith('sb-item-')??false;const asset=publicPayments||testnetAssets||sandbox?'demo credits':'sample credits';
 async function load(file:File|undefined) {
  if(!file)return;
  try {
   if(file.size>10*1024*1024)throw new Error('Choose an export smaller than 10 MB.');
   const parsed=parseWorkflowProjection(JSON.parse(await file.text()));
   setSnapshot(parsed);setSelected(parsed.cases[0]?.caseId ?? '');setError('');
  } catch {setSnapshot(null);setSelected('');setError('Could not open this report. Choose a saved CareCart order report and try again.');}
 }
 return <section className={`ops ${source==='authenticated'?'ops-auth-evidence':''}`}>
  <header className="ops-heading"><div><p className="eyebrow">CareCart · Orders</p><h2>{source==='offline'?'Open a saved order report':'Order activity'}</h2><p>Review stock needs, supplier offers and payment updates.</p></div><Link href="/">CareCart home →</Link></header>
  <section className="ops-notice" aria-label="About these records"><strong>{source==='offline'?'Saved report':'Order history'}</strong><p>{source==='offline'?'Saved reports are for reference only. Payment details in a file are not verified here.':'Status updates are shown with the time they were recorded.'}</p></section>
  {source==='offline'&&<section className="ops-import"><label htmlFor="workflow-file">Choose a saved order report <span>(JSON, up to 10 MB)</span></label><input id="workflow-file" type="file" accept="application/json,.json" onChange={e=>void load(e.target.files?.[0])}/>{error&&<p role="alert">{error}</p>}</section>}
  {snapshot ? <>
   <div className="ops-summary"><div><span>Requests</span><strong>{snapshot.cases.length}</strong></div><div><span>In progress</span><strong>{snapshot.cases.filter(c=>!terminalStates.has(c.state)).length}</strong></div><div><span>Needs review</span><strong>{snapshot.cases.filter(c=>c.humanInterventions.length>0).length}</strong></div><div><span>{source==='offline'?'Report date':'Updated'}</span><strong className="ops-time">{displayTime(snapshot.generatedAt)}</strong></div></div>
   <details><summary>Advanced report details</summary><p>Reference <code>{snapshot.profileFingerprint}</code></p></details>
   <div className="ops-columns">{source==='offline'&&<aside className="ops-panel"><div className="ops-panel-heading"><h2>Requests</h2><label>Show <select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All requests</option><option value="active">In progress</option><option value="attention">Needs review</option></select></label></div>
    {cases.length?<ul className="ops-case-list">{cases.map(c=><li key={c.caseId}><button type="button" aria-pressed={c.caseId===current?.caseId} onClick={()=>setSelected(c.caseId)}><strong>{c.item?.name ?? c.itemId}</strong><span>{caseStateLabel(c)}</span>{c.humanInterventions.length>0&&<span className="ops-attention">{statusLabel(c.nextAction)}</span>}</button></li>)}</ul>:<p>No requests match this view.</p>}
   </aside>}
   {current&&<article className="ops-details" aria-label={`Order for ${current.item?.name ?? current.itemId}`}>
    <section className="ops-panel"><h2>{current.item?.name ?? current.itemId}</h2><p className="ops-state">{caseStateLabel(current)}</p><dl><dt>Next step</dt><dd>{statusLabel(current.nextAction)}</dd><dt>Needs review</dt><dd>{current.humanInterventions.map(statusLabel).join(' · ')||'No further review'}</dd><dt>Updated</dt><dd>{displayTime(current.updatedAt)}</dd></dl>
     <details><summary>Order reference</summary><p>{current.caseId}</p><p>Request reference: {current.eventId}</p></details>
     {source==='offline'&&<p>This saved report is read-only. Open the live workspace to take action.</p>}
    </section>
    <section className="ops-panel"><h3>Stock and supplier offers</h3>{current.item&&<p>{current.item.onHand} on hand · reorder at {current.item.reorderPoint} · {current.item.usageUnits} used in the past 30 days</p>}
     <div className="ops-scroll" tabIndex={0} aria-label="Supplier offers"><table><caption>Example supplier offers · amounts in {asset}</caption><thead><tr><th scope="col">Supplier</th><th scope="col">Delivery time</th><th scope="col">Suggested / order quantity</th><th scope="col">Total · {asset}</th><th scope="col">Offer</th></tr></thead><tbody>{current.quotes.map((q,index)=>{const f=current.forecasts.find(f=>f.supplierId===q.supplierId);return <tr key={q.id}><td>Supplier {index+1}</td><td>{f?.leadTimeDays ?? '—'} days</td><td>{f?.leadTimeDemand ?? '—'} / {q.quantity}</td><td>{usdc(q.amountAtomic)}</td><td>{q.id===current.selection?.quoteId?'Selected':'Other offer'}<small>Expires {displayTime(q.expiresAt)}</small></td></tr>;})}</tbody></table></div>
     <p>{current.selection?'An offer has been selected based on the clinic’s settings.':'No supplier offer has been selected yet.'}</p>
    </section>
    <section className="ops-panel"><h3>Payment status</h3>{current.vault?<><p><strong>{statusLabel(current.vault.status)}</strong></p><p>Last checked {displayTime(current.vault.checkedAt)}</p><details><summary>More payment details</summary><dl><dt>Reason</dt><dd>{current.vault.reason}</dd><dt>Payment attempt</dt><dd>{current.vault.attemptId||'Same account'}</dd><dt>Daily limit date</dt><dd>{current.vault.reservedDay}</dd></dl></details></>:<p>Payment status has not been checked yet.</p>}
     <h3>Recipient confirmation</h3><p>{current.settlement?statusLabel(current.settlement.state):'No recipient confirmation yet.'}</p>
     {current.state==='SourceDispatched'&&<p className="ops-attention">Payment sent; recipient confirmation is still pending.</p>}
     {current.settlement?.state==='Refunded'&&<p>{current.settlement.fullRefund?'Full refund recorded.':'Partial refund; clinic review is needed.'}</p>}
     {current.settlementReferences.length>0&&<details><summary>Confirmation references</summary>{current.settlementReferences.map(a=><p key={a.id}>{a.id} · {statusLabel(a.state)}</p>)}</details>}
    </section>
    <details><summary>Advanced payment records</summary>{current.operations.length?<ul>{current.operations.map(op=><li key={op.id}><code>{op.id}</code> — {statusLabel(op.state)}</li>)}</ul>:<p>No additional payment records.</p>}</details>
    <section className="ops-panel"><h3>Order activity</h3><ol className="ops-timeline">{current.timeline.map((e,index)=><li key={index}><strong>{statusLabel(e.eventType)}</strong><p>{e.previousState?statusLabel(e.previousState):'Request created'} → {statusLabel(e.resultingState)}</p><small>{displayTime(e.timestamp)}</small><details><summary>Activity record</summary><p>{e.actor} · {e.operationId??'No payment reference'}</p><code>{e.evidenceReference}</code></details></li>)}</ol></section>
   </article>}
   </div>
  </>:<section className="ops-panel ops-empty"><h2>Choose a saved order report</h2><p>Open a report to review its stock levels, supplier offers and payment updates.</p></section>}
 </section>;
}

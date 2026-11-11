'use client';
import { useState } from 'react';
import Link from 'next/link';
import { caseStateLabel, parseWorkflowProjection, stateText, terminalStates, usdc, type WorkflowProjection } from '../lib/workflow';

export function OperationsWorkspace({initialProjection=null,source='offline',publicPayments=false,testnetAssets=false}:{initialProjection?:WorkflowProjection|null;source?:'offline'|'authenticated';publicPayments?:boolean;testnetAssets?:boolean}) {
 const [snapshot,setSnapshot]=useState(initialProjection);
 const [selected,setSelected]=useState(initialProjection?.cases[0]?.caseId ?? '');
 const [filter,setFilter]=useState('all'); const [error,setError]=useState('');
 const cases=snapshot?.cases.filter(c=>filter==='all'||(filter==='active'?!terminalStates.has(c.state):c.humanInterventions.length>0)) ?? [];
 const current=cases.find(c=>c.caseId===selected) ?? cases[0];
 const sandbox=current?.itemId.startsWith('sb-item-')??false;const asset=publicPayments||testnetAssets?'CCUSD test token':sandbox?'CCUSD local test token':'USDC';
 async function load(file:File|undefined) {
  if(!file)return;
  try {
   if(file.size>10*1024*1024)throw new Error('Choose an export smaller than 10 MB.');
   const parsed=parseWorkflowProjection(JSON.parse(await file.text()));
   setSnapshot(parsed);setSelected(parsed.cases[0]?.caseId ?? '');setError('');
  } catch {setSnapshot(null);setSelected('');setError('This file is not a supported CareCart workflow export, or its financial state lacks matching evidence.');}
 }
 return <section className={`ops ${source==='authenticated'?'ops-auth-evidence':''}`}>
  <header className="ops-heading"><div><p className="eyebrow">CareCart · Procurement</p><h2>{source==='offline'?'Offline case inspection':'Order activity'}</h2><p>Review the forecast, supplier choice and payment evidence.</p></div><Link href="/">CareCart home →</Link></header>
  <section className="ops-notice" aria-label="Evidence boundary"><strong>{source==='offline'?'Offline snapshot · unauthenticated':'Saved order records'}</strong><p>{source==='offline'?'Import a saved export from the case worker. No file is uploaded. This browser does not authenticate the file or verify chain evidence.':'Recorded observations are shown with their timestamps.'} Recorded public RPC observations require fresh revalidation; mocked execution never proves USDC settlement.</p></section>
  {source==='offline'&&<section className="ops-import"><label htmlFor="workflow-file">Open workflow export <span>(JSON, up to 10 MB)</span></label><input id="workflow-file" type="file" accept="application/json,.json" onChange={e=>void load(e.target.files?.[0])}/>{error&&<p role="alert">{error}</p>}</section>}
  {snapshot ? <>
   <div className="ops-summary"><div><span>Cases</span><strong>{snapshot.cases.length}</strong></div><div><span>Active</span><strong>{snapshot.cases.filter(c=>!terminalStates.has(c.state)).length}</strong></div><div><span>Human attention</span><strong>{snapshot.cases.filter(c=>c.humanInterventions.length>0).length}</strong></div><div><span>{source==='offline'?'Exported at (UTC)':'Read at (UTC)'}</span><strong className="ops-time">{snapshot.generatedAt}</strong></div></div>
   <p className="ops-fingerprint">Profile fingerprint <code>{snapshot.profileFingerprint}</code></p>
   <div className="ops-columns">{source==='offline'&&<aside className="ops-panel"><div className="ops-panel-heading"><h2>Cases</h2><label>Show <select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All cases</option><option value="active">Active cases</option><option value="attention">Human attention</option></select></label></div>
    {cases.length?<ul className="ops-case-list">{cases.map(c=><li key={c.caseId}><button type="button" aria-pressed={c.caseId===current?.caseId} onClick={()=>setSelected(c.caseId)}><strong>{c.item?.name ?? c.itemId}</strong><span>{c.caseId}</span><span>{caseStateLabel(c)}</span>{c.humanInterventions.length>0&&<span className="ops-attention">{stateText(c.nextAction)}</span>}</button></li>)}</ul>:<p>No cases match this view.</p>}
   </aside>}
   {current&&<article className="ops-details" aria-label={`Case ${current.caseId}`}>
    <section className="ops-panel"><p className="eyebrow">{current.caseId} · Event {current.eventId}</p><h2>{current.item?.name ?? current.itemId}</h2><p className="ops-state">{caseStateLabel(current)}</p><dl><dt>Business workflow</dt><dd>{stateText(current.state)}</dd><dt>Payment authorization</dt><dd>{stateText(current.nextAction)}</dd><dt>Human intervention</dt><dd>{current.humanInterventions.map(stateText).join(' · ')||'None recorded'}</dd><dt>Last workflow update</dt><dd>{current.updatedAt} UTC</dd></dl>
     {source==='offline'&&<><fieldset disabled className="ops-controls"><legend>Operational controls unavailable</legend><button>Commit PO</button><button>Request payment</button><button>Review in wallet</button></fieldset><p>Signing requires a separately authorized role worker. Authenticated v2 wallet integration is not connected.</p></>}
    </section>
    <section className="ops-panel"><h3>Inventory and forecast</h3>{current.item&&<p>{current.item.onHand} on hand · reorder point {current.item.reorderPoint} · {current.item.usageUnits} units used in the synthetic 30-day window</p>}
     <div className="ops-scroll" tabIndex={0} aria-label="Supplier forecast comparison"><table><caption>Deterministic supplier comparison · proposed six-decimal {asset} terms</caption><thead><tr><th scope="col">Supplier</th><th scope="col">Lead time</th><th scope="col">Demand / quantity</th><th scope="col">Total {asset}</th><th scope="col">Selection</th></tr></thead><tbody>{current.quotes.map(q=>{const f=current.forecasts.find(f=>f.supplierId===q.supplierId);return <tr key={q.id}><td>{q.supplierAccount}<small>{q.id}</small></td><td>{f?.leadTimeDays ?? '—'} days</td><td>{f?.leadTimeDemand ?? '—'} / {q.quantity}</td><td>{usdc(q.amountAtomic)}</td><td>{q.id===current.selection?.quoteId?'Selected':'Alternative'}<small>Expires {q.expiresAt}</small></td></tr>;})}</tbody></table></div>
     <p>Decision: {current.selection?stateText(current.selection.policy):'Not selected'}. Resolution rechecks the trusted catalog and deterministic selection.</p>
    </section>
    <section className="ops-panel"><h3>Purchase order</h3><dl><dt>PO ID</dt><dd><code>{current.poId ?? 'Not drafted'}</code></dd><dt>Canonical hash</dt><dd><code>{current.poHash ?? 'Not available'}</code></dd><dt>Proposed terms</dt><dd>{current.selection?`${usdc(current.selection.amount)} ${asset} · ${current.selection.destination}`:'Not drafted'}</dd></dl><p>These terms are a projection, not an independent authority to spend or evidence of available funds.</p></section>
    <section className="ops-panel"><h3>Latest recorded vault observation</h3>{current.vault?<><p>{current.evidenceKind==='sandbox-rpc'?'Real local Sandbox RPC · CCUSD, not Circle USDC':current.evidenceKind==='mocked-rpc'?'Mocked RPC execution': 'Recorded public RPC observation · revalidate before acting'}</p><dl><dt>Vault payment state</dt><dd>{current.evidenceKind==='mocked-rpc'?'Mocked ': 'Recorded '}{current.vault.status}</dd><dt>Reason</dt><dd>{current.vault.reason}</dd><dt>Observed at</dt><dd>{current.vault.checkedAt}</dd><dt>Reserved UTC day</dt><dd>{current.vault.reservedDay}</dd><dt>Attempt</dt><dd>{current.vault.attemptId||'Same-chain'}</dd></dl></>:<p>No independently checked vault observation is recorded.</p>}
     <h3>Cross-chain settlement</h3><p>{current.settlement?`${current.evidenceKind==='mocked-rpc'?'Mocked':'Recorded'} ${current.settlement.state} · ${current.settlement.attemptId}`:'No destination or refund receipt verification recorded.'}</p>
     {current.state==='SourceDispatched'&&<p className="ops-attention">Source dispatch is recorded. Destination settlement is still unconfirmed.</p>}
     {current.settlement?.state==='Refunded'&&<p>{current.settlement.fullRefund?'Full refund recorded.':'Partial refund: human reconciliation required.'}</p>}
     {current.settlementReferences.map(a=><p key={a.id}>Journal reference {a.id}: {a.state} (saved journal label; not independent proof)</p>)}
    </section>
    <section className="ops-panel"><h3>Payment operations</h3>{current.operations.length?<ul>{current.operations.map(op=><li key={op.id}><code>{op.id}</code> — {op.state}{op.state!=='Confirmed'?' · unresolved; do not resend':''}</li>)}</ul>:<p>No operation journal entries. A pending workflow without its expected operation record requires human adjudication.</p>}</section>
    <section className="ops-panel"><h3>Audit timeline</h3><ol className="ops-timeline">{current.timeline.map((e,index)=><li key={index}><strong>{stateText(e.eventType)}</strong><p>{e.previousState?stateText(e.previousState):'New case'} → {stateText(e.resultingState)}</p><small>{e.actor} · {e.timestamp}</small>{e.operationId&&<p><code>{e.operationId}</code></p>}<details><summary>Evidence reference</summary><code>{e.evidenceReference}</code></details></li>)}</ol></section>
   </article>}
   </div>
  </>:<section className="ops-panel ops-empty"><h2>Open a case export to begin</h2><p>The case worker exports actual persisted cases, quotes, operation references and audit events. This workspace contains no preloaded success scenarios.</p></section>}
 </section>;
}

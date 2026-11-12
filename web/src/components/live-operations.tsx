'use client';
import { useCallback,useEffect,useRef,useState } from 'react';
import Link from 'next/link';
import { OperatorClient,OperatorApiError,acceptCaseRevision,type AgentRun,type AgentTarget,type OperatorSession } from '../lib/operator-client';
import { caseStateLabel,type WorkflowProjection } from '../lib/workflow';
import { OperationsWorkspace } from './operations-workspace';
import {V2WalletReview} from './v2-wallet-review';
import {InventoryOperations} from './inventory-operations';
import {actionError,displayTime,statusLabel} from '../lib/product-copy';
type Detail=Awaited<ReturnType<OperatorClient['detail']>>;
const empty:WorkflowProjection={generatedAt:'',profileFingerprint:'',cases:[]};
function requestedAppPath(){const path=new URLSearchParams(window.location.search).get('next');return path&&/^\/app(?:\/[A-Za-z0-9_-]+)*$/.test(path)?path:null;}
export function OperationsHub(){const [mode,setMode]=useState<'live'|'offline'>('live');
 return <main><nav className="ops-mode" aria-label="Workspace view"><button aria-pressed={mode==='live'} onClick={()=>setMode('live')}>Clinic workspace</button><button aria-pressed={mode==='offline'} onClick={()=>setMode('offline')}>Open saved report</button></nav>
 {mode==='live'?<LiveOperations/>:<OperationsWorkspace/>}</main>;
}
export function LiveOperations(){
 const [client]=useState(()=>new OperatorClient());const [session,setSession]=useState<OperatorSession|null>(null);const [checking,setChecking]=useState(true);
 const [credential,setCredential]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);
 const [page,setPage]=useState({projection:empty,total:0,nextOffset:null as number|null});const [filter,setFilter]=useState('all');const [offset,setOffset]=useState(0);const [listLoading,setListLoading]=useState(true);
 const [detail,setDetail]=useState<Detail|null>(null);const detailRef=useRef<Detail|null>(null);const [detailLoading,setDetailLoading]=useState(false);
 const listGeneration=useRef(0);const detailGeneration=useRef(0);
 const [inventory,setInventory]=useState<{id:string;name:string;onHand:number;reorderPoint:number}[]>([]);const [itemId,setItemId]=useState('');
 const [execution,setExecution]=useState<'provider'|'deterministic'>('deterministic');const [runs,setRuns]=useState<AgentRun[]>([]);const [run,setRun]=useState<AgentRun|null>(null);const [requestId,setRequestId]=useState('');
 const [audit,setAudit]=useState<{eventType:string;timestamp:string;previousState:string|null;resultingState:string}[]>([]);const [auditNext,setAuditNext]=useState<number|null>(0);
 const onError=useCallback((cause:unknown)=>{if(cause instanceof OperatorApiError&&cause.status===401){listGeneration.current++;detailGeneration.current++;setSession(null);setPage({projection:empty,total:0,nextOffset:null});setDetail(null);detailRef.current=null;setRuns([]);setRun(null);setInventory([]);}
  setError(actionError(cause,'Requests are temporarily unavailable. Refresh to try again.'));},[]);
 useEffect(()=>{let active=true;client.session().then(s=>{if(active){setSession(s);const destination=requestedAppPath();if(destination)window.location.replace(destination);}}).catch(cause=>{if(active&&(!(cause instanceof OperatorApiError)||cause.status!==401))onError(cause);}).finally(()=>{if(active)setChecking(false);});return()=>{active=false;};},[client,onError]);
 const loadPage=useCallback(async(f:string,o:number)=>{const generation=++listGeneration.current;
  try{const next=await client.cases(f,o);if(generation===listGeneration.current)setPage(next);}catch(cause){onError(cause);}finally{if(generation===listGeneration.current)setListLoading(false);}},[client,onError]);
 const loadDetail=useCallback(async(id:string)=>{const generation=++detailGeneration.current;setDetailLoading(true);setAudit([]);setAuditNext(0);
  try{const next=await client.detail(id);if(generation!==detailGeneration.current)return;
   const prior=detailRef.current;if(prior&&prior.projection.cases[0].caseId===id&&!acceptCaseRevision(id,prior.revision,id,next.revision))return;
   detailRef.current=next;setDetail(next);
  }catch(cause){onError(cause);}finally{if(generation===detailGeneration.current)setDetailLoading(false);}},[client,onError]);
 useEffect(()=>{if(!session)return;let active=true;const generation=++listGeneration.current;
  client.cases(filter,offset).then(next=>{if(active&&generation===listGeneration.current)setPage(next);}).catch(onError).finally(()=>{if(active&&generation===listGeneration.current)setListLoading(false);});
  return()=>{active=false;};},[session,filter,offset,client,onError]);
 useEffect(()=>{if(!session)return;let active=true;Promise.all([client.inventory(),client.recent()]).then(([items,recent])=>{if(active){setInventory(items);setRuns(recent);}}).catch(onError);return()=>{active=false;};},[session,client,onError]);
 async function login(){setBusy(true);setListLoading(true);setError('');try{setSession(await client.login(credential));
  const destination=requestedAppPath();if(destination)window.location.replace(destination);
 }catch(cause){onError(cause);}finally{setCredential('');setBusy(false);}}
 async function execute(target:AgentTarget,mode=execution,fallbackOf?:string){setBusy(true);setError('');const id=crypto.randomUUID();setRequestId(id);
  try{const result=await client.run({requestId:id,mode,target,...(fallbackOf?{fallbackOf}:{})});setRun(result);await loadPage(filter,offset);
   if(target.kind==='case'||result.result?.decision||result.steps.some(step=>step.tool==='prepare_replenishment_case'&&step.state==='Completed'))await loadDetail(result.caseId);setRuns(await client.recent());
  }catch(cause){onError(cause);if(cause instanceof OperatorApiError&&cause.code==='STALE_CASE'&&target.kind==='case')await loadDetail(target.caseId);}finally{setBusy(false);}}
 async function inspectRun(id:string){setBusy(true);try{setRun(await client.inspectRun(id));}catch(cause){onError(cause);}finally{setBusy(false);}}
 async function reconcileRun(id:string){setBusy(true);try{const result=await client.reconcileRun(id);setRun(result);await loadPage(filter,offset);setRuns(await client.recent());}catch(cause){onError(cause);}finally{setBusy(false);}}
 async function loadAudit(){if(!detail||auditNext===null)return;const id=detail.projection.cases[0].caseId;try{const next=await client.events(id,auditNext);
  if(detailRef.current?.projection.cases[0].caseId!==id||detailRef.current?.revision!==next.revision){setError('This request has changed. Refresh it before viewing more activity.');return;}
  setAudit(prior=>[...prior,...next.events]);setAuditNext(next.nextOffset);
 }catch(cause){onError(cause);}}
 const selected=detail?.projection.cases[0];
 const refreshInventoryCases=useCallback(()=>loadPage(filter,offset),[loadPage,filter,offset]);
 return <section className="ops live-ops"><header className="ops-heading"><div><p className="eyebrow">CareCart · Clinic workspace</p><h1>Purchase requests</h1><p>Review supplies to restock, compare offers and check payment status.</p></div><Link href="/">CareCart home →</Link></header>
  <section className="ops-notice"><strong>Demo workspace</strong><p>Sample supplier offers and payment amounts are shown for illustration. No real money is involved. Purchase planning cannot approve or send payments.</p></section>
  {error&&<p className="ops-error" role="alert">{error}</p>}
  {checking?<p role="status">Checking your access…</p>:!session?<form className="ops-panel ops-login" onSubmit={e=>{e.preventDefault();void login();}}><h2>Sign in to your clinic</h2><p>Use the access code provided by your clinic administrator.</p><label htmlFor="operator-password">Access code</label><input id="operator-password" type="password" autoComplete="current-password" maxLength={256} value={credential} onChange={e=>setCredential(e.target.value)} required/><button disabled={busy}>{busy?'Signing in…':'Sign in'}</button></form>:<>
   <div className="ops-session"><span>Signed in as {session.role==='operator'?'clinic staff':'viewer'}</span><button disabled={busy} onClick={()=>void client.logout().then(()=>{setSession(null);setDetail(null);detailRef.current=null;setRun(null);setPage({projection:empty,total:0,nextOffset:null});}).catch(onError)}>Sign out</button></div>
   {session.inventoryRuntime&&<InventoryOperations client={client} operator={session.role==='operator'} onChanged={refreshInventoryCases} onFailure={onError}/>}
   <section className="ops-panel ops-agent-start"><h2>Purchase planning help</h2><p>{session.providerAvailable?'Get help reviewing stock and supplier offers.':'AI assistance is not enabled. Standard checks are still available.'}</p>
    <label>Review with <select value={execution} onChange={e=>setExecution(e.target.value as 'provider'|'deterministic')} disabled={busy}><option value="provider" disabled={!session.providerAvailable}>AI assistance</option><option value="deterministic">Standard checks</option></select></label>
    {session.inventoryRuntime?<p>Automatic stock monitoring creates requests. Choose a request below to review it.</p>:<form onSubmit={e=>{e.preventDefault();void execute({kind:'item',itemId,eventId:crypto.randomUUID()});}}><label htmlFor="agent-item">Supply</label><select id="agent-item" required value={itemId} onChange={e=>setItemId(e.target.value)} disabled={busy||session.role!=='operator'}><option value="">Choose a supply</option>{inventory.map(item=><option key={item.id} value={item.id}>{item.name} · {item.onHand} on hand</option>)}</select><button disabled={busy||!itemId||session.role!=='operator'}>{busy?'Checking…':'Check stock and prepare request'}</button></form>}
    <p>{execution==='deterministic'?'Standard checks compare stock, offers and clinic settings.':'AI can suggest next steps, but cannot approve or send a payment.'}</p>
    {requestId&&<details><summary>Last check details</summary><p>Reference <code>{requestId}</code></p><button type="button" disabled={busy} onClick={()=>void inspectRun(requestId)}>Refresh check details</button></details>}
   </section>
   <div className="ops-columns"><aside className="ops-panel"><h2>Requests</h2><label>Show <select value={filter} disabled={busy} onChange={e=>{setListLoading(true);setFilter(e.target.value);setOffset(0);}}><option value="all">All requests</option><option value="active">In progress</option><option value="attention">Needs review</option></select></label><p>{page.total} requests</p>
    {listLoading?<p role="status">Loading requests…</p>:page.projection.cases.length?<ul className="ops-case-list">{page.projection.cases.map(c=><li key={c.caseId}><button disabled={busy} aria-pressed={selected?.caseId===c.caseId} onClick={()=>void loadDetail(c.caseId)}><strong>{c.item?.name ?? c.itemId}</strong><span>{caseStateLabel(c)}</span><span>{statusLabel(c.nextAction)}</span></button></li>)}</ul>:<p>No requests found. Record stock or refresh the list.</p>}
    <div className="ops-pagination"><button disabled={busy||offset===0} onClick={()=>(setListLoading(true),setOffset(Math.max(0,offset-20)))}>Previous</button><button disabled={busy||page.nextOffset===null} onClick={()=>(setListLoading(true),setOffset(page.nextOffset!))}>Next</button><button disabled={busy} onClick={()=>void loadPage(filter,offset)}>Refresh requests</button></div>
    <h3>Recent checks</h3>{runs.length?<ul>{runs.map(r=><li key={r.id}><details><summary>{statusLabel(r.state)} · {displayTime(r.startedAt)}</summary><button disabled={busy} onClick={()=>void inspectRun(r.id)}>View check details</button></details></li>)}</ul>:<p>No checks recorded yet.</p>}
   </aside><div className="ops-details">
    {detailLoading?<section className="ops-panel" role="status">Loading request details…</section>:detail&&selected?<>
     <section className="ops-panel"><h2>{selected.item?.name ?? 'Supply request'}</h2><p>{caseStateLabel(selected)} · {statusLabel(selected.nextAction)}</p><button disabled={busy} onClick={()=>void loadDetail(selected.caseId)}>Refresh request</button><button disabled={busy||session.role!=='operator'} onClick={()=>void execute({kind:'case',caseId:selected.caseId,expectedRevision:detail.revision})}>Review stock and offers</button></section>
     <OperationsWorkspace key={`${selected.caseId}:${detail.revision}`} initialProjection={detail.projection} source="authenticated"/>
     <V2WalletReview key={`${selected.caseId}:${detail.revision}:${detail.walletReviews[0]?.id??'none'}:${detail.walletReviews[0]?.eventCount??detail.walletReviews[0]?.events.length??0}`} client={client} session={session} caseId={selected.caseId} revision={detail.revision}
      paymentState={selected.paymentState} reviews={detail.walletReviews} onRefresh={()=>loadDetail(selected.caseId)}/>
     <section className="ops-panel"><h3>Recent activity</h3><p>{detail.eventCount} updates recorded.</p><ol>{audit.map((e,i)=><li key={i}><strong>{statusLabel(e.eventType)}</strong><p>{e.previousState?statusLabel(e.previousState):'Request created'} → {statusLabel(e.resultingState)}</p><time>{displayTime(e.timestamp)}</time></li>)}</ol><button disabled={busy||auditNext===null} onClick={()=>void loadAudit()}>Show older updates</button></section>
    </>:<section className="ops-panel"><h2>Choose a request</h2><p>Review its stock levels, supplier offers and payment status.</p></section>}
    {run&&<section className="ops-panel ops-run" aria-label="Latest check"><h2>Latest check · {statusLabel(run.state)}</h2><p>{run.state==='Failed'?'This check could not be completed. Refresh the request before trying again.':run.state==='Running'?'This check is still running. Check back shortly.':'Review the suggested next step below.'}</p>
     {run.error&&<p className="ops-error">We couldn’t complete this check. No payment was sent.</p>}
     {run.state==='Running'&&<p className="ops-attention">Wait for this check to finish before trying again.</p>}
     {run.requiresReconciliation&&<button disabled={busy||session.role!=='operator'} onClick={()=>void reconcileRun(run.id)}>Refresh check status</button>}
     {run.result?.decision&&<><h3>Suggested next step</h3><p>{run.result.decision.explanation}</p><p>Next: {statusLabel(run.result.decision.nextAction)}</p></>}
     {run.state==='Failed'&&run.mode==='provider'&&session.role==='operator'&&<button disabled={busy} onClick={()=>{if(run.target.kind==='item')void execute(run.target,'deterministic',run.id);else void client.detail(run.caseId).then(fresh=>execute({kind:'case',caseId:run.caseId,expectedRevision:fresh.revision},'deterministic',run.id)).catch(onError);}}>Retry with standard checks</button>}
     <details><summary>Advanced check details</summary><p>Reference <code>{run.id}</code> · {run.provider} · {run.model} · {run.durationMs} ms</p><p>Check type: {run.execution} · AI response received: {String(run.inferencePerformed)}</p><ol>{run.steps.map(step=><li key={step.callId}><strong>{step.tool}</strong> · {statusLabel(step.state)}<details><summary>Check details</summary><pre>{JSON.stringify({arguments:step.arguments,result:step.result},null,2)}</pre></details></li>)}</ol></details>
    </section>}
   </div></div>
  </>}
 </section>;
}

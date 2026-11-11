'use client';
import { useCallback,useEffect,useRef,useState } from 'react';
import Link from 'next/link';
import { OperatorClient,OperatorApiError,acceptCaseRevision,type AgentRun,type AgentTarget,type OperatorSession } from '../lib/operator-client';
import { caseStateLabel,stateText,type WorkflowProjection } from '../lib/workflow';
import { OperationsWorkspace } from './operations-workspace';
import {V2WalletReview} from './v2-wallet-review';
import {InventoryOperations} from './inventory-operations';
type Detail=Awaited<ReturnType<OperatorClient['detail']>>;
const empty:WorkflowProjection={generatedAt:'',profileFingerprint:'',cases:[]};
function requestedAppPath(){const path=new URLSearchParams(window.location.search).get('next');return path&&/^\/app(?:\/[A-Za-z0-9_-]+)*$/.test(path)?path:null;}
export function OperationsHub(){const [mode,setMode]=useState<'live'|'offline'>('live');
 return <main><nav className="ops-mode" aria-label="Operations data source"><button aria-pressed={mode==='live'} onClick={()=>setMode('live')}>Authenticated live workspace</button><button aria-pressed={mode==='offline'} onClick={()=>setMode('offline')}>Offline JSON inspection</button></nav>
 {mode==='live'?<LiveOperations/>:<OperationsWorkspace/>}</main>;
}
export function LiveOperations(){
 const [client]=useState(()=>new OperatorClient());const [session,setSession]=useState<OperatorSession|null>(null);const [checking,setChecking]=useState(true);
 const [credential,setCredential]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);
 const [page,setPage]=useState({projection:empty,total:0,nextOffset:null as number|null});const [filter,setFilter]=useState('all');const [offset,setOffset]=useState(0);const [listLoading,setListLoading]=useState(true);
 const [detail,setDetail]=useState<Detail|null>(null);const detailRef=useRef<Detail|null>(null);const [detailLoading,setDetailLoading]=useState(false);
 const listGeneration=useRef(0);const detailGeneration=useRef(0);
 const [inventory,setInventory]=useState<{id:string;name:string;onHand:number;reorderPoint:number}[]>([]);const [itemId,setItemId]=useState('');const [eventId,setEventId]=useState('');
 const [execution,setExecution]=useState<'provider'|'deterministic'>('deterministic');const [runs,setRuns]=useState<AgentRun[]>([]);const [run,setRun]=useState<AgentRun|null>(null);const [requestId,setRequestId]=useState('');
 const [audit,setAudit]=useState<{eventType:string;timestamp:string;previousState:string|null;resultingState:string}[]>([]);const [auditNext,setAuditNext]=useState<number|null>(0);
 const onError=useCallback((cause:unknown)=>{if(cause instanceof OperatorApiError&&cause.status===401){listGeneration.current++;detailGeneration.current++;setSession(null);setPage({projection:empty,total:0,nextOffset:null});setDetail(null);detailRef.current=null;setRuns([]);setRun(null);setInventory([]);}
  setError(cause instanceof Error?cause.message.slice(0,160):'OPERATIONS_UNAVAILABLE');},[]);
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
  if(detailRef.current?.projection.cases[0].caseId!==id||detailRef.current?.revision!==next.revision){setError('STALE_CASE: refresh the case before loading audit events.');return;}
  setAudit(prior=>[...prior,...next.events]);setAuditNext(next.nextOffset);
 }catch(cause){onError(cause);}}
 const selected=detail?.projection.cases[0];
 const refreshInventoryCases=useCallback(()=>loadPage(filter,offset),[loadPage,filter,offset]);
 return <section className="ops live-ops"><header className="ops-heading"><div><p className="eyebrow">CareCart · Local synthetic operations</p><h1>Procurement operations</h1><p>Persisted cases, constrained manual AI and independently recorded evidence. No financial execution is exposed here.</p></div><Link href="/">CareCart home →</Link></header>
  <section className="ops-notice"><strong>Local-synthetic service · financial controls unavailable</strong><p>Authenticated reads use the local case database. Proposed USDC terms are not balances or settlement. AI cannot sign, request payment or approve a payout. No TEE verification is claimed.</p></section>
  {error&&<p className="ops-error" role="alert">{error}{error.startsWith('AUTH_')?' — Your session expired. Sign in again.':''}</p>}
  {checking?<p role="status">Checking operator session…</p>:!session?<form className="ops-panel ops-login" onSubmit={e=>{e.preventDefault();void login();}}><h2>Operator sign in</h2><p>Use the credential configured on the local operations service. It is never bundled into this application.</p><label htmlFor="operator-password">Operator or viewer credential</label><input id="operator-password" type="password" autoComplete="current-password" maxLength={256} value={credential} onChange={e=>setCredential(e.target.value)} required/><button disabled={busy}>{busy?'Signing in…':'Sign in'}</button></form>:<>
   <div className="ops-session"><span>Authenticated {session.role} · expires {session.expiresAt}</span><button disabled={busy} onClick={()=>void client.logout().then(()=>{setSession(null);setDetail(null);detailRef.current=null;setRun(null);setPage({projection:empty,total:0,nextOffset:null});}).catch(onError)}>Sign out</button></div>
   {session.inventoryRuntime&&<InventoryOperations client={client} operator={session.role==='operator'} onChanged={refreshInventoryCases} onFailure={onError}/>}
   <section className="ops-panel ops-agent-start"><h2>Manual procurement execution</h2><p>Provider: {session.providerAvailable?`NEAR AI Cloud · ${session.model}`:'Not configured/enabled'}. Deterministic execution is available separately.</p>
    <label>Execution mode <select value={execution} onChange={e=>setExecution(e.target.value as 'provider'|'deterministic')} disabled={busy}><option value="provider" disabled={!session.providerAvailable}>NEAR AI Cloud inference</option><option value="deterministic">Deterministic domain execution — no inference</option></select></label>
    {session.inventoryRuntime?<p>The independent inventory worker creates cases from recorded stock activity. Select a persisted case to inspect its deterministic procurement evidence.</p>:<form onSubmit={e=>{e.preventDefault();const id=eventId.trim()||crypto.randomUUID();setEventId(id);void execute({kind:'item',itemId,eventId:id});}}><label htmlFor="agent-item">Registered synthetic inventory item</label><select id="agent-item" required value={itemId} onChange={e=>setItemId(e.target.value)} disabled={busy||session.role!=='operator'}><option value="">Select an item</option>{inventory.map(item=><option key={item.id} value={item.id}>{item.name} · {item.onHand} on hand</option>)}</select>
     <label htmlFor="agent-event">Inventory event ID (optional; generated once per action)</label><input id="agent-event" maxLength={64} pattern="[A-Za-z0-9_-]+" value={eventId} onChange={e=>setEventId(e.target.value)} disabled={busy||session.role!=='operator'}/><button disabled={busy||!itemId||session.role!=='operator'}>{busy?'Running…':'Run Procurement Agent'}</button></form>}
    <p>{execution==='deterministic'?'Explicit deterministic mode: no model inference will occur.':'Provider tool calls are constrained to this item/event or selected case. Model prose cannot change workflow/payment state.'}</p>
    {requestId&&<p>Last request <code>{requestId}</code> <button type="button" disabled={busy} onClick={()=>void inspectRun(requestId)}>Inspect saved run</button></p>}
   </section>
   <div className="ops-columns"><aside className="ops-panel"><h2>Persisted cases</h2><label>Show <select value={filter} disabled={busy} onChange={e=>{setListLoading(true);setFilter(e.target.value);setOffset(0);}}><option value="all">All</option><option value="active">Active</option><option value="attention">Human attention</option></select></label><p>{page.total} cases · page {Math.floor(offset/20)+1}</p>
    {listLoading?<p role="status">Loading cases…</p>:page.projection.cases.length?<ul className="ops-case-list">{page.projection.cases.map(c=><li key={c.caseId}><button disabled={busy} aria-pressed={selected?.caseId===c.caseId} onClick={()=>void loadDetail(c.caseId)}><strong>{c.item?.name ?? c.itemId}</strong><span>{c.caseId}</span><span>{caseStateLabel(c)}</span><span>{stateText(c.nextAction)}</span></button></li>)}</ul>:<p>No matching cases. Prepare a registered synthetic inventory item to begin.</p>}
    <div className="ops-pagination"><button disabled={busy||offset===0} onClick={()=>(setListLoading(true),setOffset(Math.max(0,offset-20)))}>Previous</button><button disabled={busy||page.nextOffset===null} onClick={()=>(setListLoading(true),setOffset(page.nextOffset!))}>Next</button><button disabled={busy} onClick={()=>void loadPage(filter,offset)}>Refresh list</button></div>
    <h3>Recent manual runs</h3>{runs.length?<ul>{runs.map(r=><li key={r.id}><button disabled={busy} onClick={()=>void inspectRun(r.id)}>{r.state} · {r.execution}<small>{r.id}</small></button></li>)}</ul>:<p>No manual runs recorded.</p>}
   </aside><div className="ops-details">
    {detailLoading?<section className="ops-panel" role="status">Loading case and validating persisted evidence…</section>:detail&&selected?<>
     <section className="ops-panel"><h2>Case {selected.caseId}</h2><p>Workflow revision {detail.revision} · {stateText(selected.nextAction)}</p><button disabled={busy} onClick={()=>void loadDetail(selected.caseId)}>Refresh case</button><button disabled={busy||session.role!=='operator'} onClick={()=>void execute({kind:'case',caseId:selected.caseId,expectedRevision:detail.revision})}>Run Procurement Agent on this case</button><p>A stale revision stops execution and requires another review.</p></section>
     <OperationsWorkspace key={`${selected.caseId}:${detail.revision}`} initialProjection={detail.projection} source="authenticated"/>
     <V2WalletReview key={`${selected.caseId}:${detail.revision}:${detail.walletReviews[0]?.id??'none'}:${detail.walletReviews[0]?.eventCount??detail.walletReviews[0]?.events.length??0}`} client={client} session={session} caseId={selected.caseId} revision={detail.revision}
      paymentState={selected.paymentState} reviews={detail.walletReviews} onRefresh={()=>loadDetail(selected.caseId)}/>
     <section className="ops-panel"><h3>Chronological audit events</h3><p>{detail.eventCount} persisted events. The case view shows the latest 100.</p><ol>{audit.map((e,i)=><li key={i}><strong>{stateText(e.eventType)}</strong> · {e.timestamp}<p>{e.previousState??'New'} → {e.resultingState}</p></li>)}</ol><button disabled={busy||auditNext===null} onClick={()=>void loadAudit()}>Load next audit page</button></section>
    </>:<section className="ops-panel"><h2>Select a case</h2><p>Inspect its forecast, quotes, canonical PO, recorded financial state and human intervention requirements.</p></section>}
    {run&&<section className="ops-panel ops-run" aria-label="Manual agent trace"><h2>Manual run · {run.state}</h2><p><code>{run.id}</code> · case {run.caseId}</p><p>{run.execution==='deterministic'?'Deterministic execution — no AI inference':run.execution==='mocked-provider'?'Mocked model execution — not genuine provider inference':run.inferencePerformed?'NEAR AI Cloud response received · TEE unverified':'Provider run · no verified inference response'} · {run.provider} · {run.model} · {run.durationMs} ms</p><p>Inference attempted: {String(run.inferenceAttempted)} · response received: {String(run.inferencePerformed)}</p>
     {run.error&&<p className="ops-error">{run.error.code} {run.error.httpStatus?`(HTTP ${run.error.httpStatus})`:''}. No automatic fallback or payment action occurred.</p>}
     {run.state==='Running'&&<p className="ops-attention">Run outcome is unresolved. Do not start another inference to repair this request.</p>}
     {run.requiresReconciliation&&<button disabled={busy||session.role!=='operator'} onClick={()=>void reconcileRun(run.id)}>Reconcile interrupted run (read only)</button>}
     {run.result?.decision&&<><h3>Deterministic domain decision</h3><p>{run.result.decision.explanation}</p><p>Next permitted action: {stateText(run.result.decision.nextAction)}</p></>}
     <ol>{run.steps.map(step=><li key={step.callId}><strong>{step.tool}</strong> · {step.state}<details><summary>Validated arguments and bounded result</summary><pre>{JSON.stringify({arguments:step.arguments,result:step.result},null,2)}</pre></details></li>)}</ol>
     {run.state==='Failed'&&run.mode==='provider'&&session.role==='operator'&&<button disabled={busy} onClick={()=>{if(run.target.kind==='item')void execute(run.target,'deterministic',run.id);else void client.detail(run.caseId).then(fresh=>execute({kind:'case',caseId:run.caseId,expectedRevision:fresh.revision},'deterministic',run.id)).catch(onError);}}>Run explicit deterministic fallback</button>}
    </section>}
   </div></div>
  </>}
 </section>;
}

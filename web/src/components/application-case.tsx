'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {OperationsWorkspace} from './operations-workspace';
import {FinancialReviewPanel} from './financial-review-panel';
import {V2WalletReview} from './v2-wallet-review';
import {useApplication} from './application-shell';
import type {AgentRun,OperatorClient,OperatorSession} from '../lib/operator-client';
import {actionError,displayTime,statusLabel} from '../lib/product-copy';
import styles from './application-view.module.css';

export function ApplicationCase({caseId,onClose}:{caseId:string;onClose:()=>void}) {
 const {client}=useApplication();const heading=useRef<HTMLHeadingElement>(null);useEffect(()=>heading.current?.focus(),[]);
 const [detail,setDetail]=useState<Awaited<ReturnType<OperatorClient['detail']>>|null>(null);
 const [session,setSession]=useState<OperatorSession|null>(null);
 const [error,setError]=useState('');
 const [running,setRunning]=useState(false);
 const [runError,setRunError]=useState('');
 const [latestRun,setLatestRun]=useState<AgentRun|null>(null);
 const refresh=useCallback(async()=>{
  try{const s=await client.session();const d=await client.detail(caseId);setSession(s);setDetail(d);setError('');}
  catch(cause){setDetail(null);setSession(null);setError(cause instanceof Error?cause.message:'CASE_UNAVAILABLE');}
 },[client,caseId]);
 useEffect(()=>{let active=true;
  client.session().then(async s=>{const d=await client.detail(caseId);if(active){setSession(s);setDetail(d);setLatestRun(d.runs[0]??null);}})
   .catch(cause=>{if(active)setError(cause instanceof Error?cause.message:'CASE_UNAVAILABLE');});
  return()=>{active=false;};
 },[client,caseId]);
 const canRunProcurement=!!session&&session.role==='operator'&&(!session.permissions||session.permissions.includes('procurement'));
 async function runAgent(mode:'provider'|'deterministic',fallbackOf?:string){
  if(!detail||running)return;
  setRunning(true);setRunError('');
  try{
   const result=await client.run({requestId:crypto.randomUUID(),mode,target:{kind:'case',caseId,expectedRevision:detail.revision},...(fallbackOf?{fallbackOf}:{})});
   setLatestRun(result);
   await refresh();
  }catch(cause){
   setRunError(actionError(cause,'Procurement run could not complete. Refresh the order before retrying.'));
   await refresh();
  }finally{setRunning(false);}
 }
 const activeRun=latestRun??detail?.runs[0]??null;
 return <section className={`${styles.caseEvidence} ops`} aria-label={`Order review for ${caseId}`}>
  <div className="ops-panel"><h2 ref={heading} tabIndex={-1}>Order review</h2><details><summary>Request reference</summary><p>{caseId}</p></details><button onClick={onClose}>Close order review</button></div>
  {error&&<p role="alert">{actionError(new Error(error),"Order details are unavailable. Refresh before retrying any payment action.")}</p>}
  {!detail&&!error&&<p role="status">Loading order details…</p>}
  {detail&&session&&<>
   <section className={styles.panel} aria-label="Procurement AI review">
    <h3>Procurement specialist · {session.providerAvailable?`NEAR AI Cloud (${session.model??'configured'})`:'Deterministic only'}</h3>
    <p>Run the constrained procurement specialist on this order to verify stock forecasts, supplier quotes and the next required action. AI cannot sign or initiate payments.</p>
    <div className="ops-actions">
     <button className={styles.evidenceButton} disabled={!canRunProcurement||!session.providerAvailable||running} onClick={()=>void runAgent('provider')}>{running?'Running NEAR AI Cloud…':'Evaluate with NEAR AI Cloud'}</button>
     <button className={styles.evidenceButton} disabled={!canRunProcurement||running} onClick={()=>void runAgent('deterministic',activeRun?.state==='Failed'&&activeRun.mode==='provider'?activeRun.id:undefined)}>{activeRun?.state==='Failed'&&activeRun.mode==='provider'?'Run deterministic fallback':'Run deterministic check'}</button>
    </div>
    {runError&&<p className={styles.error} role="alert">{runError}</p>}
    {activeRun&&<details open={activeRun.id===latestRun?.id}><summary>Latest run: {statusLabel(activeRun.state)} · {activeRun.execution==='live-provider'?`NEAR AI Cloud (${activeRun.model})`:activeRun.execution} · {activeRun.durationMs} ms</summary>
     <p>Started {displayTime(activeRun.startedAt)} · Inference performed: {activeRun.inferencePerformed?'Yes':'No'}</p>
     {activeRun.error&&<p className={styles.error} role="status">Run error: {activeRun.error.code}{activeRun.error.httpStatus?` (HTTP ${activeRun.error.httpStatus})`:''}</p>}
     {activeRun.result?.decision&&<p>{activeRun.result.decision.explanation} Next action: <strong>{statusLabel(activeRun.result.decision.nextAction)}</strong></p>}
     {activeRun.steps.length>0&&<ol>{activeRun.steps.map(step=><li key={step.callId}><strong>{step.tool}</strong> · {statusLabel(step.state)}</li>)}</ol>}
    </details>}
   </section>
   <FinancialReviewPanel client={client} caseId={caseId} revision={detail.revision} operator={session.role==='operator'&&(!session.permissions||session.permissions.includes('finance'))} onRefresh={refresh}/>
   <details><summary>Order activity and technical evidence</summary><OperationsWorkspace publicPayments={session.deployment==='public-testnet'} testnetAssets={session.deployment==='testnet-preparation'} key={detail.revision} initialProjection={detail.projection} source="authenticated"/></details>
   <V2WalletReview client={client} session={session} caseId={caseId} revision={detail.revision}
    paymentState={detail.projection.cases[0].paymentState} reviews={detail.walletReviews} onRefresh={refresh}/>
  </>}
 </section>;
}

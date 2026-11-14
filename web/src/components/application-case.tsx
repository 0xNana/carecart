'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {OrderRecord} from './order-record';
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
  {detail.projection.cases.find(c=>c.caseId===caseId)&&<OrderRecord record={detail.projection.cases.find(c=>c.caseId===caseId)!}/>}
  <section className={styles.panel} aria-label="Purchase planning help">
    <h3>Purchase planning help</h3>
    <p>Review stock, compare supplier offers and see the next step. This check will not place an order or send a payment.</p>
    <div className="ops-actions">
     <button className={styles.evidenceButton} disabled={!canRunProcurement||!session.providerAvailable||running} onClick={()=>void runAgent('provider')}>{running?'Checking…':'Review with AI'}</button>
     <button className={styles.evidenceButton} disabled={!canRunProcurement||running} onClick={()=>void runAgent('deterministic',activeRun?.state==='Failed'&&activeRun.mode==='provider'?activeRun.id:undefined)}>Run standard checks</button>
    </div>
    {runError&&<p className={styles.error} role="alert">{runError}</p>}
    {activeRun&&<details open={activeRun.id===latestRun?.id}><summary>Latest check: {statusLabel(activeRun.state)} · {displayTime(activeRun.startedAt)}</summary>
     {activeRun.error&&<p className={styles.error} role="status">The check could not be completed. Refresh the order before trying again.</p>}
     {activeRun.result?.decision&&<p>{activeRun.result.decision.explanation} Next step: <strong>{statusLabel(activeRun.result.decision.nextAction)}</strong></p>}
     <details><summary>Check timing</summary><p>Started {displayTime(activeRun.startedAt)} · Duration {activeRun.durationMs} ms</p></details>
    </details>}
   </section>
   <FinancialReviewPanel client={client} caseId={caseId} revision={detail.revision} operator={session.role==='operator'&&(!session.permissions||session.permissions.includes('finance'))} onRefresh={refresh}/>
   <details><summary>More order details</summary><OperationsWorkspace publicPayments={session.deployment==='public-testnet'} testnetAssets={session.deployment==='testnet-preparation'} key={detail.revision} initialProjection={detail.projection} source="authenticated"/></details>
   <V2WalletReview client={client} session={session} caseId={caseId} revision={detail.revision}
    paymentState={detail.projection.cases[0].paymentState} reviews={detail.walletReviews} onRefresh={refresh}/>
  </>}
 </section>;
}

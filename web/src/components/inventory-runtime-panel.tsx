'use client';
import Link from 'next/link';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {OperatorClient,OperatorSession} from '../lib/operator-client';
import type {StockDashboard,AutonomyConfig} from '../lib/inventory';
import {actionError,displayTime,statusLabel} from '../lib/product-copy';
import {InventoryOperations} from './inventory-operations';
import styles from './application-view.module.css';

type Section='overview'|'inventory'|'activity'|'settings';
const titles={overview:'Overview',inventory:'Inventory',activity:'Activity',settings:'Settings'};
const descriptions={overview:'Supplies, replenishment and items needing your attention.',inventory:'Record stock received, issued, consumed or adjusted.',activity:'Recent stock activity and monitoring checks.',settings:'Manage clinic access, stock monitoring and payment configuration.'};
/** Polling reads projections only. Scheduling remains in the independent backend worker. */
export function InventoryRuntimePanel({client,operator,section,onChanged,onFailure,canManageAutonomy=true,publicPayments=false,session=null}:{client:OperatorClient;operator:boolean;section:Section;onChanged:()=>Promise<void>;onFailure:(cause:unknown)=>void;canManageAutonomy?:boolean;publicPayments?:boolean;session?:OperatorSession|null}){
 const [data,setData]=useState<StockDashboard|null>(null),[error,setError]=useState(''),[refreshing,setRefreshing]=useState(false);
 const refresh=useCallback(async()=>{setRefreshing(true);try{setData(await client.stock());setError('');}catch(e){setData(null);setError(actionError(e,'Stock records are unavailable. Refresh to try again.'));onFailure(e);}finally{setRefreshing(false);}},[client,onFailure]);
 useEffect(()=>{let active=true;const load=async()=>{if(active)await refresh();};void load();const timer=setInterval(()=>void load(),5000);return()=>{active=false;clearInterval(timer);};},[refresh]);
 return <div className={styles.page+' '+styles.inventoryRuntime}>
  <header className={styles.heading}><div><p className={styles.eyebrow}>CLINIC OPERATIONS</p><h1>{titles[section]}</h1><p>{descriptions[section]}</p></div><button className={styles.refreshButton} disabled={refreshing} onClick={()=>void refresh()}>{refreshing?'Refreshing…':'Refresh'}</button></header>
  {data?.tenant?.syntheticDemo||data&&!data.tenant?<p className={styles.demoNotice}>Synthetic opening stock · sample supplier offers</p>:null}
  {error&&<p className={styles.error} role="alert">{error}</p>}
  {!data&&!error&&<p role="status">Loading stock records…</p>}
  {data&&<>
   {section==='overview'&&<Overview data={data} session={session}/>}
   {section==='inventory'&&<div className={styles.caseEvidence}><InventoryOperations publicPayments={publicPayments} client={client} operator={operator} canManageAutonomy={canManageAutonomy} onChanged={onChanged} onFailure={onFailure}/></div>}
   {section==='activity'&&<Events data={data}/>}
   {section==='settings'&&<RuntimeSettings publicPayments={publicPayments} session={session} key={JSON.stringify(data.config)} data={data} client={client} operator={operator} refresh={refresh}/>}
  </>}
 </div>;
}
function Monitoring({data}:{data:StockDashboard}){
 return <section className={styles.panel} aria-label="Monitoring worker health"><h2>Stock monitoring</h2><p><strong>{data.config.monitoring?statusLabel(data.workerHealth?.status??'Not observed'):'Off'}</strong> · Last successful check: {displayTime(data.workerHealth?.lastSuccessfulEvaluation)}</p><details><summary>Monitoring details</summary><p>Last heartbeat: {displayTime(data.workerHealth?.lastSeenAt)} · Records read: {displayTime(data.readAt)}</p><p>Monitoring continues when this browser is closed. A missing or stale heartbeat needs attention.</p></details></section>;
}
function Overview({data,session}:{data:StockDashboard;session?:OperatorSession|null}){
 const attention=data.items.filter(i=>i.forecast.shortage||i.freshness?.issues.length);
 const pending=data.caseStates.filter(c=>['PendingApproval','Pending','Unobserved'].includes(c.paymentState));
 return <><section className={styles.metrics} aria-label="Inventory summary">{[
  ['Supplies tracked',data.trackedSkus],['Low stock',data.lowStock],['Critical shortages',data.criticalStock],['Active requests',data.obligations.filter(o=>!o.closedAt).length],
 ].map(([label,value])=><article className={styles.metric} key={label}><span>{label}</span><strong>{value}</strong></article>)}</section>
 <div className={styles.columns}><section className={styles.panel}><h2>Stock needing attention</h2>{attention.map(i=><p key={i.id}><Link className={styles.inlineLink} href={'/app/inventory#sku-'+i.id}>{i.name}</Link><br/>{i.balance.available} available · reorder at {i.forecast.reorderPoint}{i.freshness?.issues.length?' · Check stock records':''}</p>)}{!attention.length&&<p>No stock alerts. Continue recording receipts and usage to keep balances current.</p>}<Link className={styles.inlineLink} href="/app/inventory">Manage inventory →</Link></section>
 <section className={styles.panel}><h2>Replenishment and payments</h2><p>{data.caseStates.filter(c=>c.humanInterventions.length).length} requests need review · {pending.length} payments not yet verified</p><p>AI procurement specialist: <strong>{session?.providerAvailable?`NEAR AI Cloud · ${session.model??'configured'}`:'Deterministic only'}</strong></p><Link className={styles.inlineLink} href="/app/replenishment">Review replenishment →</Link><p><Link className={styles.inlineLink} href="/app/payments">Review payments →</Link></p><p>Delivery remains pending until staff record the goods received.</p></section></div>
 <Monitoring data={data}/><Events data={data} compact/></>;
}
function Events({data,compact=false}:{data:StockDashboard;compact?:boolean}){
 const activity=data.items.flatMap(i=>i.movements.map(m=>({...m,sku:i.sku,name:i.name}))).sort((a,b)=>b.timestamp.localeCompare(a.timestamp)).slice(0,compact?5:30);
 return <section className={styles.panel}><h2>Recent stock activity</h2>{!activity.length&&<p>No stock activity yet. Record a receipt or usage in Inventory.</p>}<ol className={styles.timeline}>{activity.map(m=><li key={m.id}><div><strong>{statusLabel(m.kind)} · {m.name}</strong><p>{m.baseQuantity} units · {m.actor}</p><time dateTime={m.timestamp}>{displayTime(m.timestamp)}</time><details><summary>Record details</summary><pre className={styles.evidenceJson}>{JSON.stringify(m,null,2)}</pre></details></div></li>)}</ol>
 {compact?<Link className={styles.inlineLink} href="/app/activity">View Activity →</Link>:<><h3>Monitoring activity</h3>{!data.audit?.length&&<p>No monitoring activity recorded.</p>}<ol className={styles.timeline}>{data.audit?.slice(0,30).map(a=><li key={a.id}><div><strong>{statusLabel(a.type)}</strong><time dateTime={a.timestamp}>{displayTime(a.timestamp)}</time><details><summary>Technical details</summary><small>{a.actor} · {a.type}</small><pre className={styles.evidenceJson}>{JSON.stringify(a.evidence,null,2)}</pre></details></div></li>)}</ol><details><summary>Stock check history</summary>{!data.runs.length&&<p>No checks recorded.</p>}{data.runs.map(r=><p key={r.id}>{displayTime(r.startedAt)} · {data.items.find(i=>i.id===r.productId)?.name??r.productId} · {statusLabel(r.state)}{r.error?' · Check failed; review technical evidence':''}</p>)}</details></>}
 </section>;
}
function RuntimeSettings({data,client,operator,refresh,publicPayments,session}:{publicPayments:boolean;session?:OperatorSession|null;data:StockDashboard;client:OperatorClient;operator:boolean;refresh:()=>Promise<void>}){
 const [config,setConfig]=useState<AutonomyConfig>(data.config),[message,setMessage]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),submitting=useRef(false);
 async function save(work:()=>Promise<unknown>){if(submitting.current)return;submitting.current=true;setBusy(true);setMessage('');setError('');try{await work();setMessage('Settings saved.');await refresh();}catch(e){setError(actionError(e,'Settings could not be saved. Refresh and try again.'));}finally{submitting.current=false;setBusy(false);}}
 return <><Monitoring data={data}/><section className={styles.panel}><h2>Inventory monitoring</h2>{!operator&&<p>Your clinic role has read-only access.</p>}
 <form className={styles.runtimeForm} onSubmit={e=>{e.preventDefault();void save(()=>client.configureAutonomy({...config,financialExecution:false}));}}><fieldset disabled={!operator||busy}><legend>Automatic replenishment</legend>{(['monitoring','automaticCases','automaticPreparation'] as const).map((key,i)=><label key={key}><input type="checkbox" checked={config[key]} onChange={e=>setConfig({...config,[key]:e.target.checked})}/>{['Monitor stock','Create replenishment requests','Prepare purchase orders'][i]}</label>)}
 <details><summary>Monitoring intervals</summary>{(['intervalSeconds','maxInventoryAgeSeconds','maxCatalogAgeSeconds'] as const).map((key,i)=><label key={key}>{['Check every (seconds)','Stock records valid for (seconds)','Supplier quotes valid for (seconds)'][i]}<input type="number" min={i?60:1} max={i?31536000:86400} step="1" required value={config[key]??(i===1?604800:86400)} onChange={e=>setConfig({...config,[key]:Number(e.target.value)})}/></label>)}</details><button>{busy?'Saving…':'Save monitoring settings'}</button></fieldset></form>
 <h3>Supplier offers</h3><p>Sample offers are used for this testnet MVP.</p><button disabled={!operator||busy} onClick={()=>void save(()=>client.refreshCatalog())}>Refresh sample offers</button>
 <h3>AI procurement specialist</h3><p><strong>{session?.providerAvailable?`Configured · NEAR AI Cloud (${session.model??'model not reported'})`:'Not configured · deterministic execution only'}</strong>. Open any order in Replenishment or Payments to evaluate it with NEAR AI Cloud.</p>
 <h3>Payment configuration</h3><p>NEAR Testnet · synthetic CCUSD test token, not Circle USDC.</p><p>{publicPayments?'Scoped payment authorization is configured. Signing runs separately and is not enabled by monitoring settings.':'Public payment signing is unavailable in this workspace.'}</p><p>Human purchase approval is not yet connected to a public wallet. Hard vault limits apply to every payment.</p>
 {error&&<p role="alert" className={styles.error}>{error}</p>}<p role="status">{message}</p><details><summary>Monitoring job details</summary>{data.jobs.map(j=><p key={j.productId}>{data.items.find(i=>i.id===j.productId)?.name??j.productId}: next {displayTime(j.nextDue)} · failures {j.failures??0}{(j.failures??0)>=3?' · Stopped. Review the errors before saving settings to retry.':''}</p>)}</details></section></>;
}

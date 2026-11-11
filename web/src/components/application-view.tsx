"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentRun, OperatorSession, SupplierCatalog } from "@/lib/operator-client";
import { caseStateLabel, terminalStates, usdc, type WorkspaceCase } from "@/lib/workflow";
import { applicationErrorText as errorText, loadApplicationData } from "@/lib/application-data";
import { useApplication } from "./application-shell";
import {ClinicAccess} from './clinic-access';
import {InventoryRuntimePanel} from './inventory-runtime-panel';
import {ApplicationCase} from './application-case';
import {statusLabel as stateText,actionError} from '@/lib/product-copy';
import styles from "./application-view.module.css";

type Section = "overview" | "inventory" | "replenishment" | "suppliers" | "payments" | "activity" | "settings";
type InventoryItem = Awaited<ReturnType<ReturnType<typeof useApplication>["client"]["inventory"]>>[number];
type Supplier = { id: string; account: string; quoteCount: number; cases: Set<string>; totalProposed: bigint };
type LoadedData = Awaited<ReturnType<typeof loadApplicationData>>;

const headings: Record<Section, { eyebrow: string; title: string; description: string }> = {
  overview: { eyebrow: "CLINIC OPERATIONS", title: "Overview", description: "Supplies, replenishment and items needing your attention." },
  inventory: { eyebrow: "SUPPLY OPERATIONS", title: "Inventory", description: "Record supplies received, dispensed, consumed or adjusted." },
  replenishment: { eyebrow: "PROCUREMENT WORKFLOW", title: "Replenishment", description: "Review supply needs, selected offers and the next action." },
  suppliers: { eyebrow: "SOURCING", title: "Suppliers", description: "Compare approved sample suppliers and their offers." },
  payments: { eyebrow: "FINANCIAL CONTROLS", title: "Payments", description: "Review payment authorizations, status and transaction evidence." },
  activity: { eyebrow: "AUDIT TRAIL", title: "Activity", description: "Recent replenishment and payment activity." },
  settings: { eyebrow: "WORKSPACE", title: "Settings", description: "Clinic access, monitoring and payment configuration." },
};

function formatTime(value: string) {
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? value : time.toLocaleString();
}

export function ApplicationView({ section }: { section: Section }) {
  const { client, role,tenant } = useApplication();
  const [session, setSession] = useState<OperatorSession | null>(null);
  const [cases, setCases] = useState<WorkspaceCase[]>([]);
  const [caseCount, setCaseCount] = useState(0);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [error, setError] = useState("");
  const [inventoryError, setInventoryError] = useState("");
  const [runsError, setRunsError] = useState("");
  const [catalogError, setCatalogError] = useState("");
  const [caseReadAt, setCaseReadAt] = useState<string|null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing,setRefreshing] = useState(false);
  const caseTrigger=useRef<HTMLButtonElement|null>(null);
  const [selectedCase,setSelectedCase] = useState<string|null>(null);
  const [catalog,setCatalog]=useState<SupplierCatalog|null>(null);
  const [offset,setOffset]=useState(0);
  const [nextOffset,setNextOffset]=useState<number|null>(null);

  const applyData = useCallback((data: LoadedData) => {
    setSession(data.session);
    setError(data.errors.cases);
    setInventoryError(data.errors.inventory);
    setRunsError(data.errors.runs);
    setCatalogError(data.errors.catalog);
    setCatalog(data.catalog);
    setCases(data.cases);
    setCaseCount(data.caseCount);
    setNextOffset(data.nextOffset);
    setCaseReadAt(data.caseReadAt);
    setInventory(data.inventory);
    setRuns(data.runs);
    setLoading(false);
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError("");
    try {
      applyData(await loadApplicationData(client,offset));
    } catch (cause) {
      setError(errorText(cause));
      setCases([]);
      setInventory([]);
      setRuns([]);
      setLoading(false);
    }
    finally {setRefreshing(false);}
  }, [applyData, client,offset]);

  useEffect(() => {
    let active = true;
    loadApplicationData(client,offset).then((data) => {
      if (active) applyData(data);
    }).catch((cause: unknown) => {
      if (!active) return;
      setError(errorText(cause));
      setCases([]);
      setInventory([]);
      setRuns([]);
      setLoading(false);
    });
    return () => { active = false; };
  }, [applyData, client,offset]);

  useEffect(()=>{if(section!=='replenishment'&&section!=='payments')return;const timer=setInterval(()=>void refresh(),5000);return()=>clearInterval(timer);},[section,refresh]);
  const activeCases = cases.filter((entry) => !terminalStates.has(entry.state));
  const attentionCases = cases.filter((entry) => entry.humanInterventions.length > 0);
  const lowStock = inventory.filter((entry) => entry.onHand <= entry.reorderPoint);
  const suppliers = new Map<string, Supplier>();
  for (const entry of cases) for (const quote of entry.quotes) {
    const supplier = suppliers.get(quote.supplierId) ?? {
      id: quote.supplierId,
      account: quote.supplierAccount,
      quoteCount: 0,
      cases: new Set<string>(),
      totalProposed: BigInt(0),
    };
    supplier.quoteCount += 1;
    supplier.cases.add(entry.caseId);
    supplier.totalProposed += BigInt(quote.amountAtomic);
    suppliers.set(quote.supplierId, supplier);
  }

  const inventoryFailure=useCallback((cause:unknown)=>{if(errorText(cause).startsWith('AUTH_EXPIRED'))setError(errorText(cause));},[]);
  const title = headings[section];
  if(session?.inventoryRuntime&&(['overview','inventory','activity','settings'] as string[]).includes(section))return <><InventoryRuntimePanel publicPayments={session.deployment==='public-testnet'} session={session} client={client} operator={role==='operator'&&(!tenant||tenant.clinic.permissions.includes(section==='settings'?'admin':'inventory'))} canManageAutonomy={!tenant||tenant.clinic.permissions.includes('admin')} section={section as 'overview'|'inventory'|'activity'|'settings'} onChanged={refresh} onFailure={inventoryFailure}/>{section==='settings'&&tenant&&<ClinicAccess clinic={tenant.clinic}/>}</>;

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>{title.eyebrow} · {session?.deployment==='public-testnet'?'PUBLIC TESTNET':'LOCAL SYNTHETIC'}</p>
          <h1>{title.title}</h1>
          <p>{session?.deployment==='public-testnet'&&section==='payments'?'Review synthetic CCUSD test payments and verified transaction evidence.':title.description}</p>
        </div>
        <button type="button" className={styles.refreshButton} onClick={() => void refresh()} disabled={loading||refreshing}>
          <span aria-hidden="true">↻</span> {loading||refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      {['suppliers','payments'].includes(section)&&<p className={styles.demoNotice}>{section==='suppliers'?'Synthetic suppliers · sample offers for evaluation':'NEAR Testnet · synthetic CCUSD test token, not Circle USDC'}</p>}

      {error && <p className={styles.error} role="alert">{actionError(new Error(error),"Records could not be loaded. Refresh to try again.")}</p>}
      {loading && <p className={styles.loading} role="status" aria-busy="true">Loading records…</p>}
      {!loading&&!error&&<p className={styles.dataFootnote}>Records read at {caseReadAt ? <time dateTime={caseReadAt}>{formatTime(caseReadAt)}</time> : "unavailable"}. Payment verification times are shown with each payment.</p>}
      {!loading && !error && section === "overview" && (
        <>
          <section className={styles.metrics} aria-label="Workspace summary">
            <Metric label="Tracked supplies" value={inventoryError ? "Unavailable" : inventory.length} hint="Synthetic catalog items" />
            <Metric label="Reorder attention" value={inventoryError ? "Unavailable" : lowStock.length} hint="At or below reorder point" tone={lowStock.length ? "amber" : undefined} />
            <Metric label="Recorded cases" value={caseCount} hint={`${activeCases.length} active on this page`} />
            <Metric label="Human review" value={attentionCases.length} hint="Cases on the current page" tone={attentionCases.length ? "amber" : undefined} />
          </section>
          {inventoryError&&<p className={styles.error} role="alert">Inventory read unavailable: {inventoryError}. Stock counts cannot be evaluated.</p>}
          <section className={styles.panel}><PanelHeading eyebrow="MONITORING" title="Worker health not observed here"/>
           <p className={styles.panelLead}>This overview shows the current synthetic catalog response and persisted case activity. Continuous P4A stock balances, monitor health, data freshness and incoming-order projections are the next Dashboard integration milestone.</p>
           <p className={styles.dataFootnote}>No fresh health observation means unknown health. Recent case activity alone does not establish that a background worker is running.</p></section>
          <section className={styles.panel}>
            <PanelHeading eyebrow="PAYMENT AND DELIVERY" title="Recorded outcomes" href="/app/payments" action="View payments" />
            <p className={styles.panelLead}>These are saved workflow states for cases on this page. A draft, wallet submission or source dispatch does not establish supplier settlement.</p>
            {cases.length ? <div className={styles.tableWrap} tabIndex={0} aria-label="Overview payment evidence"><table>
              <thead><tr><th>Supply / case</th><th>Payment stage and provenance</th><th>Next human action</th></tr></thead>
              <tbody>{cases.slice(0,5).map(entry=><tr key={entry.caseId}><td><strong>{entry.item?.name??entry.itemId}</strong><small>{entry.caseId}</small></td><td>{caseStateLabel(entry)}<small>{entry.vault ? `Vault: ${entry.vault.status}` : "No vault observation"}{entry.settlement ? ` · Receipt: ${entry.settlement.state}` : " · No settlement receipt"}</small></td><td>{entry.humanInterventions.map(stateText).join(", ")||"None recorded"}</td></tr>)}</tbody>
            </table></div> : <p>No outcomes recorded yet.</p>}
            <p className={styles.dataFootnote}>Delivery status and critical-shortage severity are unavailable in this catalog view. Physical receipts, consumption history and incoming quantities require the configured inventory runtime; unified Dashboard projections are the next P4A milestone.</p>
          </section>
          <div className={styles.columns}>
            <section className={styles.panel}>
              <PanelHeading eyebrow="INVENTORY SIGNALS" title="Stock to watch" href="/app/inventory" action="View inventory" />
              {inventory.length ? <div className={styles.rows}>{inventory.slice(0, 5).map((item) => {
                const low = item.onHand <= item.reorderPoint;
                return <div className={styles.inventoryRow} key={item.id}>
                  <span className={`${styles.stockIcon} ${low ? styles.stockIconLow : ""}`} aria-hidden="true">▤</span>
                  <span className={styles.rowText}><strong>{item.name}</strong><small>{item.id}</small></span>
                  <span className={styles.stockStatus}><strong>{item.onHand}</strong><small>on hand · reorder at {item.reorderPoint}</small></span>
                  <span className={low ? styles.lowTag : styles.healthyTag}>{low ? "Reorder" : "Healthy"}</span>
                </div>;
              })}</div> : <EmptyState error={inventoryError} empty="No synthetic inventory items are available." />}
            </section>
            <section className={styles.panel}>
              <PanelHeading eyebrow="WORKFLOW" title="Recent replenishment" href="/app/replenishment" action="View requests" />
              {cases.length ? <div className={styles.rows}>{cases.slice(0, 5).map((entry) => (
                <Link className={styles.caseRow} href="/app/replenishment" key={entry.caseId}>
                  <span className={styles.caseMark} aria-hidden="true">↗</span>
                  <span className={styles.rowText}><strong>{entry.item?.name ?? entry.itemId}</strong><small>{entry.caseId}</small></span>
                  <span className={styles.caseState}>{caseStateLabel(entry)}</span>
                </Link>
              ))}</div> : <EmptyState error={error} empty="No replenishment requests yet. Stock monitoring creates a request when supplies run low." />}
            </section>
          </div>
          <section className={styles.panel}>
            <PanelHeading eyebrow="RECENT RUNS" title="Procurement activity" href="/app/activity" action="View activity" />
            {runs.length ? <div className={styles.rows}>{runs.slice(0, 4).map((run) => (
              <div className={styles.activityRow} key={run.id}><span className={styles.activityMark} aria-hidden="true">◷</span>
                <span className={styles.rowText}><strong>{run.target.kind === "item" ? run.target.itemId : run.target.caseId}</strong><small>{run.mode} · {run.provider} · {formatTime(run.startedAt)}</small></span>
                <span className={styles.caseState}>{stateText(run.state)}</span>
              </div>
              ))}</div> : <EmptyState error={runsError} empty="No procurement runs are available." />}
          </section>
        </>
      )}

      {!loading && !error && section === "inventory" && (
        <>
          <section className={styles.metrics} aria-label="Inventory summary">
            <Metric label="Tracked supplies" value={inventoryError ? "Unavailable" : inventory.length} hint="Synthetic catalog items" />
            <Metric label="At reorder point" value={inventoryError ? "Unavailable" : lowStock.length} hint="Based on current on-hand stock" tone={lowStock.length ? "amber" : undefined} />
            <Metric label="Local service" value={session?.inventoryRuntime ? "Ready" : "Unavailable"} hint="Inventory operations runtime" />
            <Metric label="Role" value={role === "operator" ? "Operator" : "Viewer"} hint={role !== "operator" ? "Read-only access" : session?.inventoryRuntime ? "Physical movement controls available" : "Operator access · runtime not configured"} />
          </section>
          {inventoryError && <p className={styles.error} role="alert">Some inventory services are unavailable: {inventoryError}</p>}
          <section className={styles.panel}><PanelHeading eyebrow="REGISTERED SYNTHETIC CATALOG" title="Products and reorder thresholds"/>
           <p className={styles.panelLead}>Catalog values are not proof of physical hospital inventory. Open a product for its source and service limits.</p>
           {inventory.length > 0 && <div className={styles.tableWrap} tabIndex={0} aria-label="Synthetic inventory catalog"><table><thead><tr><th>Product</th><th>On hand</th><th>Reorder threshold</th><th>Details</th></tr></thead><tbody>
            {inventory.map(item=><tr key={item.id}><td><strong>{item.name}</strong><small>{item.id}</small></td><td>{item.onHand}</td><td>{item.reorderPoint}</td><td><details><summary>Source and limits</summary><p>Source: local synthetic catalog. History, incoming orders and physical movement controls require the separately configured inventory runtime below.</p></details></td></tr>)}
           </tbody></table></div>}
           {!inventory.length&&<EmptyState error={inventoryError} empty="No catalog items recorded."/>}
          </section>
          {!session?.inventoryRuntime&&<section className={styles.panel}><h2>Physical inventory runtime not configured</h2><p>Receipt, consumption, expiry and history controls are unavailable for this service. The synthetic catalog remains read-only. Full P4A integration is the next milestone.</p></section>}

        </>
      )}

      {!loading && !error && section === "replenishment" && (
        <section className={styles.panel}>
          <PanelHeading eyebrow="REQUESTS" title="Replenishment requests" />
          <p className={styles.panelLead}>Review each request and any action needed before payment.</p>
          {cases.length ? <div className={styles.tableWrap} tabIndex={0} aria-label="Replenishment cases">
            <table><caption className={styles.panelLead}>Detected → Supplier selected → Order prepared → Authorization → Payment → Delivery</caption><thead><tr><th>Supply / reason</th><th>Quantity / supplier</th><th>Order value</th><th>Status / next action</th><th>Review</th></tr></thead>
              <tbody>{cases.map(entry=>{const quote=entry.quotes.find(q=>q.id===entry.selection?.quoteId);return <tr key={entry.caseId}>
                <td><strong>{entry.item?.name??entry.itemId}</strong><small>{entry.item?`${entry.item.onHand} on hand · reorder at ${entry.item.reorderPoint}`:'Stock check recorded'}</small></td>
                <td>{quote?`${quote.quantity} units`:'Awaiting quote'}<small>{quote?.supplierId??'No supplier selected'}</small></td>
                <td>{entry.selection?`${usdc(entry.selection.amount)} CCUSD test units`:'Not estimated'}</td>
                <td>{stateText(entry.state)}<small>{entry.humanInterventions.map(stateText).join(', ')||stateText(entry.nextAction)}</small></td>
                <td><button className={styles.evidenceButton} onClick={e=>{caseTrigger.current=e.currentTarget;setSelectedCase(entry.caseId);}}>Review Order</button><details><summary>Request details</summary><p>{entry.caseId}</p><time dateTime={entry.updatedAt}>{formatTime(entry.updatedAt)}</time></details></td>
              </tr>;})}</tbody>
            </table>
          </div> : <EmptyState error={error} empty="No replenishment requests yet. Stock monitoring creates a request when supplies run low." />}
          <p className={styles.dataFootnote}>Showing {cases.length ? offset+1 : 0}–{offset+cases.length} of {caseCount} requests. Review an order for its forecast, supplier choice and activity.</p>
        </section>
      )}

      {!loading && !error && section === "suppliers" && (
        <section className={styles.panel}>
          <PanelHeading eyebrow="SYNTHETIC CATALOG REFERENCES" title="Supplier offers" />
          <p className={styles.panelLead}>Synthetic suppliers and sample quotes for testnet evaluation.</p>
          <h3>Approved sample suppliers</h3>
          {catalog?.configured?<div className={styles.tableWrap} tabIndex={0} aria-label="Approved synthetic catalog"><table><thead><tr><th>Supplier</th><th>Account / route</th><th>Item</th><th>Unit price · {['testnet-preparation','public-testnet'].includes(session?.deployment??'')?'CCUSD test units':'proposed token units'}</th><th>Lead time</th></tr></thead>
           <tbody>{catalog.entries?.map(entry=>{const supplier=catalog.suppliers?.find(s=>s.id===entry.supplierId);return <tr key={`${entry.itemId}:${entry.supplierId}`}><td>{entry.supplierId}</td><td>{supplier?.account} / {supplier?.destination}</td><td>{inventory.find(i=>i.id===entry.itemId)?.name??entry.itemId}</td><td>{usdc(entry.unitPriceAtomic)}</td><td>{entry.leadTimeDays} days</td></tr>;})}</tbody></table></div>:<EmptyState error={catalogError} empty="No supplier offers are available. Refresh or check with your clinic administrator."/>}
          <h3>Recent quotes</h3>
          {suppliers.size ? <div className={styles.tableWrap} tabIndex={0} aria-label="Synthetic supplier records">
            <table><thead><tr><th>Supplier reference</th><th>Account</th><th>Cases</th><th>Quote records</th><th>Combined proposed amount</th></tr></thead>
              <tbody>{[...suppliers.values()].map((supplier) => <tr key={supplier.id}><td><strong>{supplier.id}</strong></td><td>{supplier.account}</td>
                <td>{supplier.cases.size}</td><td>{supplier.quoteCount}</td><td>{usdc(supplier.totalProposed.toString())} proposed token units</td></tr>)}</tbody>
            </table>
          </div> : <EmptyState error={error} empty="No supplier quote records are available in the current cases." />}
          <p className={styles.dataFootnote}>Quote amounts are proposals from synthetic records. No supplier outreach, order dispatch, or payment is initiated here.</p>
        </section>
      )}

      {!loading && !error && section === "payments" && (
        <section className={styles.panel}>
          <PanelHeading eyebrow="PAYMENT EVIDENCE" title="Payment status" />
          <p className={styles.panelLead}>Review the order to see approval requirements, payment activity and transaction details.</p>
          {cases.some((entry) => entry.selection || entry.vault || entry.settlement) ? <div className={styles.tableWrap} tabIndex={0} aria-label="Recorded case payment states">
            <table><thead><tr><th>Purchase order</th><th>Proposed terms</th><th>Payment verification</th><th>Destination receipt</th><th>Evidence source</th></tr></thead>
              <tbody>{cases.filter((entry) => entry.selection || entry.vault || entry.settlement).map((entry) => <tr key={entry.caseId}>
                <td><strong>{entry.item?.name??entry.itemId}</strong><small>{entry.poId??"Order being prepared"}</small><button className={styles.evidenceButton} onClick={e=>{caseTrigger.current=e.currentTarget;setSelectedCase(entry.caseId);}}>Review Order</button></td>
                <td>{entry.selection ? `${usdc(entry.selection.amount)} ${entry.evidenceKind === "sandbox-rpc" || ['testnet-preparation','public-testnet'].includes(session?.deployment??'') ? "CCUSD test token" : "proposed token units"} · ${entry.selection.destination}` : "No selected terms"}</td>
                <td>{entry.vault ? `${stateText(entry.vault.status)} · ${formatTime(entry.vault.checkedAt)}` : "Not verified"}</td>
                <td>{entry.settlement ? `${entry.settlement.state} · ${entry.settlement.attemptId}` : "No destination receipt"}</td>
                <td>{caseStateLabel(entry)}</td>
              </tr>)}</tbody>
            </table>
          </div> : <EmptyState error={error} empty="No payments recorded yet. Prepared orders appear here for review." />}
          <p className={styles.dataFootnote}>Payments are confirmed only after independent verification. Record delivered goods separately in Inventory.</p>
        </section>
      )}

      {!loading && !error && section === "activity" && (
        <section className={styles.panel}>
          <PanelHeading eyebrow="RECORDED EVENTS" title="Replenishment activity" />
          {cases.some((entry) => entry.timeline.length) ? <ol className={styles.timeline}>
            {cases.flatMap((entry) => entry.timeline.map((event) => ({ entry, event })))
              .sort((a, b) => Date.parse(b.event.timestamp) - Date.parse(a.event.timestamp)).slice(0, 50)
              .map(({ entry, event }, index) => <li key={`${entry.caseId}-${event.eventType}-${event.timestamp}-${index}`}>
                <span className={styles.timelineMark} aria-hidden="true" />
                <div><strong>{stateText(event.eventType)}</strong><small>{entry.item?.name ?? entry.itemId} · {entry.caseId}</small>
                  <p>{stateText(event.previousState ?? "Started")} → {stateText(event.resultingState)} · {event.actor}</p>
                  <time dateTime={event.timestamp}>{formatTime(event.timestamp)}</time>
                </div>
              </li>)}
          </ol> : <EmptyState error={error} empty="No replenishment activity yet." />}
          <h3>AI and deterministic procurement runs</h3>
          {runsError&&<p className={styles.error} role="alert">Procurement run history unavailable: {runsError}</p>}
          {runs.map(run=><details key={run.id}><summary>{stateText(run.state)} · {run.mode} · {formatTime(run.startedAt)}</summary>
           <p>Provider {run.provider}; execution {run.execution}; inference performed: {String(run.inferencePerformed)}. Reconciliation required: {String(run.requiresReconciliation)}.</p>
           <ol>{run.steps.map(step=><li key={step.callId}>{step.tool} · {step.state} · {formatTime(step.timestamp)}</li>)}</ol></details>)}
          <p className={styles.dataFootnote}>Case and AI timelines are persisted records. The unified P4A inventory-movement timeline is the next integration; payment submission never proves settlement.</p>
        </section>
      )}

      {selectedCase&&['replenishment','payments'].includes(section)&&<ApplicationCase key={selectedCase} caseId={selectedCase} onClose={()=>{setSelectedCase(null);caseTrigger.current?.focus();}}/>}
      {!loading&&['replenishment','payments','activity'].includes(section)&&caseCount>20&&<nav aria-label="Case pages" className={styles.panel}>
       <button disabled={refreshing||offset===0} onClick={()=>{setLoading(true);setSelectedCase(null);setOffset(Math.max(0,offset-20));}}>Previous cases</button>
       <span> Cases {offset+1}–{offset+cases.length} of {caseCount} </span>
       <button disabled={refreshing||nextOffset===null} onClick={()=>{if(nextOffset!==null){setLoading(true);setSelectedCase(null);setOffset(nextOffset);}}}>Next cases</button>
      </nav>}
      {!loading && !error && section === "settings" && (
        <div className={styles.settingsGrid}>
          <section className={styles.panel}>
            <PanelHeading eyebrow="ACCESS" title="Authenticated session" />
            <dl className={styles.facts}><dt>Role</dt><dd>{role}</dd><dt>Expires</dt><dd>{session ? formatTime(session.expiresAt) : "Unavailable"}</dd>
              <dt>Profile fingerprint</dt><dd><code>{session?.profileFingerprint ?? "Unavailable"}</code></dd></dl>
          </section>
          <section className={styles.panel}>
            <PanelHeading eyebrow="CAPABILITIES" title="Configured services" />
            <dl className={styles.facts}><dt>Inventory runtime</dt><dd>{session?.inventoryRuntime ? "Configured · synthetic data" : "Not configured"}</dd>
              <dt>AI provider</dt><dd>{session?.providerAvailable ? `Configured · ${session.model ?? "model not reported"}` : "Not configured"}</dd>
              <dt>Wallet execution</dt><dd>{session?.walletMode === "local-sandbox" ? "Isolated local Sandbox only" : session?.walletMode === "isolated-mock" ? "Mocked · not settlement" : "Disabled"}</dd>
              <dt>Financial scope</dt><dd>Testnet preparation workspace · no live treasury execution in this workspace</dd></dl>
          </section>
          <section className={styles.panel}>
            <PanelHeading eyebrow="BOUNDARIES" title="Where to continue" />
            <p className={styles.panelLead}>Financial policy: no fresh onchain policy observation is available on this settings screen. This UI grants no signing permissions. Configured inventory autonomy remains subject to the existing financial-execution-disabled boundary.</p>
            <p className={styles.panelLead}>Authenticated case evidence and operator controls remain in the existing operations workspace.</p>
            <Link className={styles.inlineLink} href="/operations">Open operations evidence →</Link>
            <p className={styles.dataFootnote}>Viewer sessions can inspect records. Operator-only inventory actions are separately permission-gated by the operations API.</p>
          </section>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, hint, tone }: { label: string; value: string | number; hint: string; tone?: "amber" }) {
  return <div className={styles.metric}><span>{label}</span><strong className={tone === "amber" ? styles.metricAmber : ""}>{value}</strong><small>{hint}</small></div>;
}

function PanelHeading({ eyebrow, title, href, action }: { eyebrow: string; title: string; href?: string; action?: string }) {
  return <div className={styles.panelHeading}><div><span className={styles.panelEyebrow}>{eyebrow}</span><h2>{title}</h2></div>
    {href && action && <Link className={styles.inlineLink} href={href}>{action} →</Link>}</div>;
}

function EmptyState({ error, empty }: { error: string; empty: string }) {
  return <p className={styles.emptyState}>{error ? `Unable to load records: ${error}` : empty}</p>;
}

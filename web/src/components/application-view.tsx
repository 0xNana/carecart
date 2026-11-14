"use client";

import {ApplicationLink as Link} from "./application-link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentRun, OperatorSession, SupplierCatalog } from "@/lib/operator-client";
import { caseStateLabel, terminalStates, usdc, type WorkspaceCase } from "@/lib/workflow";
import { applicationErrorText as errorText, loadApplicationData } from "@/lib/application-data";
import { useApplication } from "./application-shell";
import {ClinicAccess} from './clinic-access';
import {InventoryRuntimePanel} from './inventory-runtime-panel';
import {ApplicationCase} from './application-case';
import {AutomaticPurchasingPanel} from './automatic-purchasing-panel';
import {PaymentAccountPanel} from './payment-account-panel';
import {statusLabel as stateText,actionError} from '@/lib/product-copy';
import styles from "./application-view.module.css";

type Section = "overview" | "inventory" | "replenishment" | "suppliers" | "payments" | "activity" | "settings";
type InventoryItem = Awaited<ReturnType<ReturnType<typeof useApplication>["client"]["inventory"]>>[number];
type Supplier = { id: string; account: string; quoteCount: number; cases: Set<string>; totalProposed: bigint };
type LoadedData = Awaited<ReturnType<typeof loadApplicationData>>;

const headings: Record<Section, { eyebrow: string; title: string; description: string }> = {
  overview: { eyebrow: "CLINIC OPERATIONS", title: "Overview", description: "Supplies, replenishment and items needing your attention." },
  inventory: { eyebrow: "STOCK", title: "Inventory", description: "Record supplies received, used or adjusted." },
  replenishment: { eyebrow: "REQUESTS", title: "Replenishment", description: "Review supplies that need restocking and their next step." },
  suppliers: { eyebrow: "OFFERS", title: "Suppliers", description: "Compare sample suppliers, prices and delivery times." },
  payments: { eyebrow: "PAYMENTS", title: "Payments", description: "View your balance, add funds and review payments." },
  activity: { eyebrow: "ACTIVITY", title: "Activity", description: "Recent stock, order and payment updates." },
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
  const moneyLabel=session?.deployment==='public-testnet'||session?.deployment==='testnet-preparation'?'CCUSD':'demo credits';
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

  const inventoryFailure=useCallback((cause:unknown)=>{const message=errorText(cause);if(message.startsWith('Your session has expired'))setError(message);},[]);
  const title = headings[section];
  if(session?.inventoryRuntime&&(['overview','inventory','activity','settings'] as string[]).includes(section))return <><InventoryRuntimePanel publicPayments={session.deployment==='public-testnet'} session={session} client={client} operator={role==='operator'&&(!tenant||tenant.clinic.permissions.includes(section==='settings'?'admin':'inventory'))} canManageAutonomy={!tenant||tenant.clinic.permissions.includes('admin')} section={section as 'overview'|'inventory'|'activity'|'settings'} onChanged={refresh} onFailure={inventoryFailure}/>{section==='settings'&&tenant&&<ClinicAccess clinic={tenant.clinic}/>}</>;

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>{title.eyebrow}</p>
          <h1>{title.title}</h1>
          <p>{title.description}</p>
        </div>
        <button type="button" className={styles.refreshButton} onClick={() => void refresh()} disabled={loading||refreshing}>
          <span aria-hidden="true">↻</span> {loading||refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      {section==='suppliers'&&<p className={styles.demoNotice}>Sample suppliers and offers for comparison.</p>}
      {section==='payments'&&session?.deployment==='testnet-preparation'&&<p className={styles.demoNotice}>Demo amounts only · no real money is involved.</p>}

      {section==='payments'&&session?.deployment==='public-testnet'&&<AutomaticPurchasingPanel client={client} canManage={session.clinicRole==='Clinic Admin'} />}
      {section==='payments'&&session?.deployment==='public-testnet'&&<PaymentAccountPanel client={client} canFund={role==='operator'&&(tenant?tenant.clinic.permissions.includes('finance'):session.permissions?.includes('finance')===true)} />}

      {error && <p className={styles.error} role="alert">{actionError(new Error(error),"Records could not be loaded. Refresh to try again.")}</p>}
      {loading && <p className={styles.loading} role="status" aria-busy="true">Loading records…</p>}
      {!loading&&!error&&caseReadAt&&<p className={styles.dataFootnote}>Updated {formatTime(caseReadAt)}.</p>}
      {!loading && !error && section === "overview" && (
        <>
          <section className={styles.metrics} aria-label="Workspace summary">
            <Metric label="Supplies tracked" value={inventoryError ? "Unavailable" : inventory.length} hint="In your supply list" />
            <Metric label="Low stock" value={inventoryError ? "Unavailable" : lowStock.length} hint="At or below reorder level" tone={lowStock.length ? "amber" : undefined} />
            <Metric label="Requests" value={caseCount} hint={`${activeCases.length} active on this page`} />
            <Metric label="Needs review" value={attentionCases.length} hint="Requests on this page" tone={attentionCases.length ? "amber" : undefined} />
          </section>
          {inventoryError&&<p className={styles.error} role="alert">Inventory read unavailable: {inventoryError}. Stock counts cannot be evaluated.</p>}
          <section className={styles.panel}><PanelHeading eyebrow="STOCK CHECKS" title="Automatic monitoring"/>
           <p className={styles.panelLead}>Check Settings to see whether automatic stock monitoring is set up for this clinic.</p>
           <p className={styles.dataFootnote}>Review Inventory for current stock counts and Activity for recent updates.</p></section>
          <section className={styles.panel}>
            <PanelHeading eyebrow="ORDERS AND PAYMENTS" title="Recent activity" href="/app/payments" action="View payments" />
            <p className={styles.panelLead}>See what has been prepared, reviewed and paid for these requests.</p>
            {cases.length ? <div className={styles.tableWrap} tabIndex={0} aria-label="Overview payment evidence"><table>
              <thead><tr><th>Supply</th><th>Order and payment status</th><th>Next step</th></tr></thead>
              <tbody>{cases.slice(0,5).map(entry=><tr key={entry.caseId}><td><strong>{entry.item?.name??entry.itemId}</strong></td><td>{caseStateLabel(entry)}<small>{entry.vault ? stateText(entry.vault.status) : "Payment not checked yet"}{entry.settlement ? ` · Delivery: ${stateText(entry.settlement.state)}` : " · No delivery update"}</small></td><td>{entry.humanInterventions.map(stateText).join(", ")||stateText(entry.nextAction)}</td></tr>)}</tbody>
            </table></div> : <p>No outcomes recorded yet.</p>}
            <p className={styles.dataFootnote}>Open a request to review its supplier, order amount and delivery updates.</p>
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
              })}</div> : <EmptyState error={inventoryError} empty="No supplies found." />}
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
            <Metric label="Supplies tracked" value={inventoryError ? "Unavailable" : inventory.length} hint="In your supply list" />
            <Metric label="At reorder point" value={inventoryError ? "Unavailable" : lowStock.length} hint="Based on current on-hand stock" tone={lowStock.length ? "amber" : undefined} />
            <Metric label="Stock tracking" value={session?.inventoryRuntime ? "Ready" : "Unavailable"} hint="Record receipts and usage" />
            <Metric label="Your access" value={role === "operator" ? "Staff" : "Viewer"} hint={role !== "operator" ? "View only" : session?.inventoryRuntime ? "Stock updates available" : "Updates not set up"} />
          </section>
          {inventoryError && <p className={styles.error} role="alert">Some inventory services are unavailable: {inventoryError}</p>}
          <section className={styles.panel}><PanelHeading eyebrow="SUPPLY LIST" title="Supplies and reorder levels"/>
           <p className={styles.panelLead}>These sample counts may differ from what is physically in your storeroom.</p>
           {inventory.length > 0 && <div className={styles.tableWrap} tabIndex={0} aria-label="Supply list"><table><thead><tr><th>Product</th><th>On hand</th><th>Reorder level</th><th>Details</th></tr></thead><tbody>
            {inventory.map(item=><tr key={item.id}><td><strong>{item.name}</strong><details><summary>Item details</summary><code>{item.id}</code></details></td><td>{item.onHand}</td><td>{item.reorderPoint}</td><td><details><summary>About this count</summary><p>Sample supply data. To record receipts and usage, ask your clinic administrator to set up stock tracking.</p></details></td></tr>)}
           </tbody></table></div>}
           {!inventory.length&&<EmptyState error={inventoryError} empty="No catalog items recorded."/>}
          </section>
          {!session?.inventoryRuntime&&<section className={styles.panel}><h2>Stock updates are not set up</h2><p>You can view the sample supply list, but recording receipts, usage, expiry dates and stock history is not available yet.</p></section>}

        </>
      )}

      {!loading && !error && section === "replenishment" && (
        <section className={styles.panel}>
          <PanelHeading eyebrow="REQUESTS" title="Replenishment requests" />
          <p className={styles.panelLead}>Review each request and any action needed before payment.</p>
          {cases.length ? <div className={styles.tableWrap} tabIndex={0} aria-label="Replenishment cases">
            <table><caption className={styles.panelLead}>Stock checked → Offers compared → Order reviewed → Payment → Delivery</caption><thead><tr><th>Supply / reason</th><th>Quantity / supplier</th><th>Order value</th><th>Status / next step</th><th>Review</th></tr></thead>
              <tbody>{cases.map(entry=>{const quote=entry.quotes.find(q=>q.id===entry.selection?.quoteId);return <tr key={entry.caseId}>
                <td><strong>{entry.item?.name??entry.itemId}</strong><small>{entry.item?`${entry.item.onHand} on hand · reorder at ${entry.item.reorderPoint}`:'Stock check recorded'}</small></td>
                <td>{quote?`${quote.quantity} units`:'Awaiting offer'}<small>{quote?'Supplier selected':'No supplier selected'}</small></td>
                <td>{entry.selection?`${usdc(entry.selection.amount)} ${moneyLabel}`:'Not estimated'}</td>
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
          <PanelHeading eyebrow="SUPPLIER OFFERS" title="Compare suppliers" />
          <p className={styles.panelLead}>Review example suppliers, prices and delivery times.</p>
          <h3>Sample suppliers</h3>
          {catalog?.configured?<div className={styles.tableWrap} tabIndex={0} aria-label="Sample supplier offers"><table><thead><tr><th>Supplier</th><th>Product</th><th>Unit price · {moneyLabel}</th><th>Delivery time</th></tr></thead>
           <tbody>{catalog.entries?.map(entry=>{const supplierIndex=catalog.suppliers?.findIndex(s=>s.id===entry.supplierId)??-1;return <tr key={`${entry.itemId}:${entry.supplierId}`}><td>{supplierIndex>=0?`Supplier ${supplierIndex+1}`:'Supplier'}</td><td>{inventory.find(i=>i.id===entry.itemId)?.name??entry.itemId}</td><td>{usdc(entry.unitPriceAtomic)}</td><td>{entry.leadTimeDays} days</td></tr>;})}</tbody></table></div>:<EmptyState error={catalogError} empty="No supplier offers are available. Refresh or check with your clinic administrator."/>}
          <h3>Recent quotes</h3>
          {suppliers.size ? <div className={styles.tableWrap} tabIndex={0} aria-label="Supplier offer history">
            <table><thead><tr><th>Supplier</th><th>Requests</th><th>Offers</th><th>Total quoted</th></tr></thead>
              <tbody>{[...suppliers.values()].map((supplier,index) => <tr key={supplier.id}><td><strong>Supplier {index+1}</strong></td>
                <td>{supplier.cases.size}</td><td>{supplier.quoteCount}</td><td>{usdc(supplier.totalProposed.toString())} {moneyLabel}</td></tr>)}</tbody>
            </table>
          </div> : <EmptyState error={error} empty="No supplier quote records are available in the current cases." />}
          <p className={styles.dataFootnote}>These offers are examples only. No supplier is contacted from this page.</p>
        </section>
      )}

      {!loading && !error && section === "payments" && (
        <section className={styles.panel}>
          <PanelHeading eyebrow="PAYMENT HISTORY" title="Recent payment activity" />
          <p className={styles.panelLead}>Open an order to review its status and any action needed.</p>
          {cases.some((entry) => entry.selection || entry.vault || entry.settlement) ? <div className={styles.tableWrap} tabIndex={0} aria-label="Payment activity">
            <table><thead><tr><th>Purchase order</th><th>Amount</th><th>Payment status</th><th>Supplier receipt</th><th>Order status</th></tr></thead>
              <tbody>{cases.filter((entry) => entry.selection || entry.vault || entry.settlement).map((entry) => <tr key={entry.caseId}>
                <td><strong>{entry.item?.name??entry.itemId}</strong><small>{entry.poId??"Order being prepared"}</small><button className={styles.evidenceButton} onClick={e=>{caseTrigger.current=e.currentTarget;setSelectedCase(entry.caseId);}}>Review Order</button></td>
                <td>{entry.selection ? `${usdc(entry.selection.amount)} ${moneyLabel}` : "Not estimated"}</td>
                <td>{entry.vault ? stateText(entry.vault.status) : "Not checked yet"}</td>
                <td>{entry.settlement ? stateText(entry.settlement.state) : "Not received"}</td>
                <td>{caseStateLabel(entry)}</td>
              </tr>)}</tbody>
            </table>
          </div> : <EmptyState error={error} empty="No payments recorded yet. Prepared orders appear here for review." />}
          <p className={styles.dataFootnote}>A payment is complete once its receipt is confirmed. Record delivered supplies in Inventory.</p>
        </section>
      )}

      {!loading && !error && section === "activity" && (
        <section className={styles.panel}>
          <PanelHeading eyebrow="ACTIVITY" title="Order updates" />
          {cases.some((entry) => entry.timeline.length) ? <ol className={styles.timeline}>
            {cases.flatMap((entry) => entry.timeline.map((event) => ({ entry, event })))
              .sort((a, b) => Date.parse(b.event.timestamp) - Date.parse(a.event.timestamp)).slice(0, 50)
              .map(({ entry, event }, index) => <li key={`${entry.caseId}-${event.eventType}-${event.timestamp}-${index}`}>
                <span className={styles.timelineMark} aria-hidden="true" />
                <div><strong>{stateText(event.eventType)}</strong><small>{entry.item?.name ?? entry.itemId}</small>
                  <p>{stateText(event.previousState ?? "Started")} → {stateText(event.resultingState)}</p>
                  <time dateTime={event.timestamp}>{formatTime(event.timestamp)}</time>
                </div>
              </li>)}
          </ol> : <EmptyState error={error} empty="No replenishment activity yet." />}
          <h3>Purchase planning activity</h3>
          {runsError&&<p className={styles.error} role="alert">Procurement run history unavailable: {runsError}</p>}
          {runs.map(run=><details key={run.id}><summary>{stateText(run.state)} · {formatTime(run.startedAt)}</summary>
           <p>{run.result?.decision?.explanation??'A purchase planning check was recorded.'}</p></details>)}
          <p className={styles.dataFootnote}>Payment activity appears here after it is recorded. Delivery is tracked separately in Inventory.</p>
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
            <PanelHeading eyebrow="YOUR CLINIC" title="Access and services" />
            <dl className={styles.facts}><dt>Your role</dt><dd>{tenant?.clinic.role??(role==='operator'?'Staff':'Viewer')}</dd>
              <dt>Stock updates</dt><dd>{session?.inventoryRuntime ? "Available" : "Not set up"}</dd>
              <dt>Purchase planning help</dt><dd>{session?.providerAvailable ? "Available" : "Not enabled"}</dd>
              <dt>Payment balance</dt><dd>{session?.deployment==='public-testnet'?'Demo funds only':session?.deployment==='testnet-preparation'?'Demo orders only':'Unavailable'}</dd></dl>
          </section>
          <section className={styles.panel}>
            <PanelHeading eyebrow="PAYMENTS" title="Payment review" />
            <p className={styles.panelLead}>Every purchase is checked against clinic limits. Purchases that need approval stay on hold until a clinic approver reviews them.</p>
            <Link className={styles.inlineLink} href="/app/payments">View payment activity →</Link>
            <details><summary>Advanced account details</summary><dl className={styles.facts}><dt>Session expires</dt><dd>{session ? formatTime(session.expiresAt) : "Unavailable"}</dd>
              <dt>Profile reference</dt><dd><code>{session?.profileFingerprint ?? "Unavailable"}</code></dd>
              <dt>Wallet setup</dt><dd>{session?.walletMode === "local-sandbox" ? "Local preview wallet" : session?.walletMode === "isolated-mock" ? "Simulation only" : "Not enabled"}</dd></dl></details>
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

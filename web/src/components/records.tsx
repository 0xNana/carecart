import { amount, date, label, type Snapshot } from '@/lib/procurement';
import { PaymentStatus } from './payment-status';
export function Records({ snapshot }: { snapshot: Snapshot }) {
  const supplier = (id: string) => snapshot.suppliers.find((entry) => entry.id === id)?.displayName.replace('Synthetic Demo Supplier ', 'Supplier ') ?? id;
  const item = (id: string) => snapshot.inventory.find((entry) => entry.id === id)?.name.replace('Synthetic ', '') ?? id;
  return <div className="records-grid">
    <section id="orders" className="panel" aria-labelledby="orders-title"><div className="section-top"><div><span className="eyebrow">Persisted records</span><h2 id="orders-title">Purchase orders <span className="count">{snapshot.purchaseOrders.length}</span></h2></div><span className="caption">Latest 50</span></div>
      {snapshot.purchaseOrders.length === 0 ? <p className="empty">No purchase orders yet. Select an item and draft an order from a supplier quote.</p> : <div className="table-scroll" tabIndex={0} role="region" aria-label="Purchase orders, scroll horizontally on small screens"><table><thead><tr><th scope="col">Order / item</th><th scope="col">Supplier</th><th scope="col">Quantity</th><th scope="col">Amount · atomic</th><th scope="col">Status / testnet payment</th></tr></thead><tbody>{snapshot.purchaseOrders.map((po) => <tr key={po.id}><th scope="row"><strong className="mono">{po.id}</strong><span className="caption">{item(po.itemId)}</span></th><td>{supplier(po.supplierId)}</td><td>{po.quantity}</td><td className="numeric">{amount(po.amountAtomic)}<span className="caption">{po.assetCode}</span></td><td><span className="tag muted-tag">{label(po.status)}</span><PaymentStatus order={po}/></td></tr>)}</tbody></table></div>}
      <p className="panel-foot">Synthetic records only · Drafting an order does not move funds.</p>
    </section>
    <section id="audit" className="panel audit-panel" aria-labelledby="audit-title"><div className="section-top"><div><span className="eyebrow">Traceable by design</span><h2 id="audit-title">Activity & audit</h2></div><span className="caption">Latest 50</span></div>
      {snapshot.auditEvents.length === 0 ? <p className="empty">No activity recorded yet. New procurement actions will appear here.</p> : <ol className="audit-list">{snapshot.auditEvents.map((event) => <li key={event.id}><details><summary><span className="audit-dot" aria-hidden="true"/><span><strong>{label(event.eventType)}</strong><span className="caption">{event.entityId} · {date(event.occurredAt)} UTC</span></span><span className="disclosure" aria-hidden="true">+</span></summary><div className="audit-detail"><span className="caption">{event.id} · {label(event.entityType)}</span><pre>{JSON.stringify(event.payload, null, 2)}</pre></div></details></li>)}</ol>}
    </section>
  </div>;
}

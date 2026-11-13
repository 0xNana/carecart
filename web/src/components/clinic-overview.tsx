import {ApplicationLink as Link} from './application-link';
import type {StockDashboard} from '@/lib/inventory';
import {displayTime,unitLabel} from '@/lib/product-copy';

const supplyName=(name:string)=>name.replace(/\s*\(synthetic\)$/i,'');
export function ClinicOverview({data,canRecord}:{data:StockDashboard;canRecord:boolean}){
 const attention=data.items.filter(item=>item.forecast.shortage||item.freshness?.issues.length);
 const incoming=data.deliveries?.filter(delivery=>delivery.remaining>0)??[];
 const reviews=data.caseStates.filter(entry=>entry.humanInterventions.length>0);
 const monitoring=data.config.monitoring;
 const healthy=monitoring&&data.workerHealth?.status==='Healthy';
 return <div className="clinic-overview">
  <div className="clinic-status-strip"><span className={healthy?'clinic-status-good':'clinic-status-neutral'}><span aria-hidden="true"/> {healthy?'Monitoring active':monitoring?'Check monitoring':'Monitoring off'}</span><p>{data.workerHealth?.lastSuccessfulEvaluation?`Last stock check ${displayTime(data.workerHealth.lastSuccessfulEvaluation)}`:'Stock checks have not been recorded yet.'}</p><Link href="/app/settings">Manage monitoring <span aria-hidden="true">→</span></Link></div>
  <section className="clinic-summary" aria-label="Clinic summary">
   {[['Supplies tracked',data.trackedSkus,'In your inventory'],['Low stock',data.lowStock,'Below the reorder level'],['Expected deliveries',incoming.length,'Not yet received'],['Needs review',reviews.length,'Purchasing decisions']].map(([label,value,hint])=><div key={label}><span>{label}</span><strong>{value}</strong><small>{hint}</small></div>)}
  </section>
  <section className="clinic-action-bar" aria-label="Quick stock actions"><div><h2>Keep your stock up to date</h2><p>Record what arrives and what your team uses.</p></div><div className="clinic-actions">{canRecord?<><Link className="clinic-primary" href="/app/inventory#receive">Receive stock <span aria-hidden="true">＋</span></Link><Link className="clinic-secondary" href="/app/inventory#consume">Record usage</Link></>:<Link className="clinic-secondary" href="/app/inventory">View inventory</Link>}</div></section>
  <div className="clinic-overview-grid">
   <section className="clinic-surface"><header><div><p className="clinic-kicker">STOCK PRIORITIES</p><h2>Needs your attention</h2></div><Link href="/app/inventory">View inventory <span aria-hidden="true">→</span></Link></header>
    {attention.length?<div className="clinic-table-scroll" tabIndex={0} role="region" aria-label="Stock priorities"><table><thead><tr><th scope="col">Supply</th><th scope="col">Available</th><th scope="col">Status</th></tr></thead><tbody>{attention.map(item=><tr key={item.id}><th scope="row"><Link href={'/app/inventory#sku-'+item.id}>{supplyName(item.name)}</Link><small>{item.sku}</small></th><td><strong>{item.balance.available}</strong><small>{unitLabel(item.baseUnit,item.balance.available)}</small></td><td><span className="clinic-badge-warning">{item.forecast.shortage?'Low stock':'Check records'}</span></td></tr>)}</tbody></table></div>:<div className="clinic-empty"><span aria-hidden="true">✓</span><h3>No stock alerts</h3><p>Keep recording receipts and usage so your inventory stays accurate.</p></div>}
   </section>
   <section className="clinic-surface"><header><div><p className="clinic-kicker">ON THE WAY</p><h2>Expected deliveries</h2></div><span className="clinic-count">{incoming.length}</span></header>
    {incoming.length?<ul className="clinic-deliveries">{incoming.slice(0,4).map(delivery=>{const item=data.items.find(item=>item.id===delivery.productId);return <li key={delivery.orderId}><span className="clinic-delivery-icon" aria-hidden="true">↙</span><div><strong>{supplyName(item?.name??'Supply order')}</strong><p>{delivery.remaining} {unitLabel(item?.baseUnit??'unit',delivery.remaining)} remaining</p><small>{delivery.confirmationReference?'Supplier confirmed':'Awaiting supplier confirmation'}</small></div>{canRecord&&<Link href="/app/inventory#receive">Receive</Link>}</li>;})}</ul>:<div className="clinic-empty clinic-empty-small"><span aria-hidden="true">▤</span><h3>No deliveries expected</h3><p>Incoming supplies will appear here when an order is prepared.</p></div>}
    <footer><Link href="/app/replenishment">View replenishment <span aria-hidden="true">→</span></Link></footer>
   </section>
  </div>
  {reviews.length>0&&<section className="clinic-review-strip"><div><strong>{reviews.length} {reviews.length===1?'request needs':'requests need'} a decision</strong><p>Review the order and purchasing limits before taking action.</p></div><Link className="clinic-secondary" href="/app/replenishment">Review requests</Link></section>}
  <p className="clinic-read-time">Stock records read {displayTime(data.readAt)}. A confirmed payment does not confirm delivery.</p>
 </div>;
}

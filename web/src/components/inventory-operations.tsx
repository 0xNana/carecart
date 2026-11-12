'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { OperatorApiError, type OperatorClient } from '../lib/operator-client';
import {actionError,statusLabel,stockActionLabel,unitLabel,displayTime} from '../lib/product-copy';
import type { StockDashboard } from '../lib/inventory';
export function InventorySummary({data}: {data:StockDashboard;publicPayments?:boolean}) {
 const [search,setSearch]=useState('');
 const items=data.items.filter(i=>(i.name+' '+i.sku).toLowerCase().includes(search.toLowerCase()));
 return <><h3>Stock levels</h3><label>Search products <input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Product name"/></label>
 <div className="ops-table-scroll" tabIndex={0} role="region" aria-label="Stock levels"><table><thead><tr><th>Supply</th><th>On hand</th><th>Available</th><th>Reorder level</th><th>Status</th></tr></thead><tbody>{items.map(i=><tr key={i.id}><td><a href={'#sku-'+i.id}>{i.name}</a><small>Measured in {i.baseUnit}</small></td><td>{i.balance.onHand}</td><td>{i.balance.available}</td><td>{i.forecast.reorderPoint}</td><td>{i.forecast.shortage?'Low stock':'In range'}{i.freshness?.issues.length?' · Check stock records':''}</td></tr>)}</tbody></table></div>
 {!items.length&&<p>No supplies match your search.</p>}
 {items.map(item=><article id={'sku-'+item.id} key={item.id}><h3>{item.name}</h3><p>1 purchase pack = {item.packSize} {unitLabel(item.baseUnit,item.packSize)}</p>
 <details><summary>Stock, batches and history</summary>
 <dl><dt>On hand / set aside / available</dt><dd>{item.balance.onHand} / {item.balance.reserved} / {item.balance.available}</dd><dt>Expected deliveries / stock position</dt><dd>{item.balance.incoming} / {item.balance.inventoryPosition}</dd><dt>Reorder level / target stock</dt><dd>{item.forecast.reorderPoint} / {item.forecast.targetStock}</dd><dt>Average daily use</dt><dd>{item.forecast.dailyDemand} {unitLabel(item.baseUnit)} · estimated delivery in {item.forecast.leadTimeDays} days</dd><dt>Estimated days of stock left</dt><dd>{item.forecast.daysOfSupply?.toFixed(1)??'Not available'}</dd></dl>
 {item.freshness?.issues.length?<p role="status">Check stock records: {item.freshness.issues.join('; ')}</p>:null}
 <p>Usable: {item.balance.usableOnHand??item.balance.onHand} · Expired: {item.balance.expired} · Expected but not confirmed: {item.balance.unverifiedIncoming??0} · Backordered: {item.balance.backorders??0}</p>
 <h4>Lots and expiry dates</h4>{item.batches?.length?<ul>{item.batches.map(b=><li key={b.id}>{b.quantity} {unitLabel(item.baseUnit)} · expires {displayTime(b.expiresAt)} · receipt {b.receiptReference??'Opening balance'}<details><summary>Lot number</summary><code>{b.id}</code></details></li>)}</ul>:<p>No lots recorded.</p>}
 <h4>Stock dispensed or consumed</h4><ul>{Object.entries(item.movements.filter(m=>['Consume','Dispense'].includes(m.kind)).reduce<Record<string,number>>((days,m)=>{const day=m.timestamp.slice(0,10);days[day]=(days[day]??0)+m.baseQuantity;return days;},{})).map(([day,n])=><li key={day}>{day}: {n} {unitLabel(item.baseUnit)}</li>)}</ul>
 <h4>Stock activity</h4>{!item.movements.length&&<p>No stock activity recorded.</p>}<ol>{item.movements.map(m=><li key={m.id}><strong>{statusLabel(m.kind)}: {m.baseQuantity} {unitLabel(item.baseUnit)}</strong> · {displayTime(m.timestamp)}<p>{m.reason}{m.destination?' · '+m.destination:''}{m.reference?' · reference '+m.reference:''}{m.supplierId?' · '+m.supplierId:''}{m.batch?' · lot '+m.batch:''}</p><details><summary>More activity details</summary><p>Recorded by {m.actor}{m.receivedAt?' · received '+displayTime(m.receivedAt):''}</p><p>{m.id} · {m.source}{m.orderId?' · order '+m.orderId:''}{m.corrects?' · corrects '+m.corrects:''}</p></details></li>)}</ol>
 <details><summary>Forecast details</summary><p>{item.forecast.basis} · {item.forecast.safetyStock} safety stock · {item.clinicId} / {item.storeroomId} · source {item.source}</p></details></details></article>)}
 <h3>Replenishment</h3>{data.obligations.length?<ul>{data.obligations.map(o=>{const c=data.caseStates.find(c=>c.caseId===o.caseId);return <li key={o.id}><a href="/app/replenishment">{data.items.find(i=>i.id===o.productId)?.name??'Review request'}</a> · {o.closedAt?'Goods received':statusLabel(c?.state??'Preparing')}<p>Payment: {statusLabel(c?.paymentState??'Unobserved')}. {c?.humanInterventions.map(statusLabel).join(', ')||'No action requested'}</p><details><summary>Request details</summary><code>{o.caseId}</code><p>Delivery is recorded independently of payment.</p></details></li>;})}</ul>:<p>No replenishment requests yet. Stock monitoring will create a request when needed.</p>}
 </>;
}
export function InventoryOperations({ client, operator, onChanged, onFailure,publicPayments=false }: {
    client: OperatorClient;
    operator: boolean;
    canManageAutonomy?:boolean;
    publicPayments?:boolean;
    onChanged: () => Promise<void>;
    onFailure: (cause: unknown) => void;
}) {
    const [data, setData] = useState<StockDashboard | null>(null);
    const [unavailable, setUnavailable] = useState(false);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const generation = useRef(0);
    const submitting=useRef(false);
    const formRef = useRef<HTMLFormElement>(null);
    const [kind, setKind] = useState('Consume');
    const [quantity, setQuantity] = useState('1');
    const [unit, setUnit] = useState<'base' | 'pack'>('base');
    const [productId, setProductId] = useState('mn-item-1');
    const [orderId, setOrderId] = useState('');
    const [reason, setReason] = useState('');
    const [expiresAt, setExpiresAt] = useState('');
    const [receiptReference,setReceiptReference]=useState('');
    const [supplierId,setSupplierId]=useState('');
    const [suppliers,setSuppliers]=useState<{id:string;account:string}[]>([]);
    const [batch,setBatch]=useState('');
    const [receivedAt,setReceivedAt]=useState('');
    const [destination,setDestination]=useState('');
    const [reference,setReference]=useState('');
    const pendingMovement=useRef<{signature:string;id:string}|null>(null);
    const [confirmationReference,setConfirmationReference]=useState('');
    const [confirmedAt,setConfirmedAt]=useState('');
    const [success,setSuccess]=useState('');
    const [corrects, setCorrects] = useState('');
    const caseSignature = useRef('');
    const invalidate = useCallback(() => { generation.current++; }, []);
    const refresh = useCallback(async () => {
        const g = ++generation.current;
        try {
            const [next,catalog] = await Promise.all([client.stock(),client.catalog()]);
            if (g === generation.current) {
                setData(next);
                setSuppliers(catalog.suppliers??[]);
                setUnavailable(false);
                setError('');
                const signature = JSON.stringify(next.caseStates);
                if (signature !== caseSignature.current) {
                    caseSignature.current = signature;
                    await onChanged();
                }
            }
        }
        catch (e) {
            if (g !== generation.current)
                return;
            setData(null);
            setSuppliers([]);
            if (e instanceof OperatorApiError && e.code === 'INVENTORY_RUNTIME_NOT_CONFIGURED')
                setUnavailable(true);
            else {
                setError(actionError(e,'Stock records are unavailable. Refresh to try again.'));
                if (e instanceof OperatorApiError && e.status === 401) {
                    setData(null);
                    onFailure(e);
                }
            }
        }
    }, [client, onChanged, onFailure]);
    useEffect(() => { let active = true; const load = () => { if (active)
        void refresh(); }; load(); const timer = setInterval(load, 5000); return () => { active = false; invalidate(); clearInterval(timer); }; }, [refresh, invalidate]);
    async function mutate(work: () => Promise<unknown>) { if(submitting.current)return;submitting.current=true;setBusy(true); setError('');setSuccess(''); try {
        await work();setSuccess('Stock updated.');
        await refresh();
        await onChanged();
    }
    catch (e) {
        setError(actionError(e,'This update could not be saved. Check the quantity and existing records, then try again.'));
        if (e instanceof OperatorApiError && e.status === 401)
            onFailure(e);
    }
    finally {
        submitting.current=false;setBusy(false);
    } }
    if (unavailable)
        return <section className="ops-panel" aria-label="Stock updates"><h2>Stock updates</h2><p role="status">Stock updates are not available right now. Ask your clinic administrator for help.</p></section>;
    return <section className="ops-panel" aria-label="Stock updates"><h2>Manage stock</h2>{error && <p role="alert" className="ops-error">{error}</p>}
  <p role="status">{success}</p>{!operator&&<p>You have view-only access.</p>}
  {!data ? <p role="status">{error?'Stock details are unavailable. Refresh before recording an update.':'Loading stock…'}</p> : <>

   <form ref={formRef} style={{scrollMarginTop:"8rem"}} onSubmit={e => {
                e.preventDefault();
                const signature=JSON.stringify({productId,kind,quantity,unit,orderId,reason,expiresAt,corrects,receiptReference,supplierId,batch,receivedAt,destination,reference,confirmationReference,confirmedAt});
                if(pendingMovement.current?.signature!==signature)pendingMovement.current={signature,id:crypto.randomUUID()};
                const id=pendingMovement.current.id;
                void mutate(async () => {const result=await client.recordStock({ id, productId, kind, quantity: Number(quantity), unit, source: 'manual',
                    ...(kind==='Receive'?{supplierId,batch,receivedAt:new Date(receivedAt).toISOString()}:{}),...(kind==='Dispense'?{destination}:{}),...(['Consume','Dispense'].includes(kind)&&reference?{reference}:{}),
                    ...(['Receive','ConfirmInbound','CancelInbound'].includes(kind)&&orderId ? { orderId } : {}), ...(reason ? { reason } : {}), ...(['Receive','AdjustUp'].includes(kind)&&expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}), ...(['AdjustUp','AdjustDown'].includes(kind)&&corrects ? { corrects } : {}),...(kind==='Receive'&&receiptReference?{receiptReference}:{}),...(kind==='ConfirmInbound'&&confirmationReference?{confirmationReference}:{}),...(kind==='ConfirmInbound'&&confirmedAt?{confirmedAt:new Date(confirmedAt).toISOString()}:{} ) });pendingMovement.current=null;return result;});
            }}>
    <h3>{stockActionLabel(kind)}</h3><p>{kind==='Receive'?'Record supplies after they arrive. Payment does not update stock automatically.':['Consume','Dispense'].includes(kind)?'Record stock leaving this storeroom once. Do not enter patient information.':'Record the stock change and why it was made.'}</p>
    <label>Product <select value={productId} onChange={e => setProductId(e.target.value)} disabled={!operator || busy}>{data.items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
    <label>What would you like to record? <select value={kind} onChange={e => setKind(e.target.value)} disabled={!operator || busy}>{['Consume', 'Dispense', 'Receive', 'Reserve', 'Release', 'AdjustUp', 'AdjustDown', 'Unusable', 'ConfirmInbound', 'CancelInbound'].map(k => <option value={k} key={k}>{stockActionLabel(k)}</option>)}</select></label>
    <label>Quantity <input type="number" min="1" max="1000000" step="1" value={quantity} onChange={e => setQuantity(e.target.value)} disabled={!operator || busy} required/></label>
    <label>Count in <select value={unit} onChange={e => setUnit(e.target.value as 'base' | 'pack')} disabled={!operator || busy}><option value="base">{unitLabel(data.items.find(i=>i.id===productId)?.baseUnit??'unit')}</option><option value="pack">Purchase packs ({data.items.find(i=>i.id===productId)?.packSize??1} units each)</option></select></label>
    {kind==='Receive'&&<>
      <label>Supplier <select value={supplierId} onChange={e=>setSupplierId(e.target.value)} disabled={!operator||busy} required><option value="">Select supplier</option>{suppliers.map((s,index)=><option value={s.id} key={s.id}>Supplier {index+1}</option>)}</select></label>
      <label>Lot number <input value={batch} maxLength={100} onChange={e=>setBatch(e.target.value)} disabled={!operator||busy} required/></label>
      <label>Date received <input type="datetime-local" value={receivedAt} onChange={e=>setReceivedAt(e.target.value)} disabled={!operator||busy} required/></label>
    </>}
    {kind==='Dispense'&&<label>Department or purpose <input value={destination} maxLength={100} onChange={e=>setDestination(e.target.value)} disabled={!operator||busy} required/></label>}
    {['Dispense','Consume'].includes(kind)&&<label>Reference (optional) <input value={reference} maxLength={100} onChange={e=>setReference(e.target.value)} disabled={!operator||busy}/></label>}
    {['Receive','ConfirmInbound','CancelInbound'].includes(kind)&&<>
    <label>Related order number (optional) <input value={orderId} maxLength={100} onChange={e => setOrderId(e.target.value)} disabled={!operator || busy}/></label>
    </>}
    {kind==='Receive'&&<>
    <label>Receipt or invoice number <input value={receiptReference} maxLength={100} onChange={e=>setReceiptReference(e.target.value)} disabled={!operator||busy} required={kind==='Receive'}/></label>
    </>}
    {kind==='ConfirmInbound'&&<>
    <label>Supplier delivery reference <input value={confirmationReference} maxLength={100} onChange={e=>setConfirmationReference(e.target.value)} disabled={!operator||busy} required={kind==='ConfirmInbound'}/></label>
    <label>Delivery confirmed at <input type="datetime-local" value={confirmedAt} onChange={e=>setConfirmedAt(e.target.value)} disabled={!operator||busy} required={kind==='ConfirmInbound'}/></label>
    <p>Use the supplier’s confirmation to record an expected delivery. Stock increases when goods are received.</p>
    </>}
    {['AdjustUp','AdjustDown'].includes(kind)&&<>
    <label>Adjustment reason <input value={reason} maxLength={200} onChange={e => setReason(e.target.value)} disabled={!operator || busy} required={kind === 'AdjustUp' || kind === 'AdjustDown'}/></label>
    <details><summary>Link to an earlier stock update (optional)</summary><label>Update reference <input value={corrects} maxLength={64} onChange={e => setCorrects(e.target.value)} disabled={!operator || busy}/></label></details>
    </>}
    {['Receive','AdjustUp'].includes(kind)&&<>
    <label>Expiry date (optional) <input type="datetime-local" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} disabled={!operator || busy}/></label>
    </>}
    <button disabled={!operator || busy}>{busy ? 'Saving…' : 'Save stock update'}</button>
   </form>
   <InventorySummary data={data} publicPayments={publicPayments}/>
  </>}
 </section>;
}

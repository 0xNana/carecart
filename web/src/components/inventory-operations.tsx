'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { OperatorApiError, type OperatorClient } from '../lib/operator-client';
import {actionError,statusLabel,stockActionLabel,unitLabel,displayTime} from '../lib/product-copy';
import type { StockDashboard } from '../lib/inventory';
export function InventorySummary({data}: {data:StockDashboard;publicPayments?:boolean}) {
 const [search,setSearch]=useState('');
 const items=data.items.filter(i=>(i.name+' '+i.sku).toLowerCase().includes(search.toLowerCase()));
 return <><h3>Stock balances</h3><label>Search supplies <input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Supply name or SKU"/></label>
 <div className="ops-table-scroll" tabIndex={0} role="region" aria-label="Stock balances"><table><thead><tr><th>Supply</th><th>On hand</th><th>Available</th><th>Reorder point</th><th>Status</th></tr></thead><tbody>{items.map(i=><tr key={i.id}><td><a href={'#sku-'+i.id}>{i.name}</a><small>{i.sku} · {i.baseUnit}</small></td><td>{i.balance.onHand}</td><td>{i.balance.available}</td><td>{i.forecast.reorderPoint}</td><td>{i.forecast.shortage?'Low stock':'Within target'}{i.freshness?.issues.length?' · Check records':''}</td></tr>)}</tbody></table></div>
 {!items.length&&<p>No supplies match your search.</p>}
 {items.map(item=><article id={'sku-'+item.id} key={item.id}><h3>{item.name}</h3><p>{item.sku} · 1 purchase pack = {item.packSize} {unitLabel(item.baseUnit,item.packSize)}</p>
 <details><summary>Stock, batches and history</summary>
 <dl><dt>On hand / reserved / available</dt><dd>{item.balance.onHand} / {item.balance.reserved} / {item.balance.available}</dd><dt>Confirmed incoming / inventory position</dt><dd>{item.balance.incoming} / {item.balance.inventoryPosition}</dd><dt>Reorder point / target stock</dt><dd>{item.forecast.reorderPoint} / {item.forecast.targetStock}</dd><dt>Expected usage</dt><dd>{item.forecast.dailyDemand} {unitLabel(item.baseUnit)} per day · {item.forecast.leadTimeDays}-day delivery estimate</dd><dt>Estimated days remaining</dt><dd>{item.forecast.daysOfSupply?.toFixed(1)??'No demand estimate'}</dd></dl>
 {item.freshness?.issues.length?<p role="status">Check stock records: {item.freshness.issues.join('; ')}</p>:null}
 <p>Usable: {item.balance.usableOnHand??item.balance.onHand} · Expired: {item.balance.expired} · Unverified incoming: {item.balance.unverifiedIncoming??0} · Backorders: {item.balance.backorders??0}</p>
 <h4>Batches and expiry</h4>{item.batches?.length?<ul>{item.batches.map(b=><li key={b.id}>{b.id}: {b.quantity} {unitLabel(item.baseUnit)} · expiry {displayTime(b.expiresAt)} · receipt {b.receiptReference??'Opening balance'}</li>)}</ul>:<p>No batches recorded.</p>}
 <h4>Stock dispensed or consumed</h4><ul>{Object.entries(item.movements.filter(m=>['Consume','Dispense'].includes(m.kind)).reduce<Record<string,number>>((days,m)=>{const day=m.timestamp.slice(0,10);days[day]=(days[day]??0)+m.baseQuantity;return days;},{})).map(([day,n])=><li key={day}>{day}: {n} {unitLabel(item.baseUnit)}</li>)}</ul>
 <h4>Stock activity</h4>{!item.movements.length&&<p>No stock activity recorded.</p>}<ol>{item.movements.map(m=><li key={m.id}><strong>{statusLabel(m.kind)}: {m.baseQuantity} {unitLabel(item.baseUnit)}</strong> · {displayTime(m.timestamp)}<p>{m.actor}{m.reason?' · '+m.reason:''}{m.destination?' · destination '+m.destination:''}{m.reference?' · reference '+m.reference:''}{m.supplierId?' · supplier '+m.supplierId:''}{m.batch?' · batch '+m.batch:''}{m.receivedAt?' · received '+m.receivedAt:''}</p><details><summary>Record details</summary><p>{m.id} · {m.source}{m.orderId?' · PO '+m.orderId:''}{m.corrects?' · corrects '+m.corrects:''}</p></details></li>)}</ol>
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
        setError(actionError(e,'Stock change rejected. Check stock activity for an existing reference, then review the quantity and unit before retrying.'));
        if (e instanceof OperatorApiError && e.status === 401)
            onFailure(e);
    }
    finally {
        submitting.current=false;setBusy(false);
    } }
    if (unavailable)
        return <section className="ops-panel" aria-label="Inventory operations"><h2>Inventory operations</h2><p role="status">The persisted inventory service is unavailable. Staff actions resume when it is configured.</p></section>;
    return <section className="ops-panel" aria-label="Inventory operations"><h2>Manage stock</h2>{error && <p role="alert" className="ops-error">{error}</p>}
  <p role="status">{success}</p>{!operator&&<p>Viewer access: inventory is read-only.</p>}
  {!data ? <p role="status">{error?'Persisted inventory values are unavailable. Refresh before recording stock.':'Loading stock…'}</p> : <>
    <div className="ops-actions" role="group" aria-label="Staff inventory actions">{([['Receive','Receive Stock'],['Dispense','Dispense Stock'],['Consume','Record Consumption'],['AdjustUp','Adjust Stock']] as const).map(([action,label])=><button key={action} type="button" disabled={!operator||busy} aria-pressed={kind===action||(action==='AdjustUp'&&kind==='AdjustDown')} onClick={()=>{setKind(action);formRef.current?.scrollIntoView({block:"start"});formRef.current?.querySelector("select")?.focus({preventScroll:true});}}>{label}</button>)}</div>

   <form ref={formRef} style={{scrollMarginTop:"8rem"}} onSubmit={e => {
                e.preventDefault();
                const signature=JSON.stringify({productId,kind,quantity,unit,orderId,reason,expiresAt,corrects,receiptReference,supplierId,batch,receivedAt,destination,reference,confirmationReference,confirmedAt});
                if(pendingMovement.current?.signature!==signature)pendingMovement.current={signature,id:crypto.randomUUID()};
                const id=pendingMovement.current.id;
                void mutate(async () => {const result=await client.recordStock({ id, productId, kind, quantity: Number(quantity), unit, source: 'manual',
                    ...(kind==='Receive'?{supplierId,batch,receivedAt:new Date(receivedAt).toISOString()}:{}),...(kind==='Dispense'?{destination}:{}),...(['Consume','Dispense'].includes(kind)&&reference?{reference}:{}),
                    ...(['Receive','ConfirmInbound','CancelInbound'].includes(kind)&&orderId ? { orderId } : {}), ...(reason ? { reason } : {}), ...(['Receive','AdjustUp'].includes(kind)&&expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}), ...(['AdjustUp','AdjustDown'].includes(kind)&&corrects ? { corrects } : {}),...(kind==='Receive'&&receiptReference?{receiptReference}:{}),...(kind==='ConfirmInbound'&&confirmationReference?{confirmationReference}:{}),...(kind==='ConfirmInbound'&&confirmedAt?{confirmedAt:new Date(confirmedAt).toISOString()}:{} ) });pendingMovement.current=null;return result;});
            }}>
    <h3>{stockActionLabel(kind)}</h3><p>{kind==='Receive'?'Record supplies only after they arrive. A confirmed payment does not add stock.':['Consume','Dispense'].includes(kind)?'Record stock leaving this storeroom once, as dispensing or consumption. Do not enter patient information.':'Record the stock change and its reason. Previous stock activity is preserved.'}</p>
    <label>Product <select value={productId} onChange={e => setProductId(e.target.value)} disabled={!operator || busy}>{data.items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
    <label>Action <select value={kind} onChange={e => setKind(e.target.value)} disabled={!operator || busy}>{['Consume', 'Dispense', 'Receive', 'Reserve', 'Release', 'AdjustUp', 'AdjustDown', 'Unusable', 'ConfirmInbound', 'CancelInbound'].map(k => <option value={k} key={k}>{stockActionLabel(k)}</option>)}</select></label>
    <label>Quantity <input type="number" min="1" max="1000000" step="1" value={quantity} onChange={e => setQuantity(e.target.value)} disabled={!operator || busy} required/></label>
    <label>Units <select value={unit} onChange={e => setUnit(e.target.value as 'base' | 'pack')} disabled={!operator || busy}><option value="base">{unitLabel(data.items.find(i=>i.id===productId)?.baseUnit??'unit')}</option><option value="pack">Purchase packs ({data.items.find(i=>i.id===productId)?.packSize??1} units each)</option></select></label>
    {kind==='Receive'&&<>
      <label>Supplier <select value={supplierId} onChange={e=>setSupplierId(e.target.value)} disabled={!operator||busy} required><option value="">Select supplier</option>{suppliers.map(s=><option value={s.id} key={s.id}>{s.id} · {s.account}</option>)}</select></label>
      <label>Batch <input value={batch} maxLength={100} onChange={e=>setBatch(e.target.value)} disabled={!operator||busy} required/></label>
      <label>Date received <input type="datetime-local" value={receivedAt} onChange={e=>setReceivedAt(e.target.value)} disabled={!operator||busy} required/></label>
    </>}
    {kind==='Dispense'&&<label>Destination department or purpose <input value={destination} maxLength={100} onChange={e=>setDestination(e.target.value)} disabled={!operator||busy} required/></label>}
    {['Dispense','Consume'].includes(kind)&&<label>Issue reference (optional) <input value={reference} maxLength={100} onChange={e=>setReference(e.target.value)} disabled={!operator||busy}/></label>}
    {['Receive','ConfirmInbound','CancelInbound'].includes(kind)&&<>
    <label>Purchase order reference (for an existing order) <input value={orderId} maxLength={100} onChange={e => setOrderId(e.target.value)} disabled={!operator || busy}/></label>
    </>}
    {kind==='Receive'&&<>
    <label>Receipt reference (document and line) <input value={receiptReference} maxLength={100} onChange={e=>setReceiptReference(e.target.value)} disabled={!operator||busy} required={kind==='Receive'}/></label>
    </>}
    {kind==='ConfirmInbound'&&<>
    <label>Supplier confirmation reference <input value={confirmationReference} maxLength={100} onChange={e=>setConfirmationReference(e.target.value)} disabled={!operator||busy} required={kind==='ConfirmInbound'}/></label>
    <label>Supplier confirmation time <input type="datetime-local" value={confirmedAt} onChange={e=>setConfirmedAt(e.target.value)} disabled={!operator||busy} required={kind==='ConfirmInbound'}/></label>
    <p>Use the supplier’s confirmation to record an expected delivery. Stock increases when goods are received.</p>
    </>}
    {['AdjustUp','AdjustDown'].includes(kind)&&<>
    <label>Adjustment reason <input value={reason} maxLength={200} onChange={e => setReason(e.target.value)} disabled={!operator || busy} required={kind === 'AdjustUp' || kind === 'AdjustDown'}/></label>
    <label>Corrects stock activity ID (optional) <input value={corrects} maxLength={64} onChange={e => setCorrects(e.target.value)} disabled={!operator || busy}/></label>
    </>}
    {['Receive','AdjustUp'].includes(kind)&&<>
    <label>Expiry date (optional) <input type="datetime-local" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} disabled={!operator || busy}/></label>
    </>}
    <button disabled={!operator || busy}>{busy ? 'Saving…' : 'Save stock activity'}</button>
   </form>
   <InventorySummary data={data} publicPayments={publicPayments}/>
  </>}
 </section>;
}

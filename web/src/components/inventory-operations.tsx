'use client';
import {ApplicationLink} from './application-link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { OperatorApiError, type OperatorClient } from '../lib/operator-client';
import {actionError,statusLabel,stockActionLabel,unitLabel,displayTime} from '../lib/product-copy';
import type { StockDashboard } from '../lib/inventory';
export function InventorySummary({data,compact=false}: {data:StockDashboard;publicPayments?:boolean;compact?:boolean}) {
 const [search,setSearch]=useState('');
 const [selected,setSelected]=useState<string|null>(null);
 const [lowOnly,setLowOnly]=useState(false);
 const detailTrigger=useRef<HTMLButtonElement|null>(null);
 useEffect(()=>{if(!compact)return;const selectFromHash=()=>{if(location.hash.startsWith('#sku-'))setSelected(location.hash.slice(5));};selectFromHash();window.addEventListener('hashchange',selectFromHash);return()=>window.removeEventListener('hashchange',selectFromHash);},[compact]);
 const items=data.items.filter(i=>(i.name+' '+i.sku).toLowerCase().includes(search.toLowerCase())&&(!lowOnly||i.forecast.shortage));
 return <><div className="stock-list-heading"><h3>Stock levels</h3>{compact&&<div className="stock-filters" aria-label="Filter supplies"><button type="button" aria-pressed={!lowOnly} onClick={()=>setLowOnly(false)}>All supplies <span>{data.items.length}</span></button><button type="button" aria-pressed={lowOnly} onClick={()=>setLowOnly(true)}>Low stock <span>{data.lowStock}</span></button></div>}</div><label>Search products <input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Product name"/></label>
 <div className="ops-table-scroll" tabIndex={0} role="region" aria-label="Stock levels"><table><thead><tr><th>Supply</th><th>On hand</th><th>Available</th><th>Reorder level</th><th>Status</th></tr></thead><tbody>{items.map(i=><tr key={i.id}><td>{compact?<button type="button" className="stock-detail-trigger" aria-expanded={selected===i.id} onClick={event=>{detailTrigger.current=event.currentTarget;setSelected(selected===i.id?null:i.id);}}>{i.name.replace(/\s*\(synthetic\)$/i,'')}</button>:<a href={'#sku-'+i.id}>{i.name}</a>}<small>Measured in {i.baseUnit}</small></td><td>{i.balance.onHand}</td><td>{i.balance.available}</td><td>{i.forecast.reorderPoint}</td><td>{i.forecast.shortage?'Low stock':'In range'}{i.freshness?.issues.length?' · Check stock records':''}</td></tr>)}</tbody></table></div>
 {!items.length&&<p>No supplies match your search.</p>}
 {items.filter(item=>!compact||item.id===selected).map(item=><article id={'sku-'+item.id} key={item.id}>{compact&&<button type="button" className="stock-close-details" onClick={()=>{setSelected(null);detailTrigger.current?.focus();}}>Close stock details</button>}<h3>{item.name}</h3><p>1 purchase pack = {item.packSize} {unitLabel(item.baseUnit,item.packSize)}</p>
 <details open={compact||undefined}><summary>Stock, batches and history</summary>
 <dl><dt>On hand / set aside / available</dt><dd>{item.balance.onHand} / {item.balance.reserved} / {item.balance.available}</dd><dt>Expected deliveries / stock position</dt><dd>{item.balance.incoming} / {item.balance.inventoryPosition}</dd><dt>Reorder level / target stock</dt><dd>{item.forecast.reorderPoint} / {item.forecast.targetStock}</dd><dt>Average daily use</dt><dd>{item.forecast.dailyDemand} {unitLabel(item.baseUnit)} · estimated delivery in {item.forecast.leadTimeDays} days</dd><dt>Estimated days of stock left</dt><dd>{item.forecast.daysOfSupply?.toFixed(1)??'Not available'}</dd></dl>
 {item.freshness?.issues.length?<p role="status">Check stock records: {item.freshness.issues.join('; ')}</p>:null}
 <p>Usable: {item.balance.usableOnHand??item.balance.onHand} · Expired: {item.balance.expired} · Expected but not confirmed: {item.balance.unverifiedIncoming??0} · Backordered: {item.balance.backorders??0}</p>
 <h4>Lots and expiry dates</h4>{item.batches?.length?<ul>{item.batches.map(b=><li key={b.id}>{b.quantity} {unitLabel(item.baseUnit)} · expires {displayTime(b.expiresAt)} · receipt {b.receiptReference??'Opening balance'}<details><summary>Lot number</summary><code>{b.id}</code></details></li>)}</ul>:<p>No lots recorded.</p>}
 <h4>Stock dispensed or consumed</h4><ul>{Object.entries(item.movements.filter(m=>['Consume','Dispense'].includes(m.kind)).reduce<Record<string,number>>((days,m)=>{const day=m.timestamp.slice(0,10);days[day]=(days[day]??0)+m.baseQuantity;return days;},{})).map(([day,n])=><li key={day}>{day}: {n} {unitLabel(item.baseUnit)}</li>)}</ul>
 <h4>Stock activity</h4>{!item.movements.length&&<p>No stock activity recorded.</p>}<ol>{item.movements.map(m=><li key={m.id}><strong>{statusLabel(m.kind)}: {m.baseQuantity} {unitLabel(item.baseUnit)}</strong> · {displayTime(m.timestamp)}<p>{m.reason}{m.destination?' · '+m.destination:''}{m.reference?' · reference '+m.reference:''}{m.supplierId?' · '+m.supplierId:''}{m.batch?' · lot '+m.batch:''}</p><details><summary>More activity details</summary><p>Recorded by {m.actor}{m.receivedAt?' · received '+displayTime(m.receivedAt):''}</p><p>{m.id} · {m.source}{m.orderId?' · order '+m.orderId:''}{m.corrects?' · corrects '+m.corrects:''}</p></details></li>)}</ol>
 <details><summary>Forecast details</summary><p>{item.forecast.basis} · {item.forecast.safetyStock} safety stock · {item.clinicId} / {item.storeroomId} · source {item.source}</p></details></details></article>)}
 {!compact&&<><h3>Replenishment</h3>{data.obligations.length?<ul>{data.obligations.map(o=>{const c=data.caseStates.find(c=>c.caseId===o.caseId);return <li key={o.id}><ApplicationLink href="/app/replenishment">{data.items.find(i=>i.id===o.productId)?.name??'Review request'}</ApplicationLink> · {o.closedAt?'Goods received':statusLabel(c?.state??'Preparing')}<p>Payment: {statusLabel(c?.paymentState??'Unobserved')}. {c?.humanInterventions.map(statusLabel).join(', ')||'No action requested'}</p><details><summary>Request details</summary><code>{o.caseId}</code><p>Delivery is recorded independently of payment.</p></details></li>;})}</ul>:<p>No replenishment requests yet. Stock monitoring will create a request when needed.</p>}</>}
 </>;
}
export function InventoryOperations({ client, operator, onChanged, onFailure,publicPayments=false,layout='legacy' }: {
    client: OperatorClient;
    operator: boolean;
    layout?:'legacy'|'workspace';
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
    const editorRef=useRef<HTMLDialogElement>(null);
    const editorTrigger=useRef<HTMLButtonElement|null>(null);
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
    const ready=!!data;
    const openEditor=useCallback((action:string,trigger?:HTMLButtonElement)=>{
        setKind(action);setError('');editorTrigger.current=trigger??null;
        if(action==='Receive'){const now=new Date();setReceivedAt(new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,16));}
        if(editorRef.current&&!editorRef.current.open)editorRef.current.showModal();
    },[]);
    useEffect(()=>{
        if(layout!=='workspace'||!ready||!operator)return;
        const fromHash=()=>{const action=({receive:'Receive',consume:'Consume',dispense:'Dispense'} as Record<string,string>)[location.hash.slice(1)];if(action)openEditor(action);};
        fromHash();window.addEventListener('hashchange',fromHash);return()=>window.removeEventListener('hashchange',fromHash);
    },[layout,ready,operator,openEditor]);
    async function mutate(work: () => Promise<unknown>) { if(submitting.current)return;submitting.current=true;setBusy(true); setError('');setSuccess(''); try {
        await work();setSuccess('Stock updated.');
        await refresh();
        await onChanged();
        if(layout==='workspace')editorRef.current?.close();
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
    const movementForm=data?(<form ref={formRef} style={{scrollMarginTop:"8rem"}} onSubmit={e => {
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
   </form>):null;
    return <section className={layout==='workspace'?'stock-workspace':'ops-panel'} aria-label="Stock updates">{layout==='workspace'?<header className="stock-workspace-heading"><div><h2>Your supplies</h2><p>Current stock, reorder levels and receipt history.</p></div>{operator&&<div className="clinic-actions"><button className="clinic-primary" type="button" onClick={event=>openEditor('Receive',event.currentTarget)}>Receive stock <span aria-hidden="true">＋</span></button><button className="clinic-secondary" type="button" onClick={event=>openEditor('Consume',event.currentTarget)}>Record usage</button><button className="clinic-tertiary" type="button" onClick={event=>openEditor('Dispense',event.currentTarget)}>More actions</button></div>}</header>:<h2>Manage stock</h2>}{error && <p role="alert" className="ops-error">{error}</p>}
  <p role="status">{success}</p>{!operator&&<p>You have view-only access.</p>}
  {!data ? <p role="status">{error?'Stock details are unavailable. Refresh before recording an update.':'Loading stock…'}</p> : <>

   {layout==='workspace'?<><InventorySummary data={data} compact/><dialog ref={editorRef} className="stock-editor" aria-labelledby="stock-editor-title" onCancel={event=>{if(busy)event.preventDefault();}} onClose={()=>{if(['#receive','#consume','#dispense'].includes(location.hash))history.replaceState(null,'',location.pathname+location.search);editorTrigger.current?.focus();}}><header><div><p>INVENTORY</p><h2 id="stock-editor-title">{stockActionLabel(kind)}</h2></div><button type="button" aria-label="Close stock update" disabled={busy} onClick={()=>editorRef.current?.close()}>×</button></header>{error&&<p role="alert" className="ops-error">{error}</p>}{movementForm}</dialog></>:movementForm}
   {layout==='legacy'&&<InventorySummary data={data} publicPayments={publicPayments}/>}
  </>}
 </section>;
}

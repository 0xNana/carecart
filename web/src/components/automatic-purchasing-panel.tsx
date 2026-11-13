'use client';
import {useEffect,useState} from 'react';
import type {OperatorClient,SupplierCatalog} from '@/lib/operator-client';
import {identityRequest} from '@/lib/identity-client';
import {parseTokenInput,tokenAmount} from '@/lib/funding';
import styles from './application-view.module.css';

type Snapshot={version:number;enabled:boolean;policy:{maxAutomaticAmount:string;expiresAt:string;suppliers:string[];itemIds:string[]}|null};
export function AutomaticPurchasingPanel({client,canManage}:{client:OperatorClient;canManage:boolean}){
 const [snapshot,setSnapshot]=useState<Snapshot|null>(null),[catalog,setCatalog]=useState<SupplierCatalog|null>(null),[items,setItems]=useState<{id:string;name:string}[]>([]);
 const [wallets,setWallets]=useState<{id:string;accountId:string}[]>([]),[wallet,setWallet]=useState(''),[suppliers,setSuppliers]=useState<string[]>([]),[skus,setSkus]=useState<string[]>([]),[amount,setAmount]=useState('1'),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let active=true;void (async()=>{
  const s=await client.session();const [policy,catalog,inventory]=await Promise.all([client.automaticPurchasing(),client.catalog(),client.inventory()]);
  if(!active)return;setSnapshot(policy as Snapshot);setCatalog(catalog);setItems(inventory);
  if(canManage&&s.clinicId){
   const [proofs,treasuries]=await Promise.all([identityRequest(`clinics/${s.clinicId}/wallet-bindings`),identityRequest(`clinics/${s.clinicId}/treasuries`)]);
   const controller=(treasuries.configurations as {environment:string;status:string;controller:string}[]).find(c=>c.environment==='near-testnet'&&c.status==='Active')?.controller;
   const available=(proofs.bindings as {id:string;accountId:string;status:string}[]).filter(b=>b.status==='Verified'&&b.accountId===controller);
   if(active){setWallets(available);setWallet(available.length===1?available[0].id:'');}
  }
 })().catch(()=>{if(active)setError('Automatic purchasing settings are unavailable. Refresh to try again.');});return()=>{active=false;};},[client,canManage]);
 const atomic=parseTokenInput(amount),valid=!!atomic&&BigInt(atomic)<=BigInt(10000000)&&suppliers.length>0&&skus.length>0&&!!wallet&&consent;
 const toggle=(values:string[],value:string)=>values.includes(value)?values.filter(v=>v!==value):[...values,value];
 async function save(pause=false){setBusy(true);setError('');try{const result=pause?await client.pauseAutomaticPurchasing():await client.setAutomaticPurchasing({expectedVersion:snapshot?.version??0,enabled:true,suppliers,itemIds:skus,maxAutomaticAmount:atomic,walletBindingId:wallet},wallet);setSnapshot(result as Snapshot);setConsent(false);}catch{setError('The policy could not be saved. Refresh settings and check your clinic role and verified wallet.');}finally{setBusy(false);}}
 return <section className={styles.panel} aria-labelledby="automatic-purchasing-title">
  <h2 id="automatic-purchasing-title">Automatic purchasing</h2>
  <p>Approved items can be purchased without asking you to approve each order. Test payments use CCUSD, a token with no cash value.</p>
  {error&&<p role="alert">{error}</p>}
  {snapshot&&<p role="status">{snapshot.enabled?'Enabled':'Paused'}{snapshot.policy&&snapshot.enabled?` · up to ${tokenAmount(snapshot.policy.maxAutomaticAmount)} CCUSD per order · authorization ends ${new Date(snapshot.policy.expiresAt).toLocaleString()}`:''}</p>}
  <p>The vault enforces a 25 CCUSD hard order cap, a 25 CCUSD daily cap, its available balance and its pause control. Orders outside your automatic policy stay for review. Delivery must be recorded separately.</p>
  {canManage&&<>
   <button type="button" disabled={busy||!snapshot?.enabled} onClick={()=>void save(true)}>Pause automatic purchasing</button>
   <form onSubmit={event=>{event.preventDefault();if(valid)void save();}}>
    <fieldset disabled={busy}><legend>Choose items</legend>{items.map(item=><label key={item.id}><input type="checkbox" checked={skus.includes(item.id)} onChange={()=>setSkus(toggle(skus,item.id))}/>{item.name}</label>)}</fieldset>
    <fieldset disabled={busy}><legend>Choose approved suppliers</legend>{catalog?.suppliers?.map((supplier,index)=><label key={supplier.id}><input type="checkbox" checked={suppliers.includes(supplier.account)} onChange={()=>setSuppliers(toggle(suppliers,supplier.account))}/>Supplier {index+1} · {supplier.account}</label>)}</fieldset>
    <label>Maximum automatic order (CCUSD, up to 10)<input inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} /></label>
    <label>Verified clinic control wallet<select value={wallet} onChange={e=>setWallet(e.target.value)}><option value="">Choose wallet</option>{wallets.map(w=><option key={w.id} value={w.id}>{w.accountId}</option>)}</select></label>
    {!wallets.length&&<p>Verify the clinic control wallet in Settings before enabling purchases.</p>}
    <label><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>I authorize automatic test purchases for these items and suppliers within this limit, for up to 24 hours or until my wallet verification expires.</label>
    <button type="submit" disabled={busy||!valid||!snapshot}>{busy?'Saving…':'Enable automatic purchasing'}</button>
   </form>
  </>}
 </section>;
}

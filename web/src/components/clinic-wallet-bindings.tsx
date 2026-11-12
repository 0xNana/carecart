'use client';
import {useEffect,useState} from 'react';import {identityRequest,identityMutation} from '../lib/identity-client';import {connectOwnershipWallet,parseOwnershipProof} from '../lib/wallet-binding';import {statusLabel} from '../lib/product-copy';
type Binding={id:string;accountId:string;status:string;network:string};
export function ClinicWalletBindings({clinicId}:{clinicId:string}){
 const [accountId,setAccountId]=useState('admin.carecart.testnet'),[challenge,setChallenge]=useState<{id:string;accountId:string;payload:{message:string;recipient:string;nonce:string}}|null>(null),[proof,setProof]=useState('');
 const [data,setData]=useState<{enabled:boolean;bindings:Binding[]}|null>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);const path='clinics/'+clinicId+'/wallet-bindings';
 useEffect(()=>{let live=true;identityRequest(path).then(d=>{if(live)setData(d);}).catch(()=>{if(live)setMessage('Wallet verification is unavailable. Refresh to try again.');});return()=>{live=false;};},[path]);
 async function bind(){setBusy(true);setMessage('');let connection:Awaited<ReturnType<typeof connectOwnershipWallet>>|undefined;try{connection=await connectOwnershipWallet();const challenge=await identityMutation('clinics/'+clinicId+'/wallet-challenges',{accountId:connection.accountId,network:'testnet'});const proof=await connection.prove(challenge);await identityMutation(path,{challengeId:challenge.id,accountId:proof.accountId,publicKey:proof.publicKey,signature:proof.signature});setData(await identityRequest(path));setMessage('Wallet verified. Each payment still needs its own review.');}catch{setMessage('Could not verify this wallet. Choose a wallet that supports message signing. No payment was made.');}finally{try{await connection?.disconnect();}catch{setMessage('Wallet could not be disconnected. Close it from your wallet app.');}finally{setBusy(false);}}}
 async function challengeCLI(){setBusy(true);setMessage('');try{setChallenge(await identityMutation('clinics/'+clinicId+'/wallet-challenges',{accountId,network:'testnet'}));setProof('');}catch{setMessage('Challenge could not be created; refresh your clinic session.');}finally{setBusy(false);}}
 async function verifyCLI(){if(!challenge)return;setBusy(true);try{await identityMutation(path,parseOwnershipProof(proof,challenge));setData(await identityRequest(path));setChallenge(null);setProof('');setMessage('Wallet verified. No payment was made.');}catch{setMessage('Wallet verification could not be completed. Check the signed message and try again.');}finally{setBusy(false);}}
 async function revoke(id:string){setBusy(true);try{await identityMutation(path+'/revoke',{bindingId:id});setData(await identityRequest(path));setMessage('Wallet binding revoked.');}catch{setMessage('Revocation failed; refresh and retry.');}finally{setBusy(false);}}
 return <section>
  <h3>Payment wallet</h3>
  <p>Connect the clinic wallet to verify ownership. Each payment still needs its own review.</p>
  {!data&&<p role="status">Loading wallet details…</p>}
  {data&&!data.enabled&&<p>Wallet verification is unavailable. Ask your clinic administrator for help.</p>}
  <button disabled={busy||!data?.enabled} onClick={()=>void bind()}>{busy?'Connecting…':'Connect wallet'}</button>
  <details><summary>Use a command line wallet</summary>
   <p>Sign a one-time message with your wallet, then paste the public verification details below. Never paste a private key. No payment will be made.</p>
   <label>Wallet account<input value={accountId} onChange={e=>setAccountId(e.target.value)} disabled={busy}/></label>
   <button disabled={busy||!accountId} onClick={()=>void challengeCLI()}>Create verification request</button>
   {challenge&&<><label>Message to sign<textarea readOnly value={JSON.stringify(challenge,null,2)} rows={8}/></label><label>Signed message details<textarea value={proof} onChange={e=>setProof(e.target.value)} rows={5}/></label><button disabled={busy||!proof} onClick={()=>void verifyCLI()}>Verify wallet</button></>}
  </details>
  {data?.bindings.length? <><h4>Connected wallets</h4><ul>{data.bindings.map(b=><li key={b.id}>{b.accountId} · {statusLabel(b.status)} <button disabled={busy||b.status==='Revoked'} onClick={()=>void revoke(b.id)}>Remove</button></li>)}</ul></>:<p>No wallet connected.</p>}
  <p role="status">{message}</p>
 </section>;
}

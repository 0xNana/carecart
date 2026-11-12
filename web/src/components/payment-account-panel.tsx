'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {NearConnector,NearWalletBase} from '@hot-labs/near-connect';
import type {OperatorClient} from '@/lib/operator-client';
import type {FundingSnapshot} from '@/lib/funding';
import {nearAmount,parseTokenInput,tokenAmount} from '@/lib/funding';
import styles from './payment-account-panel.module.css';

type Phase='amount'|'review'|'signing'|'checking'|'complete'|'uncertain'|'failed';
type WalletConnection={connector:NearConnector;wallet:NearWalletBase};
function exactTokenInput(value:string){const amount=BigInt(value),whole=amount/BigInt(1_000_000),fraction=(amount%BigInt(1_000_000)).toString().padStart(6,'0').replace(/0+$/,'');return fraction?`${whole}.${fraction}`:whole.toString();}
function transactionDetails(value:unknown){
 const result=value&&typeof value==='object'?value as {transaction?:{hash?:unknown};status?:unknown}:{};
 const hash=typeof result.transaction?.hash==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(result.transaction.hash)?result.transaction.hash:null;
 const status=result.status&&typeof result.status==='object'?result.status as Record<string,unknown>:{};
 return {hash,failed:Object.hasOwn(status,'Failure')};
}

export function PaymentAccountPanel({client,canFund}:{client:OperatorClient;canFund:boolean}){
 const [snapshot,setSnapshot]=useState<FundingSnapshot|null>(null),[loadError,setLoadError]=useState(''),[amount,setAmount]=useState('1');
 const [phase,setPhase]=useState<Phase>('amount'),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[txHash,setTxHash]=useState<string|null>(null);
 const wallet=useRef<WalletConnection|null>(null),baseline=useRef<string|null>(null),treasuryBaseline=useRef<string|null>(null),expectedAmount=useRef<string|null>(null);
 const refresh=useCallback(async()=>{try{const next=await client.funding();setSnapshot(next);setLoadError('');return next;}catch{setLoadError('Live vault balances are temporarily unavailable. Refresh to try again.');return null;}},[client]);
 useEffect(()=>{if(!canFund)return;const initial=window.setTimeout(()=>void refresh(),0),timer=window.setInterval(()=>void refresh(),30000);return()=>{window.clearTimeout(initial);window.clearInterval(timer);};},[refresh,canFund]);

 if(!canFund)return <section className={styles.panel} aria-labelledby="payment-account-title"><div className={styles.heading}><div><p className={styles.eyebrow}>PAYMENT ACCOUNT</p><h2 id="payment-account-title">Treasury access required</h2></div></div><p className={styles.copy}>A clinic Finance Officer or Clinic Admin can view balances and fund the payment account.</p></section>;

 const treasury=BigInt(snapshot?.balances.treasuryToken??'0'),accounted=BigInt(snapshot?.balances.accounted??'0'),ceiling=BigInt(snapshot?.policy.acceptedDepositCeiling??'0');
 const remaining=ceiling>accounted?ceiling-accounted:BigInt(0),maxDeposit=remaining<treasury?remaining:treasury;
 const parsedAmount=parseTokenInput(amount),amountBig=parsedAmount?BigInt(parsedAmount):BigInt(0);
 const amountProblem=!parsedAmount?'Enter an amount greater than zero with up to six decimal places.':amountBig>treasury?'The treasury does not have enough CCUSD for this deposit.':amountBig>remaining?'This amount is above the vault\'s remaining deposit limit.':'';
 const unavailable=!snapshot||snapshot.policy.paused||maxDeposit===BigInt(0);
 const submitDeposit=async()=>{
  if(!snapshot||!canFund||!parsedAmount||amountProblem||unavailable)return;
  const depositAmount=parsedAmount;
  let signatureRequested=false;
  setBusy(true);setMessage('Opening your treasury wallet…');setTxHash(null);baseline.current=snapshot.balances.accounted;treasuryBaseline.current=snapshot.balances.treasuryToken;expectedAmount.current=depositAmount;setPhase('signing');
  try{
   let connection=wallet.current;
   if(!connection){const {NearConnector}=await import('@hot-labs/near-connect');const connector=new NearConnector({network:'testnet',autoConnect:false,features:{signInWithoutAddKey:true,signAndSendTransaction:true,testnet:true}});await connector.whenManifestLoaded;const connected=await connector.connect();connection={connector,wallet:connected};wallet.current=connection;}
   if(connection.connector.network!=='testnet'||!connection.wallet.manifest.features.signAndSendTransaction)throw new Error('Choose a NEAR Testnet wallet that can send transactions.');
   const accounts=await connection.wallet.getAccounts({network:'testnet'});
   if(!accounts.some(entry=>entry.accountId===snapshot.accounts.treasury))throw new Error(`Connect the treasury account ${snapshot.accounts.treasury} in your wallet.`);
   setMessage('Review the token transfer in your wallet. No deposit is sent until you approve it.');
   signatureRequested=true;
   const result=await connection.wallet.signAndSendTransaction({network:'testnet',signerId:snapshot.accounts.treasury,receiverId:snapshot.accounts.token,actions:[{type:'FunctionCall',params:{methodName:'ft_transfer_call',args:{receiver_id:snapshot.accounts.vault,amount:depositAmount,msg:'deposit'},gas:'120000000000000',deposit:'1'}}]});
   const details=transactionDetails(result);setTxHash(details.hash);
   if(details.failed){setPhase('failed');setMessage('The transaction failed on chain. No deposit was added to the vault.');return;}
   setPhase('checking');setMessage('Transaction returned by the wallet. Checking the finalized vault balance…');
   const next=await refresh();
   if(next&&BigInt(next.balances.accounted)>=BigInt(snapshot.balances.accounted)+BigInt(depositAmount)&&BigInt(next.balances.treasuryToken)<=BigInt(snapshot.balances.treasuryToken)-BigInt(depositAmount)){
    setPhase('complete');setMessage(`${tokenAmount(depositAmount)} CCUSD is now available in the payment account.`);
   }else{
    setPhase('uncertain');setMessage('The wallet returned a transaction, but the vault balance has not caught up yet. Refresh and check the transaction before sending another deposit.');
   }
  }catch(cause){
   if(signatureRequested){setPhase('uncertain');setMessage('The wallet did not confirm this request. Check wallet activity and refresh balances before trying again.');}
   else{setPhase('review');setMessage(cause instanceof Error&&cause.message.startsWith('Connect the treasury')?cause.message:'Could not open the treasury wallet. Try again and select the configured treasury account.');}
  }finally{setBusy(false);}
 };

 const checkAgain=async()=>{setBusy(true);const next=await refresh();if(next&&baseline.current&&treasuryBaseline.current&&expectedAmount.current&&BigInt(next.balances.accounted)>=BigInt(baseline.current)+BigInt(expectedAmount.current)&&BigInt(next.balances.treasuryToken)<=BigInt(treasuryBaseline.current)-BigInt(expectedAmount.current)){setPhase('complete');setMessage(`${tokenAmount(expectedAmount.current)} CCUSD is now available in the payment account.`);}setBusy(false);};
 const startAnother=()=>{setPhase('amount');setAmount('1');setMessage('');setTxHash(null);baseline.current=null;treasuryBaseline.current=null;expectedAmount.current=null;};
 const suggestions=['0.5','1','5'].map(v=>({label:v,atomic:parseTokenInput(v)!})).filter(v=>BigInt(v.atomic)<=maxDeposit);

 return <section className={styles.panel} aria-labelledby="payment-account-title">
  <div className={styles.heading}><div><p className={styles.eyebrow}>CARE CART PAYMENT ACCOUNT · NEAR TESTNET</p><h2 id="payment-account-title">Your payment balance</h2><p>Only funds held in the Safety Vault can be used for reviewed clinic payments.</p></div><span className={styles.badge}>TESTNET</span></div>
  {loadError&&<p className={styles.error} role="alert">{loadError} <button type="button" onClick={()=>void refresh()}>Refresh balances</button></p>}
  {snapshot&&<>
   <div className={styles.balanceCard}><span>Available to pay</span><strong>{tokenAmount(snapshot.balances.spendable)} <small>CCUSD</small></strong><span className={styles.balanceCaption}>Synthetic test token · not Circle USDC</span></div>
   <div className={styles.metrics} aria-label="Payment account balances">
    <div><span>Treasury funds</span><strong>{tokenAmount(snapshot.balances.treasuryToken)} <small>CCUSD</small></strong><small>{snapshot.accounts.treasury}</small></div>
    <div><span>Total in vault</span><strong>{tokenAmount(snapshot.balances.accounted)} <small>CCUSD</small></strong><small>Before reserved funds</small></div>
    <div><span>Deposit room</span><strong>{tokenAmount(remaining.toString())} <small>CCUSD</small></strong><small>Vault limit {tokenAmount(snapshot.policy.acceptedDepositCeiling)} CCUSD</small></div>
    <div><span>Reserved for review</span><strong>{tokenAmount((BigInt(snapshot.balances.reservedPayment)+BigInt(snapshot.balances.reservedWithdrawal)).toString())} <small>CCUSD</small></strong><small>Not currently available to pay</small></div>
   </div>
   <div className={styles.detailRow}><span>Vault account</span><code>{snapshot.accounts.vault}</code><span>Network gas in treasury</span><strong>{nearAmount(snapshot.balances.treasuryNearYocto)} NEAR</strong></div>
   {snapshot.policy.paused&&<p className={styles.error} role="status">Deposits are paused by the vault policy. No deposit can be made right now.</p>}
   {phase==='amount'&&<div className={styles.depositFlow}>
    <h3>Add funds</h3><p>Move CCUSD from the clinic treasury into the Safety Vault.</p>
    <form onSubmit={event=>{event.preventDefault();if(!amountProblem&&!unavailable)setPhase('review');}}>
     <label htmlFor="deposit-amount">Deposit amount</label><div className={styles.amountField}><input id="deposit-amount" inputMode="decimal" autoComplete="off" maxLength={32} value={amount} onChange={event=>setAmount(event.target.value)} aria-describedby="deposit-help deposit-error" aria-invalid={!!amountProblem}/><span>CCUSD</span></div>
     <div className={styles.suggestions} role="group" aria-label="Suggested amounts">{suggestions.map(option=><button type="button" key={option.label} onClick={()=>setAmount(option.label)}>{option.label} CCUSD</button>)}{maxDeposit>BigInt(0)&&<button type="button" onClick={()=>setAmount(exactTokenInput(maxDeposit.toString()))}>Max</button>}</div>
     <p id="deposit-help" className={styles.hint}>Maximum now: {tokenAmount(maxDeposit.toString())} CCUSD, based on treasury funds and the vault limit.</p>
     {amountProblem&&<p id="deposit-error" className={styles.error} role="alert">{amountProblem}</p>}
     {!amountProblem&&<span id="deposit-error" className={styles.visuallyHidden}>Amount is within the available balance and vault limit.</span>}
     <button className={styles.primary} disabled={busy||unavailable||!!amountProblem}>Review deposit</button>
    </form>
   </div>}
   {phase==='review'&&<div className={styles.depositFlow}>
    <h3>Review deposit</h3><p>Make sure these details are correct before opening your wallet.</p>
    <dl className={styles.review}><div><dt>You deposit</dt><dd>{tokenAmount(parsedAmount??'0')} CCUSD</dd></div><div><dt>From treasury</dt><dd>{snapshot.accounts.treasury}</dd></div><div><dt>To Safety Vault</dt><dd>{snapshot.accounts.vault}</dd></div><div><dt>Network fee</dt><dd>Paid in NEAR by the treasury wallet</dd></div></dl>
    <p className={styles.hint}>Your wallet will ask you to approve a Testnet token transfer. This only adds funds; it does not approve or send a supplier payment.</p>
    {message&&<p role="status" aria-live="polite">{message}</p>}{(amountProblem||unavailable)&&<p className={styles.error} role="alert">{snapshot.policy.paused?'Deposits are paused by the vault policy.':amountProblem||'The treasury has no funds available within the vault limit.'}</p>}
    <div className={styles.actions}><button type="button" onClick={()=>setPhase('amount')}>Edit amount</button><button className={styles.primary} type="button" disabled={busy||!!amountProblem||unavailable} onClick={()=>void submitDeposit()}>{busy?'Opening wallet…':'Connect treasury wallet'}</button></div>
   </div>}
   {['signing','checking','complete','uncertain','failed'].includes(phase)&&<div className={styles.depositFlow}>
    <h3>{phase==='signing'?'Approve in your wallet':phase==='checking'?'Confirming deposit':phase==='complete'?'Deposit complete':phase==='failed'?'Deposit failed':'Check deposit status'}</h3>
    <p role="status" aria-live="polite">{busy&&phase==='signing'?'Waiting for your treasury wallet…':message}</p>
    {txHash&&<p className={styles.transaction}>Transaction <code>{txHash}</code> · <a href={`https://testnet.nearblocks.io/txns/${encodeURIComponent(txHash)}`} target="_blank" rel="noreferrer">View on NEAR explorer</a></p>}
    {phase==='complete'&&<button type="button" className={styles.primary} onClick={startAnother}>Make another deposit</button>}
    {phase==='failed'&&<button type="button" className={styles.primary} onClick={startAnother}>Try another deposit</button>}
    {phase==='uncertain'&&<button type="button" onClick={()=>void checkAgain()} disabled={busy}>{busy?'Refreshing…':'Refresh and check balance'}</button>}
   </div>}
   <p className={styles.footnote}>Balances last checked <time dateTime={snapshot.observedAt}>{new Date(snapshot.observedAt).toLocaleTimeString()}</time>. Deposits require a wallet connected to the configured treasury and a small amount of NEAR for gas.</p>
  </>}
  {!snapshot&&!loadError&&<p role="status" aria-busy="true" className={styles.loading}>Loading finalized testnet balances…</p>}
 </section>;
}

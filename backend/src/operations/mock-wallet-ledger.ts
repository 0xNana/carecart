import {PUBLIC_TOKENS} from '../near/token-registry';
import Database from 'better-sqlite3';
import {randomUUID} from 'node:crypto';
import {digest} from '../intents/settlement';
import {SafetyVaultClient,type SafetyReadTransport} from '../near/safety-client';
import {SafetyOrderSchema,type SafetyOrder} from '../near/commitments';
import type {PaymentReview} from '../near/human-review';
import {ReplenishmentWorkflow} from '../workflow/cases';
import {observeVault} from '../workflow/capabilities';
import {OperationJournal} from '../near/operation-journal';
import type {FinancialBinding} from './financial-authorizations';
import type {HumanReviewBinding} from './human-reviews';
/** An isolated, persisted MOCK contract read source. It never calls a network, loads keys or transfers assets. */
export class MockWalletLedger {
 readonly db:Database.Database;readonly binding:HumanReviewBinding;
 readonly execution='mocked-rpc' as const;
 constructor(readonly workflow:ReplenishmentWorkflow,readonly clock=()=>Date.now()){
  const p=workflow.procurement.profile;
  if(p.vault!=='vault.local-ops.near'||!p.databasePath.includes('/local-operations/'))throw new Error('Isolated mock profile required');
  this.db=new Database(p.databasePath);this.db.pragma('journal_mode=WAL');this.db.pragma('synchronous=FULL');
  this.db.exec(`CREATE TABLE IF NOT EXISTS mock_wallet_vault(po_id TEXT PRIMARY KEY,order_json TEXT NOT NULL,payment_json TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS mock_wallet_receipts(review_id TEXT PRIMARY KEY,terms_hash TEXT NOT NULL,transaction_hash TEXT NOT NULL);`);
  const transport={viewNodeStatus:async()=>({chain_id:p.network}),viewAccount:async({accountId}:{accountId:string})=>({code_hash:accountId===p.token?PUBLIC_TOKENS[p.network].codeHash:p.codeHash}),
   callFunction:async({method,args}:{method:string;args:Record<string,string>})=>{
    if(method==='ft_metadata')return {decimals:6,symbol:'USDC',spec:'ft-1.0.0'};
    if(method==='get_state')return {profile:p.network,admin:p.admin,guardian:p.guardian,treasury:p.treasury,token:p.token,paused:false,
     policy:{auto_per_po_limit:'10000000',hard_payout_limit:'25000000',daily_dispatch_limit:'25000000',accepted_deposit_ceiling:'5000000'},
     ...this.accounting()};
    if(method==='get_roles')return {supplier:['a','b','c'].some(c=>args.account===`supplier-${c}.local-ops.near`),committer:args.account===p.committer,requester:args.account===p.requester};
    const row=this.db.prepare('SELECT order_json,payment_json FROM mock_wallet_vault WHERE po_id=?').get(args.po_id) as {order_json:string;payment_json:string}|undefined;
    if(method==='get_purchase_order')return row?JSON.parse(row.order_json):null;
    if(method==='get_payment')return row?JSON.parse(row.payment_json):null;
    throw new Error('No such mock read capability');
   }} as unknown as SafetyReadTransport;
  this.binding={kind:'mocked-rpc',client:new SafetyVaultClient(p,undefined,undefined,transport),mockWallet:async(id,terms)=>this.submit(id,terms)};
 }
 get financialBinding():FinancialBinding{return {kind:'mocked-rpc',client:this.binding.client,verify:async()=>{},simulateRole:async(role,caseId)=>this.simulateRole(role,caseId)};}
 /** Explicit offline fixture operation only. No signer, network or real asset exists. */
 simulateRole(role:'committer'|'requester',caseId:string){
  const c=this.workflow.get(caseId);if(!c.poId||!c.domain)throw new Error('Canonical fixture PO required');
  const order=this.workflow.procurement.resolve(c.poId).canonical;
  if(order.destination!=='Near'||BigInt(order.amount)>25_000_000n||Date.parse(this.workflow.procurement.quoteExpiry(c.poId))<=this.clock())throw new Error('Fixture policy/quote blocked');
  const method=role==='committer'?'commit_purchase_order':'request_payment';const payload={method,args:role==='committer'?{order}:{po_id:c.poId}};
  const journal=new OperationJournal(this.workflow.procurement.profile.databasePath,this.workflow.procurement.fingerprint);
  try{journal.rememberOrder(order);if(journal.begin(method+':'+c.poId,payload))return;
   this.db.transaction(()=>{
    const row=this.db.prepare('SELECT order_json,payment_json FROM mock_wallet_vault WHERE po_id=?').get(c.poId) as {order_json:string;payment_json:string}|undefined;
    if(role==='committer'){
     if(row&&digest(JSON.parse(row.order_json))!==digest(order))throw new Error('Fixture immutable commitment conflict');
     this.db.prepare('INSERT OR IGNORE INTO mock_wallet_vault VALUES(?,?,?)').run(c.poId,JSON.stringify(order),JSON.stringify({status:'Committed',reason:'None',attempt_id:'',reserved_day:0}));
    }else{
     if(!row||digest(JSON.parse(row.order_json))!==digest(order)||JSON.parse(row.payment_json).status!=='Committed')throw new Error('Fixture committed PO required');
     const a=this.accounting(),amount=BigInt(order.amount);if(amount>BigInt(a.spendable))throw new Error('Fixture insufficient reserve');
     const pending=amount>10_000_000n||BigInt(a.usage.spent)+BigInt(a.usage.reserved)+amount>25_000_000n;
     this.db.prepare('UPDATE mock_wallet_vault SET payment_json=? WHERE po_id=?').run(JSON.stringify({status:pending?'PendingApproval':'Dispatching',reason:pending?'PolicyReview':'None',attempt_id:'',reserved_day:Math.floor(this.clock()/86400000)}),c.poId);
    }
   }).immediate();journal.confirm(method+':'+c.poId,payload,{transactionHash:'mock:'+randomUUID(),reconciled:false});
  }catch(e){journal.ambiguous(method+':'+c.poId);throw e;}finally{journal.close();}
 }
 close(){if(this.db.open)this.db.close();}
 accounting(){
  let spent=0n,reserved=0n,unavailable=0n;const today=Math.floor(this.clock()/86400000);
  for(const row of this.db.prepare('SELECT order_json,payment_json FROM mock_wallet_vault').all() as {order_json:string;payment_json:string}[]){
   const amount=BigInt(SafetyOrderSchema.parse(JSON.parse(row.order_json)).amount);const p=JSON.parse(row.payment_json);
   if(p.status==='Paid'||p.status==='Dispatching')unavailable+=amount;
   if(p.reserved_day===today){if(p.status==='Paid')spent+=amount;if(p.status==='Dispatching')reserved+=amount;}
  }
  if(unavailable>5_000_000n)throw new Error('Mock accepted balance invariant');
  return {spendable:(5_000_000n-unavailable).toString(),usage:{spent:spent.toString(),reserved:reserved.toString()}};
 }
 async seedPending(caseId:string){
  const c=this.workflow.get(caseId);if(!c.poId||!c.domain||c.domain.purchaseOrder.canonical.destination!=='Near')throw new Error('Canonical same-chain fixture required');
  const order=this.workflow.procurement.resolve(c.poId).canonical;
  if(BigInt(order.amount)>5_000_000n)throw new Error('Mock launch fixture must stay within the initial 5-USDC ceiling');
  this.db.transaction(()=>{
   const prior=this.db.prepare('SELECT order_json FROM mock_wallet_vault WHERE po_id=?').get(c.poId) as {order_json:string}|undefined;
   if(prior){if(digest(JSON.parse(prior.order_json))!==digest(order))throw new Error('Immutable mock commitment conflict');return;}
   // Pending from a previous UTC day's capacity limit; current-day mock usage is zero. No funded launch is asserted.
   this.db.prepare('INSERT INTO mock_wallet_vault VALUES(?,?,?)').run(c.poId,JSON.stringify(order),JSON.stringify({status:'PendingApproval',reason:'DailyCap',attempt_id:'',reserved_day:Math.floor(this.clock()/86400000)-1}));
  }).immediate();
  return this.workflow.observe(caseId,await observeVault(this.workflow.procurement,c.poId,'mocked-rpc',new Date(this.clock()),this.binding.client));
 }
 submit(id:string,terms:PaymentReview){return this.db.transaction(()=>{
  const prior=this.db.prepare('SELECT terms_hash,transaction_hash FROM mock_wallet_receipts WHERE review_id=?').get(id) as {terms_hash:string;transaction_hash:string}|undefined;
  if(prior){if(prior.terms_hash!==digest(terms))throw new Error('Conflicting mock handoff');return prior.transaction_hash;}
  const row=this.db.prepare('SELECT order_json,payment_json FROM mock_wallet_vault WHERE po_id=?').get(terms.order.po_id) as {order_json:string;payment_json:string}|undefined;
  if(!row||digest(SafetyOrderSchema.parse(JSON.parse(row.order_json)))!==terms.canonicalHash||JSON.parse(row.payment_json).status!=='PendingApproval')throw new Error('Mock canonical pending payment required');
  if(terms.transaction.signerId!==this.workflow.procurement.profile.admin||terms.transaction.actions[0].params.deposit!=='1')throw new Error('Mock v2 admin boundary');
  const accounting=this.accounting();const amount=BigInt(terms.order.amount);
  if(terms.action==='approve'&&(amount>25_000_000n||amount>BigInt(accounting.spendable)||BigInt(accounting.usage.spent)+BigInt(accounting.usage.reserved)+amount>25_000_000n))throw new Error('Mock hard policy prevents dispatch');
  const payment=JSON.parse(row.payment_json);payment.status=terms.action==='reject'?'Rejected':'Dispatching';payment.reason=terms.action==='reject'?'HumanRejected':'None';
  if(terms.action==='approve')payment.reserved_day=Math.floor(this.clock()/86400000);
  const hash=`mock:${randomUUID()}`;
  this.db.prepare('UPDATE mock_wallet_vault SET payment_json=? WHERE po_id=?').run(JSON.stringify(payment),terms.order.po_id);
  this.db.prepare('INSERT INTO mock_wallet_receipts VALUES(?,?,?)').run(id,digest(terms),hash);return hash;
 }).immediate();}
 /** Test harness only; not exposed by an HTTP endpoint. Simulates independently arriving callbacks. */
 callback(poId:string,status:'Paid'|'Failed'){
  const row=this.db.prepare('SELECT payment_json FROM mock_wallet_vault WHERE po_id=?').get(poId) as {payment_json:string}|undefined;
  if(!row)throw new Error('Unknown mock obligation');const p=JSON.parse(row.payment_json);
  if(p.status!=='Dispatching')throw new Error('No pending mock callback');p.status=status;
  this.db.prepare('UPDATE mock_wallet_vault SET payment_json=? WHERE po_id=?').run(JSON.stringify(p),poId);
 }
}

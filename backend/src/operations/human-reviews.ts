import {financialDatabaseOwner} from '../tenancy/treasury';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {digest} from '../intents/settlement';
import {SettlementJournal} from '../intents/journal';
import type {VaultReader} from '../near/vault-reader';import {isSandboxProfile} from '../sandbox/profile';
import {paymentReview,type PaymentReview} from '../near/human-review';
import {verifyHumanTransaction} from '../near/human-receipts';
import {ReplenishmentWorkflow} from '../workflow/cases';
import {observeVault} from '../workflow/capabilities';
import {Identity} from '../workflow/model';
import {OperatorAuth,OperationsError,type OperatorSession} from './auth';
export interface HumanReviewBinding {
 client:VaultReader;kind:'mocked-rpc'|'public-rpc'|'sandbox-rpc';
 /** Never supplied for a public profile. There is no server-side real signing method. */
 mockWallet?:(id:string,terms:PaymentReview)=>Promise<string>;
}
const makeInput=z.object({requestId:z.uuid(),action:z.enum(['approve','reject']),expectedRevision:z.number().int().nonnegative()}).strict();
export const WalletReport=z.object({requestId:z.uuid(),outcome:z.enum(['Submitted','Cancelled','Ambiguous','Failed']),transactionHash:z.string().max(128).nullable()}).strict();
type Row={id:string;case_id:string;session_hash:string;request_hash:string;terms_json:string|null;terms_hash:string|null;state:string;expires:number;transaction_hash:string|null;created_at:string;updated_at:string};
/** Workflow/audit state only. None of these rows is an authority to spend or prove settlement. */
export class HumanReviews {
 readonly db;
 constructor(readonly workflow:ReplenishmentWorkflow,readonly auth:OperatorAuth,readonly binding:HumanReviewBinding){
  if(digest(binding.client.profile)!==workflow.procurement.fingerprint||auth.profileFingerprint!==workflow.procurement.fingerprint)throw new Error('Wallet review profile mismatch');
  if(!binding.client.readOnly)throw new Error('Signing authority is forbidden in the human review service');
  if(binding.client.injectedReads&&binding.kind!=='mocked-rpc')throw new Error('Injected reads must be labeled mocked');
  if(isSandboxProfile(binding.client.profile)!==(binding.kind==='sandbox-rpc'))throw new Error('Sandbox identity/evidence boundary mismatch');
  if(binding.mockWallet&&binding.kind!=='mocked-rpc')throw new Error('Mock wallet cannot use public evidence');
  this.db=auth.database;this.db.exec(`CREATE TABLE IF NOT EXISTS human_wallet_reviews(id TEXT PRIMARY KEY,case_id TEXT NOT NULL,session_hash TEXT NOT NULL,request_hash TEXT NOT NULL,
   terms_json TEXT,terms_hash TEXT,state TEXT NOT NULL,expires INTEGER NOT NULL,transaction_hash TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
   CREATE UNIQUE INDEX IF NOT EXISTS one_unresolved_human_review ON human_wallet_reviews(case_id) WHERE state NOT IN ('Observed','Cancelled','Expired','Failed');
   CREATE TABLE IF NOT EXISTS human_wallet_events(id INTEGER PRIMARY KEY,review_id TEXT NOT NULL,event_key TEXT UNIQUE NOT NULL,body_json TEXT NOT NULL,event_hash TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS human_wallet_requests(request_id TEXT PRIMARY KEY,payload_hash TEXT NOT NULL,review_id TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS human_wallet_receipts(review_id TEXT PRIMARY KEY,transaction_hash TEXT UNIQUE NOT NULL,terms_hash TEXT NOT NULL,proof_json TEXT NOT NULL,proof_hash TEXT NOT NULL);`);
 }
 #row(id:string){z.uuid().parse(id);const r=this.db.prepare('SELECT * FROM human_wallet_reviews WHERE id=?').get(id) as Row|undefined;
  if(!r)throw new OperationsError(404,'REVIEW_NOT_FOUND');
  if(!['Preparing','Prepared','Handoff','Submitted','Ambiguous','Observed','Cancelled','Expired','Failed'].includes(r.state))throw new OperationsError(503,'WALLET_EVIDENCE_INVALID');
  if(r.terms_json&&(digest(JSON.parse(r.terms_json))!==r.terms_hash))throw new OperationsError(503,'WALLET_EVIDENCE_INVALID');return r;}
 #event(row:Row,type:string,evidence:unknown,key:string,previousState:string|null=null){
  const prior=this.db.prepare('SELECT event_hash FROM human_wallet_events WHERE review_id=? ORDER BY id DESC LIMIT 1').get(row.id) as {event_hash:string}|undefined;
  const evidenceType=!!evidence&&typeof evidence==='object'&&'event' in evidence?evidence.event:null;
  const observed=evidenceType==='CanonicalObserved';const attributed=evidenceType==='FinalizedTransactionAttributed';
  const body={caseId:row.case_id,reviewId:row.id,eventType:observed?'CanonicalObserved':attributed?'FinalizedTransactionAttributed':type,actor:observed?'independent-vault-observer':attributed?'independent-receipt-observer':'operator-wallet-report',timestamp:new Date(this.auth.clock()).toISOString(),
   state:row.state,previousState,resultingState:row.state,poId:row.terms_json?JSON.parse(row.terms_json).order.po_id:null,evidence,previousHash:prior?.event_hash ?? null};
  this.db.prepare('INSERT INTO human_wallet_events(review_id,event_key,body_json,event_hash) VALUES(?,?,?,?)').run(row.id,key,JSON.stringify(body),digest(body));
 }
 #update(id:string,state:string,evidence:unknown,key:string){const before=this.#row(id);this.db.prepare('UPDATE human_wallet_reviews SET state=?,updated_at=? WHERE id=?').run(state,new Date(this.auth.clock()).toISOString(),id);this.#event(this.#row(id),state,evidence,key,before.state);}
 #claim(session:OperatorSession,nonce:string,requestId:string,payload:unknown,id:string){
  if(session.role!=='operator')throw new OperationsError(403,'OPERATOR_REQUIRED');
  const hash=digest(payload);this.auth.claimNonce(session,nonce,requestId,hash);
  const prior=this.db.prepare('SELECT payload_hash,review_id FROM human_wallet_requests WHERE request_id=?').get(requestId) as {payload_hash:string;review_id:string}|undefined;
  if(prior){if(prior.payload_hash!==hash||prior.review_id!==id)throw new OperationsError(409,'WALLET_REQUEST_CONFLICT');return false;}
  this.db.prepare('INSERT INTO human_wallet_requests VALUES(?,?,?)').run(requestId,hash,id);return true;
 }
 get(id:string){const r=this.#row(id);let hash:string|null=null;
  const receipt=this.db.prepare('SELECT * FROM human_wallet_receipts WHERE review_id=?').get(id) as {transaction_hash:string;terms_hash:string;proof_json:string;proof_hash:string}|undefined;
  if(receipt&&(receipt.transaction_hash!==r.transaction_hash||receipt.terms_hash!==r.terms_hash||digest(JSON.parse(receipt.proof_json))!==receipt.proof_hash))throw new OperationsError(503,'WALLET_RECEIPT_EVIDENCE_INVALID');
  const events=(this.db.prepare('SELECT body_json,event_hash FROM human_wallet_events WHERE review_id=? ORDER BY id').all(id) as {body_json:string;event_hash:string}[]).map(e=>{
   const body=JSON.parse(e.body_json);if(digest(body)!==e.event_hash||body.previousHash!==hash||body.reviewId!==id||body.caseId!==r.case_id)throw new OperationsError(503,'WALLET_EVIDENCE_INVALID');hash=e.event_hash;return body;});
  if(!events.length||events.at(-1).state!==r.state)throw new OperationsError(503,'WALLET_EVIDENCE_INVALID');
  return {id:r.id,caseId:r.case_id,state:r.state,terms:r.terms_json?JSON.parse(r.terms_json) as PaymentReview:null,termsHash:r.terms_hash,
   expiresAt:new Date(r.expires).toISOString(),execution:this.binding.kind,publicSigningEnabled:false,sandboxSigningEnabled:this.binding.kind==='sandbox-rpc',transactionHash:r.transaction_hash,transactionVerified:!!receipt,
   transactionEvidence:receipt?JSON.parse(receipt.proof_json):null,
   createdAt:r.created_at,updatedAt:r.updated_at,eventCount:events.length,events:events.slice(-100)};
 }
 list(caseId:string){Identity.shape.caseId.parse(caseId);return (this.db.prepare('SELECT id FROM human_wallet_reviews WHERE case_id=? ORDER BY created_at DESC LIMIT 20').all(caseId) as {id:string}[]).map(r=>this.get(r.id));}
 #owner(r:Row,s:OperatorSession){if(s.role!=='operator'||r.session_hash!==s.hash)throw new OperationsError(403,'REVIEW_SESSION_MISMATCH');}
 async #fresh(caseId:string,action:'approve'|'reject',reviewedBase?:PaymentReview['base']){
  const c=this.workflow.get(caseId);if(!c.poId||!c.domain)throw new OperationsError(409,'CANONICAL_PO_REQUIRED');
  // Resolve against the independent trusted catalog; the case row alone cannot supply payment authority.
  const resolved=this.workflow.procurement.resolve(c.poId);
  if(digest(resolved.canonical)!==c.poHash)throw new OperationsError(409,'CANONICAL_PO_CONFLICT');
  const journal=new SettlementJournal(this.workflow.procurement.profile.databasePath,this.workflow.procurement.fingerprint);
  try{const review=await paymentReview(this.binding.client,resolved.canonical,action,journal,reviewedBase ?? undefined);
   if(digest(this.workflow.procurement.resolve(c.poId).canonical)!==review.canonicalHash||this.workflow.get(caseId).poHash!==review.canonicalHash)
    throw new OperationsError(409,'CANONICAL_PO_CONFLICT');
   return review;
  }finally{journal.close();}
 }
 async prepare(caseId:string,raw:unknown,s:OperatorSession,nonce:string){
  if(financialDatabaseOwner(this.workflow.procurement.profile.databasePath))throw new OperationsError(403,'TENANT_HUMAN_HANDOFF_DISABLED');
  Identity.shape.caseId.parse(caseId);const input=makeInput.parse(raw);const id=input.requestId;
  const created=this.db.transaction(()=>{
   if(!this.#claim(s,nonce,id,{caseId,...input},id))return false;
   this.auth.limit('wallet-review',s.hash,10);const c=this.workflow.get(caseId);
   if(c.version!==input.expectedRevision)throw new OperationsError(409,'STALE_CASE');
   if(this.db.prepare("SELECT 1 FROM human_wallet_reviews WHERE case_id=? AND state NOT IN ('Observed','Cancelled','Expired','Failed')").get(caseId))throw new OperationsError(409,'WALLET_REVIEW_UNRESOLVED');
   const now=new Date(this.auth.clock()).toISOString();
   this.db.prepare("INSERT INTO human_wallet_reviews VALUES(?,?,?,?,NULL,NULL,'Preparing',?,NULL,?,?)").run(id,caseId,s.hash,digest({caseId,...input}),this.auth.clock()+120000,now,now);
   this.#event(this.#row(id),'ReviewStarted',{action:input.action,expectedRevision:input.expectedRevision},id+':start');return true;
  }).immediate();
  if(!created)return this.get(id);
  try{const terms=await this.#fresh(caseId,input.action);
   this.db.transaction(()=>{if(this.workflow.get(caseId).version!==input.expectedRevision)throw new OperationsError(409,'STALE_CASE');
    const expiry=Math.min(this.auth.clock()+120000,terms.base?Date.parse(terms.base.summary.reviewValidUntil):Infinity);
    this.db.prepare('UPDATE human_wallet_reviews SET terms_json=?,terms_hash=?,expires=? WHERE id=?').run(JSON.stringify(terms),digest(terms),expiry,id);
    this.#update(id,'Prepared',{termsHash:digest(terms),execution:this.binding.kind},id+':prepared');
   }).immediate();
  }catch(error){this.db.transaction(()=>this.#update(id,'Failed',{reason:'REVIEW_VALIDATION_FAILED'},id+':failed')).immediate();throw error;}
  return this.get(id);
 }
 async handoff(id:string,raw:unknown,s:OperatorSession,nonce:string){
  if(financialDatabaseOwner(this.workflow.procurement.profile.databasePath))throw new OperationsError(403,'TENANT_HUMAN_HANDOFF_DISABLED');
  const input=z.object({requestId:z.uuid(),termsHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(raw);let r=this.#row(id);this.#owner(r,s);
  if(r.state!=='Prepared'||r.expires<=this.auth.clock()||r.terms_hash!==input.termsHash)throw new OperationsError(409,'REVIEW_STALE_OR_UNRESOLVED');
  // Public-network handoff is deliberately unavailable in P3B, even with operator authentication.
  if(this.binding.kind!=='sandbox-rpc'&&(!this.binding.mockWallet||this.binding.kind!=='mocked-rpc'))throw new OperationsError(403,'PUBLIC_SIGNING_DISABLED');
  const terms=JSON.parse(r.terms_json!) as PaymentReview;const fresh=await this.#fresh(r.case_id,terms.action,terms.base);
  if(digest(fresh)!==r.terms_hash)throw new OperationsError(409,'REVIEW_TERMS_CHANGED');
  this.db.transaction(()=>{r=this.#row(id);if(r.state!=='Prepared'||r.expires<=this.auth.clock()||r.terms_hash!==digest(fresh))throw new OperationsError(409,'REVIEW_STALE_OR_UNRESOLVED');
   if(!this.#claim(s,nonce,input.requestId,{id,action:'handoff',...input},id))throw new OperationsError(409,'HANDOFF_ALREADY_USED');
   this.#update(id,'Handoff',{termsHash:r.terms_hash,financialSuccess:false},id+':handoff');
  }).immediate();return this.get(id);
 }
 async mockSubmit(id:string,raw:unknown,s:OperatorSession,nonce:string){
  if(financialDatabaseOwner(this.workflow.procurement.profile.databasePath))throw new OperationsError(403,'TENANT_HUMAN_HANDOFF_DISABLED');const r=this.#row(id);this.#owner(r,s);
  const input=z.object({requestId:z.uuid()}).strict().parse(raw);
  if(r.state!=='Handoff'||!this.binding.mockWallet||this.binding.kind!=='mocked-rpc')throw new OperationsError(409,'MOCK_WALLET_UNAVAILABLE');
  this.db.transaction(()=>{this.#claim(s,nonce,input.requestId,{id,action:'mock-wallet'},id);this.auth.limit('mock-wallet',s.hash,10);}).immediate();
  // Read-only validation again before an explicitly labeled fixture simulation. No RPC or signer exists here.
  const terms=JSON.parse(r.terms_json!) as PaymentReview;
  if(digest(await this.#fresh(r.case_id,terms.action,terms.base))!==r.terms_hash)throw new OperationsError(409,'REVIEW_TERMS_CHANGED');
  return {transactionHash:await this.binding.mockWallet(id,terms),simulated:true,publicChainExecution:false};
 }
 report(id:string,raw:unknown,s:OperatorSession,nonce:string){const input=WalletReport.parse(raw);const r=this.#row(id);this.#owner(r,s);
  const hashPattern=this.binding.kind==='mocked-rpc'?/^mock:[a-f0-9-]{36}$/:/^[1-9A-HJ-NP-Za-km-z]{32,64}$/;
  if(input.transactionHash&&!hashPattern.test(input.transactionHash))throw new OperationsError(400,'TRANSACTION_HASH_INVALID');
  this.db.transaction(()=>{if(!this.#claim(s,nonce,input.requestId,{id,action:'report',...input},id))return;
   const current=this.#row(id);if(!['Prepared','Handoff','Submitted','Ambiguous'].includes(current.state))throw new OperationsError(409,'WALLET_OUTCOME_CONFLICT');
   if(current.transaction_hash&&current.transaction_hash!==input.transactionHash)throw new OperationsError(409,'WALLET_TRANSACTION_CONFLICT');
   if(input.outcome==='Submitted'&&!input.transactionHash)throw new OperationsError(400,'TRANSACTION_ID_REQUIRED');
   // Only cancellation BEFORE handoff is definitive non-execution. Later reports cannot authorize another send.
   const state=current.state==='Prepared'&&input.outcome==='Cancelled'?'Cancelled':input.outcome==='Submitted'?'Submitted':'Ambiguous';
   if(current.state==='Prepared'&&state!=='Cancelled')throw new OperationsError(409,'HANDOFF_REQUIRED');
   this.db.prepare('UPDATE human_wallet_reviews SET transaction_hash=COALESCE(transaction_hash,?) WHERE id=?').run(input.transactionHash,id);
   this.#update(id,state,{reportedOutcome:input.outcome,transactionHash:input.transactionHash,verified:false},input.requestId);
  }).immediate();return this.get(id);
 }
 async reconcile(id:string){let r=this.#row(id);const c=this.workflow.get(r.case_id);
  if(r.state==='Preparing'||(r.state==='Prepared'&&r.expires<=this.auth.clock())){
   if(r.expires>this.auth.clock())return this.get(id);
   this.db.transaction(()=>this.#update(id,r.state==='Preparing'?'Failed':'Expired',{noHandoffRecorded:true},randomUUID())).immediate();return this.get(id);
  }
  if(!c.poId)throw new OperationsError(409,'CANONICAL_PO_REQUIRED');
  if(r.transaction_hash&&this.binding.kind!=='mocked-rpc'){
   const terms=JSON.parse(r.terms_json!) as PaymentReview;
   const proof=verifyHumanTransaction(terms,r.transaction_hash,await this.binding.client.finalTransaction(r.transaction_hash));
   this.db.transaction(()=>{
    const prior=this.db.prepare('SELECT proof_hash FROM human_wallet_receipts WHERE review_id=?').get(id) as {proof_hash:string}|undefined;
    if(prior&&prior.proof_hash!==digest(proof))throw new OperationsError(409,'FINAL_RECEIPT_CONFLICT');
    this.db.prepare('INSERT OR IGNORE INTO human_wallet_receipts VALUES(?,?,?,?,?)').run(id,r.transaction_hash,r.terms_hash,JSON.stringify(proof),digest(proof));
    if(!prior)this.#update(id,r.state,{event:'FinalizedTransactionAttributed',proofHash:digest(proof),execution:this.binding.kind,financialSuccess:false},randomUUID());
   }).immediate();
  }
  const observation=await observeVault(this.workflow.procurement,c.poId,this.binding.kind,new Date(this.auth.clock()),this.binding.client);
  // Only the sealed independent observer can change financial workflow state. Wallet reports cannot.
  this.workflow.observe(c.caseId,observation,c.version);
  this.db.transaction(()=>{r=this.#row(id);const observed=observation.payment.status!=='PendingApproval';
   this.#update(id,observed?'Observed':r.state,{event:'CanonicalObserved',status:observation.payment.status,execution:this.binding.kind,transactionVerified:!!this.get(id).transactionEvidence},randomUUID());
  }).immediate();return this.get(id);
 }
}

/** Public review protocol only. This module imports no backend code, secrets or RPC transport. */
export interface V2Terms {
 abi:'carecart-safety-vault-v2';profileFingerprint:string;codeHash:string;action:'approve'|'reject';canonicalHash:string;recipient:string;
 order:{po_id:string;profile:'mainnet'|'testnet';supplier:string;token:string;amount:string;invoice_digest:string;destination:'Near'|{Base:{route_id:string;version:number;route_hash:string}}};
 payment:{status:string;reason:string;attempt_id:string};policy:Record<string,string>;spendable:string;usage:{spent:string;reserved:string};approvalBlocks:string[];
 transaction:{network:'mainnet'|'testnet'|'sandbox';signerId:string;receiverId:string;actions:[{type:'FunctionCall';params:{methodName:string;args:Record<string,string|null>;deposit:string;gas:string}}]};
 base:{summary:Record<string,unknown>;quote:unknown;commitment:unknown;reviewHash:string}|null;
}
export interface WalletReview {id:string;caseId:string;state:string;terms:V2Terms|null;termsHash:string|null;expiresAt:string;execution:'mocked-rpc'|'public-rpc'|'sandbox-rpc';publicSigningEnabled:false;sandboxSigningEnabled?:boolean;
 transactionHash:string|null;transactionVerified:boolean;transactionEvidence?:{executionSucceeded:boolean;transferConfirmed:boolean;rejectionConfirmed:boolean;destinationSettlementVerified:false}|null;eventCount?:number;events:{eventType:string;actor:string;timestamp:string;state:string;evidence:unknown}[]}
export interface V2Wallet {
 execution:'isolated-mock'|'sandbox-wallet';getNetwork():Promise<'mainnet'|'testnet'|'sandbox'>;getAccounts():Promise<{accountId:string}[]>;
 signAndSendTransaction(transaction:V2Terms['transaction']):Promise<unknown>;
}
export interface WalletReviewApi {
 handoff(id:string,termsHash:string):Promise<WalletReview>;
 report(id:string,outcome:'Submitted'|'Cancelled'|'Ambiguous'|'Failed',transactionHash:string|null):Promise<WalletReview>;
}
export interface WalletProfile {profileFingerprint:string;network:'mainnet'|'testnet'|'sandbox';vault:string;admin:string;codeHash:string;token:string;decimals:6}
export async function jsonHash(value:unknown){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));
 return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');}
const exact=(value:object,keys:string[])=>Object.keys(value).sort().join(',')===[...keys].sort().join(',');
export async function validateWalletReview(review:WalletReview){
 const t=review.terms;const tx=t?.transaction;const call=tx?.actions?.[0];
 if(!t||t.abi!=='carecart-safety-vault-v2'||!review.termsHash||await jsonHash(t)!==review.termsHash||await jsonHash(t.order)!==t.canonicalHash||
  !/^[a-f0-9]{64}$/.test(t.profileFingerprint)||!t.codeHash||t.payment.status!=='PendingApproval'||!['approve','reject'].includes(t.action)||
  !tx||!['mainnet','testnet','sandbox'].includes(tx.network)||(tx.network==='sandbox'?t.order.profile!=='testnet':tx.network!==t.order.profile)||!tx.signerId||!tx.receiverId||tx.actions.length!==1||
  !exact(tx,['network','signerId','receiverId','actions'])||!call||!exact(call,['type','params'])||call.type!=='FunctionCall'||
  !exact(call.params,['methodName','args','deposit','gas'])||call.params.deposit!=='1'||call.params.gas!=='120000000000000'||
  call.params.methodName!==(t.action==='approve'?'approve_payment':'reject_payment')||call.params.args.po_id!==t.order.po_id)
  throw new Error('V2_REVIEW_INVALID');
 const args=call.params.args;
 if(t.action==='reject'){if(!exact(args,['po_id']))throw new Error('V2_REJECTION_ABI_INVALID');}
 else{
  if(!exact(args,['po_id','expected_quote_hash','expected_commitment_hash'])||t.approvalBlocks.length||!/^[1-9][0-9]{0,38}$/.test(t.order.amount)||BigInt(t.order.amount)>BigInt('25000000'))throw new Error('V2_APPROVAL_ABI_INVALID');
  if(t.order.destination==='Near'){
   if(args.expected_quote_hash!==null||args.expected_commitment_hash!==null||t.base!==null||t.recipient!==t.order.supplier)throw new Error('V2_SAME_CHAIN_REVIEW_INVALID');
  }else if(!t.base||!/^[a-f0-9]{64}$/.test(args.expected_quote_hash??'')||!/^[a-f0-9]{64}$/.test(args.expected_commitment_hash??'')||
    args.expected_quote_hash!==t.base.summary.quoteIdentityHash||args.expected_commitment_hash!==t.base.summary.quoteCommitmentHash||
    Date.parse(String(t.base.summary.reviewValidUntil))<=Date.now())throw new Error('V2_BASE_REVIEW_INVALID');
 }
 if(!Number.isFinite(Date.parse(review.expiresAt))||Date.parse(review.expiresAt)<=Date.now())throw new Error('V2_REVIEW_EXPIRED');
 return structuredClone(t);
}
export class V2WalletPendingError extends Error {constructor(){super('Wallet outcome is ambiguous. Reconcile independently; do not resend.');}}
/** Explicit human action only. Server-persisted handoff prevents retries across browser restarts. */
export class V2WalletController {
 #active=false;
 readonly profile:WalletProfile;
 constructor(profile:WalletProfile){this.profile=structuredClone(profile);}
 async submit(review:WalletReview,wallet:V2Wallet,api:WalletReviewApi,confirmed:boolean,timeoutMs=45000){
  if(!confirmed)throw new Error('EXPLICIT_HUMAN_CONFIRMATION_REQUIRED');
  if(this.#active)throw new Error('WALLET_ALREADY_ACTIVE');
  this.#active=true;let handed=false;let timer:ReturnType<typeof setTimeout>|undefined;let pending:Promise<unknown>|undefined;
  try{
   const original=structuredClone(review);const terms=await validateWalletReview(original);
   if(terms.profileFingerprint!==this.profile.profileFingerprint||terms.codeHash!==this.profile.codeHash||terms.transaction.network!==this.profile.network||
    terms.transaction.receiverId!==this.profile.vault||terms.transaction.signerId!==this.profile.admin||terms.order.token!==this.profile.token||this.profile.decimals!==6)throw new Error('WALLET_PROFILE_CHANGED');
   const isolated=original.execution==='mocked-rpc'&&wallet.execution==='isolated-mock';
   const sandbox=original.execution==='sandbox-rpc'&&original.sandboxSigningEnabled===true&&wallet.execution==='sandbox-wallet'&&terms.transaction.network==='sandbox';
   if(original.state!=='Prepared'||(!isolated&&!sandbox)||original.publicSigningEnabled)throw new Error('PUBLIC_SIGNING_DISABLED');
   const identity=async()=>{if(await wallet.getNetwork()!==terms.transaction.network||!(await wallet.getAccounts()).some(a=>a.accountId===terms.transaction.signerId))throw new Error('WALLET_NETWORK_OR_ACCOUNT_CHANGED');};
   await identity();const fresh=await api.handoff(original.id,original.termsHash!);handed=true;
   if(fresh.id!==original.id||fresh.caseId!==original.caseId||fresh.execution!==original.execution||fresh.state!=='Handoff'||fresh.termsHash!==original.termsHash||fresh.publicSigningEnabled)throw new Error('REVIEW_CHANGED');
   const checked=await validateWalletReview(fresh);await identity();
   pending=wallet.signAndSendTransaction(checked.transaction);
   // A wallet response is a report, never canonical financial evidence. Track late responses after timeout.
   const reported=pending.then(async raw=>{const hash=(raw as {transactionHash?:unknown}|null)?.transactionHash;
    const pattern=sandbox?/^[1-9A-HJ-NP-Za-km-z]{32,64}$/:/^mock:[a-f0-9-]{36}$/;
    if(typeof hash!=='string'||!pattern.test(hash))throw new Error('WALLET_TRANSACTION_UNOBSERVED');
    return api.report(original.id,'Submitted',hash);
   },async error=>{await api.report(original.id,(error as {code?:unknown})?.code===4001?'Cancelled':'Ambiguous',null);throw error;});
   // Attach a rejection handler even if timeout wins; no unhandled late wallet rejection.
   void reported.catch(()=>{}).finally(()=>{this.#active=false;});
   return await Promise.race([reported,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new V2WalletPendingError()),timeoutMs);})]);
  }catch(error){
   if(handed&&!pending)try{await api.report(review.id,'Ambiguous',null);}catch{/* Durable Handoff remains unresolved if reporting fails. */}
   throw error;
  }finally{if(timer)clearTimeout(timer);if(!pending)this.#active=false;}
 }
}

import { parseWorkflowProjection,type WorkflowProjection } from './workflow.ts';
import type {WalletReview,WalletProfile} from './v2-wallet.ts';
import {parseStockDashboard,type AutonomyConfig} from './inventory.ts';
import {parseFinancialReview} from './financial-review.ts';
export interface OperatorSession {deployment?:'local-synthetic'|'local-sandbox'|'testnet-preparation'|'public-testnet';role:'operator'|'viewer';clinicId?:string;clinicRole?:string;permissions?:string[];userId?:string;csrf:string;nonce:string;expiresAt:string;providerAvailable:boolean;model:string|null;profileFingerprint:string;inventoryRuntime?:boolean;walletMode?:'isolated-mock'|'disabled'|'local-sandbox';walletAdmin?:string|null;walletProfile?:WalletProfile|null}
export interface AgentRun {id:string;caseId:string;target:AgentTarget;state:string;mode:string;execution:string;provider:string;model:string;inferenceAttempted:boolean;inferencePerformed:boolean;
 startedAt:string;completedAt:string|null;durationMs:number;requiresReconciliation:boolean;steps:{callId:string;tool:string;arguments:unknown;state:string;result:unknown;timestamp:string}[];
 result:{decision?:{source:string;explanation:string;nextAction:string};humanActions?:string[];freeFormModelText?:string}|null;error:{code:string;httpStatus?:number;providerCode?:string}|null}
export type AgentTarget={kind:'item';itemId:string;eventId:string}|{kind:'case';caseId:string;expectedRevision:number};
export interface SupplierCatalog {configured:boolean;dataOrigin:'synthetic';profileFingerprint:string;suppliers?:{id:string;account:string;destination:'Near'|'Base'}[];entries?:{itemId:string;supplierId:string;unitPriceAtomic:string;leadTimeDays:number}[]}
export class OperatorApiError extends Error {readonly code:string;readonly status:number;constructor(code:string,status:number){super(code);this.code=code;this.status=status;}}
export const acceptCaseRevision=(currentId:string,current:number,nextId:string,next:number)=>currentId===nextId&&next>=current;
export class OperatorClient {
 #session:OperatorSession|null=null;
 readonly #revisions=new Map<string,number>();
 readonly #transport:typeof fetch;
 readonly expectedClinicId?:string;
 constructor(transport:typeof fetch=(input,init)=>globalThis.fetch(input,init),expectedClinicId?:string){this.#transport=transport;this.expectedClinicId=expectedClinicId;}
 get authenticated(){return this.#session!==null;}
 async #request(path:string,body?:unknown,headers?:Record<string,string>) {
  const response=await this.#transport(`/api/operations/${path}`,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(path==='runs'&&body!==undefined?75000:15000),
   headers:body===undefined?undefined:{'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json();if(!response.ok){if(response.status===401){this.#session=null;this.#revisions.clear();}
   throw new OperatorApiError(typeof data?.error?.code==='string'?data.error.code:'OPERATIONS_FAILED',response.status);}
  if(this.expectedClinicId&&response.headers.get('x-carecart-clinic')!==this.expectedClinicId){this.#session=null;this.#revisions.clear();throw new OperatorApiError('CLINIC_CONTEXT_CHANGED_RELOAD_REQUIRED',409);}
  return data;
 }
 async session():Promise<OperatorSession>{const s=await this.#request('session');
  if(!['operator','viewer'].includes(s.role)||!/^[a-f0-9]{64}$/.test(s.csrf)||!/^[a-f0-9]{48}$/.test(s.nonce)||!/^[a-f0-9]{64}$/.test(s.profileFingerprint)||typeof s.providerAvailable!=='boolean')throw new Error('Invalid operator session');
  if(this.#session?.profileFingerprint!==s.profileFingerprint)this.#revisions.clear();this.#session=s;return s;
 }
 async login(credential:string){await this.#request('login',{credential});return this.session();}
 async #mutation(path:string,input:unknown){const session=await this.session();return this.#request(path,input,{'x-csrf-token':session.csrf,'x-operation-nonce':session.nonce});}
 async logout(){await this.#mutation('logout',{});this.#session=null;this.#revisions.clear();}
 #projection(raw:unknown):WorkflowProjection {const projection=parseWorkflowProjection(raw);
  if(!this.#session||projection.profileFingerprint!==this.#session.profileFingerprint)throw new OperatorApiError('PROFILE_MISMATCH',409);return projection;}
 async cases(filter='all',offset=0){const r=await this.#request(`cases?filter=${encodeURIComponent(filter)}&limit=20&offset=${offset}`);
  return {projection:this.#projection(r.projection),total:r.total as number,nextOffset:r.nextOffset as number|null};}
 async detail(caseId:string){if(!/^[A-Za-z0-9_-]{1,64}$/.test(caseId))throw new Error('Invalid case ID');const r=await this.#request(`cases/${encodeURIComponent(caseId)}`);
  const projection=this.#projection(r.projection);if(projection.cases.length!==1||projection.cases[0].caseId!==caseId||!Number.isSafeInteger(r.revision))throw new Error('Invalid case detail');
  if((this.#revisions.get(caseId) ?? -1)>r.revision)throw new OperatorApiError('STALE_RESPONSE',409);this.#revisions.set(caseId,r.revision);
  return {projection,revision:r.revision as number,eventCount:r.eventCount as number,runs:r.runs as AgentRun[],walletReviews:(r.walletReviews??[]) as WalletReview[]};}
 async inventory(){return (await this.#request('inventory')).items as {id:string;name:string;onHand:number;reorderPoint:number}[];}
 async catalog():Promise<SupplierCatalog>{const result=await this.#request('catalog');
  if(!this.#session||result.profileFingerprint!==this.#session.profileFingerprint||result.dataOrigin!=='synthetic')throw new OperatorApiError('PROFILE_MISMATCH',409);return result;}

 async stock(){const session=await this.session();return parseStockDashboard(await this.#request('stock'),session.profileFingerprint);}
 async recordStock(movement:{id:string;productId:string;kind:string;quantity:number;unit:'base'|'pack';source:'synthetic'|'manual';orderId?:string;reason?:string;expiresAt?:string;corrects?:string;receiptReference?:string;confirmationReference?:string;confirmedAt?:string;lotId?:string;supplierId?:string;batch?:string;receivedAt?:string;destination?:string;reference?:string}){
  return this.#mutation('stock/movements',{requestId:crypto.randomUUID(),movement});
 }
 async refreshCatalog(){return this.#mutation('stock/catalog-refresh',{requestId:crypto.randomUUID()});}
 async configureAutonomy(config:AutonomyConfig){return this.#mutation('stock/autonomy',{requestId:crypto.randomUUID(),config});}
 async events(caseId:string,offset=0){return this.#request(`cases/${encodeURIComponent(caseId)}/events?limit=50&offset=${offset}`);}
 async recent(){return (await this.#request('runs')).runs as AgentRun[];}
 async run(input:{requestId:string;mode:'provider'|'deterministic';target:AgentTarget;fallbackOf?:string}){const r=await this.#mutation('runs',input);
  if(r.projection)this.#projection(r.projection);return r.run as AgentRun;}
 async inspectRun(id:string){if(!/^[a-f0-9-]{36}$/.test(id))throw new Error('Invalid run ID');return (await this.#request(`runs/${id}`)).run as AgentRun;}
 async reconcileRun(id:string){return (await this.#mutation(`runs/${id}/reconcile`,{requestId:crypto.randomUUID()})).run as AgentRun;}
 async financialReview(caseId:string){const session=await this.session();const r=await this.#request(`cases/${encodeURIComponent(caseId)}/financial-review`);return parseFinancialReview(r.review,session.profileFingerprint);}
 async authorizeFinancial(caseId:string,role:'committer'|'requester',expectedRevision:number,expectedHash:string,walletBindingId?:string){return this.#mutation(`cases/${encodeURIComponent(caseId)}/financial-authorizations`,{requestId:crypto.randomUUID(),role,expectedRevision,expectedHash,...(walletBindingId?{walletBindingId}:{})});}
 async simulateFinancial(id:string){return this.#mutation(`financial-authorizations/${encodeURIComponent(id)}/simulate`,{requestId:crypto.randomUUID()});}
 async reconcileFinancial(id:string){return this.#mutation(`financial-authorizations/${encodeURIComponent(id)}/reconcile`,{requestId:crypto.randomUUID()});}
 async prepareWalletReview(caseId:string,action:'approve'|'reject',expectedRevision:number){return (await this.#mutation(`cases/${encodeURIComponent(caseId)}/wallet-reviews`,{requestId:crypto.randomUUID(),action,expectedRevision})).review as WalletReview;}
 async walletReview(id:string){return (await this.#request(`wallet-reviews/${id}`)).review as WalletReview;}
 async handoff(id:string,termsHash:string){return (await this.#mutation(`wallet-reviews/${id}/handoff`,{requestId:crypto.randomUUID(),termsHash})).review as WalletReview;}
 async report(id:string,outcome:'Submitted'|'Cancelled'|'Ambiguous'|'Failed',transactionHash:string|null){return (await this.#mutation(`wallet-reviews/${id}/report`,{requestId:crypto.randomUUID(),outcome,transactionHash})).review as WalletReview;}
 async mockWallet(id:string){return this.#mutation(`wallet-reviews/${id}/mock-wallet`,{requestId:crypto.randomUUID()});}
 async reconcileWallet(id:string){return (await this.#mutation(`wallet-reviews/${id}/reconcile`,{requestId:crypto.randomUUID()})).review as WalletReview;}
}

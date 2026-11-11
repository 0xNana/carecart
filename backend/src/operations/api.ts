import {assertTestnetPayments} from '../profiles/testnet-payments';
import type {TenantTreasuryAuthority,TreasuryApproval} from '../tenancy/treasury-authority';
import Fastify,{type FastifyRequest} from 'fastify';
import { z } from 'zod';
import { relative,resolve,sep } from 'node:path';
import { PROJECT_ROOT } from '../profiles/storage';
import {testnetProfile} from '../profiles/testnet';
import { Identity } from '../workflow/model';
import { ReplenishmentWorkflow } from '../workflow/cases';
import { digest } from '../intents/settlement';
import { OperatorAuth,OperationsError,type OperatorSession } from './auth';
import { ProcurementRuns,type ProviderBinding } from './runs';
import { assertNoSigningCredentials } from './local';
import {HumanReviews,type HumanReviewBinding} from './human-reviews';
import {isSandboxProfile} from '../sandbox/profile';
import {InventoryLedger,Movement,Autonomy} from '../inventory/ledger';
import {FinancialAuthorizations,FinancialInput,type FinancialBinding} from './financial-authorizations';
const page=z.object({limit:z.coerce.number().int().min(1).max(50).default(20),offset:z.coerce.number().int().min(0).max(10000).default(0)}).strict();
const header=(r:FastifyRequest,name:string)=>typeof r.headers[name]==='string'?r.headers[name] as string:undefined;
const caseId=(r:FastifyRequest)=>Identity.shape.caseId.parse((r.params as {id:string}).id);
const runId=(r:FastifyRequest)=>z.uuid().parse((r.params as {id:string}).id);
export function createOperationsApp(options:{workflow:ReplenishmentWorkflow;origin:string;operatorCredential:string;viewerCredential?:string;provider?:ProviderBinding;clock?:()=>number;humanReview?:HumanReviewBinding;inventory?:InventoryLedger;financial?:FinancialBinding;treasuryAuthority?:TenantTreasuryAuthority;treasuryApproval?:(request:FastifyRequest,bindingId:string)=>TreasuryApproval;identitySession?:(request:FastifyRequest)=>{hash:string;userId:string;clinicId:string;clinicRole:string;permissions:string[];expires:number}}) {
 assertNoSigningCredentials(process.env);
 const {workflow}=options;const directory=resolve(PROJECT_ROOT,'backend/data/local-v2/local-operations');
 const sandbox=isSandboxProfile(workflow.procurement.profile);
 const publicTestnet=!!workflow.procurement.profile.testToken&&!sandbox&&options.financial?.kind==='public-rpc';
 if(publicTestnet){if(!options.treasuryAuthority||options.humanReview)throw new Error('Clinic-bound native testnet authority required');assertTestnetPayments(workflow.procurement.profile,options.treasuryAuthority.clinicId,options.financial!.testnet);}
 const testnetPreparation=!!workflow.procurement.profile.testToken&&!sandbox&&!publicTestnet;
 if(testnetPreparation){testnetProfile(workflow.procurement.profile);if(options.financial||options.humanReview)throw new Error('Testnet preparation forbids financial, wallet and AI execution bindings');}
 const suffix=relative(directory,workflow.procurement.profile.databasePath);
 if(!sandbox&&!testnetPreparation&&!publicTestnet&&(!suffix||suffix==='..'||suffix.startsWith(`..${sep}`)||workflow.procurement.profile.vault!=='vault.local-ops.near'))throw new Error('Operations service is local-synthetic only; mainnet activation is unavailable');
 if(sandbox&&(options.provider||options.humanReview?.kind!=='sandbox-rpc'))throw new Error('Dedicated key-free Sandbox binding required; AI/public activation forbidden');
 const auth=new OperatorAuth(workflow.procurement,options.origin,options.operatorCredential,options.viewerCredential,options.clock);
 if(options.inventory&&(sandbox||options.inventory.path!==workflow.procurement.profile.databasePath||options.inventory.fingerprint!==workflow.procurement.fingerprint))throw new Error('Inventory service profile mismatch');
 const inventory=options.inventory?new InventoryLedger(options.inventory.path,options.inventory.fingerprint,options.inventory.products,options.inventory.clock,auth.database,options.inventory.tenant):null;
 if(inventory)inventory.registerCatalog(options.inventory!.catalogDefinition(),'operations-api');
 const financial=new FinancialAuthorizations(workflow,options.financial,auth.database,auth.clock,options.treasuryAuthority);
 const runs=new ProcurementRuns(workflow,auth,options.provider);const app=Fastify({logger:false,bodyLimit:16384,trustProxy:false});
 const reviews=options.humanReview?new HumanReviews(workflow,auth,options.humanReview):null;
 const walletReviews=()=>{if(!reviews)throw new OperationsError(503,'V2_WALLET_NOT_CONFIGURED');return reviews;};
 const session=(request:FastifyRequest):OperatorSession=>{
  if(options.identitySession)return auth.identitySession(options.identitySession(request));
  const values=(header(request,'cookie') ?? '').split(';').map(v=>v.trim()).filter(v=>v.startsWith('carecart_ops='));
  if(values.length!==1)throw new OperationsError(401,'AUTH_REQUIRED');return auth.session(values[0].slice('carecart_ops='.length));
 };
 const mutation=(r:FastifyRequest,operator=true)=>{const s=session(r);const nonce=auth.authorizeMutation(s,header(r,'origin'),header(r,'x-csrf-token'),header(r,'x-operation-nonce'),operator);return {s,nonce};};
 const projection=(cases:ReturnType<ReplenishmentWorkflow['get']>[])=>({format:'carecart-workflow-v1',dataOrigin:'synthetic',generatedAt:new Date(auth.clock()).toISOString(),
  profileFingerprint:workflow.procurement.fingerprint,cases:cases.map(c=>({...c,timeline:c.timeline.slice(-100)})),deployment:publicTestnet?'public-testnet':testnetPreparation?'testnet-preparation':sandbox?'local-sandbox':'local-synthetic',financialObservation:'recorded; not refreshed by this API'});
 app.addHook('onRequest',async(request,reply)=>{
  reply.header('Cache-Control','no-store').header('Vary','Cookie').header('X-Content-Type-Options','nosniff');
  if(header(request,'sec-fetch-site')==='cross-site'||(header(request,'origin')&&header(request,'origin')!==options.origin))throw new OperationsError(403,'ORIGIN_FORBIDDEN');
  const path=request.url.split('?')[0];
  if(path!=='/api/operations/cases'&&!/^\/api\/operations\/cases\/[^/]+\/events$/.test(path))z.object({}).strict().parse(request.query);
  if(path==='/api/operations/login')return;
  const s=session(request);auth.limit('read',s.hash,120);
 });
 app.setErrorHandler((cause,_request,reply)=>{
  const parseStatus=(cause as {statusCode?:number})?.statusCode;
  const status=cause instanceof OperationsError?cause.status:cause instanceof z.ZodError?400:parseStatus&&[400,413,415].includes(parseStatus)?parseStatus:cause instanceof Error&&cause.message==='Unknown case'?404:503;
  const code=cause instanceof OperationsError?cause.code:cause instanceof z.ZodError?'INVALID_INPUT':status===413?'BODY_TOO_LARGE':status===404?'CASE_NOT_FOUND':'CASE_OR_SERVICE_EVIDENCE_INVALID';
  reply.code(status).send({error:{code,message:code}});
 });
 app.post('/api/operations/login',{bodyLimit:1024},async(request,reply)=>{
  if(options.identitySession)throw new OperationsError(403,'LEGACY_LOGIN_DISABLED');
  if(header(request,'origin')!==options.origin)throw new OperationsError(403,'ORIGIN_FORBIDDEN');
  const body=z.object({credential:z.string().min(1).max(256)}).strict().parse(request.body);
  const login=auth.login(body.credential);reply.header('Set-Cookie',auth.cookie(login.token));return {authenticated:true};
 });
 app.get('/api/operations/session',async(request,reply)=>{const s=session(request);const token=options.identitySession?'':(header(request,'cookie') ?? '').split(';').map(v=>v.trim()).find(v=>v.startsWith('carecart_ops='))!.slice('carecart_ops='.length);
  if(!options.identitySession)reply.header('Set-Cookie',auth.appCookie(token,Math.max(0,Math.floor((s.expires-auth.clock())/1000))));return {role:s.role,userId:s.userId,clinicId:s.clinicId,clinicRole:s.clinicRole,permissions:s.permissions,csrf:s.csrf,nonce:auth.issueNonce(s),expiresAt:new Date(s.expires).toISOString(),
  providerAvailable:!!options.provider,model:options.provider?.config.model ?? null,inventoryRuntime:!!inventory,deployment:publicTestnet?'public-testnet':testnetPreparation?'testnet-preparation':sandbox?'local-sandbox':'local-synthetic',profileFingerprint:workflow.procurement.fingerprint,
  walletMode:sandbox?'local-sandbox':options.humanReview?.mockWallet?'isolated-mock':'disabled',walletAdmin:options.humanReview?workflow.procurement.profile.admin:null,
  walletProfile:options.humanReview?{profileFingerprint:workflow.procurement.fingerprint,network:sandbox?'sandbox':workflow.procurement.profile.network,
   vault:workflow.procurement.profile.vault,admin:workflow.procurement.profile.admin,codeHash:workflow.procurement.profile.codeHash,
   token:workflow.procurement.profile.token,decimals:6}:null};});
 app.post('/api/operations/logout',async(request,reply)=>{const {s,nonce}=mutation(request,false);z.object({}).strict().parse(request.body);
  auth.claimNonce(s,nonce,'logout',digest({action:'logout'}));auth.revoke(s);reply.header('Set-Cookie',auth.cookie('',0));return {authenticated:false};});
 app.get('/api/operations/inventory',async()=>({items:workflow.procurement.registeredInventory(),dataOrigin:'synthetic'}));
 app.get('/api/operations/catalog',async()=>({configured:!!workflow.procurement.registeredCatalog,...workflow.procurement.registeredCatalog?.(),dataOrigin:'synthetic',profileFingerprint:workflow.procurement.fingerprint}));
 app.get('/api/operations/playground',async()=>{throw new OperationsError(410,'PLAYGROUND_RETIRED');});
 app.post('/api/operations/playground/runs',async request=>{mutation(request);throw new OperationsError(410,'PLAYGROUND_RETIRED');});
 const inventoryRequired=()=>{if(!inventory)throw new OperationsError(503,'INVENTORY_RUNTIME_NOT_CONFIGURED');return inventory;};
 app.get('/api/operations/stock',async()=>{const l=inventoryRequired();const dashboard=l.dashboard();return {...dashboard,profileFingerprint:workflow.procurement.fingerprint,caseStates:dashboard.obligations.map(o=>{
  try{const c=workflow.get(o.caseId);return {caseId:c.caseId,state:c.state,paymentState:c.paymentState,humanInterventions:c.humanInterventions};}
  catch{return {caseId:o.caseId,state:'Preparing / requires reconciliation',paymentState:'Unobserved',humanInterventions:['InspectWorkerEvidence']};}
 })};});
 const inventoryMutation=(request:FastifyRequest,action:'movement'|'autonomy'|'catalog-refresh')=>{
  const {s,nonce}=mutation(request);const l=inventoryRequired();
  const input=action==='movement'?z.object({requestId:z.uuid(),movement:Movement}).strict().parse(request.body):action==='autonomy'?z.object({requestId:z.uuid(),config:Autonomy}).strict().parse(request.body):z.object({requestId:z.uuid()}).strict().parse(request.body);
  const payloadHash=digest({action,input});
  return auth.database.transaction(()=>{auth.claimNonce(s,nonce,input.requestId,payloadHash);auth.limit('inventory-write',s.hash,30);
   const prior=auth.database.prepare('SELECT payload_hash,result_json FROM inventory_requests WHERE request_id=?').get(input.requestId) as {payload_hash:string;result_json:string}|undefined;
   if(prior){if(prior.payload_hash!==payloadHash)throw new OperationsError(409,'INVENTORY_REQUEST_CONFLICT');return JSON.parse(prior.result_json);}
   let result:unknown;
   if('movement' in input){const m=Movement.parse(input.movement);
    if(['Opening','Expire'].includes(m.kind)||m.source==='external')throw new OperationsError(403,'INVENTORY_ACTION_FORBIDDEN');
    if(m.supplierId&&!workflow.procurement.registeredCatalog?.()?.suppliers.some(s=>s.id===m.supplierId))throw new OperationsError(409,'INVENTORY_SUPPLIER_UNREGISTERED');
    if(m.orderId){
     const domain=workflow.procurement.inspect(m.orderId);
     if(domain.event.itemId!==m.productId)throw new OperationsError(409,'INBOUND_CANONICAL_CONFLICT');
     if(m.kind==='Receive'&&m.supplierId&&m.supplierId!==domain.quote.supplierId)throw new OperationsError(409,'INBOUND_CANONICAL_CONFLICT');
     const row=auth.database.prepare('SELECT case_id FROM replenishment_cases WHERE po_id=?').get(m.orderId) as {case_id:string}|undefined;
     if(!row)throw new OperationsError(409,'CANONICAL_CASE_REQUIRED');
     if(m.kind==='ConfirmInbound'&&m.quantity*(m.unit==='pack'?l.product(m.productId).packSize:1)!==domain.quote.quantity)throw new OperationsError(409,'INBOUND_CANONICAL_CONFLICT');
     l.registerOrderLink({orderId:m.orderId,productId:m.productId,caseId:row.case_id,quantity:domain.quote.quantity,canonicalHash:domain.canonicalHash},s.userId&&s.clinicId?`user:${s.userId}@clinic:${s.clinicId}`:'operator:'+s.hash.slice(0,16));
    }
    result={movement:l.move(m,s.userId&&s.clinicId?`user:${s.userId}@clinic:${s.clinicId}`:'operator:'+s.hash.slice(0,16))};
   }else if('config' in input)result={config:l.configure(input.config,s.userId&&s.clinicId?`user:${s.userId}@clinic:${s.clinicId}`:'operator:'+s.hash.slice(0,16))};
   else result={catalog:l.refreshCatalog(s.userId&&s.clinicId?`user:${s.userId}@clinic:${s.clinicId}`:'operator:'+s.hash.slice(0,16))};
   auth.database.prepare('INSERT INTO inventory_requests VALUES(?,?,?)').run(input.requestId,payloadHash,JSON.stringify(result));return result;
  }).immediate();
 };
 app.post('/api/operations/stock/movements',async request=>inventoryMutation(request,'movement'));
 app.post('/api/operations/stock/autonomy',async request=>inventoryMutation(request,'autonomy'));
 app.post('/api/operations/stock/catalog-refresh',async request=>inventoryMutation(request,'catalog-refresh'));
 app.get('/api/operations/cases',async request=>{const q=page.extend({filter:z.enum(['all','active','attention']).default('all')}).strict().parse(request.query);
  const result=workflow.page(q);return {...result,cases:undefined,projection:projection(result.cases),nextOffset:result.nextOffset!==null&&result.nextOffset<=10000?result.nextOffset:null};});
 app.get('/api/operations/cases/:id',async(request,reply)=>{z.object({}).strict().parse(request.query);const c=workflow.get(caseId(request));
  reply.header('ETag',`W/"${workflow.procurement.fingerprint}:${c.caseId}:${c.version}"`);return {projection:projection([c]),revision:c.version,eventCount:c.timeline.length,runs:runs.list(c.caseId),walletReviews:reviews?.list(c.caseId) ?? []};});
 app.get('/api/operations/cases/:id/financial-review',async request=>({review:await financial.assess(caseId(request))}));
 app.post('/api/operations/cases/:id/financial-authorizations',async request=>{const {s,nonce}=mutation(request);const id=caseId(request);const input=FinancialInput.parse(request.body);
  return {authorization:await financial.authorize(id,input,s.hash,()=>auth.claimNonce(s,nonce,input.requestId,digest({id,action:'financial-authorize',...input})),input.walletBindingId?options.treasuryApproval?.(request,input.walletBindingId):undefined)};});
 app.post('/api/operations/financial-authorizations/:id/simulate',async request=>{const {s,nonce}=mutation(request);const id=runId(request);const input=z.object({requestId:z.uuid()}).strict().parse(request.body);
  auth.claimNonce(s,nonce,input.requestId,digest({id,action:'financial-simulate'}));return {authorization:await financial.executeMock(id,s.hash)};});
 app.post('/api/operations/financial-authorizations/:id/reconcile',async request=>{const {s,nonce}=mutation(request);const id=runId(request);const input=z.object({requestId:z.uuid()}).strict().parse(request.body);
  auth.claimNonce(s,nonce,input.requestId,digest({id,action:'financial-reconcile'}));return {authorization:await financial.reconcile(id)};});
 app.get('/api/operations/cases/:id/events',async request=>{const q=page.parse(request.query);const c=workflow.get(caseId(request));return {events:c.timeline.slice(q.offset,q.offset+q.limit),
  revision:c.version,total:c.timeline.length,nextOffset:q.offset+q.limit<c.timeline.length?q.offset+q.limit:null};});
 app.get('/api/operations/cases/:id/runs',async request=>{z.object({}).strict().parse(request.query);const id=caseId(request);workflow.get(id);return {runs:runs.list(id)};});
 app.get('/api/operations/runs',async request=>{z.object({}).strict().parse(request.query);return {runs:runs.recent()};});
 app.get('/api/operations/runs/:id',async request=>{z.object({}).strict().parse(request.query);return {run:runs.get(runId(request))};});
 app.post('/api/operations/runs',async request=>{const {s,nonce}=mutation(request);if(sandbox)throw new OperationsError(403,'SANDBOX_DOMAIN_PREPARATION_IS_MANUAL');const begun=runs.begin(request.body,s,nonce);
  const run=begun.created?await runs.execute(begun.run.id):begun.run;
  let current=null;try{current=projection([workflow.get(run.caseId)]);}catch{/* An unprepared/corrupt case is not fabricated for a model response. */}
  return {run,projection:current};
 });
 app.post('/api/operations/runs/:id/reconcile',async request=>{const {s,nonce}=mutation(request);const id=runId(request);
  const body=z.object({requestId:z.uuid()}).strict().parse(request.body);auth.claimNonce(s,nonce,body.requestId,digest({action:'reconcile',id}));
  return {run:runs.reconcile(id)};
 });
 app.post('/api/operations/cases/:id/wallet-reviews',async request=>{const {s,nonce}=mutation(request);
  return {review:await walletReviews().prepare(caseId(request),request.body,s,nonce)};});
 app.get('/api/operations/wallet-reviews/:id',async request=>({review:walletReviews().get(runId(request))}));
 app.post('/api/operations/wallet-reviews/:id/handoff',async request=>{const {s,nonce}=mutation(request);
  return {review:await walletReviews().handoff(runId(request),request.body,s,nonce)};});
 app.post('/api/operations/wallet-reviews/:id/mock-wallet',async request=>{const {s,nonce}=mutation(request);
  return walletReviews().mockSubmit(runId(request),request.body,s,nonce);});
 app.post('/api/operations/wallet-reviews/:id/report',async request=>{const {s,nonce}=mutation(request);
  return {review:walletReviews().report(runId(request),request.body,s,nonce)};});
 app.post('/api/operations/wallet-reviews/:id/reconcile',async request=>{const {s,nonce}=mutation(request);const id=runId(request);
  const input=z.object({requestId:z.uuid()}).strict().parse(request.body);auth.claimNonce(s,nonce,input.requestId,digest({id,action:'wallet-reconcile'}));
  return {review:await walletReviews().reconcile(id)};});
 app.addHook('onClose',async()=>auth.close());return app;
}

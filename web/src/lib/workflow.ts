import {statusLabel} from './product-copy.ts';
/** An imported export is a saved, unauthenticated projection, never a browser-verified payment proof. */
const states=['Opened','InventoryRecorded','ForecastEvaluated','QuotesAvailable','SupplierSelected','PoDrafted','CommitmentPending',
 'PoCommitted','PaymentRequestPending','AwaitingHumanApproval','DispatchInProgress','SameChainConfirmed','SourceDispatched',
 'DestinationSettled','Refunded','Rejected','Failed','Expired','RequiresReconciliation'];
export interface WorkspaceCase {
 caseId:string;eventId:string;itemId:string;state:string;poId:string|null;poHash:string|null;nextAction:string;humanInterventions:string[];
 createdAt:string;updatedAt:string;paymentState:string;evidenceKind:'local-only'|'mocked-rpc'|'public-rpc'|'sandbox-rpc';
 item:{name:string;onHand:number;reorderPoint:number;usageUnits:number}|null;
 forecasts:{supplierId:string;leadTimeDays:number;leadTimeDemand:number;recommendedQuantity:number}[];
 quotes:{id:string;supplierId:string;supplierAccount:string;quantity:number;amountAtomic:string;expiresAt:string}[];
 selection:{quoteId:string;policy:string;amount:string;destination:'Near'|'Base'}|null;
 vault:{checkedAt:string;status:string;reason:string;reservedDay:number;attemptId:string}|null;
 settlement:{attemptId:string;state:string;fullRefund:boolean|undefined}|null;
 operations:{id:string;state:string}[];settlementReferences:{id:string;state:string}[];
 timeline:{eventType:string;previousState:string|null;resultingState:string;actor:string;timestamp:string;evidenceReference:string;operationId:string|null}[];
}
export interface WorkflowProjection {generatedAt:string;profileFingerprint:string;cases:WorkspaceCase[]}
const record=(v:unknown):Record<string,unknown>=>{if(!v || typeof v!=='object' || Array.isArray(v)) throw new Error('Expected workflow record');return v as Record<string,unknown>;};
const string=(v:unknown)=>{if(typeof v!=='string'||v.length>4096)throw new Error('Invalid workflow text');return v;};
const nullable=(v:unknown)=>v===null?null:string(v);
const list=(v:unknown)=>{if(!Array.isArray(v)||v.length>10000)throw new Error('Invalid workflow list');return v as unknown[];};
const integer=(v:unknown)=>{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0)throw new Error('Invalid workflow integer');return v;};
const timestamp=(v:unknown)=>{const s=string(v);if(!Number.isFinite(Date.parse(s)))throw new Error('Invalid workflow timestamp');return s;};
const hash=(v:unknown)=>{const s=string(v);if(!/^[a-f0-9]{64}$/.test(s))throw new Error('Invalid workflow hash');return s;};
const atomic=(v:unknown)=>{const s=string(v);if(!/^[1-9][0-9]{0,38}$/.test(s)||BigInt(s)>=BigInt(2)**BigInt(128))throw new Error('Invalid atomic USDC amount');return s;};
export function parseWorkflowProjection(raw:unknown):WorkflowProjection {
 const root=record(raw);
 if(root.format!=='carecart-workflow-v1'||root.dataOrigin!=='synthetic')throw new Error('CareCart synthetic workflow export required');
 const cases=list(root.cases).map((value):WorkspaceCase=>{
  const c=record(value);const state=string(c.state);if(!states.includes(state))throw new Error('Unknown workflow state');
  const evidenceKind=string(c.evidenceKind);if(!['local-only','mocked-rpc','public-rpc','sandbox-rpc'].includes(evidenceKind))throw new Error('Unknown evidence provenance');
  const inventory=c.inventory===null?null:record(c.inventory);const item=inventory?record(inventory.item):null;
  const domain=c.domain===null?null:record(c.domain);const po=domain?record(domain.purchaseOrder):null;const canonical=po?record(po.canonical):null;
  const saved=c.vault===null?null:record(c.vault);const payment=saved?record(saved.payment):null;
  const settlement=c.settlement===null?null:record(c.settlement);
  if(saved&&(saved.kind!==evidenceKind||hash(saved.canonicalHash)!==c.poHash))throw new Error('Evidence/canonical mismatch');
  if(['SameChainConfirmed','DestinationSettled','Refunded','SourceDispatched'].includes(state)&&(!saved||evidenceKind==='local-only'))throw new Error('Financial outcome requires independent observation');
  if(state==='SameChainConfirmed'&&(payment?.status!=='Paid'||canonical?.destination!=='Near'))throw new Error('Unsupported same-chain confirmation');
  if(state==='SourceDispatched'&&payment?.status!=='Dispatched')throw new Error('Unsupported source dispatch');
  if(state==='DestinationSettled'&&(settlement?.state!=='Settled'||!settlement.proof||payment?.status!=='Dispatched'))throw new Error('Destination receipt evidence required');
  if(state==='Refunded'&&(settlement?.state!=='Refunded'||!settlement.proof))throw new Error('Refund receipt evidence required');
  return {caseId:string(c.caseId),eventId:string(c.eventId),itemId:string(c.itemId),state,poId:nullable(c.poId),poHash:c.poHash===null?null:hash(c.poHash),
   nextAction:string(c.nextAction),humanInterventions:list(c.humanInterventions).map(string),createdAt:timestamp(c.createdAt),updatedAt:timestamp(c.updatedAt),
   paymentState:string(c.paymentState),evidenceKind:evidenceKind as WorkspaceCase['evidenceKind'],
   item:item?{name:string(item.name),onHand:integer(item.onHand),reorderPoint:integer(item.reorderPoint),usageUnits:integer(item.usageUnits)}:null,
   forecasts:inventory?list(inventory.forecasts).map(v=>{const f=record(v);return {supplierId:string(f.supplierId),leadTimeDays:integer(f.leadTimeDays),leadTimeDemand:integer(f.leadTimeDemand),recommendedQuantity:integer(f.recommendedQuantity)};}):[],
   quotes:inventory?list(inventory.quotes).map(v=>{const q=record(v);return {id:string(q.id),supplierId:string(q.supplierId),supplierAccount:string(q.supplierAccount),quantity:integer(q.quantity),amountAtomic:atomic(q.amountAtomic),expiresAt:timestamp(q.expiresAt)};}):[],
   selection:po&&canonical?{quoteId:string(po.quoteId),policy:string(po.decisionPolicy),amount:atomic(canonical.amount),destination:canonical.destination==='Near'?'Near':'Base'}:null,
   vault:saved&&payment?{checkedAt:timestamp(saved.checkedAt),status:string(payment.status),reason:string(payment.reason),reservedDay:integer(payment.reserved_day),attemptId:string(payment.attempt_id)}:null,
   settlement:settlement?{attemptId:string(settlement.attemptId),state:string(settlement.state),fullRefund:typeof settlement.fullRefund==='boolean'?settlement.fullRefund:undefined}:null,
   operations:domain?list(domain.operations).map(v=>{const o=record(v);return {id:string(o.operation_key),state:string(o.state)};}):[],
   settlementReferences:domain?list(domain.settlement).map(v=>{const a=record(v);return {id:string(a.id),state:string(a.state)};}):[],
   timeline:list(c.timeline).map(v=>{const e=record(v);return {eventType:string(e.eventType),previousState:nullable(e.previousState),resultingState:string(e.resultingState),actor:string(e.actor),timestamp:timestamp(e.timestamp),evidenceReference:hash(e.evidenceReference),operationId:nullable(e.operationId)};}),
  };
 });
 if(new Set(cases.map(c=>c.caseId)).size!==cases.length)throw new Error('Duplicate case ID');
 return {generatedAt:timestamp(root.generatedAt),profileFingerprint:hash(root.profileFingerprint),cases};
}
export const stateText=(s:string)=>s.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/^Po /,'PO ');
export function caseStateLabel(c:WorkspaceCase) {
 return paymentEvidenceLabel(c,c.state);
}
export function paymentEvidenceLabel(c:Pick<WorkspaceCase,'evidenceKind'>,value:string) {
 const labels:Record<WorkspaceCase['evidenceKind'],Record<string,string>>={
  'local-only':{},
  'mocked-rpc':{Paid:'Demo payment complete',SameChainConfirmed:'Demo payment complete',Dispatched:'Demo payment sent',SourceDispatched:'Demo payment sent · recipient confirmation pending',Settled:'Demo recipient confirmation',DestinationSettled:'Demo recipient confirmed'},
  'sandbox-rpc':{Paid:'Local test payment complete',SameChainConfirmed:'Local test payment complete',Dispatched:'Local test payment sent',SourceDispatched:'Local test payment sent · recipient confirmation pending',Settled:'Local recipient confirmation',DestinationSettled:'Local recipient confirmed'},
  'public-rpc':{Paid:'Testnet payment confirmed',SameChainConfirmed:'Testnet payment confirmed',Dispatched:'Testnet payment sent',SourceDispatched:'Testnet payment sent · recipient confirmation pending',Settled:'Testnet recipient confirmation',DestinationSettled:'Testnet recipient confirmed'},
 };
 return labels[c.evidenceKind][value]??statusLabel(value);
}
export function usdc(value:string) {const n=BigInt(value);return `${n/BigInt(1_000_000)}.${(n%BigInt(1_000_000)).toString().padStart(6,'0')}`;}
export const terminalStates=new Set(['SameChainConfirmed','DestinationSettled','Refunded','Rejected','Failed','Expired']);

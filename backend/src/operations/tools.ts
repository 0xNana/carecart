import { z } from 'zod';
import { Identity, WorkflowState } from '../workflow/model';
import { SafetyOrderSchema } from '../near/commitments';
import { CatalogItemId } from '../procurement/v2-catalog';
import { ReplenishmentWorkflow } from '../workflow/cases';
import type { ModelToolDefinition } from '../agent/live';

const caseArg=z.object({caseId:Identity.shape.caseId}).strict();
export const toolSchemas={
 get_replenishment_case:caseArg,
 get_inventory_forecast:z.object({itemId:CatalogItemId}).strict(),
 evaluate_supplier_quotes:caseArg,
 prepare_replenishment_case:z.object({itemId:CatalogItemId,eventId:Identity.shape.eventId}).strict(),
 explain_procurement_decision:caseArg,
 get_required_human_actions:caseArg,
 propose_next_action:z.object({caseId:Identity.shape.caseId,action:z.string().regex(/^[A-Za-z]{1,64}$/)}).strict(),
} as const;
export type ToolName=keyof typeof toolSchemas;
const descriptions:Record<ToolName,string>={
 get_replenishment_case:'Inspect the authorized persisted case. Recorded payment status is separate from AI recommendations.',
 get_inventory_forecast:'Evaluate exact deterministic demand for the authorized registered synthetic inventory item.',
 evaluate_supplier_quotes:'Compare trusted persisted quotes; never invent supplier, price, recipient or quote.',
 prepare_replenishment_case:'Prepare the explicitly authorized synthetic inventory event using deterministic domain rules only.',
 explain_procurement_decision:'Return the deterministic selection explanation and canonical PO evidence.',
 get_required_human_actions:'Read actual workflow intervention requirements; cannot approve any action.',
 propose_next_action:'Record a proposal only if it equals the current permitted workflow action. Does not execute it.',
};
export const procurementToolDefinitions:ModelToolDefinition[]=Object.entries(toolSchemas).map(([name,schema])=>{
 const parameters=z.toJSONSchema(schema);delete parameters.$schema;
 return {name,description:descriptions[name as ToolName],parameters};
});
const action=z.string().regex(/^[A-Za-z]{1,64}$/);
const CaseSummary=z.object({caseId:Identity.shape.caseId,itemId:CatalogItemId,state:WorkflowState,revision:z.number().int().nonnegative(),
 poId:SafetyOrderSchema.shape.po_id.nullable(),poHash:z.string().regex(/^[a-f0-9]{64}$/).nullable(),nextAction:action,
 humanActions:z.array(action).max(20),paymentState:z.string().max(32),evidenceKind:z.enum(['local-only','mocked-rpc','public-rpc'])}).strict();
export function caseSummary(c:ReturnType<ReplenishmentWorkflow['get']>){return CaseSummary.parse({caseId:c.caseId,itemId:c.itemId,state:c.state,revision:c.version,
 poId:c.poId,poHash:c.poHash,nextAction:c.nextAction,humanActions:c.humanInterventions,paymentState:c.paymentState,evidenceKind:c.evidenceKind});}
const number=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const Forecast=z.object({itemId:CatalogItemId,onHand:number,reorderPoint:number,usageUnits:number,stockoutRisk:z.boolean(),
 suppliers:z.array(z.object({supplierId:z.string().regex(/^mn-supplier-[1-9][0-9]*$/),leadTimeDays:number,leadTimeDemand:number,recommendedQuantity:number}).strict()).max(20)}).strict();
const QuoteComparison=z.object({caseId:Identity.shape.caseId,quotes:z.array(z.object({id:z.string().max(64),supplierId:z.string().max(64),
 quantity:number,amountAtomic:SafetyOrderSchema.shape.amount,expiresAt:z.iso.datetime(),selected:z.boolean()}).strict()).max(20)}).strict();
export interface ProcurementToolContext {
 identity:Identity;workflow:ReplenishmentWorkflow;
 checkRevision():void;prepare():ReturnType<ReplenishmentWorkflow['get']>;propose(action:string):void;
}
export function validateTool(name:string,raw:unknown) {
 if(!Object.hasOwn(toolSchemas,name))throw new Error('UNKNOWN_TOOL');
 return toolSchemas[name as ToolName].parse(raw);
}
/** This registry has no credential, shell, SQL, arbitrary RPC, payment request or financial-observation capability. */
export function executeProcurementTool(ctx:ProcurementToolContext,name:string,raw:unknown):unknown {
 const args=validateTool(name,raw);ctx.checkRevision();
 if('caseId' in args&&args.caseId!==ctx.identity.caseId)throw new Error('TOOL_SCOPE');
 if('itemId' in args&&args.itemId!==ctx.identity.itemId)throw new Error('TOOL_SCOPE');
 if('eventId' in args&&args.eventId!==ctx.identity.eventId)throw new Error('TOOL_SCOPE');
 if(name==='get_inventory_forecast') {
  const f=ctx.workflow.procurement.inventoryForecast(ctx.identity.itemId);
  return Forecast.parse({itemId:f.item.id,onHand:f.item.onHand,reorderPoint:f.item.reorderPoint,usageUnits:f.item.usageUnits,
   stockoutRisk:f.suppliers.some(s=>s.leadTimeDemand>f.item.onHand),suppliers:f.suppliers});
 }
 if(name==='prepare_replenishment_case')return caseSummary(ctx.prepare());
 const c=ctx.workflow.get(ctx.identity.caseId);
 if(name==='get_replenishment_case')return caseSummary(c);
 if(name==='get_required_human_actions')return z.object({caseId:Identity.shape.caseId,nextAction:action,humanActions:z.array(action).max(20)}).strict()
  .parse({caseId:c.caseId,nextAction:c.nextAction,humanActions:c.humanInterventions});
 if(name==='evaluate_supplier_quotes')return QuoteComparison.parse({caseId:c.caseId,quotes:(c.inventory?.quotes ?? []).map(q=>({id:q.id,supplierId:q.supplierId,
  quantity:q.quantity,amountAtomic:q.amountAtomic,expiresAt:q.expiresAt,selected:q.id===c.domain?.purchaseOrder.quoteId}))});
 if(name==='propose_next_action') {
  const p=toolSchemas.propose_next_action.parse(args);if(p.action!==c.nextAction)throw new Error('UNSUPPORTED_PROPOSAL');
  ctx.propose(p.action);return z.object({caseId:Identity.shape.caseId,proposal:action,executed:z.literal(false)}).strict().parse({caseId:c.caseId,proposal:p.action,executed:false});
 }
 if(name==='explain_procurement_decision')return deterministicDecision(c);
 throw new Error('UNKNOWN_TOOL');
}
export function deterministicDecision(c:ReturnType<ReplenishmentWorkflow['get']>) {
 const order=c.domain?.purchaseOrder;
 return z.object({caseId:Identity.shape.caseId,source:z.literal('deterministic-domain'),policy:z.string().max(128),
  explanation:z.string().max(1000),nextAction:action,canonicalHash:z.string().regex(/^[a-f0-9]{64}$/).nullable()}).strict().parse({
  caseId:c.caseId,source:'deterministic-domain',policy:order?.decisionPolicy ?? 'not-selected',canonicalHash:c.poHash,nextAction:c.nextAction,
  explanation:order?`The deterministic minimum-total policy selected persisted quote ${order.quoteId} for ${order.canonical.amount} atomic proposed USDC units. Financial observations are separate.`:
   'No procurement decision is persisted. Preparation or human review is still required.',
 });
}

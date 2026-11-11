import {parseWorkflowProjection, type WorkflowProjection} from '../src/lib/workflow.ts';
import {parseStockDashboard, type StockDashboard} from '../src/lib/inventory.ts';

export interface PlaygroundRun {execution:'local-simulation';network:'none';financialExecution:false;projection:WorkflowProjection;stock:StockDashboard}
export function parsePlaygroundRun(raw:unknown,dashboardFingerprint:string):PlaygroundRun {
 const value=raw as Record<string,unknown>;
 if(!value||value.execution!=='local-simulation'||value.network!=='none'||value.financialExecution!==false)
  throw new Error('PLAYGROUND_ENVIRONMENT_INVALID');
 const projection=parseWorkflowProjection(value.projection);
 if(projection.profileFingerprint===dashboardFingerprint||projection.cases.length!==1)
  throw new Error('PLAYGROUND_ISOLATION_INVALID');
 const c=projection.cases[0];
 if(c.evidenceKind!=='local-only'||c.paymentState!=='Unobserved'||c.vault||c.settlement||c.state!=='PoDrafted'||!c.poId||!c.poHash||!c.selection||c.selection.destination!=='Near'||c.operations.length||c.settlementReferences.length||
  !c.quotes.length||c.quotes.some(q=>!/^supplier-[ab]\.local-ops\.near$/.test(q.supplierAccount)))
  throw new Error('PLAYGROUND_FINANCIAL_EVIDENCE_INVALID');
 const stock=parseStockDashboard(value.stock,projection.profileFingerprint);
 return {execution:'local-simulation',network:'none',financialExecution:false,projection,stock};
}

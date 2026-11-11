import type {TenantExecutionPermit} from '../tenancy/treasury-authority';
import type {V2ProcurementStore} from '../procurement/v2-store';
type Snapshot=ReturnType<V2ProcurementStore['eventSnapshot']>;
export type WorkflowQuote=Omit<Snapshot['quotes'][number],'profile'|'token'|'asset'>&{profile:string;token:string;asset:string};
export type WorkflowSnapshot=Omit<Snapshot,'quotes'>&{quotes:WorkflowQuote[]};
type Inspect=ReturnType<V2ProcurementStore['inspect']>;
/** Public domain surface. Public mainnet validation stays in V2ProcurementStore; Sandbox has its own branded binding. */
export type WorkflowProcurement=Omit<Pick<V2ProcurementStore,keyof V2ProcurementStore>,'eventSnapshot'|'inspect'|'inventoryEvent'|'registeredCatalog'>&{
 registeredCatalog?:V2ProcurementStore['registeredCatalog'];
 inventoryEvent(raw:unknown,now?:Date):Omit<ReturnType<V2ProcurementStore['inventoryEvent']>,'quotes'>&{quotes:WorkflowQuote[]};
 eventSnapshot(id:string):WorkflowSnapshot;
 inspect(poId:string):Omit<Inspect,'quote'>&{quote:WorkflowQuote};
 executeSandboxRole?:(role:'committer'|'requester',poId:string,environment:NodeJS.ProcessEnv,tenantPermit?:TenantExecutionPermit)=>Promise<void>;
};

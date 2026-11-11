import {z} from 'zod';
import {digest} from '../src/intents/settlement.js';
import {openInventoryOperations} from '../src/inventory/local.js';
import {gloves} from '../src/inventory/ledger.js';
import {OperatorAuth, OperationsError, type OperatorSession} from '../src/operations/auth.js';

export const playgroundDefinition = Object.freeze({dataOrigin:'synthetic', execution:'local-simulation', network:'none',
 financialExecution:false, openingStock:12, consumption:4, product:gloves,
 reorderPoint:gloves.baselineDailyDemand*gloves.leadTimeDays+gloves.safetyStock});

/** Reuses the actual ledger, monitor and procurement spine in a separate key-free workspace per run. */
export class PlaygroundRuns {
 constructor(readonly auth:OperatorAuth) {
  auth.database.exec('CREATE TABLE IF NOT EXISTS playground_runs(request_id TEXT PRIMARY KEY,session_hash TEXT NOT NULL,workspace TEXT UNIQUE NOT NULL)');
 }
 run(raw:unknown,session:OperatorSession,nonce:string) {
  if(session.role!=='operator')throw new OperationsError(403,'OPERATOR_REQUIRED');
  const input=z.object({requestId:z.uuid()}).strict().parse(raw);
  const workspace='playground-'+digest([this.auth.profileFingerprint,session.hash,input.requestId]).slice(0,48);
  this.auth.database.transaction(()=>{
   this.auth.claimNonce(session,nonce,input.requestId,digest({action:'playground',...input}));
   const prior=this.auth.database.prepare('SELECT session_hash,workspace FROM playground_runs WHERE request_id=?').get(input.requestId) as {session_hash:string;workspace:string}|undefined;
   if(prior){if(prior.session_hash!==session.hash||prior.workspace!==workspace)throw new OperationsError(409,'PLAYGROUND_REQUEST_CONFLICT');return;}
   this.auth.limit('playground-write',session.hash,10);
   const count=this.auth.database.prepare('SELECT COUNT(*) FROM playground_runs WHERE session_hash=?').pluck().get(session.hash) as number;
   if(count>=20)throw new OperationsError(429,'PLAYGROUND_SESSION_LIMIT');
   this.auth.database.prepare('INSERT INTO playground_runs VALUES(?,?,?)').run(input.requestId,session.hash,workspace);
  }).immediate();
  const local=openInventoryOperations(workspace);
  try {
   local.inventory.move({id:'playground-consumption',productId:gloves.id,kind:'Consume',quantity:4,unit:'base',source:'synthetic'},'playground-operator');
   const run=local.monitor.runOnce('playground');
   if(run?.state==='Failed')throw new OperationsError(503,'PLAYGROUND_PREPARATION_FAILED');
   const obligation=local.inventory.dashboard().obligations[0];
   if(!obligation)throw new OperationsError(409,'PLAYGROUND_PREPARING');
   const c=local.workflow.get(obligation.caseId);
   return {execution:'local-simulation' as const,network:'none' as const,financialExecution:false as const,
    projection:{format:'carecart-workflow-v1',dataOrigin:'synthetic',generatedAt:new Date().toISOString(),profileFingerprint:local.store.fingerprint,cases:[c]},
    stock:{...local.inventory.dashboard(),profileFingerprint:local.store.fingerprint,caseStates:[{caseId:c.caseId,state:c.state,paymentState:c.paymentState,humanInterventions:c.humanInterventions}]}};
  } finally {local.close();}
 }
}

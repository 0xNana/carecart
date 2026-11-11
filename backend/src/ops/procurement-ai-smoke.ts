import { randomUUID,randomBytes } from 'node:crypto';
import { liveConfiguration,openAiTransport } from '../agent/live';
import { openLocalOperations,assertNoSigningCredentials } from '../operations/local';
import { OperatorAuth } from '../operations/auth';
import { ProcurementRuns } from '../operations/runs';
import { procurementToolDefinitions } from '../operations/tools';
/** Explicit, bounded provider smoke. No dotenv, public accounts, signing transport or funds. */
async function main(){
 assertNoSigningCredentials(process.env);const config=liveConfiguration(process.env);
 if(!config){console.info(JSON.stringify({status:'blocked',reason:'LIVE_AI_DISABLED',inferenceAttempted:false}));process.exitCode=2;return;}
 const local=openLocalOperations(`ai-smoke-${randomUUID()}`);const secret=randomBytes(32).toString('hex');
 const auth=new OperatorAuth(local.store,'http://localhost:3000',secret);
 try{const runs=new ProcurementRuns(local.workflow,auth,{config,transport:openAiTransport(config,procurementToolDefinitions),evidence:'live-provider'});
  const session=auth.session(auth.login(secret).token);const begun=runs.begin({requestId:randomUUID(),mode:'provider',target:{kind:'item',itemId:'mn-item-1',eventId:`smoke-${randomUUID()}`}},session,auth.issueNonce(session));
  const run=await runs.execute(begun.run.id);console.info(JSON.stringify({status:run.state==='Completed'?'passed':'failed',run,publicChainExecution:false,transactionInitiated:false}));
  if(run.state!=='Completed')process.exitCode=1;
 }finally{auth.close();local.close();}
}
if(require.main===module)void main().catch(()=>{console.error('Provider smoke blocked or failed configuration validation. No signing or payment execution was attempted.');process.exitCode=1;});

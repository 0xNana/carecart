import { liveConfiguration,openAiTransport } from '../agent/live';
import { procurementToolDefinitions } from './tools';
import { assertNoSigningCredentials } from './local';
import { openInventoryOperations } from '../inventory/local';
import { createOperationsApp } from './api';
/** Separate local service. No dotenv, payment configuration, keys, account queries or automatic AI tick. */
export async function startOperationsServer(env:NodeJS.ProcessEnv=process.env) {
 assertNoSigningCredentials(env);
 if(env.CARECART_OPERATIONS_MODE!=='local-synthetic')throw new Error('Explicit local-synthetic operations mode required');
 const credential=env.CARECART_OPERATIONS_OPERATOR_SECRET ?? '';
 if(credential.length<32)throw new Error('Server-only operator credential required');
 const config=liveConfiguration(env);const local=openInventoryOperations(env.CARECART_INVENTORY_WORKSPACE??'clinic-runtime',()=>Date.now(),{dataset:'clinic'});let app:ReturnType<typeof createOperationsApp>|undefined;
 try {
  app=createOperationsApp({workflow:local.workflow,inventory:local.inventory,origin:env.CARECART_OPERATIONS_ORIGIN ?? 'http://localhost:3000',operatorCredential:credential,
   viewerCredential:env.CARECART_OPERATIONS_VIEWER_SECRET,provider:config?{config,transport:openAiTransport(config,procurementToolDefinitions),evidence:'live-provider'}:undefined});
  app.addHook('onClose',async()=>local.close());
  const port=Number(env.CARECART_OPERATIONS_PORT ?? 3002);if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid operations port');
  await app.listen({host:'127.0.0.1',port});return app;
 } catch(error){if(app)await app.close();else local.close();throw error;}
}
if(require.main===module)void startOperationsServer().catch(()=>{console.error('Local operations service could not start. Check isolated configuration; signing credentials and mainnet activation are forbidden.');process.exitCode=1;});

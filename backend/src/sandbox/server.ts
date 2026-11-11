import {readFileSync} from 'node:fs';import {sandboxProfile} from './profile';import {SandboxProcurementStore} from './store';import {SandboxVaultClient} from './client';
import {ReplenishmentWorkflow} from '../workflow/cases';import {createOperationsApp} from '../operations/api';import {assertNoSigningCredentials} from '../operations/local';
async function main(){assertNoSigningCredentials(process.env);if(process.env.CARECART_OPERATIONS_MODE!=='local-sandbox')throw new Error('Explicit Sandbox mode required');
 const profile=sandboxProfile(JSON.parse(readFileSync(process.argv[2],'utf8')));const store=new SandboxProcurementStore(profile);const workflow=new ReplenishmentWorkflow(store);
 try{const client=new SandboxVaultClient(profile);await client.verify();
  const app=createOperationsApp({workflow,origin:process.env.CARECART_OPERATIONS_ORIGIN ?? 'http://127.0.0.1:3001',operatorCredential:process.env.CARECART_OPERATIONS_OPERATOR_SECRET ?? '',
  humanReview:{client,kind:'sandbox-rpc'},financial:{client,kind:'sandbox-rpc',verify:()=>client.verify()}});app.addHook('onClose',async()=>{workflow.close();store.close();});
  for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>void app.close());
  const port=Number(process.env.CARECART_OPERATIONS_PORT);if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Explicit Sandbox loopback port required');
  await app.listen({host:'127.0.0.1',port});console.info('Key-free Operations API connected to genuine local Sandbox; public-chain signing disabled');
 }catch(e){workflow.close();store.close();throw e;}
}
if(require.main===module)void main().catch(()=>{console.error('Dedicated Sandbox API failed');process.exitCode=1;});

import {readFileSync} from 'node:fs';
import {sandboxProfile} from './profile';import {SandboxProcurementStore} from './store';import {SandboxVaultClient} from './client';
import {ReplenishmentWorkflow} from '../workflow/cases';import {FinancialAuthorizations} from '../operations/financial-authorizations';
/** One local restricted role consumes one exact application authorization. No public-chain alias is accepted. */
async function main(){const [path,role,id]=process.argv.slice(2);if(!path||!['committer','requester'].includes(role)||!id)throw new Error('Sandbox profile, one role and authorization ID required');
 const profile=sandboxProfile(JSON.parse(readFileSync(path,'utf8'))),store=new SandboxProcurementStore(profile),workflow=new ReplenishmentWorkflow(store),client=new SandboxVaultClient(profile);
 const financial=new FinancialAuthorizations(workflow,{kind:'sandbox-rpc',client,verify:()=>client.verify()});
 try{console.info(JSON.stringify(await financial.executeSandbox(id,role as 'committer'|'requester',process.env)));}finally{financial.close();workflow.close();store.close();}
}
if(require.main===module)void main().catch(()=>{console.error('Authorized Sandbox worker stopped; inspect exact authorization and operation journals. No resend permitted.');process.exitCode=1;});

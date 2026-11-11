import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import dotenv from 'dotenv';
import Database from 'better-sqlite3';
import {PROJECT_ROOT} from '../profiles/storage';
import {testnetPayments} from '../profiles/testnet-payments';
import {roleCredentials} from './role-credentials';
import {assertNoSigningCredentials} from '../operations/local';
import {tenantFinancialMain} from './tenant-financial';
/** One role per process; independent key-free observer. Consumed/uncertain intents never return to the send queue. */
async function main(){
 const [mode,registryPath,activationPath]=process.argv.slice(2);
 if(!['committer','requester','observe'].includes(mode)||!registryPath||!activationPath||process.env.CARECART_TENANT_FINANCIAL_MODE!=='near-testnet')throw new Error('Exact testnet worker mode required');
 if(mode==='observe')assertNoSigningCredentials(process.env);else roleCredentials(mode as 'committer'|'requester');
 const grant=testnetPayments(JSON.parse(readFileSync(activationPath,'utf8')));let stopped=false,running=false;
 const tick=async()=>{if(stopped||running)return;running=true;let db:Database.Database|undefined;
  try{
   db=new Database(grant.profile.databasePath,{readonly:true,fileMustExist:true});
   if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='financial_authorizations'").get())return;
   const rows=mode==='observe'?db.prepare("SELECT id,role FROM financial_authorizations WHERE state='Submitted' ORDER BY created_at LIMIT 5").all():db.prepare("SELECT id,role FROM financial_authorizations WHERE state='Authorized' AND role=? AND expires>? ORDER BY created_at LIMIT 1").all(mode,Date.now());
   db.close();db=undefined;
   for(const row of rows as {id:string;role:string}[]){if(stopped)break;try{console.info(JSON.stringify(await tenantFinancialMain([mode==='observe'?'observe':'execute',registryPath,grant.clinicId,'near-testnet',activationPath,row.id,row.role])));}catch{console.error(JSON.stringify({authorizationId:row.id,role:row.role,status:'HeldOrRequiresReconciliation',resubmitted:false}));}}
  }catch{console.error('Testnet payment queue unavailable; no alternate profile or retry submission');}finally{db?.close();running=false;}
 };
 const timer=setInterval(()=>void tick(),1500);void tick();for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{stopped=true;clearInterval(timer);});
}
if(require.main===module){dotenv.config({path:join(PROJECT_ROOT,'.env')});void main().catch(()=>{console.error('Restricted testnet payment worker refused configuration');process.exitCode=1;});}

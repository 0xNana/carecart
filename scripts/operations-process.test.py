"""Real process-death test around a MOCKED MODEL tool. No network, signing or operational configuration."""
import json,os,shutil,sqlite3,subprocess,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
RUN='11111111-1111-4111-8111-111111111111'
class OperationsCrashTest(unittest.TestCase):
 def test_model_tool_crash_reconstructs_domain_effect_without_replaying_inference(self):
  with tempfile.TemporaryDirectory(prefix='carecart-p3a-process-') as folder:
   root=Path(folder);(root/'backend').mkdir();shutil.copytree(ROOT/'backend/src',root/'backend/src');shutil.copy2(ROOT/'backend/package.json',root/'backend/package.json')
   (root/'web/src/lib').mkdir(parents=True)
   for name in ['operator-proxy.ts','proxy-body.ts']:shutil.copy2(ROOT/'web/src/lib'/name,root/'web/src/lib'/name)
   (root/'backend/node_modules').symlink_to(ROOT/'backend/node_modules',target_is_directory=True)
   preload=root/'backend/no-transport.mjs'
   preload.write_text('''import http from 'node:http';import https from 'node:https';import net from 'node:net';import {Account} from 'near-api-js';import Database from 'better-sqlite3';
const deny=()=>{throw Error('NO_NETWORK_OR_SIGNING');};globalThis.fetch=deny;http.request=deny;https.request=deny;net.Socket.prototype.connect=deny;Account.prototype.callFunctionRaw=deny;
const original=Database.prototype.prepare;Database.prototype.prepare=function(sql){const stmt=original.call(this,sql);
 if(process.env.CRASH_TOOL==='yes'&&sql.startsWith("UPDATE procurement_ai_steps SET state='Completed'")){
  const run=stmt.run.bind(stmt);stmt.run=(...args)=>{if(args[2]==='call-prepare')process.kill(process.pid,'SIGKILL');return run(...args);};}
 return stmt;};''')
   entry=root/'backend/src/operations/process-fixture.ts'
   entry.write_text('''import {appendFileSync} from 'node:fs';import {openLocalOperations} from './local';import {createOperationsApp} from './api';import {proxyOperatorRequest} from '../../../web/src/lib/operator-proxy';
async function main(){const local=openLocalOperations('process-fixture');let count=0;const action=process.argv[2];
const app=createOperationsApp({workflow:local.workflow,origin:'http://localhost:3000',operatorCredential:'operator-'.repeat(5),clock:()=>Date.now()+(action==='reconcile'?120000:0),provider:{
 config:{apiKey:'offline-fixture',model:'private-fixture',baseURL:'https://cloud-api.near.ai/v1'},evidence:'mocked-provider',
 transport:{models:async()=>[{id:'private-fixture',privacy_tier:'confidential',features:['tools','structured_outputs']}],complete:async(messages)=>{
 appendFileSync('model-calls.txt','call\\n');const i=JSON.parse((messages[1] as {content:string}).content).authorizedIdentity;
 const name=++count===1?'get_inventory_forecast':'prepare_replenishment_case';
 return {id:'mock-response',choices:[{message:{role:'assistant',content:null,tool_calls:[{id:count===1?'call-forecast':'call-prepare',type:'function',function:{name,arguments:JSON.stringify(count===1?{itemId:i.itemId}:{itemId:i.itemId,eventId:i.eventId})}}]}}]};}}}});
try{if(action==='web-flow'){
 const bridge:typeof fetch=async(url,init)=>{const u=new URL(String(url));const response=await app.inject({method:(init?.method??'GET') as 'GET'|'POST',url:u.pathname+u.search,
 headers:Object.fromEntries(new Headers(init?.headers)),payload:init?.body as string|undefined});return new Response(response.body,{status:response.statusCode,headers:response.headers as Record<string,string>});};
 const call=(path:string,method='GET',body?:unknown,headers:Record<string,string>={})=>proxyOperatorRequest(new Request('http://localhost:3000/api/operations/'+path,{method,
 headers:{...headers,...(method==='POST'?{origin:'http://localhost:3000','Content-Type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body)}),path.split('/'),'http://127.0.0.1:3002',bridge);
 const login=await call('login','POST',{credential:'operator-'.repeat(5)});const cookie=login.headers.get('set-cookie')!.split(';')[0];
 const session=await (await call('session','GET',undefined,{cookie})).json();const runResponse=await call('runs','POST',{requestId:'33333333-3333-4333-8333-333333333333',mode:'deterministic',target:{kind:'item',itemId:'mn-item-2',eventId:'web-event'}},
 {cookie,'x-csrf-token':session.csrf,'x-operation-nonce':session.nonce});const run=(await runResponse.json()).run;
 const detail=await (await call('cases/'+run.caseId,'GET',undefined,{cookie})).json();console.log(JSON.stringify({status:runResponse.status,run,detail}));return;
 }
 const login=await app.inject({method:'POST',url:'/api/operations/login',headers:{origin:'http://localhost:3000'},payload:{credential:'operator-'.repeat(5)}});
 const cookie=login.headers['set-cookie']!.toString().split(';')[0];const session=(await app.inject({url:'/api/operations/session',headers:{cookie}})).json();
 const headers={cookie,origin:'http://localhost:3000','x-csrf-token':session.csrf,'x-operation-nonce':session.nonce};
 const response=await app.inject({method:'POST',url:action==='start'?'/api/operations/runs':'/api/operations/runs/11111111-1111-4111-8111-111111111111/reconcile',headers,
 payload:action==='start'?{requestId:'11111111-1111-4111-8111-111111111111',mode:'provider',target:{kind:'item',itemId:'mn-item-1',eventId:'process-event'}}:{requestId:'22222222-2222-4222-8222-222222222222'}});
 console.log(JSON.stringify({status:response.statusCode,...response.json(),cases:local.workflow.list()}));
}finally{await app.close();local.close();}}
void main().catch(()=>{console.error('isolated process fixture failed');process.exitCode=1;});''')
   node=shutil.which('node');command=[node,'--import',str(ROOT/'backend/node_modules/tsx/dist/loader.mjs'),'--import',str(preload),str(entry)]
   env={'PATH':os.environ.get('PATH',''),'HOME':folder,'TMPDIR':folder,'TSX_DISABLE_CACHE':'1'}
   first=subprocess.run(command+['start'],cwd=root,env={**env,'CRASH_TOOL':'yes'},capture_output=True,text=True,timeout=30)
   self.assertEqual(first.returncode,-9,first.stderr)
   db_path=root/'backend/data/local-v2/local-operations/process-fixture/state.sqlite'
   with sqlite3.connect(db_path) as db:
    self.assertEqual(db.execute('SELECT state FROM procurement_ai_runs').fetchone()[0],'Running')
    self.assertEqual(db.execute("SELECT state FROM procurement_ai_steps WHERE call_id='call-prepare'").fetchone()[0],'Started')
    self.assertEqual(db.execute('SELECT count(*) FROM v2_procurement_orders').fetchone()[0],1)
   before=(root/'model-calls.txt').read_text();self.assertEqual(before.count('call'),2)
   second=subprocess.run(command+['reconcile'],cwd=root,env=env,capture_output=True,text=True,timeout=30)
   self.assertEqual(second.returncode,0,second.stderr);result=json.loads(second.stdout)
   self.assertEqual(result['status'],200);self.assertEqual(result['run']['state'],'Interrupted');self.assertEqual(result['run']['execution'],'mocked-provider')
   self.assertEqual(result['cases'][0]['state'],'PoDrafted');self.assertEqual(result['cases'][0]['paymentState'],'Unobserved')
   self.assertEqual(result['run']['steps'][1]['state'],'EffectObserved');self.assertEqual((root/'model-calls.txt').read_text(),before)
   self.assertNotIn('NO_NETWORK_OR_SIGNING',first.stderr+second.stderr)
   third=subprocess.run(command+['web-flow'],cwd=root,env=env,capture_output=True,text=True,timeout=30)
   self.assertEqual(third.returncode,0,third.stderr);web=json.loads(third.stdout)
   self.assertEqual(web['status'],200);self.assertEqual(web['run']['state'],'Completed');self.assertEqual(web['run']['execution'],'deterministic')
   self.assertEqual(web['detail']['projection']['cases'][0]['caseId'],web['run']['caseId'])
   self.assertEqual(web['detail']['projection']['cases'][0]['paymentState'],'Unobserved')
   self.assertEqual((root/'model-calls.txt').read_text(),before)

if __name__=='__main__':unittest.main()

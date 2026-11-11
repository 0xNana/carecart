import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,openSync,closeSync,realpathSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
// Local synthetic acceptance only: no hosted identity, wallet or public-chain execution.
// Prepare/build the snapshot with scripts/verify-phase2.sh first.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const testnetPreparation=process.argv[3]==='--testnet';
if(process.argv.length!==(testnetPreparation?4:3))throw Error('Usage: node scripts/mvp-browser-acceptance.mjs /tmp/carecart-phase2-verify.SNAPSHOT [--testnet]');
const snapshot=realpathSync(process.argv[2]);
assert.equal(dirname(snapshot),'/tmp');
assert(snapshot.startsWith('/tmp/carecart-phase2-verify.')&&existsSync(snapshot+'/web/.next/BUILD_ID'),'A source-only production snapshot is required');
const hashes=JSON.parse(readFileSync(snapshot+'/source-hashes.json','utf8'));
for(const [name,hash] of Object.entries(hashes))assert.equal(createHash('sha256').update(readFileSync(resolve(root,name))).digest('hex'),hash,'Snapshot/source mismatch: '+name);
const output=mkdtempSync('/tmp/carecart-mvp-browser-');
const temp=mkdtempSync('/tmp/carecart-p4a-'), workspace='test-'+randomUUID(), children=[];
const node=process.execPath;
assert.equal(process.versions.node,'24.21.0','Use the repository Node pin: nvm use');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function port(){const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
const [webPort,apiPort,debugPort]=await Promise.all([port(),port(),port()]);const origin=`http://127.0.0.1:${webPort}`;
const secret=randomBytes(32).toString('hex');
const env={HOME:process.env.HOME,PATH:dirname(node)+':/usr/bin:/bin',NEXT_TELEMETRY_DISABLED:'1',TSX_DISABLE_CACHE:'1',CARECART_OPERATIONS_MODE:testnetPreparation?'testnet-preparation':'local-synthetic',CARECART_INVENTORY_WORKSPACE:workspace,CARECART_INVENTORY_DATASET:'clinic',CARECART_INVENTORY_WORKER_ENABLED:'true',CARECART_OPERATIONS_ORIGIN:origin,CARECART_OPERATIONS_PORT:String(apiPort),CARECART_OPERATIONS_OPERATOR_SECRET:secret};
if(testnetPreparation){const candidate=JSON.parse(readFileSync(root+'/profiles/testnet.demo.json','utf8'));candidate.profile.databasePath=snapshot+'/backend/data/testnet-v2/'+workspace+'/state.sqlite';const file=temp+'/workspace.json';writeFileSync(file,JSON.stringify(candidate),{mode:0o600});env.CARECART_TESTNET_WORKSPACE_FILE=file;}
function launch(args,cwd,extra={},name='process'){const fd=openSync(temp+'/'+name+'.log','w',0o600);const p=spawn(node,args,{cwd,env:{...env,...extra},stdio:['ignore',fd,fd]});closeSync(fd);children.push(p);return p;}
const api=launch(['--import','tsx','test-support/inventory-runtime-process.ts','api'],snapshot+'/backend',{CARECART_P4A_SPY_FILE:temp+'/api-spies.json'},'api');
const web=launch(['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(webPort)],snapshot+'/web',{CARECART_OPERATIONS_API_URL:`http://127.0.0.1:${apiPort}`},'web');
let worker,ws,cookie='';const report={snapshot,output,environment:testnetPreparation?'testnet CCUSD offline preparation; synthetic suppliers; local auth fixture':'isolated local synthetic clinic; legacy-local auth fixture',hostedSupabaseVerified:false,publicChainExecution:false,actions:[],viewports:[],runtimeErrors:[],consoleErrors:[]};
async function wait(fn,label,tries=100){for(let i=0;i<tries;i++){try{const result=await fn();if(result)return result;}catch{}await pause(200);}throw Error('Timed out: '+label);}
// Stay below the real read limit while the application also performs its normal polling.
let lastRequestAt=0;
async function request(path,body){await pause(Math.max(0,2000-(Date.now()-lastRequestAt)));lastRequestAt=Date.now();const r=await fetch(origin+'/api/operations/'+path,{method:body?'POST':'GET',headers:{Origin:origin,'content-type':'application/json',...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();if(r.status!==200)throw Error('Local HTTP '+path+' '+r.status);return {r,data};}
async function stock(){return (await request('stock')).data;}
async function stop(p){if(!p||p.exitCode!==null||p.signalCode!==null)return;const exited=new Promise((resolve,reject)=>{p.once('exit',resolve);p.once('error',reject);});p.kill('SIGTERM');await Promise.race([exited,pause(3000)]);if(p.exitCode===null&&p.signalCode===null){p.kill('SIGKILL');await exited;}}
try{
 const login=await wait(async()=>{const result=await request('login',{credential:secret});cookie=result.r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');return cookie;},'local login');
 const chrome=spawn(process.env.CARECART_CHROMIUM_BIN??'/snap/bin/chromium',['--headless','--no-sandbox','--disable-gpu','--no-first-run','--no-default-browser-check',`--remote-debugging-port=${debugPort}`,`--user-data-dir=${temp}/chrome`,'about:blank'],{stdio:'ignore'});children.push(chrome);
 const target=await wait(()=>fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`,{method:'PUT'}).then(r=>r.json()),'Chromium');
 ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
 let next=0;const pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}}if(m.method==='Runtime.exceptionThrown')report.runtimeErrors.push(m.params.exceptionDetails.text);if(m.method==='Log.entryAdded'&&m.params.entry.level==='error')report.consoleErrors.push(m.params.entry.text.slice(0,300));};
 const cmd=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const r=await cmd('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error('Browser evaluation failed');return r.result.value;};
 await cmd('Page.enable');await cmd('Runtime.enable');await cmd('Log.enable');await cmd('Network.enable');
 for(const c of cookie.split('; ')){const at=c.indexOf('=');await cmd('Network.setCookie',{name:c.slice(0,at),value:c.slice(at+1),url:origin,httpOnly:true,sameSite:'Lax'});}
 await cmd('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await cmd('Page.navigate',{url:origin+'/app/inventory'});
 await wait(()=>evaluate('document.body.innerText.includes("Save stock activity")'),'inventory form');
 const set=async(label,value)=>{await evaluate(`(()=>{const label=Array.from(document.querySelectorAll('label')).find(l=>l.textContent.trim().startsWith(${JSON.stringify(label)}));const input=label?.querySelector('input,select');if(!input)throw Error('Missing input');const proto=input.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event(input.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);await pause(80);};
 const click=async text=>{await evaluate(`(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b||b.disabled)throw Error('Missing or disabled button');b.click();})()`);await pause(100);};
 async function submit(expected,action){await click('Save stock activity');await wait(async()=>{const data=await stock();return data.items[0].balance.onHand===expected;},action);report.actions.push({action,onHand:expected});await wait(()=>evaluate('Array.from(document.querySelectorAll("button")).some(b=>b.textContent.trim()==="Save stock activity"&&!b.disabled)'),'mutation completion');}
 assert.equal((await stock()).items[0].balance.onHand,30);
 await click('Receive Stock');await set('Quantity','2');await set('Supplier ','mn-supplier-1');await set('Batch','BROWSER-LOT-1');await set('Date received',new Date().toISOString().slice(0,16));await set('Receipt reference','BROWSER-RECEIPT-1');await submit(32,'Receive Stock');
 await click('Dispense Stock');await set('Quantity','8');await set('Destination department','Treatment room');await set('Issue reference','BROWSER-ISSUE-1');await submit(24,'Dispense Stock');
 await click('Record Consumption');await set('Quantity','1');await set('Issue reference','BROWSER-CONSUME-1');await submit(23,'Record Consumption');
 await click('Adjust Stock');await set('Quantity','1');await set('Adjustment reason','Count correction');await submit(24,'Adjust Stock');
 const current=await stock();const session=(await request('session')).data;
 const configured=await fetch(origin+'/api/operations/stock/autonomy',{method:'POST',headers:{Origin:origin,cookie,'content-type':'application/json','x-csrf-token':session.csrf,'x-operation-nonce':session.nonce},body:JSON.stringify({requestId:randomUUID(),config:{...current.config,monitoring:true,automaticCases:true,automaticPreparation:true,intervalSeconds:1}})});assert.equal(configured.status,200);
 await cmd('Page.navigate',{url:'about:blank'});
 worker=launch(['--import','tsx','test-support/inventory-runtime-process.ts','worker'],snapshot+'/backend',{CARECART_P4A_SPY_FILE:temp+'/worker-spies.json'},'worker');
 const proposed=await wait(async()=>{const s=await stock();return s.deliveries?.some(d=>d.productId==='mn-item-1')?s:null;},'headless canonical PO');
 const delivery=proposed.deliveries.find(d=>d.productId==='mn-item-1');assert.equal(proposed.obligations.length,1);assert.equal(proposed.caseStates[0].paymentState,'Unobserved');report.actions.push({action:'headless worker creates one canonical PO',poId:delivery.orderId,paymentState:'Unobserved'});
 await cmd('Page.navigate',{url:origin+'/app/inventory'});await wait(()=>evaluate('document.body.innerText.includes("Save stock activity")'),'reopened inventory');
 await click('Receive Stock');await set('Quantity',String(delivery.expected));await set('Supplier ','mn-supplier-1');await set('Batch','BROWSER-LOT-2');await set('Date received',new Date().toISOString().slice(0,16));await set('Receipt reference','BROWSER-RECEIPT-2');await set('Purchase order reference',delivery.orderId);await submit(24+delivery.expected,'Physical goods receipt');
 await stop(worker);worker=launch(['--import','tsx','test-support/inventory-runtime-process.ts','worker'],snapshot+'/backend',{CARECART_P4A_SPY_FILE:temp+'/worker-restart-spies.json'},'worker-restart');await pause(2500);
 const after=await stock();assert.equal(after.obligations.length,1);assert.equal(after.deliveries[0].orderId,delivery.orderId);assert.equal(after.caseStates[0].paymentState,'Unobserved');report.actions.push({action:'worker restart',orders:1,paymentState:'Unobserved'});
 for(const width of [1440,1280,768,390,360]){await cmd('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<500});await evaluate('document.fonts.ready.then(()=>true)');await pause(500);const overflow=await evaluate('document.documentElement.scrollWidth>innerWidth+1');report.viewports.push({width,overflow});assert.equal(overflow,false,'Horizontal overflow at '+width);await evaluate('document.querySelector("form")?.scrollIntoView({block:"start"})');await pause(100);writeFileSync(output+'/inventory-'+width+'.png',Buffer.from((await cmd('Page.captureScreenshot',{format:'png'})).data,'base64'));}
 report.spies=['api','worker','worker-restart'].map(n=>JSON.parse(readFileSync(temp+'/'+n+'-spies.json','utf8')));for(const spy of report.spies)assert(Object.values(spy).every(n=>n===0));assert.equal(report.runtimeErrors.length,0);assert.equal(report.consoleErrors.length,0);report.status='passed';
}catch(error){report.status='failed';report.error=error.message;process.exitCode=1;}
finally{if(ws?.readyState===WebSocket.OPEN){ws.send(JSON.stringify({id:99999,method:'Browser.close'}));await pause(500);}ws?.close();try{for(const p of [...children].reverse()){try{await stop(p);}catch(error){throw Error('Cannot stop owned child '+p.spawnargs[1]+': '+error.message);}}rmSync(snapshot+(testnetPreparation?'/backend/data/testnet-v2/':'/backend/data/local-v2/local-operations/')+workspace,{recursive:true,force:true});rmSync(temp,{recursive:true,force:true});}catch(error){report.status='failed';report.cleanupError=error.message;process.exitCode=1;}finally{writeFileSync(output+'/browser-report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}}

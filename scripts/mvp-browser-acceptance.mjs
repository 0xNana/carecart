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
const options=new Set(process.argv.slice(3));
if([...options].some(option=>!['--testnet','--headed'].includes(option)))throw Error('Usage: node scripts/mvp-browser-acceptance.mjs /tmp/carecart-phase2-verify.SNAPSHOT [--testnet] [--headed]');
const testnetPreparation=options.has('--testnet');
const headed=options.has('--headed');
const demoPauseMs=headed?Number(process.env.CARECART_DEMO_PAUSE_MS??7000):0;
if(headed&&(!Number.isInteger(demoPauseMs)||demoPauseMs<2000||demoPauseMs>15000))throw Error('CARECART_DEMO_PAUSE_MS must be between 2000 and 15000');
const pauseForRecording=async()=>{if(demoPauseMs)await pause(demoPauseMs);};
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
let worker,ws,intercept,cookie='';const report={snapshot,output,environment:testnetPreparation?'testnet CCUSD offline preparation; synthetic suppliers; local auth fixture':'isolated local synthetic clinic; local workspace auth fixture',recordingMode:headed?'visible Chromium':'headless Chromium',demoStepPauseMs:demoPauseMs,hostedSupabaseVerified:false,publicChainExecution:false,actions:[],viewports:[],runtimeErrors:[],consoleErrors:[],consoleWarnings:[]};
async function wait(fn,label,tries=100){for(let i=0;i<tries;i++){try{const result=await fn();if(result)return result;}catch{}await pause(200);}throw Error('Timed out: '+label);}
// Stay below the real read limit while the application also performs its normal polling.
let lastRequestAt=0;
async function request(path,body){await pause(Math.max(0,2000-(Date.now()-lastRequestAt)));lastRequestAt=Date.now();const r=await fetch(origin+'/api/operations/'+path,{method:body?'POST':'GET',headers:{Origin:origin,'content-type':'application/json',...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();if(r.status!==200)throw Error('Local HTTP '+path+' '+r.status);return {r,data};}
async function stock(){return (await request('stock')).data;}
async function stop(p){if(!p||p.exitCode!==null||p.signalCode!==null)return;const exited=new Promise((resolve,reject)=>{p.once('exit',resolve);p.once('error',reject);});p.kill('SIGTERM');await Promise.race([exited,pause(3000)]);if(p.exitCode===null&&p.signalCode===null){p.kill('SIGKILL');await exited;}}
try{
 const login=await wait(async()=>{const result=await request('login',{credential:secret});cookie=result.r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');return cookie;},'local login');
 const chromeArgs=[...(headed?[]:['--headless']),'--no-sandbox','--disable-gpu','--no-first-run','--no-default-browser-check',`--remote-debugging-port=${debugPort}`,`--user-data-dir=${temp}/chrome`,'about:blank'];
 const chrome=spawn(process.env.CARECART_CHROMIUM_BIN??'/snap/bin/chromium',chromeArgs,{stdio:'ignore'});children.push(chrome);
 const target=await wait(()=>fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`,{method:'PUT'}).then(r=>r.json()),'Chromium');
 ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
 let next=0;const pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}}if(m.method==='Fetch.requestPaused'&&intercept)void intercept(m.params).catch(error=>report.runtimeErrors.push(error.message));if(m.method==='Runtime.exceptionThrown')report.runtimeErrors.push(m.params.exceptionDetails.text);if(m.method==='Log.entryAdded'&&m.params.entry.level==='error')report.consoleErrors.push(m.params.entry.text.slice(0,300));if(m.method==='Log.entryAdded'&&m.params.entry.level==='warning')report.consoleWarnings.push(m.params.entry.text.slice(0,300));};
 const cmd=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const r=await cmd('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error('Browser evaluation failed: '+(r.exceptionDetails.exception?.description??r.exceptionDetails.text).slice(0,220));return r.result.value;};
 await cmd('Page.enable');await cmd('Runtime.enable');await cmd('Log.enable');await cmd('Network.enable');
 for(const c of cookie.split('; ')){const at=c.indexOf('=');await cmd('Network.setCookie',{name:c.slice(0,at),value:c.slice(at+1),url:origin,httpOnly:true,sameSite:'Lax'});}
 report.publicPages=[];
 for(const path of ['/', '/docs/mainnet-readiness']){
  for(const width of [1440,768,390]){
   await cmd('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<500});
   for(const action of ['navigate','reload']){
    const previousDocument=await evaluate('performance.timeOrigin');
    if(action==='navigate')await cmd('Page.navigate',{url:origin+path});else await cmd('Page.reload',{ignoreCache:true});
    await wait(()=>evaluate(`performance.timeOrigin!==${previousDocument}&&location.pathname===${JSON.stringify(path)}&&document.readyState==="complete"&&!!document.querySelector("h1")`),'public page '+path);
    await evaluate('document.fonts.ready.then(()=>true)');await pause(500);
    const metrics=await evaluate(`(()=>{const skip=document.querySelector('a[href="#main-content"]');const logo=document.querySelector('a[aria-label="CareCart home"] svg');return {undefinedClasses:[...document.querySelectorAll('[class]')].filter(e=>e.classList.contains('undefined')).length,skipPosition:skip?getComputedStyle(skip).position:null,skipBottom:skip?.getBoundingClientRect().bottom,logoWidth:logo?.getBoundingClientRect().width,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,title:document.querySelector('h1')?.textContent}})()`);
    report.publicPages.push({path,width,action,...metrics});
    assert.equal(metrics.undefinedClasses,0,'Missing CSS Module exports on '+path);
    assert.equal(metrics.overflow,false,'Public page overflow on '+path);
    if(path==='/'){
     assert.equal(metrics.skipPosition,'absolute','Skip link lost its stylesheet');
     assert(metrics.skipBottom<=0,'Skip link should be offscreen until focused');
     assert(metrics.logoWidth>=16&&metrics.logoWidth<=40,'Brand icon lost its size constraint');
     await cmd('Page.bringToFront');
     await evaluate(`document.querySelector('a[href="#main-content"]').focus({preventScroll:true})`);
     await wait(()=>evaluate(`(()=>{const skip=document.querySelector('a[href="#main-content"]');return skip.matches(':focus')&&skip.getBoundingClientRect().top>=0})()`),'visible keyboard skip link');
     await evaluate(`document.querySelector('a[href="#main-content"]').blur()`);
    }
    writeFileSync(output+'/public-'+(path==='/'?'home':'docs')+'-'+width+'-'+action+'.png',Buffer.from((await cmd('Page.captureScreenshot',{format:'png'})).data,'base64'));
   }
  }
 }
 await cmd('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await cmd('Page.navigate',{url:origin+'/operations'});
 await wait(()=>evaluate('document.body.innerText.includes("Save stock update")'),'inventory form');
 await pauseForRecording();
 const set=async(label,value)=>{await evaluate(`(()=>{const label=Array.from(document.querySelectorAll('label')).find(l=>l.textContent.trim().startsWith(${JSON.stringify(label)}));const input=label?.control??label?.querySelector('input,select');if(!input)throw Error('Missing input');const proto=input.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event(input.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);await pause(80);};
 const click=async text=>{await evaluate(`(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b||b.disabled)throw Error('Missing or disabled button');b.click();})()`);await pause(100);};
 async function submit(expected,action){await click('Save stock update');await wait(async()=>{const data=await stock();return data.items[0].balance.onHand===expected;},action);report.actions.push({action,onHand:expected});await wait(()=>evaluate('Array.from(document.querySelectorAll("button")).some(b=>b.textContent.trim()==="Save stock update"&&!b.disabled)'),'mutation completion');await pauseForRecording();}
 report.appPages=[];
 for(const path of ['/app','/app/inventory','/app/replenishment','/app/suppliers','/app/payments','/app/activity','/app/settings']){
  await cmd('Page.navigate',{url:origin+path});
  await wait(()=>evaluate(`location.pathname===${JSON.stringify(path)}&&!!document.querySelector('#application-main h1')&&!document.body.innerText.includes('Loading stock records…')&&!document.body.innerText.includes('Loading records…')`),'clinic page '+path);
  if(path==='/app')await wait(()=>evaluate('!!document.querySelector(".clinic-overview")'),'clinic overview projection');
  if(path==='/app/inventory')await wait(()=>evaluate('!!document.querySelector(".stock-filters")'),'inventory projection');
  for(const width of [1440,1024,768,390,320]){
   await cmd('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<500});await evaluate('document.fonts.ready.then(()=>true)');await pause(500);
   const metrics=await evaluate(`(()=>{const nav=document.querySelector('nav[aria-label="Quick navigation"]');return {title:document.querySelector('#application-main h1')?.textContent,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,undefinedClasses:[...document.querySelectorAll('[class]')].filter(e=>e.classList.contains('undefined')).length,mobileNavigation:getComputedStyle(nav).display!=='none'}})()`);
   report.appPages.push({path,width,...metrics});assert.equal(metrics.overflow,false,'Clinic page overflow '+path+' at '+width);assert.equal(metrics.undefinedClasses,0,'Missing clinic styles '+path);assert.equal(metrics.mobileNavigation,width<=1024);
   assert.equal(await evaluate(`document.querySelectorAll('nav[aria-label="Application sections"] a[aria-current="page"]').length`),1,'Exactly one active sidebar destination');
   writeFileSync(output+'/clinic-'+(path==='/app'?'overview':path.split('/').at(-1))+'-'+width+'.png',Buffer.from((await cmd('Page.captureScreenshot',{format:'png'})).data,'base64'));
  }
 }
 await cmd('Page.bringToFront');
 await evaluate(`document.querySelector('button[aria-controls="application-navigation"]').click()`);
 await wait(()=>evaluate(`document.querySelector('button[aria-controls="application-navigation"]').getAttribute('aria-expanded')==='true'`),'mobile navigation opens');
 await cmd('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await cmd('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 await wait(()=>evaluate(`document.querySelector('button[aria-controls="application-navigation"]').getAttribute('aria-expanded')==='false'&&document.activeElement?.getAttribute('aria-controls')==='application-navigation'`),'mobile navigation restores keyboard focus');
 // The drawer contains keyboard focus and leaves the records behind it inert.
 const toggleSelector='button[aria-controls="application-navigation"]';
 await evaluate(`document.querySelector('${toggleSelector}').click()`);
 await wait(()=>evaluate(`document.querySelector('#application-navigation').contains(document.activeElement)&&!!document.querySelector('main').closest('[inert]')&&document.body.style.overflow==='hidden'`),'drawer takes focus and isolates background');
 const drawerNodes=`Array.from(document.querySelector('#application-navigation').querySelectorAll('a[href],button:not(:disabled),select,summary')).filter(e=>e.checkVisibility())`;
 await evaluate(`(${drawerNodes}).at(-1).focus()`);
 await cmd('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
 await cmd('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
 assert.equal(await evaluate(`document.activeElement===(${drawerNodes})[0]`),true,'Drawer Tab wraps to first control');
 await cmd('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,modifiers:8});
 await cmd('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,modifiers:8});
 assert.equal(await evaluate(`document.activeElement===(${drawerNodes}).at(-1)`),true,'Drawer Shift+Tab wraps to last control');
 await evaluate(`document.querySelector('summary[aria-label="Account options"]').click()`);
 assert.equal(await evaluate(`document.querySelector('summary[aria-label="Account options"]').parentElement.open`),true);
 await cmd('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 await cmd('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 assert.equal(await evaluate(`!document.querySelector('summary[aria-label="Account options"]').parentElement.open&&document.querySelector('${toggleSelector}').getAttribute('aria-expanded')==='true'&&document.activeElement.matches('summary')`),true,'Escape closes account before the containing drawer');
 for(const width of [320,390,768]){
  await cmd('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<500});await pause(150);
  assert.equal(await evaluate(`document.documentElement.scrollWidth>document.documentElement.clientWidth+1`),false,'Drawer overflow at '+width);
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('nav[aria-label="Application sections"] a')).every(e=>e.getBoundingClientRect().width>=220&&e.getBoundingClientRect().height<=48)`),true,'Drawer destinations stay full width and single line at '+width);
  writeFileSync(output+'/shell-drawer-'+width+'.png',Buffer.from((await cmd('Page.captureScreenshot',{format:'png'})).data,'base64'));
 }
 await evaluate(`document.querySelector('button[aria-label="Close navigation backdrop"]').click()`);
 await wait(()=>evaluate(`document.querySelector('${toggleSelector}').getAttribute('aria-expanded')==='false'&&!document.querySelector('main').closest('[inert]')&&document.body.style.overflow!=='hidden'&&document.activeElement.matches('${toggleSelector}')`),'backdrop restores navigation focus and scroll');
 await evaluate(`document.querySelector('${toggleSelector}').click()`);
 await cmd('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await wait(()=>evaluate(`document.querySelector('${toggleSelector}').getAttribute('aria-expanded')==='false'&&!document.querySelector('main').closest('[inert]')`),'desktop resize releases mobile drawer');
 await evaluate(`document.querySelector('summary[aria-label="Account options"]').click()`);
 writeFileSync(output+'/shell-account-1440.png',Buffer.from((await cmd('Page.captureScreenshot',{format:'png'})).data,'base64'));
 await cmd('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 await cmd('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 assert.equal(await evaluate(`!document.querySelector('summary[aria-label="Account options"]').parentElement.open&&document.activeElement.matches('summary')`),true,'Desktop account Escape returns focus');
 await evaluate(`document.querySelector('summary[aria-label="Account options"]').click();document.querySelector('main').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`);
 assert.equal(await evaluate(`document.querySelector('summary[aria-label="Account options"]').parentElement.open`),false,'Click away closes account');
 report.shellNavigation={activeDestinationUnique:true,drawerFocusContained:true,backgroundInert:true,escapeClosesTopLayer:true,backdropRestoresFocus:true,resizeRestoresContent:true,accountKeyboardAndClickAway:true};

 await cmd('Page.navigate',{url:origin+'/app/inventory#receive'});
 await wait(()=>evaluate('!!document.querySelector("dialog[open]")'),'receive stock deep link');
 await cmd('Page.bringToFront');
 assert(await evaluate('!!document.activeElement?.closest("dialog")'),'Stock editor must take keyboard focus');
 await set('Quantity','1');await set('Supplier','mn-supplier-1');await set('Lot number','UI-LOT-1');await set('Receipt or invoice number','UI-RECEIPT-1');
 await cmd('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await pause(500);writeFileSync(output+'/clinic-receive-1440.png',Buffer.from((await cmd('Page.captureScreenshot',{format:'png'})).data,'base64'));
 await cmd('Emulation.setDeviceMetricsOverride',{width:320,height:1000,deviceScaleFactor:1,mobile:true});await pause(500);
 writeFileSync(output+'/clinic-receive-320.png',Buffer.from((await cmd('Page.captureScreenshot',{format:'png'})).data,'base64'));
 await set('Quantity','0');await click('Save stock update');assert(await evaluate('!document.querySelector("dialog form").checkValidity()'),'Invalid quantity must not submit');assert.equal((await stock()).items[0].balance.onHand,30);await set('Quantity','1');
 await evaluate(`document.querySelector('dialog form>button').focus()`);await cmd('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await cmd('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});assert(await evaluate('!!document.activeElement.closest("dialog")'),'Tab must remain inside the stock dialog');
 await evaluate(`(()=>{const button=document.querySelector('dialog form>button');button.click();button.click();})()`);await wait(async()=>((await stock()).items[0].balance.onHand===31),'clinic receipt saved');await wait(()=>evaluate('!document.querySelector("dialog[open]")'),'editor closes after saved receipt');
 await click('Record Consumption');await wait(()=>evaluate('!!document.querySelector("dialog[open]")'),'usage editor');await set('Quantity','1');await set('Reference (optional)','UI-CONSUME-1');
 await click('Save stock update');await wait(async()=>((await stock()).items[0].balance.onHand===30),'clinic usage saved');await wait(()=>evaluate('!document.querySelector("dialog[open]")'),'editor closes after saved usage');
 await click('Dispense');await wait(()=>evaluate('!!document.querySelector("dialog[open]")'),'dispense stock action');
 await cmd('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await cmd('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await wait(()=>evaluate('!document.querySelector("dialog[open]")'),'Escape dismisses stock editor');
 assert.equal((await stock()).items[0].balance.onHand,30,'Dismissing the editor must not mutate stock');
 await click('Adjust Stock');await wait(()=>evaluate('document.querySelector("dialog select").value!==null'),'adjust editor');assert.equal(await evaluate('Array.from(document.querySelectorAll("dialog select")).some(s=>s.value==="AdjustUp")'),true);await cmd('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await cmd('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 await evaluate(`document.querySelectorAll('.stock-row-action')[1].click()`);await wait(()=>evaluate('!!document.querySelector("dialog[open]")'),'row receive action');assert.equal(await evaluate('document.querySelector("dialog select").value'),(await stock()).items[1].id);await cmd('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await cmd('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 assert.equal((await stock()).items[0].balance.onHand,30);report.clinicStockActions={received:1,consumed:1,finalOnHand:30,escapeWithoutMutation:true,invalidQuantityBlocked:true,duplicateClickRecordedOnce:true,dialogTabContained:true,rowActionSelectsSupply:true};
 // Give the legacy stock acceptance its own real local session/read budget.
 const renewed=await request('login',{credential:secret});cookie=renewed.r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
 for(const c of cookie.split('; ')){const at=c.indexOf('=');await cmd('Network.setCookie',{name:c.slice(0,at),value:c.slice(at+1),url:origin,httpOnly:true,sameSite:'Lax'});}
 await cmd('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await cmd('Page.navigate',{url:origin+'/operations'});await wait(()=>evaluate('document.body.innerText.includes("Save stock update")'),'legacy stock form');
 assert.equal((await stock()).items[0].balance.onHand,30);
 await set('What would you like to record?','Receive');await set('Quantity','2');await set('Supplier','mn-supplier-1');await set('Lot number','BROWSER-LOT-1');await set('Date received',new Date().toISOString().slice(0,16));await set('Receipt or invoice number','BROWSER-RECEIPT-1');await submit(32,'Receive Stock');
 await set('What would you like to record?','Dispense');await set('Quantity','8');await set('Department or purpose','Treatment room');await set('Reference (optional)','BROWSER-ISSUE-1');await submit(24,'Dispense Stock');
 await set('What would you like to record?','Consume');await set('Quantity','1');await set('Reference (optional)','BROWSER-CONSUME-1');await submit(23,'Record Consumption');
 await set('What would you like to record?','AdjustUp');await set('Quantity','1');await set('Adjustment reason','Count correction');await submit(24,'Increase Stock');
 const current=await stock();const session=(await request('session')).data;
 const configured=await fetch(origin+'/api/operations/stock/autonomy',{method:'POST',headers:{Origin:origin,cookie,'content-type':'application/json','x-csrf-token':session.csrf,'x-operation-nonce':session.nonce},body:JSON.stringify({requestId:randomUUID(),config:{...current.config,monitoring:true,automaticCases:true,automaticPreparation:true,intervalSeconds:1}})});assert.equal(configured.status,200);
 await cmd('Page.navigate',{url:'about:blank'});
 worker=launch(['--import','tsx','test-support/inventory-runtime-process.ts','worker'],snapshot+'/backend',{CARECART_P4A_SPY_FILE:temp+'/worker-spies.json'},'worker');
 const proposed=await wait(async()=>{const s=await stock();return s.deliveries?.some(d=>d.productId==='mn-item-1')?s:null;},'headless canonical PO');
 const delivery=proposed.deliveries.find(d=>d.productId==='mn-item-1');assert.equal(proposed.obligations.length,1);assert.equal(proposed.caseStates[0].paymentState,'Unobserved');report.actions.push({action:'headless worker creates one canonical PO',poId:delivery.orderId,paymentState:'Unobserved'});
 await cmd('Page.navigate',{url:origin+'/operations'});await wait(()=>evaluate('document.body.innerText.includes("Save stock update")'),'reopened inventory');
 await pauseForRecording();
 await set('What would you like to record?','Receive');await set('Quantity',String(delivery.expected));await set('Supplier','mn-supplier-1');await set('Lot number','BROWSER-LOT-2');await set('Date received',new Date().toISOString().slice(0,16));await set('Receipt or invoice number','BROWSER-RECEIPT-2');await set('Related order number (optional)',delivery.orderId);await submit(24+delivery.expected,'Physical goods receipt');
 await stop(worker);worker=launch(['--import','tsx','test-support/inventory-runtime-process.ts','worker'],snapshot+'/backend',{CARECART_P4A_SPY_FILE:temp+'/worker-restart-spies.json'},'worker-restart');await pause(2500);
 const after=await stock();assert.equal(after.obligations.length,1);assert.equal(after.deliveries[0].orderId,delivery.orderId);assert.equal(after.caseStates[0].paymentState,'Unobserved');report.actions.push({action:'worker restart',orders:1,paymentState:'Unobserved'});
 await pauseForRecording();
 for(const width of [1440,1280,768,390,360]){await cmd('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<500});if(width<500){await cmd('Page.reload',{ignoreCache:true});await wait(()=>evaluate('document.readyState==="complete"&&document.body.innerText.includes("Save stock update")'),'viewport '+width+' inventory');}await evaluate('document.fonts.ready.then(()=>true)');await pause(500);const metrics=await evaluate('(()=>{const w=document.documentElement.clientWidth;const nodes=Array.from(document.body.querySelectorAll("*"));const leaves=nodes.filter(e=>{const r=e.getBoundingClientRect();return (r.right>w+1||r.left< -1)&&![...e.children].some(c=>{const q=c.getBoundingClientRect();return q.right>w+1||q.left< -1;})}).map(e=>({tag:e.tagName,className:typeof e.className==="string"?e.className:"",text:(e.textContent||"").trim().slice(0,80),left:Math.round(e.getBoundingClientRect().left),right:Math.round(e.getBoundingClientRect().right),width:Math.round(e.getBoundingClientRect().width),scrollWidth:e.scrollWidth,clientWidth:e.clientWidth,overflowX:getComputedStyle(e).overflowX})).slice(0,12);return {innerWidth,layoutWidth:w,visualWidth:visualViewport?.width,visualScale:visualViewport?.scale,viewportMeta:document.querySelector("meta[name=viewport]")?.content,workspaceWidth:document.querySelector(".live-ops")?.getBoundingClientRect().width,overflow:document.documentElement.scrollWidth>w+1,overflowElements:leaves}})()');report.viewports.push({width,...metrics});await evaluate('document.querySelector("form")?.scrollIntoView({block:"start"})');await pause(100);writeFileSync(output+'/inventory-'+width+'.png',Buffer.from((await cmd('Page.captureScreenshot',{format:'png'})).data,'base64'));assert(metrics.layoutWidth<=width&&width-metrics.layoutWidth<=16,'Unexpected scrollbar/layout width at '+width);assert(metrics.visualWidth<=width&&width-metrics.visualWidth<=16,'Visual viewport exceeds width at '+width);assert(metrics.workspaceWidth>0&&metrics.workspaceWidth<=metrics.layoutWidth,'Workspace exceeds viewport at '+width);assert.equal(metrics.overflow,false,'Horizontal overflow at '+width);}
 // Inspect the persisted order after the synthetic worker has actually prepared it.
 const detailLogin=await request('login',{credential:secret});cookie=detailLogin.r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');for(const c of cookie.split('; ')){const at=c.indexOf('=');await cmd('Network.setCookie',{name:c.slice(0,at),value:c.slice(at+1),url:origin,httpOnly:true,sameSite:'Lax'});}
 report.orderReviews=[];
 for(const path of ['/app/replenishment','/app/payments']){
  const paymentPage=path.endsWith('/payments');
  await cmd('Page.navigate',{url:origin+path});await wait(()=>evaluate(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim().startsWith(${JSON.stringify(paymentPage?'View payment':'Review Order')}))`),'saved order in '+path);
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim().startsWith(${JSON.stringify(paymentPage?'View payment':'Review Order')})).click()`);
  await wait(()=>evaluate(`!!document.querySelector('[aria-label="Purchase review"]')&&!document.body.innerText.includes("Loading purchase details…")`),'payment review result');
  if(paymentPage){
   assert.equal(await evaluate(`!!document.querySelector('dialog[open]')&&!!document.activeElement?.closest('dialog')`),true,'Payment detail opens as a focused dialog');
   assert.equal(await evaluate(`document.querySelector('dialog').innerText.includes('Purchase planning help')`),false,'Payment details prioritize finance');
   await evaluate(`Array.from(document.querySelectorAll('dialog summary')).find(e=>e.textContent==='Order and delivery').click()`);
  }
  await wait(()=>evaluate(`!!document.querySelector('[aria-label="Replenishment details"]')`),'persisted replenishment detail');
  for(const width of [1440,768,390]){await cmd('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<500});await evaluate(`document.querySelector('[aria-label="Replenishment details"]').scrollIntoView({block:"start"})`);await pause(300);const result=await evaluate(`({overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,hasSupplierComparison:document.body.innerText.includes("Supplier comparison"),falseConfirmation:document.querySelector('[aria-label="Purchase review"]').innerText.includes("Supplier transfer independently confirmed"),orderLabelHeight:[...document.querySelectorAll('[aria-label="Replenishment details"] dt')].find(e=>e.textContent==="Purchase order")?.getBoundingClientRect().height})`);assert.equal(result.overflow,false);assert.equal(result.hasSupplierComparison,true);assert.equal(result.falseConfirmation,false);assert(result.orderLabelHeight<=24,'Purchase order label must stay readable');report.orderReviews.push({path,width,...result});writeFileSync(output+'/order-'+path.split('/').at(-1)+'-'+width+'.png',Buffer.from((await cmd('Page.captureScreenshot',{format:'png'})).data,'base64'));await evaluate(`document.querySelector('[aria-label="Purchase review"]').scrollIntoView({block:"start"})`);await pause(200);writeFileSync(output+'/payment-review-'+path.split('/').at(-1)+'-'+width+'.png',Buffer.from((await cmd('Page.captureScreenshot',{format:'png'})).data,'base64'));}
  if(paymentPage){
   await cmd('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await cmd('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
   await wait(()=>evaluate(`!document.querySelector('dialog[open]')&&document.activeElement.textContent.trim().startsWith('View payment')`),'Payment dialog Escape restores focus');
   await click('Receipts');assert.equal(await evaluate(`document.body.innerText.includes('No matching purchases')`),true);await click('Clear filters');
   await set('Search payments','unmatched-search');assert.equal(await evaluate(`document.body.innerText.includes('No matching purchases')`),true);await click('Clear filters');
   report.paymentActivity={filters:true,search:true,dialogEscapeAndFocus:true};
  }else{await click('Close order review');assert.equal(await evaluate('document.activeElement.textContent.trim()'),'Review Order');}
 }
 // Browser-only read fixtures exercise the connected-account UI. No wallet is
 // connected, no policy is written and no public-chain request is permitted.
 const fixtureSession={...(await request('session')).data,deployment:'public-testnet',clinicId:'ui-fixture-clinic',clinicRole:'Clinic Admin',permissions:['finance','admin','inventory','procurement']};
 const fundingFixture={profileFingerprint:fixtureSession.profileFingerprint,network:'testnet',asset:{symbol:'CCUSD',decimals:6},accounts:{treasury:'funding.ui-fixture.testnet',vault:'vault.ui-fixture.testnet',token:'token.ui-fixture.testnet'},balances:{treasuryToken:'30000000',vaultToken:'12000000',treasuryNearYocto:'2000000000000000000000000',vaultNearYocto:'1000000000000000000000000',accounted:'12000000',spendable:'10000000',reservedPayment:'2000000',reservedWithdrawal:'0'},policy:{paused:false,acceptedDepositCeiling:'25000000'},observedAt:new Date().toISOString()};
 let fundingMode='valid';
 intercept=async params=>{
  const path=new URL(params.request.url).pathname;let body;
  if(params.request.method!=='GET')throw Error('Connected UI fixture attempted a mutation');
  if(path==='/api/operations/session')body=fixtureSession;
  else if(path==='/api/operations/funding')body=fundingMode==='valid'?fundingFixture:{...fundingFixture,profileFingerprint:'invalid'};
  else if(path==='/api/operations/automatic-purchasing')body={version:0,enabled:false,policy:null};
  else if(path.endsWith('/wallet-bindings'))body={bindings:[{id:'ui-fixture-binding',accountId:'control.ui-fixture.testnet',status:'Verified'}]};
  else if(path.endsWith('/treasuries'))body={configurations:[{environment:'near-testnet',status:'Active',controller:'control.ui-fixture.testnet'}]};
  if(body!==undefined)await cmd('Fetch.fulfillRequest',{requestId:params.requestId,responseCode:200,responseHeaders:[{name:'content-type',value:'application/json'},{name:'cache-control',value:'no-store'}],body:Buffer.from(JSON.stringify(body)).toString('base64')});
  else await cmd('Fetch.continueRequest',{requestId:params.requestId});
 };
 await cmd('Fetch.enable',{patterns:[{urlPattern:origin+'/api/*',requestStage:'Request'}]});
 await cmd('Page.navigate',{url:origin+'/app/payments'});
 await wait(()=>evaluate(`document.body.innerText.includes('10.00')&&Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim().startsWith('Add funds')&&!b.disabled)`),'Connected balance fixture');
 assert.equal(await evaluate(`document.querySelector('#automatic-purchasing-title').closest('details').open`),false,'Purchasing rules start collapsed');
 assert.equal(await evaluate(`document.querySelector('dialog[open]')`),null,'Funding form starts closed');
 report.connectedPaymentsViews=[];
 for(const width of [1440,1024,768,390,320]){
  await cmd('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<500});await evaluate('window.scrollTo({top:0,behavior:"instant"})');await pause(200);
  const overflow=await evaluate(`document.documentElement.scrollWidth>document.documentElement.clientWidth+1`);assert.equal(overflow,false,'Connected payments overflow at '+width);report.connectedPaymentsViews.push({width,overflow});writeFileSync(output+'/payments-connected-fixture-'+width+'.png',Buffer.from((await cmd('Page.captureScreenshot',{format:'png'})).data,'base64'));
 }
 await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim().startsWith('Add funds')).click()`);
 await wait(()=>evaluate(`!!document.querySelector('dialog[open] input')`),'Deposit amount dialog');
 await set('Amount','0');assert.equal(await evaluate(`Array.from(document.querySelectorAll('dialog[open] button')).find(b=>b.textContent==='Review deposit').disabled`),true,'Zero deposit blocked');
 await set('Amount','14');assert.equal(await evaluate(`Array.from(document.querySelectorAll('dialog[open] button')).find(b=>b.textContent==='Review deposit').disabled`),true,'Account deposit limit enforced');
 await set('Amount','1.25');await click('Review deposit');
 assert.equal(await evaluate(`document.querySelector('dialog[open]').innerText.includes('1.25 CCUSD')&&Array.from(document.querySelectorAll('dialog[open] button')).some(b=>b.textContent==='Continue to wallet')`),true,'Exact amount and wallet step reviewed');
 await evaluate(`Array.from(document.querySelectorAll('dialog[open] button')).at(-1).focus()`);await cmd('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await cmd('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});assert.equal(await evaluate(`!!document.activeElement?.closest('dialog[open]')`),true,'Deposit focus stays inside dialog');
 for(const width of [1440,390,320]){await cmd('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<500});await pause(150);assert.equal(await evaluate(`document.querySelector('dialog[open]').scrollWidth>document.querySelector('dialog[open]').clientWidth+1`),false,'Deposit modal overflow');writeFileSync(output+'/deposit-review-fixture-'+width+'.png',Buffer.from((await cmd('Page.captureScreenshot',{format:'png'})).data,'base64'));}
 await cmd('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await cmd('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 await wait(()=>evaluate(`!document.querySelector('dialog[open]')&&document.activeElement.textContent.trim().startsWith('View deposit')`),'Deposit Escape returns focus');
 await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim().startsWith('View deposit')).click()`);
 assert.equal(await evaluate(`document.querySelector('dialog[open]').innerText.includes('1.25 CCUSD')`),true,'Closing retains reviewed deposit');await click('Edit amount');await click('Max');
 assert.equal(await evaluate(`document.querySelector('dialog[open] input').value`),'13','Max amount respects treasury and ceiling');
 await evaluate(`document.querySelector('button[aria-label="Close deposit"]').click()`);
 await evaluate(`document.querySelector('#automatic-purchasing-title').closest('summary').click()`);
 await wait(()=>evaluate(`!!document.querySelector('fieldset input')`),'Purchasing options');
 assert.equal(await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Enable purchasing').disabled`),true,'Purchasing consent and selections required');
 writeFileSync(output+'/purchasing-rules-fixture-320.png',Buffer.from((await cmd('Page.captureScreenshot',{format:'png'})).data,'base64'));
 fundingMode='invalid';await cmd('Page.navigate',{url:origin+'/app/payments'});
 await wait(()=>evaluate(`document.body.innerText.includes('Balance unavailable')`),'Invalid funding response shows recovery');
 assert.equal(await evaluate(`document.querySelector('[aria-label="Payment account balances"]')`),null,'Unavailable balance is not shown as zero');
 assert.equal(await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim().startsWith('Add funds')).disabled`),true,'Funding unavailable without verified snapshot');
 fundingMode='valid';await click('Refresh balances');await wait(()=>evaluate(`!!document.querySelector('[aria-label="Payment account balances"]')`),'Funding refresh recovers');
 await cmd('Page.navigate',{url:'about:blank'});await cmd('Fetch.disable');intercept=null;
 report.depositFlow={source:'browser-only funding UI fixture',noWalletConnection:true,noFinancialMutations:true,zeroAndOverLimitBlocked:true,reviewedAmountPreserved:true,maxRespectsLimits:true,escapeAndFocus:true,unavailableBalanceAndRecovery:true};
 report.spies=['api','worker','worker-restart'].map(n=>JSON.parse(readFileSync(temp+'/'+n+'-spies.json','utf8')));for(const spy of report.spies)assert(Object.values(spy).every(n=>n===0));assert.equal(report.runtimeErrors.length,0);assert.equal(report.consoleErrors.length,0);assert(report.consoleWarnings.every(w=>w.includes('was preloaded using link preload but not used')),'Unexpected browser warning');report.status='passed';
}catch(error){report.status='failed';report.error=error.message;process.exitCode=1;}
finally{if(ws?.readyState===WebSocket.OPEN){ws.send(JSON.stringify({id:99999,method:'Browser.close'}));await pause(500);}ws?.close();try{for(const p of [...children].reverse()){try{await stop(p);}catch(error){throw Error('Cannot stop owned child '+p.spawnargs[1]+': '+error.message);}}rmSync(snapshot+(testnetPreparation?'/backend/data/testnet-v2/':'/backend/data/local-v2/local-operations/')+workspace,{recursive:true,force:true});rmSync(temp,{recursive:true,force:true});}catch(error){report.status='failed';report.cleanupError=error.message;process.exitCode=1;}finally{writeFileSync(output+'/browser-report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}}

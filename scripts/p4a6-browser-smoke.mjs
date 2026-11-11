// Owner-run Playwright fallback. Requires an isolated Supabase test project and an explicitly enabled test clinic.
// Does not write auth cookies, tokens, HAR or browser storage to disk. No wallet/payment action is invoked.
import {mkdir,writeFile,readFile,stat} from 'node:fs/promises';import {pathToFileURL} from 'node:url';
const base=new URL(process.env.CARECART_SMOKE_URL??'http://127.0.0.1:3000');
if(!['http:','https:'].includes(base.protocol)||base.username||base.password)throw Error('Explicit application URL required');
const modulePath=process.env.CARECART_PLAYWRIGHT_MODULE??'/tmp/carecart-browser-tools/node_modules/playwright/index.mjs';
const {chromium}=await import(pathToFileURL(modulePath).href);const browser=await chromium.launch({headless:true});
const output=process.env.CARECART_SMOKE_OUTPUT??'/tmp/carecart-p4a6-browser-evidence';await mkdir(output,{recursive:true});
const email=process.env.CARECART_SMOKE_EMAIL,password=process.env.CARECART_SMOKE_PASSWORD;const mutate=process.env.CARECART_SMOKE_MUTATIONS==='isolated-test-clinic';
const report={browser:'chromium',hostedIdentityVerified:false,signupEmailVerified:false,passwordRecoveryVerified:false,authenticatedClinicVerified:false,clinicSwitchingVerified:false,viewports:[],consoleErrors:[],screenshots:[],financialActionsInvoked:false};
const context=await browser.newContext();const page=await context.newPage();
const privateValues=[password,email,process.env.CARECART_SMOKE_NEW_PASSWORD,process.env.CARECART_SMOKE_CONFIRMATION_URL,process.env.CARECART_SMOKE_RECOVERY_URL].filter(Boolean);
const redact=value=>privateValues.reduce((text,secret)=>text.replaceAll(secret,'[redacted]'),String(value)).replace(/eyJ[A-Za-z0-9_.-]+/g,'[token redacted]').replace(/([?&](?:code|token_hash|access_token|refresh_token)=)[^&\s"'<>]+/g,'$1[redacted]');
page.on('pageerror',error=>report.consoleErrors.push(redact(error.message)));
page.on('console',message=>{if(message.type()==='error')report.consoleErrors.push(redact(message.text()));});
async function screenshot(name){const path=output+'/'+name+'.png';await page.screenshot({path,fullPage:true});report.screenshots.push(path);}
async function overflow(){if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Horizontal overflow at '+new URL(page.url()).pathname);}
// Read delivered one-time links from owner-created mode-600 files after the email is sent.
// This keeps callback tokens out of command arguments, logs and browser storage exports.
async function deliveredCallback(kind){
 const file=process.env['CARECART_SMOKE_'+kind+'_FILE'];
 if(!file)return process.env['CARECART_SMOKE_'+kind+'_URL'];
 console.info(kind==='CONFIRMATION'?'Waiting for the signup callback in the configured private file.':'Waiting for the recovery callback in the configured private file.');
 for(let attempt=0;attempt<600;attempt++){
  try{const info=await stat(file);if(!info.isFile()||info.size>8192||(info.mode&0o077))throw Error('Callback file must be a private mode-600 regular file under 8 KiB');const value=(await readFile(file,'utf8')).trim();if(value){privateValues.push(value);return value;}}
  catch(error){if(error?.code!=='ENOENT')throw error;}
  await new Promise(resolve=>setTimeout(resolve,1000));
 }
 throw Error('Delivered email callback was not supplied within ten minutes');
}

async function callback(value){const u=new URL(value);if(u.origin!==base.origin||u.pathname!=='/auth/callback')throw Error('Provide the same-origin CareCart callback URL from the isolated test email');await page.goto(u.href);}
try{
 for(const kind of ['CONFIRMATION','RECOVERY']){const file=process.env['CARECART_SMOKE_'+kind+'_FILE'];if(file){try{await stat(file);}catch(error){if(error?.code==='ENOENT')continue;throw error;}throw Error('Use an absent callback file for each new email flow; do not replay old links');}}
 for(const width of [1440,768,390]){
  await page.setViewportSize({width,height:1000});await page.goto(base.href);await overflow();await page.keyboard.press('Tab');await screenshot('landing-'+width);
  for(const path of ['/login','/signup','/forgot-password','/reset-password']){await page.goto(new URL(path,base).href);await overflow();await screenshot(path.slice(1)+'-'+width);}
  await page.goto(new URL('/app',base).href);if(!new URL(page.url()).pathname.startsWith('/login'))throw Error('Anonymous app access did not redirect to login');report.viewports.push({width,publicForms:true});
 }
 if(email&&password&&mutate){
  await page.setViewportSize({width:1440,height:1000});
  if(process.env.CARECART_SMOKE_SIGNUP==='true'){
   await page.goto(new URL('/signup',base).href);await page.getByLabel('Email address').fill(email);await page.getByLabel('Password',{exact:true}).fill(password);await page.getByLabel('Confirm password').fill(password);await page.getByRole('button',{name:'Sign up',exact:true}).click();await page.getByRole('status').filter({hasText:'Check your email'}).waitFor();
   const confirmation=await deliveredCallback('CONFIRMATION');if(!confirmation)throw Error('Signup acceptance needs the actually delivered confirmation callback');await callback(confirmation);report.signupEmailVerified=true;
  }
  await page.goto(new URL('/login',base).href);await page.getByLabel('Email address').fill(email);await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL(u=>['/onboarding','/app'].includes(u.pathname));report.hostedIdentityVerified=true;
  await page.goto(new URL('/onboarding',base).href);const clinic='Browser smoke '+Date.now();await page.getByLabel('Clinic name').fill(clinic);await page.getByLabel('Country (two-letter code)').fill('GH');await page.getByLabel('Timezone',{exact:true}).fill('Africa/Accra');await page.getByLabel('Include clearly labeled synthetic opening stock for evaluation').check();await page.getByRole('button',{name:'Create clinic and open Dashboard'}).click();await page.waitForURL(u=>u.pathname==='/app');
  await page.getByText('NEAR Testnet',{exact:true}).waitFor();if(await page.getByRole('link',{name:/Playground/}).count())throw Error('Retired Playground navigation remains');
  for(const width of [1440,768,390]){await page.setViewportSize({width,height:1000});for(const path of ['/app','/app/inventory','/app/replenishment','/app/suppliers','/app/payments','/app/activity','/app/settings']){await page.goto(new URL(path,base).href);await page.waitForLoadState('networkidle');await overflow();await page.keyboard.press('Tab');await screenshot(path.replaceAll('/','-').slice(1)+'-'+width);}}
  await page.goto(new URL('/app/inventory',base).href);await page.getByLabel('Movement',{exact:true}).selectOption('Consume');await page.getByLabel('Quantity',{exact:true}).fill('4');await page.getByRole('button',{name:'Record stock movement',exact:true}).click();
  await page.waitForFunction(async()=>{const r=await fetch('/api/operations/stock');if(!r.ok)return false;const s=await r.json();return s.items[0].balance.onHand===26;});
  await page.goto(new URL('/app/settings',base).href);await page.getByLabel('Inventory monitoring',{exact:true}).check();await page.getByLabel('Automatic replenishment case creation',{exact:true}).check();await page.getByLabel('Automatic PO preparation',{exact:true}).check();await page.getByRole('button',{name:'Save monitoring settings'}).click();
  await page.waitForFunction(async()=>{const r=await fetch('/api/operations/stock');const s=await r.json();return s.caseStates.some(c=>c.state==='PoDrafted');},{},{timeout:45000});
  await page.goto(new URL('/app/payments',base).href);await page.getByRole('button',{name:'Review payment evidence'}).first().click();await page.getByRole('heading',{name:'Canonical financial review'}).waitFor();await screenshot('canonical-review-disabled');
  for(const retired of ['/app/playground','/app/playground/testnet']){await page.goto(new URL(retired,base).href);await page.waitForURL(u=>u.pathname==='/app');}const retired=await page.request.post(new URL('/api/operations/playground/runs',base).href,{data:{requestId:crypto.randomUUID()}});if(retired.status()!==404)throw Error('Retired simulation endpoint is reachable');const stock=await (await page.request.get(new URL('/api/operations/stock',base).href)).json();if(stock.items[0].balance.onHand!==26)throw Error('Retirement changed clinic inventory');report.authenticatedClinicVerified=true;report.playgroundRetirementVerified=true;
  // Two clinics owned by the same verified identity must never share stock or cached case data.
  await page.setViewportSize({width:1440,height:1000});await page.goto(new URL('/onboarding',base).href);
  const secondClinic='Browser empty clinic '+Date.now();await page.getByLabel('Clinic name').fill(secondClinic);await page.getByLabel('Country (two-letter code)').fill('GH');await page.getByRole('button',{name:'Create clinic and open Dashboard'}).click();await page.waitForURL(u=>u.pathname==='/app');
  const emptyStock=await (await page.request.get(new URL('/api/operations/stock',base).href)).json();if(emptyStock.items.some(i=>i.balance.onHand!==0)||emptyStock.obligations.length)throw Error('New empty clinic contains another clinic business state');
  await screenshot('second-empty-clinic');
  await Promise.all([page.waitForEvent('load'),page.getByRole('combobox',{name:'Active clinic',exact:true}).selectOption({label:clinic})]);
  const restoredStock=await (await page.request.get(new URL('/api/operations/stock',base).href)).json();if(restoredStock.tenant.clinicId!==stock.tenant.clinicId||restoredStock.items[0].balance.onHand!==26)throw Error('Clinic switching leaked or lost persisted state');
  report.clinicSwitchingVerified=true;await screenshot('clinic-switch-restored');
  if((process.env.CARECART_SMOKE_RECOVERY_URL||process.env.CARECART_SMOKE_RECOVERY_FILE)&&process.env.CARECART_SMOKE_NEW_PASSWORD){await page.goto(new URL('/forgot-password',base).href);await page.getByLabel('Email address').fill(email);await page.getByRole('button',{name:'Send recovery email'}).click();await callback(await deliveredCallback('RECOVERY'));await page.getByLabel('Password',{exact:true}).fill(process.env.CARECART_SMOKE_NEW_PASSWORD);await page.getByLabel('Confirm password').fill(process.env.CARECART_SMOKE_NEW_PASSWORD);await page.getByRole('button',{name:'Update password'}).click();await page.waitForURL(u=>u.pathname==='/login');report.passwordRecoveryVerified=true;}
  else{await page.getByRole('button',{name:/Sign out/}).click();await page.waitForURL(u=>u.pathname==='/login');}
  if((await page.request.get(new URL('/api/operations/stock',base).href)).status()!==401)throw Error('Logout did not close API access');
 }
 if(report.consoleErrors.length)throw Error('Browser console/page errors detected');
 report.verdict=report.authenticatedClinicVerified?'PASS for exercised browser checks; signup/recovery require their own callback evidence':'CONDITIONAL: read-only routes checked; isolated verified identity/mutation prerequisites not supplied';
}catch(error){report.verdict='FAIL';report.failure=redact(error instanceof Error?error.message:String(error));throw new Error(report.failure);}
finally{await writeFile(output+'/results.json',JSON.stringify(report,null,2));await browser.close();}

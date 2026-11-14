import test from 'node:test';
import assert from 'node:assert/strict';
import {applicationPublicPath,applicationInternalPath,siteOrigins,siteRoute,documentationPublicPath} from '../src/lib/application-routing.ts';
import {identityBackendUrl,safeAuthNext} from '../src/lib/auth-config.ts';

const env={CARECART_PUBLIC_ORIGIN:'https://app.carecart.xyz'};
const origins={app:'https://app.carecart.xyz',site:'https://carecart.xyz',docs:'https://docs.carecart.xyz'};
test('subdomain routing keeps marketing/docs public and maps clean workspace URLs to protected routes',()=>{
 assert.deepEqual(siteOrigins(env),origins);
 for(const path of ['/','/inventory','/payments','/replenishment']){
  const route=siteRoute(new URL(path,origins.app),origins);
  assert.equal(route.kind,'rewrite');assert.equal(route.path,applicationInternalPath(path));
 }
 assert.equal(siteRoute(new URL('/docs',origins.site),origins).url,origins.docs+'/');
 assert.equal(siteRoute(new URL('/_next/static/style.css',origins.app),origins).kind,'next');
 assert.equal(siteRoute(new URL('/api/operations/stock',origins.app),origins).kind,'next');
});
test('old workspace/auth links redirect to the canonical app host with their query intact',()=>{
 for(const [old,next] of [['/app','/'],['/app/inventory','/inventory'],['/login','/login'],['/forgot-password','/forgot-password'],['/auth/callback','/auth/callback']]){
  const route=siteRoute(new URL(old+'?next=%2Fapp%2Finventory',origins.site),origins);
  assert.equal(route.kind,'redirect');const url=new URL(route.url!);assert.equal(url.origin,origins.app);assert.equal(url.pathname,next);assert.equal(url.searchParams.get('next'),'/app/inventory');
 }
 assert.equal(siteRoute(new URL('/app/payments',origins.app),origins).url,origins.app+'/payments');
 assert.equal(siteRoute(new URL('/docs/how-it-works',origins.app),origins).url,origins.docs+'/how-it-works');
});
test('unknown hosts and unsafe return URLs cannot choose a redirect destination',()=>{
 assert.equal(siteRoute(new URL('https://attacker.example/app'),origins).kind,'next');
 for(const value of ['https://attacker.example','//attacker.example','/app//attacker.example','/inventory?next=https://attacker.example','/\\attacker.example'])assert.equal(safeAuthNext(value,'/onboarding',true),'/onboarding');
 assert.equal(safeAuthNext('/app/inventory','/onboarding',true),'/inventory');
 assert.equal(safeAuthNext('/payments','/onboarding',true),'/payments');
 assert.equal(safeAuthNext('/','/onboarding',true),'/');
 assert.equal(applicationPublicPath('/app/inventory#receive',true),'/inventory#receive');
 assert.equal(applicationPublicPath('/app/inventory',false),'/app/inventory');
 assert.equal(applicationInternalPath('/app/inventory'),'/app/inventory');
 assert.equal(siteOrigins({CARECART_PUBLIC_ORIGIN:'http://127.0.0.1:3000'}),null);
});
test('the canonical app can use its explicit sibling API, while foreign and malformed backends remain blocked',()=>{
 assert.equal(identityBackendUrl({...env,CARECART_OPERATIONS_API_URL:'https://api.carecart.xyz'}),'https://api.carecart.xyz');
 for(const url of ['https://api.carecart.xyz.attacker.example','https://evilcarecart.xyz','https://api.carecart.xyz/private','https://user:password@api.carecart.xyz'])assert.throws(()=>identityBackendUrl({...env,CARECART_OPERATIONS_API_URL:url}));
});

test('proxy rewrites retain the protected layout and strip forged routing headers; old form submissions redirect without forwarding credentials',async()=>{
 const {mkdtempSync,readFileSync,writeFileSync,symlinkSync,rmSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');const {join,resolve}=await import('node:path');const {pathToFileURL}=await import('node:url');
 const {default:ts}=await import('typescript');const {NextRequest}=await import('next/server.js');
 const folder=mkdtempSync(join(tmpdir(),'carecart-domain-proxy-'));
 const settings={...env,CARECART_AUTH_MODE:'supabase',SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture_only'};
 const previous=Object.fromEntries(Object.keys(settings).map(key=>[key,process.env[key]]));
 try{
  Object.assign(process.env,settings);symlinkSync(resolve('node_modules'),join(folder,'node_modules'),'dir');
  let source=ts.transpileModule(readFileSync('src/proxy.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
  for(const [from,to] of [['next/server','next/server.js'],['./lib/auth-config',pathToFileURL(resolve('src/lib/auth-config.ts')).href],['./lib/application-routing',pathToFileURL(resolve('src/lib/application-routing.ts')).href]])source=source.replaceAll(`'${from}'`,`'${to}'`);
  writeFileSync(join(folder,'proxy.mjs'),source);const {proxy}=await import(pathToFileURL(join(folder,'proxy.mjs')).href);
  const response=await proxy(new NextRequest('http://localhost:3000/inventory',{headers:{host:'app.carecart.xyz','x-forwarded-proto':'https','x-carecart-application-path':'https://attacker.example'}}));
  assert.equal(new URL(response.headers.get('x-middleware-rewrite')!).pathname,'/app/inventory');
  assert.equal(response.headers.get('x-middleware-request-x-carecart-application-path'),'/inventory');
  assert.equal(response.headers.get('cache-control'),'private, no-store');
  const redirect=await proxy(new NextRequest('https://carecart.xyz/login',{method:'POST',body:'password=fixture'}));
  assert.equal(redirect.status,303);assert.equal(redirect.headers.get('location'),'https://app.carecart.xyz/login');
  const docs=await proxy(new NextRequest('https://docs.carecart.xyz/inventory-guide',{headers:{'x-carecart-application-path':'/payments'}}));
  assert.equal(new URL(docs.headers.get('x-middleware-rewrite')!).pathname,'/docs/inventory-guide');
  assert.equal(docs.headers.get('x-middleware-request-x-carecart-application-path'),null);
  assert.equal(docs.headers.get('set-cookie'),null);
  assert.notEqual(docs.headers.get('cache-control'),'private, no-store');
  const docsSearch=await proxy(new NextRequest('https://docs.carecart.xyz/api/search?query=stock'));
  assert.equal(new URL(docsSearch.headers.get('x-middleware-rewrite')!).pathname,'/docs-search');
  assert.equal(new URL(docsSearch.headers.get('x-middleware-rewrite')!).search,'?query=stock');
  const marketing=await proxy(new NextRequest('https://carecart.xyz/',{headers:{'x-carecart-application-path':'/payments'}}));
  assert.equal(marketing.headers.get('x-middleware-request-x-carecart-application-path'),null);
  // Exercise Supabase's refresh callback: response recreation must retain the rewrite.
  const refreshSource=source.replace(/import \{ createServerClient \} from '@supabase\/ssr';/,"const createServerClient=(_url,_key,options)=>({auth:{getClaims:async()=>options.cookies.setAll([{name:'carecart_supabase',value:'fixture-refreshed',options:{}}])}});");
  assert.notEqual(refreshSource,source);writeFileSync(join(folder,'refresh.mjs'),refreshSource);
  const refresh=await (await import(pathToFileURL(join(folder,'refresh.mjs')).href)).proxy(new NextRequest('https://app.carecart.xyz/payments'));
  assert.equal(new URL(refresh.headers.get('x-middleware-rewrite')!).pathname,'/app/payments');
  assert.match(refresh.headers.get('x-middleware-request-cookie')!,/carecart_supabase=fixture-refreshed/);
  assert.match(refresh.headers.get('set-cookie')!,/HttpOnly/);assert.match(refresh.headers.get('set-cookie')!,/Secure/);assert.doesNotMatch(refresh.headers.get('set-cookie')!,/Domain=/i);
 }finally{for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}rmSync(folder,{recursive:true,force:true});}
});


test('documentation has clean public URLs, permanent legacy targets and its own search endpoint',()=>{
 for(const origin of [origins.site,origins.app,'https://www.carecart.xyz']){
  const result=siteRoute(new URL('/docs/inventory-guide?from=home#receiving',origin),origins);
  assert.equal(result.kind,'redirect');assert.equal(result.url,origins.docs+'/inventory-guide?from=home#receiving');
 }
 for(const [path,internal] of [['/','/docs'],['/inventory-guide','/docs/inventory-guide'],['/api/search?query=stock','/docs-search']]){
  const result=siteRoute(new URL(path,origins.docs),origins);
  assert.equal(result.kind,'rewrite');assert.equal(result.path,internal);assert.equal(result.surface,'docs');
 }
 assert.equal(siteRoute(new URL('/docs/how-it-works',origins.docs),origins).url,origins.docs+'/how-it-works');
 assert.equal(siteRoute(new URL('/docs-search?query=stock',origins.site),origins).url,origins.docs+'/api/search?query=stock');
 assert.equal(siteRoute(new URL('/_next/static/test.js',origins.docs),origins).kind,'next');
 assert.equal(siteRoute(new URL('https://docs.carecart.xyz.attacker.example/inventory-guide'),origins).kind,'next');
});


test('docs links keep local development paths and same-page anchors while cleaning legacy public paths',()=>{
 assert.equal(documentationPublicPath('/docs/quickstart#stock',true),'/quickstart#stock');
 assert.equal(documentationPublicPath('/docs',true),'/');
 assert.equal(documentationPublicPath('/docs?query=stock',true),'/?query=stock');
 for(const value of ['#stock','https://app.carecart.xyz/','/docs-other','/diagrams/carecart-architecture.svg'])assert.equal(documentationPublicPath(value,true),value);
 assert.equal(documentationPublicPath('/docs/quickstart',false),'/docs/quickstart');
});

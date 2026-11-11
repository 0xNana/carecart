#!/usr/bin/env python3
"""Actual Next SSR forms/callback/cookies + backend JWT/JWKS + SQLite tenancy, with a MOCK local HTTPS identity provider."""
import re,copy,hashlib,http.cookiejar,json,os,secrets,shutil,socket,sqlite3,ssl,subprocess,sys,tempfile,time,urllib.error,urllib.parse,urllib.request,uuid
from html.parser import HTMLParser
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];snapshot=Path(sys.argv[1]).resolve();node=shutil.which('node')
assert snapshot.parent==Path('/tmp') and snapshot.name.startswith('carecart-phase2-verify.') and (snapshot/'web/.next/BUILD_ID').is_file()
assert all(hashlib.sha256((ROOT/n).read_bytes()).hexdigest()==h for n,h in json.loads((snapshot/'source-hashes.json').read_text()).items()),'Source/build mismatch'
def port():
 with socket.socket() as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]
def stop(p):
 if p.poll() is None:
  p.terminate()
  try:p.wait(timeout=10)
  except subprocess.TimeoutExpired:p.kill();p.wait(timeout=5)
class Inputs(HTMLParser):
 def __init__(self):super().__init__();self.fields=[]
 def handle_starttag(self,tag,attrs):
  a=dict(attrs)
  if tag=='input' and a.get('type')=='hidden' and a.get('name'):self.fields.append((a['name'],a.get('value','')))
processes=[];logs=[];checks=[]
with tempfile.TemporaryDirectory(prefix='carecart-auth-process-') as folder:
 try:
  tmp=Path(folder);api_port,idp_port,web_port=port(),port(),port();origin=f'http://127.0.0.1:{web_port}';provider=f'https://127.0.0.1:{idp_port}';password='Fixture-'+secrets.token_urlsafe(24);email='fixture-'+uuid.uuid4().hex+'@example.invalid';control=secrets.token_hex(32)
  cert,key=tmp/'cert.pem',tmp/'key.pem';openssl=subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(key),'-out',str(cert),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1,DNS:localhost'],capture_output=True,timeout=30);assert openssl.returncode==0,'Local TLS fixture setup failed'
  preparation=json.loads((ROOT/'profiles/testnet.demo.json').read_text());preparation['profile']['databasePath']=str(snapshot/'backend/data/testnet-v2/auth-template/state.sqlite');profile_file=tmp/'testnet-preparation.json';profile_file.write_text(json.dumps(preparation))
  env={'CARECART_TESTNET_WORKSPACE_FILE':str(profile_file),'PATH':os.environ['PATH'],'HOME':'/tmp','TSX_DISABLE_CACHE':'1','NODE_EXTRA_CA_CERTS':str(cert),'NEXT_TELEMETRY_DISABLED':'1','CARECART_AUTH_MODE':'supabase','SUPABASE_URL':provider,'SUPABASE_PUBLISHABLE_KEY':'sb_publishable_identity_fixture_only','CARECART_PUBLIC_ORIGIN':origin,'CARECART_OPERATIONS_API_URL':f'http://127.0.0.1:{api_port}'}
  def launch(args,cwd,extra=None,stdin=None):
   log=open(tmp/('process-'+str(len(processes))+'.log'),'w+');logs.append(log);p=subprocess.Popen([node,*args],cwd=cwd,env={**env,**(extra or {})},stdin=subprocess.PIPE if stdin else subprocess.DEVNULL,stdout=log,stderr=log);processes.append(p)
   if stdin:p.stdin.write(stdin.encode());p.stdin.close()
   return p
  fixture=launch(['--import','tsx','test-support/auth-tenancy.ts'],snapshot/'backend',stdin=json.dumps({'keyFile':str(key),'certFile':str(cert),'idpPort':idp_port,'apiPort':api_port,'origin':origin,'password':password,'control':control}))
  web=launch(['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',str(web_port)],snapshot/'web')
  tls=ssl.create_default_context(cafile=str(cert));cookies=http.cookiejar.CookieJar();client=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookies),urllib.request.HTTPSHandler(context=tls))
  def request(path,body=None,headers=None,method=None,target=origin,expected=200):
   data=None if body is None else json.dumps(body).encode();req=urllib.request.Request(target+path,data=data,method=method,headers={'Origin':origin,**({'Content-Type':'application/json'} if body is not None else {}),**(headers or {})})
   try:r=client.open(req,timeout=20)
   except urllib.error.HTTPError as e:r=e
   with r:raw=r.read();assert r.status==expected,(path.split('?')[0],r.status,expected,raw[:150] if b'token' not in raw else b'[sensitive response redacted]');return raw
  def wait(check,label):
   for _ in range(120):
    assert fixture.poll() is None and web.poll() is None,'Fixture process exited during '+label
    try:
     if check():return
    except (urllib.error.URLError,ConnectionError):pass
    time.sleep(.25)
   raise AssertionError(label)
  wait(lambda:request('/',expected=200),'Next startup')
  def provider_call(path,body=None):return json.loads(request('/__fixture/'+path,body,{'Authorization':'Bearer '+control},target=provider))
  wait(lambda:provider_call('evidence'),'Identity provider startup')
  def form(path,values):
   html=request(path).decode();parser=Inputs();parser.feed(html);fields=[(n,v) for n,v in parser.fields if n.startswith('$ACTION_')]+list(values.items());assert fields and any(n.startswith('$ACTION_') for n,_ in fields),'SSR server action fields missing'
   boundary='carecart-'+secrets.token_hex(16);payload=(''.join('--'+boundary+'\r\nContent-Disposition: form-data; name="'+n+'"\r\n\r\n'+v+'\r\n' for n,v in fields)+'--'+boundary+'--\r\n').encode()
   req=urllib.request.Request(origin+path,data=payload,headers={'Origin':origin,'Content-Type':'multipart/form-data; boundary='+boundary})
   try:r=client.open(req,timeout=25)
   except urllib.error.HTTPError as e:r=e
   with r:raw=r.read().decode();assert r.status==200,(path,r.status);return r.url,raw
  for guarded,destination in [('/app','/login'),('/operations','/app')]:
   with client.open(origin+guarded) as r:
    anonymous=r.read().decode()
    assert destination in r.url or re.search(r'(NEXT_REDIRECT[^<]*?'+re.escape(destination)+r'|http-equiv="refresh"[^>]*?'+re.escape(destination)+')',anonymous),'Anonymous protected-route redirect missing'
  request('/api/operations/stock',expected=401)
  for retired in ['/api/operations/playground','/api/operations/playground/runs']:request(retired,{} if retired.endswith('runs') else None,expected=404)
  for path in ['/login','/signup','/forgot-password','/reset-password','/onboarding']:assert request(path)
  url,html=form('/signup',{'mode':'signup','next':'/onboarding','email':email,'password':password,'confirmation':password});assert 'Check your email' in html,('SSR signup did not require verification',re.findall(r'<p[^>]*role="(?:alert|status)"[^>]*>(.*?)</p>',html));checks.append('signup_requires_verified_email')
  url,html=form('/login',{'mode':'login','next':'/onboarding','email':email,'password':password});assert 'Sign-in failed' in html;checks.append('unverified_identity_rejected')
  verification=provider_call('verify',{'email':email,'type':'signup'});request('/auth/callback?token_hash='+verification['token_hash']+'&type=signup&next='+urllib.parse.quote('//evil.example'));assert any(c.name=='carecart_identity' and c.has_nonstandard_attr('HttpOnly') for c in cookies);checks.extend(['callback_redirect_is_allowlisted','http_only_identity_cookie'])
  ctx=json.loads(request('/api/identity/context'));assert ctx['email']==email and ctx['clinics']==[]
  def mutate(path,body):
   ctx=json.loads(request('/api/identity/context'));return json.loads(request('/api/identity/'+path,{'requestId':str(uuid.uuid4()),**body},{'x-csrf-token':ctx['csrf'],'x-operation-nonce':ctx['nonce']}))
  clinic=mutate('clinics',{'clinic':{'name':'SSR auth fixture','country':'GH','timezone':'Africa/Accra','storeroom':'Main','syntheticDemo':True}})['clinic'];mutate('active-clinic',{'clinicId':clinic['id']});checks.append('verified_clinic_onboarding')
  for path in ['/app','/app/inventory','/app/replenishment','/app/payments','/app/playground','/app/settings']:assert request(path)
  stock=json.loads(request('/api/operations/stock'));assert stock['tenant']['clinicId']==clinic['id'] and stock['items'][0]['balance']['onHand']==30;assert all(i['clinicId']==clinic['id'] for i in stock['items']);checks.append('active_clinic_inventory_scope')
  session=json.loads(request('/api/operations/session'));assert session['userId']==ctx['userId'] and session['clinicRole']=='Clinic Admin'
  request('/api/operations/stock/movements',{'requestId':str(uuid.uuid4()),'movement':{'id':'SSR-consumption','productId':'mn-item-1','kind':'Consume','quantity':4,'unit':'base','source':'manual'}},{'x-csrf-token':session['csrf'],'x-operation-nonce':session['nonce']});assert json.loads(request('/api/operations/stock'))['items'][0]['balance']['onHand']==26;checks.append('identity_bound_stock_mutation')
  session=json.loads(request('/api/operations/session'));request('/api/operations/stock/movements',{'requestId':str(uuid.uuid4()),'movement':{'id':'CSRF-forged','productId':'mn-item-1','kind':'Consume','quantity':4,'unit':'base','source':'manual'}},{'x-csrf-token':'wrong','x-operation-nonce':session['nonce']},expected=403);checks.append('csrf_rejected')
  second=mutate('clinics',{'clinic':{'name':'Empty second clinic','country':'GH','timezone':'Africa/Accra','storeroom':'Secondary','syntheticDemo':False}})['clinic'];mutate('active-clinic',{'clinicId':second['id']});assert json.loads(request('/api/operations/stock'))['items'][0]['balance']['onHand']==0;mutate('active-clinic',{'clinicId':clinic['id']});assert json.loads(request('/api/operations/stock'))['items'][0]['balance']['onHand']==26;checks.append('same_identity_switches_isolated_clinics')
  # Rotate real signing keys and then sign in again; no production identity or remote credentials.
  provider_call('rotate',{});mutate('logout',{});request('/api/identity/context',expected=401);checks.append('logout_revokes_access')
  time.sleep(5.1);url,html=form('/login',{'mode':'login','next':'/onboarding','email':email,'password':password});assert '/onboarding' in url;mutate('active-clinic',{'clinicId':clinic['id']});assert json.loads(request('/api/operations/stock'))['items'][0]['balance']['onHand']==26;checks.append('jwks_rotation_and_login_restart')
  old_cookies=http.cookiejar.CookieJar();[old_cookies.set_cookie(copy.copy(c)) for c in cookies];old_client=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(old_cookies),urllib.request.HTTPSHandler(context=tls))
  url,html=form('/forgot-password',{'mode':'forgot-password','email':email,'next':'/onboarding'});assert 'recovery email' in html;recovery=provider_call('verify',{'email':email,'type':'recovery'});request('/auth/callback?token_hash='+recovery['token_hash']+'&type=recovery&next=/reset-password')
  changed='Changed-'+secrets.token_urlsafe(24);url,html=form('/reset-password',{'mode':'reset-password','password':changed,'confirmation':changed,'next':'/onboarding'});assert '/login' in url;request('/api/identity/context',expected=401);checks.append('recovery_changes_password_and_revokes_sessions')
  try:old_client.open(origin+'/api/operations/stock',timeout=15);raise AssertionError('Old CareCart session survived recovery')
  except urllib.error.HTTPError as e:assert e.code==401
  checks.append('recovery_revokes_other_application_session')
  url,html=form('/login',{'mode':'login','email':email,'password':password,'next':'/onboarding'});assert 'Sign-in failed' in html;url,html=form('/login',{'mode':'login','email':email,'password':changed,'next':'/onboarding'});assert '/onboarding' in url;checks.append('old_password_rejected_new_password_accepted')
  mutate('active-clinic',{'clinicId':clinic['id']});session=json.loads(request('/api/operations/session'));stock=json.loads(request('/api/operations/stock'));request('/api/operations/stock/autonomy',{'requestId':str(uuid.uuid4()),'config':{**stock['config'],'monitoring':True,'automaticCases':True,'automaticPreparation':True,'intervalSeconds':1}},{'x-csrf-token':session['csrf'],'x-operation-nonce':session['nonce']})
  worker=launch(['--import','tsx','src/tenancy/worker.ts'],snapshot/'backend',{'CARECART_INVENTORY_WORKER_ENABLED':'true'})
  for _ in range(40):
   stock=json.loads(request('/api/operations/stock'))
   if stock['caseStates'] and stock['caseStates'][0]['state']=='PoDrafted':break
   time.sleep(.5)
  assert len(stock['obligations'])==1 and stock['caseStates'][0]['state']=='PoDrafted';case_id=stock['obligations'][0]['caseId'];checks.append('tenant_headless_worker_prepares_one_case')
  stop(worker);worker=launch(['--import','tsx','src/tenancy/worker.ts'],snapshot/'backend',{'CARECART_INVENTORY_WORKER_ENABLED':'true'});time.sleep(1.2);assert len(json.loads(request('/api/operations/stock'))['obligations'])==1
  runtime=snapshot/'backend/data/testnet-v2/clinics'/clinic['id']/'state.sqlite';stop(web)
  with sqlite3.connect(runtime) as db:before=db.execute('SELECT count(*) FROM inventory_monitor_runs').fetchone()[0]
  for _ in range(20):
   time.sleep(.3)
   with sqlite3.connect(runtime) as db:
    if db.execute('SELECT count(*) FROM inventory_monitor_runs').fetchone()[0]>before:break
  with sqlite3.connect(runtime) as db:
   assert db.execute('SELECT count(*) FROM inventory_monitor_runs').fetchone()[0]>before;assert db.execute('SELECT count(*) FROM inventory_obligations').fetchone()[0]==1
  checks.extend(['tenant_worker_restart_no_duplicate','tenant_worker_runs_without_web'])
  evidence=provider_call('evidence');assert evidence['adapter']==evidence['signing']==evidence['externalSubmission']==0
  report={'status':'passed','identityProvider':'MOCK local HTTPS Supabase-compatible fixture','realHostedSupabaseVerified':False,'realSSRForms':True,'realJWTSignatures':True,'realBrowser':False,'checks':checks,'clinicId':clinic['id'],'financialSpies':{k:evidence[k] for k in ['adapter','signing','externalSubmission']},'jwksReads':evidence['jwksReads'],'snapshot':str(snapshot)}
  Path('/tmp/carecart-p4a6-auth-process.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
 except Exception:
  for log in logs:
   log.flush();log.seek(0);content=log.read();content=content.replace(password,'[redacted]').replace(control,'[redacted]');print(content[-3500:],file=sys.stderr)
  raise
 finally:
  for p in reversed(processes):stop(p)
  for log in logs:log.close()

#!/usr/bin/env python3
"""Actual autonomous clinic -> canonical PO -> isolated P3B financial fixture over HTTP/Next, never public-chain execution."""
import hashlib,http.cookiejar,json,os,secrets,shutil,socket,subprocess,sys,tempfile,time,urllib.error,urllib.request,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];snapshot=Path(sys.argv[1]).resolve();node=shutil.which('node');assert snapshot.parent==Path('/tmp') and snapshot.name.startswith('carecart-phase2-verify.') and (snapshot/'web/.next/BUILD_ID').is_file()
assert all(hashlib.sha256((ROOT/n).read_bytes()).hexdigest()==h for n,h in json.loads((snapshot/'source-hashes.json').read_text()).items())
def port():
 with socket.socket() as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]
processes=[];trace=[];logs=[]
def stop(p):
 if p.poll() is None:
  p.terminate()
  try:p.wait(timeout=10)
  except subprocess.TimeoutExpired:p.kill();p.wait(timeout=5)
def event(name,**data):trace.append({'at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'event':name,**data})
with tempfile.TemporaryDirectory(prefix='carecart-p4b-') as folder:
 try:
  api_port,web_port=port(),port();origin=f'http://127.0.0.1:{web_port}';workspace='p4b-process-'+uuid.uuid4().hex;secret,viewer=secrets.token_hex(32),secrets.token_hex(32);spy=Path(folder)/'financial-spies.json'
  env={'PATH':os.environ['PATH'],'HOME':'/tmp','TSX_DISABLE_CACHE':'1','CARECART_OPERATIONS_MODE':'local-synthetic','CARECART_FINANCIAL_MODE':'offline-fixture','CARECART_INVENTORY_WORKSPACE':workspace,'CARECART_INVENTORY_DATASET':'clinic','CARECART_INVENTORY_WORKER_ENABLED':'true','CARECART_OPERATIONS_ORIGIN':origin,'CARECART_OPERATIONS_PORT':str(api_port),'CARECART_OPERATIONS_OPERATOR_SECRET':secret,'CARECART_OPERATIONS_VIEWER_SECRET':viewer,'CARECART_P4B_SPY_FILE':str(spy),'NEXT_TELEMETRY_DISABLED':'1'}
  def launch(args):
   log=open(Path(folder)/('process-'+str(len(processes))+'.log'),'w+');logs.append(log);p=subprocess.Popen([node,'--import','tsx',*args],cwd=snapshot/'backend',env=env,stdout=log,stderr=log);processes.append(p);return p
  api=launch(['test-support/financial-http.ts']);worker=launch(['src/ops/inventory.ts','worker'])
  web=subprocess.Popen([node,'node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',str(web_port)],cwd=snapshot/'web',env={**env,'CARECART_OPERATIONS_API_URL':f'http://127.0.0.1:{api_port}'},stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);processes.append(web)
  jar=http.cookiejar.CookieJar();client=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
  def request(path,body=None,headers=None,expected=200):
   req=urllib.request.Request(origin+'/api/operations/'+path,data=None if body is None else json.dumps(body).encode(),headers={'Origin':origin,'Content-Type':'application/json',**(headers or {})})
   try:r=client.open(req,timeout=15)
   except urllib.error.HTTPError as e:r=e
   with r:raw=r.read();assert r.status==expected,(path,r.status,expected,raw[:250]);return json.loads(raw)
  def wait(check,label):
   for _ in range(80):
    if api.poll() is not None or worker.poll() is not None:raise AssertionError('Runtime process exited during '+label)
    try:
     value=check()
     if value:return value
    except (urllib.error.URLError,ConnectionError):pass
    time.sleep(.75)
   raise AssertionError(label)
  def ready():
   try:return request('login',{'credential':secret})
   except AssertionError as e:
    if isinstance(e.args[0],tuple) and e.args[0][:2]==('login',503):return None
    raise
  wait(ready,'startup')
  def mutate(path,body,expected=200):s=request('session');return request(path,body,{'x-csrf-token':s['csrf'],'x-operation-nonce':s['nonce']},expected)
  routes=['/','/app','/app/inventory','/app/replenishment','/app/payments','/app/playground','/operations']
  for path in routes:
   with client.open(origin+path,timeout=15) as r:html=r.read().decode();assert r.status==200;assert 'CareCart' in html
  stock=request('stock');mutate('stock/autonomy',{'requestId':str(uuid.uuid4()),'config':{**stock['config'],'monitoring':True,'automaticCases':True,'automaticPreparation':True,'intervalSeconds':1}})
  mutate('stock/movements',{'requestId':str(uuid.uuid4()),'movement':{'id':'financial-consumption','productId':'mn-item-1','kind':'Consume','quantity':4,'unit':'base','source':'manual'}})
  stock=wait(lambda:(s if (s:=request('stock'))['caseStates'] and s['caseStates'][0]['state']=='PoDrafted' else None),'automatic proposal');case_id=stock['obligations'][0]['caseId'];before=stock['items'][0]['balance']['onHand'];event('AutonomousProposal',caseId=case_id,onHand=before)
  for role in ['committer','requester']:
   review=request('cases/'+case_id+'/financial-review')['review'];assert review['publicSigningEnabled'] is False and review['execution']=='mocked-rpc' and review['requiredAuthority']==role
   authorization=mutate('cases/'+case_id+'/financial-authorizations',{'requestId':str(uuid.uuid4()),'role':role,'expectedRevision':review['revision'],'expectedHash':review['canonicalHash']})['authorization'];event('Authorized',role=role,id=authorization['id'],canonicalHash=review['canonicalHash'])
   if role=='requester':
    # Rejected status injection cannot claim a settled payment or trigger a submission.
    mutate('financial-authorizations/'+authorization['id']+'/simulate',{'requestId':str(uuid.uuid4()),'state':'Paid'},400)
   result=mutate('financial-authorizations/'+authorization['id']+'/simulate',{'requestId':str(uuid.uuid4())});assert result['authorization']['state']=='Submitted'
   unchanged=request('cases/'+case_id)['projection']['cases'][0];assert unchanged['state']==('PoDrafted' if role=='committer' else 'PoCommitted')
   # Replaying a completed simulation is idempotent and creates no second operation.
   mutate('financial-authorizations/'+authorization['id']+'/simulate',{'requestId':str(uuid.uuid4())})
   mutate('financial-authorizations/'+authorization['id']+'/reconcile',{'requestId':str(uuid.uuid4())});event('ObservedRoleEffect',role=role,state=request('cases/'+case_id)['projection']['cases'][0]['state'])
  c=request('cases/'+case_id)['projection']['cases'][0];assert c['paymentState']=='Dispatching' and request('stock')['items'][0]['balance']['onHand']==before
  callback=subprocess.run([node,'--import','tsx','test-support/financial-callback.ts',workspace,c['poId']],cwd=snapshot/'backend',env=env,capture_output=True,timeout=30);assert callback.returncode==0,callback.stderr
  mutate('financial-authorizations/'+authorization['id']+'/reconcile',{'requestId':str(uuid.uuid4())});c=request('cases/'+case_id)['projection']['cases'][0];assert c['paymentState']=='Paid' and c['evidenceKind']=='mocked-rpc';assert request('stock')['items'][0]['balance']['onHand']==before;event('MockedCallbackObserved',state=c['state'],onHand=before,physicalStockUnchanged=True)
  mutate('stock/movements',{'requestId':str(uuid.uuid4()),'movement':{'id':'financial-goods-receipt','productId':'mn-item-1','kind':'Receive','quantity':30,'unit':'base','source':'manual','orderId':c['poId'],'receiptReference':'OFFLINE-DELIVERY-LINE-1'}});assert request('stock')['items'][0]['balance']['onHand']==before+30;event('PhysicalReceipt',onHand=before+30)
  mutate('playground/runs',{'requestId':str(uuid.uuid4())},404);assert request('stock')['items'][0]['balance']['onHand']==before+30
  first_counts=json.loads(spy.read_text());assert first_counts=={'adapter':0,'signing':0,'externalSubmission':0}
  stop(api);api=launch(['test-support/financial-http.ts']);wait(ready,'restart');after=request('cases/'+case_id)['projection']['cases'][0];assert after['poHash']==c['poHash'] and after['paymentState']=='Paid' and len(after['domain']['operations'])==2
  event('RestartRecovered',caseId=case_id,poId=c['poId'],poHash=c['poHash'],operations=2)
  for p in reversed(processes):stop(p)
  counts=json.loads(spy.read_text());assert counts=={'adapter':0,'signing':0,'externalSubmission':0}
  report={'status':'passed','execution':'offline-fixture-real-HTTP-Next-SQLite','browserRuntime':False,'publicChainExecution':False,'routes':routes,'trace':trace,'financialSpies':counts,'beforeRestartSpies':first_counts,'publicSettlementVerified':False,'retiredPlaygroundHasNoEffect':True,'snapshot':str(snapshot)}
  Path('/tmp/carecart-p4b-offline-trace.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
 except Exception:
  for log in logs:log.flush();log.seek(0);print(log.read()[-3500:],file=sys.stderr)
  raise
 finally:
  for p in reversed(processes):stop(p)
  for log in logs:log.close()

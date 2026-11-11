#!/usr/bin/env python3
"""Actual clinic HTTP/Next/SQLite and headless worker, with financial traps; temporary source-only snapshot."""
import hashlib,http.cookiejar,json,os,secrets,shutil,socket,sqlite3,subprocess,sys,tempfile,time,urllib.error,urllib.request,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
snapshot=Path(sys.argv[1]).resolve()
assert snapshot.parent==Path('/tmp') and snapshot.name.startswith('carecart-phase2-verify.')
assert (snapshot/'web/.next/BUILD_ID').is_file()
assert all(hashlib.sha256((ROOT/p).read_bytes()).hexdigest()==h for p,h in json.loads((snapshot/'source-hashes.json').read_text()).items())
node=shutil.which('node');processes=[];trace=[];logs=[]
def port():
 with socket.socket() as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]
def event(action,**values):trace.append({'at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'action':action,**values})
def stop(p):
 if p.poll() is None:
  p.terminate()
  try:p.wait(timeout=10)
  except subprocess.TimeoutExpired:p.kill();p.wait(timeout=5)
with tempfile.TemporaryDirectory(prefix='carecart-p4a-') as folder:
 try:
  web_port,api_port=port(),port();origin=f'http://127.0.0.1:{web_port}';service=origin
  name='p4a-acceptance-'+uuid.uuid4().hex
  credential,viewer=secrets.token_hex(32),secrets.token_hex(32)
  env={'PATH':os.environ['PATH'],'HOME':'/tmp','TSX_DISABLE_CACHE':'1','NEXT_TELEMETRY_DISABLED':'1','CARECART_OPERATIONS_MODE':'local-synthetic','CARECART_INVENTORY_WORKSPACE':name,'CARECART_INVENTORY_DATASET':'clinic','CARECART_INVENTORY_WORKER_ENABLED':'true','CARECART_OPERATIONS_ORIGIN':origin,'CARECART_OPERATIONS_PORT':str(api_port),'CARECART_OPERATIONS_OPERATOR_SECRET':credential,'CARECART_OPERATIONS_VIEWER_SECRET':viewer}
  def launch(mode):
   spy=Path(folder)/(mode+'-'+str(len(processes))+'.json');log=open(Path(folder)/('process-'+str(len(processes))+'.log'),'w+');logs.append(log)
   p=subprocess.Popen([node,'--import','tsx','test-support/inventory-runtime-process.ts',mode],cwd=snapshot/'backend',env={**env,'CARECART_P4A_SPY_FILE':str(spy)},stdout=log,stderr=log);processes.append(p);return p
  api=launch('api');worker=launch('worker')
  web=subprocess.Popen([node,'node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',str(web_port)],cwd=snapshot/'web',env={**env,'CARECART_OPERATIONS_API_URL':f'http://127.0.0.1:{api_port}'},stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);processes.append(web)
  cookies=http.cookiejar.CookieJar();client=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookies))
  def request(path,body=None,headers=None,expected=200):
   req=urllib.request.Request(service+'/api/operations/'+path,data=None if body is None else json.dumps(body).encode(),headers={'Origin':origin,'Content-Type':'application/json',**(headers or {})})
   try:r=client.open(req,timeout=15)
   except urllib.error.HTTPError as e:r=e
   with r:
    raw=r.read();assert r.status==expected,(path,r.status,expected,raw[:300]);return json.loads(raw)
  def wait(check,label):
   for _ in range(100):
    if api.poll() is not None or worker.poll() is not None:raise AssertionError('Inventory service process exited during '+label)
    try:
     value=check()
     if value:return value
    except (urllib.error.URLError,ConnectionError):pass
    time.sleep(.75)
   raise AssertionError(label)
  def login_ready():
   try:return request('login',{'credential':credential})
   except AssertionError as e:
    # Next may listen before its upstream service. Retry only this startup 503.
    if e.args and isinstance(e.args[0],tuple) and e.args[0][:2]==('login',503):return None
    raise
  wait(login_ready,'startup')
  def mutate(path,body,expected=200):
   s=request('session');return request(path,body,{'x-csrf-token':s['csrf'],'x-operation-nonce':s['nonce']},expected)
  stock=request('stock');assert len(stock['items'])==6 and stock['items'][0]['balance']['onHand']==30
  assert not stock['config']['monitoring'];assert len(request('catalog')['suppliers'])==3
  for path in ['/app','/app/inventory','/app/replenishment','/app/activity','/app/settings','/app/playground']:
   with client.open(origin+path,timeout=15) as r:assert r.status==200
  event('AuthenticatedDashboardHTTP',supplies=6,suppliers=3,workspace=name,browserRuntime=False)
  mutate('stock/autonomy',{'requestId':str(uuid.uuid4()),'config':{**stock['config'],'monitoring':True,'automaticCases':True,'automaticPreparation':True,'intervalSeconds':1}})
  def move(identifier,kind,quantity,**extra):return mutate('stock/movements',{'requestId':str(uuid.uuid4()),'movement':{'id':identifier,'productId':'mn-item-1','kind':kind,'quantity':quantity,'unit':'base','source':'manual',**extra}})
  move('acceptance-consume','Consume',4);assert request('stock')['items'][0]['balance']['onHand']==26;event('ConsumptionPersisted',movementId='acceptance-consume',before=30,after=26,reorderPoint=28)
  stock=wait(lambda:(s if (s:=request('stock'))['caseStates'] and s['caseStates'][0]['state']=='PoDrafted' else None),'automatic PO preparation')
  c=request('cases/'+stock['obligations'][0]['caseId'])['projection']['cases'][0];assert c['nextAction']=='AuthorizeCommitment' and c['paymentState']=='Unobserved'
  assert c['domain']['quote']['quantity']==30 and len(c['inventory']['quotes'])==3
  assert stock['items'][0]['balance']['incoming']==0
  event('AutonomousCanonicalProposal',caseId=c['caseId'],poId=c['poId'],poHash=c['poHash'],supplier=c['domain']['quote']['supplierId'],quantity=30,proposedAmountAtomic=c['domain']['purchaseOrder']['canonical']['amount'],nextAction=c['nextAction'],paymentState=c['paymentState'])
  before=(len(stock['obligations']),c['poId'],c['poHash']);fingerprint=stock['profileFingerprint']
  request('playground',expected=404)
  mutate('playground/runs',{'requestId':str(uuid.uuid4())},404)
  assert request('stock')['profileFingerprint']==fingerprint and request('stock')['items'][0]['balance']['onHand']==26
  event('RetiredPlaygroundHasNoEffects',operationalOnHand=26)
  stop(web);service=f'http://127.0.0.1:{api_port}';old={r['id'] for r in request('stock')['runs']};move('without-browser','Consume',1)
  wait(lambda:any(r['id'] not in old and r['state']=='Completed' for r in request('stock')['runs']),'worker without web')
  event('WorkerContinuedWithoutWebServer',onHand=25)
  stop(worker);worker=launch('worker');time.sleep(1.3)
  stock=request('stock');again=request('cases/'+c['caseId'])['projection']['cases'][0];assert (len(stock['obligations']),again['poId'],again['poHash'])==before;event('WorkerRestartNoDuplicate',caseId=c['caseId'],poId=c['poId'])
  move('acceptance-receipt','Receive',10,orderId=c['poId'],receiptReference='DELIVERY-1-LINE-1');assert request('stock')['items'][0]['balance']['onHand']==35
  duplicate={'requestId':str(uuid.uuid4()),'movement':{'id':'duplicate-receipt','productId':'mn-item-1','kind':'Receive','quantity':10,'unit':'base','source':'manual','orderId':c['poId'],'receiptReference':'DELIVERY-1-LINE-1'}}
  mutate('stock/movements',duplicate,503);assert request('stock')['items'][0]['balance']['onHand']==35
  move('acceptance-receipt-final','Receive',20,orderId=c['poId'],receiptReference='DELIVERY-2-LINE-1')
  stock=wait(lambda:(s if (s:=request('stock'))['obligations'][0]['closedAt'] else None),'physical delivery closure')
  assert stock['items'][0]['balance']['onHand']==55 and stock['deliveries'][0]['remaining']==0
  event('PhysicalGoodsReceiptExactlyOnce',onHand=55,received=30,remaining=0,paymentState=request('cases/'+c['caseId'])['projection']['cases'][0]['paymentState'])
  with sqlite3.connect(snapshot/'backend/data/local-v2/local-operations'/name/'state.sqlite') as db:
   assert db.execute('SELECT count(*) FROM v2_procurement_orders').fetchone()[0]==1
   evaluations=[{'eventId':r[0],'productId':r[1],'calculation':json.loads(r[2])} for r in db.execute('SELECT event_id,product_id,body_json FROM inventory_evaluations ORDER BY rowid LIMIT 12')]
  for p in reversed(processes):stop(p)
  spies=[json.loads(p.read_text()) for p in Path(folder).glob('*.json')];assert len(spies)==3 and all(all(n==0 for n in s.values()) for s in spies),spies
  report={'status':'passed','trace':trace,'evaluations':evaluations,'financialSpies':spies,'workerRestart':True,'webServerStoppedDuringMonitoring':True,'browserRuntime':False,'publicChainExecution':False}
  output=Path('/tmp/carecart-p4a-acceptance.json');output.write_text(json.dumps(report,indent=2));print(json.dumps(report))
 except Exception:
  for log in logs:log.flush();log.seek(0);print(log.read()[-4000:],file=sys.stderr)
  raise
 finally:
  for p in reversed(processes):stop(p)
  for log in logs:log.close()

"""Real HTTP/Next/auth/SQLite security regression. Spies prohibit all financial execution.

Usage: python3 scripts/p3c-security-process.test.py /tmp/carecart-phase2-verify.XXXXXX
The snapshot must be freshly prepared and webpack-built by verify-phase2.sh.
No operational environment, signing credentials, external RPC or deployment is used.
"""
import concurrent.futures
import hashlib
import http.client
import http.cookiejar
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid

ROOT=Path(__file__).resolve().parents[1]

def main():
 snapshot=Path(sys.argv[1]).resolve()
 assert snapshot.parent==Path('/tmp') and snapshot.name.startswith('carecart-phase2-verify.')
 assert (snapshot/'web/.next/BUILD_ID').is_file(), 'A fresh production build is required'
 hashes=json.loads((snapshot/'source-hashes.json').read_text())
 assert all(hashlib.sha256((ROOT/name).read_bytes()).hexdigest()==digest for name,digest in hashes.items()), 'Snapshot/source mismatch'
 node=shutil.which('node');assert node
 def port():
  with socket.socket() as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]
 web_port,api_port,legacy_port=port(),port(),port();origin=f'http://127.0.0.1:{web_port}'
 credential=secrets.token_hex(32);viewer=secrets.token_hex(32);workspace='p3c-http-'+uuid.uuid4().hex
 env={'PATH':os.environ.get('PATH','/usr/bin:/bin'),'HOME':'/tmp','TSX_DISABLE_CACHE':'1','NEXT_TELEMETRY_DISABLED':'1'}
 processes=[];logs=[];checks=[]
 cookies=http.cookiejar.CookieJar();client=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookies))
 def request(path,method='GET',body=None,headers=None,target=web_port):
  url=f'http://127.0.0.1:{target}'+path
  req=urllib.request.Request(url,data=None if body is None else json.dumps(body).encode(),method=method,
   headers={'Content-Type':'application/json',**(headers or {})})
  try:response=client.open(req,timeout=20)
  except urllib.error.HTTPError as error:response=error
  with response:return response.status,response.read()
 def check(path,expected,method='GET',body=None,headers=None,target=web_port):
  status,raw=request(path,method,body,headers,target);assert status==expected,(path,status,expected,raw[:300])
  checks.append({'path':path,'method':method,'target':'backend' if target==legacy_port else 'frontend','status':status})
  return raw
 def session():return json.loads(check('/api/operations/session',200))
 def mutation_headers(s):return {'Origin':origin,'x-csrf-token':s['csrf'],'x-operation-nonce':s['nonce']}
 def login(secret):check('/api/operations/login',200,'POST',{'credential':secret},{'Origin':origin});return session()
 with tempfile.TemporaryDirectory(prefix='carecart-p3c-process-') as folder:
  def start(args,cwd,extra):
   log=open(Path(folder)/f'process-{len(logs)}.log','w+');logs.append(log)
   p=subprocess.Popen([node,*args],cwd=cwd,env={**env,**extra},stdout=log,stderr=log);processes.append(p);return p
  def ready(target,path):
   for _ in range(150):
    if any(p.poll() is not None for p in processes):
     for log in logs:log.flush();log.seek(0)
     raise AssertionError('Isolated process exited: '+''.join(log.read() for log in logs))
    try:
     if request(path,target=target)[0] in [200,401]:return
    except (OSError,http.client.HTTPException,urllib.error.URLError):pass
    time.sleep(.1)
   raise AssertionError('Isolated process startup timed out')
  try:
   start(['--import','tsx','test-support/security-http.ts'],snapshot/'backend',{
    'CARECART_P3C_WORKSPACE':workspace,'CARECART_P3C_LEGACY_PORT':str(legacy_port),
    'CARECART_OPERATIONS_PORT':str(api_port),'CARECART_OPERATIONS_ORIGIN':origin,
    'CARECART_OPERATIONS_OPERATOR_SECRET':credential,'CARECART_OPERATIONS_VIEWER_SECRET':viewer})
   start(['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',str(web_port)],snapshot/'web',{
    'CARECART_OPERATIONS_API_URL':f'http://127.0.0.1:{api_port}','CARECART_API_URL':f'http://127.0.0.1:{legacy_port}'})
   ready(legacy_port,'/api/dashboard');ready(api_port,'/api/operations/session');ready(web_port,'/operations')
   app_routes=['/app','/app/inventory','/app/replenishment','/app/suppliers','/app/payments','/app/activity','/app/settings']
   for path in app_routes:
    raw=check(path,200);assert b'NEXT_REDIRECT' in raw and b'/operations?next=%2Fapp' in raw
   for path in ['/api/intents/config','/api/intents/preview','/api/intents/dry-quote']:
    for target in [web_port,legacy_port]:check(path,410,'POST',{'network':'mainnet','amount':'1'}, {'Origin':origin},target)
   for route in ['playground','playground/runs']:
    check('/api/operations/'+route,404,'POST',{'role':'operator','network':'mainnet'},{'Origin':origin})
   for path in ['/app/playground','/app/playground/testnet','/app/playground/unknown']:
    raw=check(path,200);assert b'/operations?next=%2Fapp' in raw and b'NEXT_REDIRECT' in raw
   attempts=[('/api/supplier-quotes',{'itemId':'item-000001'}),('/api/purchase-orders',{'requestId':'p3c-chain','itemId':'item-000001','quoteId':'quote-000002'}),
    ('/api/agent/tasks',{'itemId':'item-000001','quoteId':'quote-000002'}),('/api/agent/tick',{'itemId':'item-000001'}),('/api/payments',{'purchaseOrderId':'po-000001'})]
   for target in [web_port,legacy_port]:
    for path,payload in attempts:
     check(path,410,'POST',payload,{'Origin':origin},target)
     check(path,410,'POST',{**payload,'role':'operator','userId':'admin','network':'mainnet'},{'Origin':origin,'x-role':'operator'},target)
   with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    statuses=list(pool.map(lambda _:request('/api/payments','POST',{'purchaseOrderId':'po-000001'},target=legacy_port)[0],range(16)))
   assert statuses==[410]*16
   for path in ['session','inventory','catalog','stock','cases','runs','cases/audit','cases/audit/events','cases/audit/runs',
    'runs/11111111-1111-4111-8111-111111111111','wallet-reviews/11111111-1111-4111-8111-111111111111']:
    check('/api/operations/'+path,401)
   privileged=['runs','stock/movements','stock/autonomy','cases/audit/wallet-reviews',
    *['wallet-reviews/11111111-1111-4111-8111-111111111111/'+a for a in ['handoff','report','reconcile','mock-wallet']],
    'runs/11111111-1111-4111-8111-111111111111/reconcile']
   for path in privileged:check('/api/operations/'+path,401,'POST',{}, {'Origin':origin})
   check('/api/operations/runs',401,'POST',{}, {'Origin':origin,'Cookie':'carecart_ops='+'a'*64,'x-role':'operator'})
   check('/api/operations/login',400,'POST',{'credential':viewer,'role':'operator'},{'Origin':origin})
   for path in ['/api/vault','/api/vault/payments/po-000001']:
    check(path,404)
   for role,secret in [('viewer',viewer),('operator',credential)]:
    s=login(secret);assert s['role']==role
    for path in app_routes:
     raw=check(path,200);assert b'NEXT_REDIRECT' not in raw
    for path in ['/app/playground','/app/playground/testnet','/app/playground/unknown']:
     raw=check(path,200);assert b'NEXT_REDIRECT;replace;/app;307;' in raw
    check('/api/operations/playground/runs',404,'POST',{'requestId':str(uuid.uuid4())},mutation_headers(session()))
    if role=='viewer':
     for path in privileged:check('/api/operations/'+path,403,'POST',{'role':'operator'},mutation_headers(s))
     check('/api/operations/logout',200,'POST',{},mutation_headers(session()));continue
    payload={'requestId':str(uuid.uuid4()),'mode':'deterministic','target':{'kind':'item','itemId':'mn-item-1','eventId':'p3c-process-event'}}
    check('/api/operations/runs',403,'POST',payload,{'Origin':origin})
    check('/api/operations/runs',403,'POST',payload,{**mutation_headers(s),'Origin':'http://evil.invalid'})
    check('/api/operations/runs',400,'POST',{**payload,'role':'requester'},mutation_headers(s))
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
     replies=list(pool.map(lambda _:request('/api/operations/runs','POST',payload,mutation_headers(s)),range(4)))
    assert all(status==200 for status,_ in replies);runs=[json.loads(raw)['run'] for _,raw in replies]
    assert len({run['id'] for run in runs})==1
    cases=json.loads(check('/api/operations/cases',200))['projection']['cases'];assert len(cases)==1
    case=cases[0];assert case['state']=='PoDrafted' and case['paymentState']=='Unobserved' and case['nextAction']=='AuthorizeCommitment'
    check('/api/operations/runs',409,'POST',{**payload,'target':{**payload['target'],'eventId':'changed'}},mutation_headers(s))
    for path in ['payments','request_payment','commit_purchase_order']:
     check('/api/operations/'+path,404,'POST',{'poId':case['poId'],'role':'requester'},mutation_headers(session()))
    check('/api/operations/playground/runs',404,'POST',{'requestId':str(uuid.uuid4())},mutation_headers(session()))
    check('/api/operations/playground',410,target=api_port)
    check('/api/operations/playground/runs',410,'POST',{'requestId':str(uuid.uuid4())},mutation_headers(session()),api_port)
    assert len(json.loads(check('/api/operations/cases',200))['projection']['cases'])==1
    database=snapshot/'backend/data/local-v2/local-operations'/workspace/'state.sqlite'
    with sqlite3.connect(database) as db:db.execute('UPDATE operator_sessions SET expires=0');db.commit()
    check('/api/operations/session',401);check('/api/operations/runs',401,'POST',payload,mutation_headers(s))
   evidence=json.loads(check('/__p3c-evidence',200,target=legacy_port))
   assert evidence=={'adapter':0,'signing':0,'externalSubmission':0,'syntheticDemoUnchanged':True,'operationalCases':1},evidence
   report={'status':'passed','execution':'real-local-HTTP-production-webpack','publicChainExecution':False,'browserRuntime':False,
    'snapshot':str(snapshot),'checks':checks,'concurrentRejectedPayments':len(statuses),'concurrentAuthorizedReplays':len(runs),
    'spyEvidence':evidence,'playgroundRetiredWithoutEffects':True,'serverSessionExpiryEnforced':True}
   destination=os.environ.get('CARECART_P3C_EVIDENCE')
   if destination:Path(destination).write_text(json.dumps(report,indent=2)+'\n')
   print(json.dumps({k:v for k,v in report.items() if k!='checks'}))
  finally:
   for p in reversed(processes):
    if p.poll() is None:
     p.terminate()
     try:p.wait(timeout=10)
     except subprocess.TimeoutExpired:p.kill();p.wait(timeout=5)
   for log in logs:log.close()
if __name__=='__main__':main()

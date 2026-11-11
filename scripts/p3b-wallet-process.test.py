"""Real CLI + HTTP + Next proxy; MOCK wallet/chain only. No external transport or operational credentials."""
import http.client,http.cookiejar,json,os,secrets,shutil,socket,subprocess,tempfile,time,unittest,urllib.error,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def port():
 with socket.socket() as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]
class WalletProcessTest(unittest.TestCase):
 def test_cli_proxy_wallet_report_restart_and_canonical_reconciliation(self):
  # Fail visibly when the runtime disallows sockets; do not skip or fabricate receipt evidence.
  api_port,web_port=port(),port()
  with tempfile.TemporaryDirectory(prefix='carecart-p3b-http-') as directory:
   temp=Path(directory);(temp/'backend').mkdir()
   shutil.copytree(ROOT/'backend/src',temp/'backend/src');shutil.copy2(ROOT/'backend/package.json',temp/'backend/package.json')
   (temp/'backend/node_modules').symlink_to(ROOT/'backend/node_modules',target_is_directory=True)
   preload=temp/'no-external.cjs';preload.write_text("""const net=require('node:net');const original=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){const normalized=Array.isArray(args[0])?args[0]:args;const first=normalized[0];
const host=typeof first==='object'?first.host:(typeof normalized[1]==='string'?normalized[1]:typeof first==='number'?'localhost':undefined);
if(!['127.0.0.1','localhost','::1'].includes(host))throw Error('NO_EXTERNAL_NETWORK');return original.apply(this,args);};
const fetch0=globalThis.fetch;globalThis.fetch=(input,...rest)=>{const u=new URL(typeof input==='object'&&input.url?input.url:String(input));if(!['127.0.0.1','localhost','[::1]'].includes(u.hostname))throw Error('NO_EXTERNAL_NETWORK');return fetch0.call(globalThis,input,...rest);};
const {Account}=require('/home/nana/projects/carecart/backend/node_modules/near-api-js');Account.prototype.callFunctionRaw=()=>{throw Error('NO_SIGNING');};
""")
   node=shutil.which('node');credential=secrets.token_hex(32);origin=f'http://127.0.0.1:{web_port}'
   base={'PATH':os.environ.get('PATH',''),'HOME':directory,'TMPDIR':directory,'NEXT_TELEMETRY_DISABLED':'1','CARECART_AI_MODE':'deterministic','NODE_OPTIONS':'--require '+str(preload)}
   env={**base,'CARECART_OPERATIONS_MODE':'local-synthetic','CARECART_OPERATIONS_WALLET_MODE':'isolated-mock','CARECART_OPERATIONS_OPERATOR_SECRET':credential,'CARECART_OPERATIONS_ORIGIN':origin,'CARECART_OPERATIONS_PORT':str(api_port)}
   command=[node,'--import',str(ROOT/'backend/node_modules/tsx/dist/loader.mjs'),'src/ops/wallet-workspace.ts','--seed']
   processes=[];logs=[]
   def start_api():
    log=open(temp/f'api-{len(logs)}.log','w+');logs.append(log)
    p=subprocess.Popen(command,cwd=temp/'backend',env=env,stdout=log,stderr=log);processes.append(p);return p
   cookies=http.cookiejar.CookieJar()
   client=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookies))
   sent_cookie_names={}
   def request(path,method='GET',body=None,headers=None):
    payload=None if body is None else json.dumps(body).encode()
    req=urllib.request.Request(origin+path,data=payload,headers={'Content-Type':'application/json',**(headers or {})},method=method)
    try:
     response=client.open(req,timeout=15)
    except urllib.error.HTTPError as error:response=error
    with response:
     sent_cookie_names[path]=[v.strip().split('=',1)[0] for v in (req.get_header('Cookie') or '').split(';') if v.strip()]
     return response.status,dict(response.headers),response.read()
   def ready(p,check):
    for _ in range(150):
     if p.poll() is not None:
      for log in logs:log.flush();log.seek(0)
      self.fail('Isolated process failed: '+''.join(log.read() for log in logs))
     try:
      if check():return
     except (OSError,http.client.HTTPException,urllib.error.URLError):pass
     time.sleep(.1)
    self.fail('Isolated service startup timed out')
   def api_ready():
    with socket.create_connection(('127.0.0.1',api_port),timeout=.2):return True
   try:
    api=start_api();ready(api,api_ready)
    log=open(temp/'next.log','w+');logs.append(log)
    web=subprocess.Popen([node,str(ROOT/'web/node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',str(web_port)],cwd=ROOT/'web',env={**base,'CARECART_OPERATIONS_API_URL':f'http://127.0.0.1:{api_port}'},stdout=log,stderr=log);processes.append(web)
    ready(web,lambda:request('/operations')[0]==200)
    self.assertEqual(request('/api/operations/cases')[0],401)
    status,headers,_=request('/api/operations/login','POST',{'credential':credential},{'Origin':origin});self.assertEqual(status,200)
    self.assertEqual({c.name:c.path for c in cookies},{'carecart_ops':'/api/operations','carecart_app':'/app'})
    self.assertTrue(all(c.has_nonstandard_attr('HttpOnly') and c.get_nonstandard_attr('SameSite')=='Strict' for c in cookies))
    def get(path):
     status,_,body=request('/api/operations/'+path);self.assertEqual(status,200,body.decode());return json.loads(body)
    def mutate(path,body):
     session=get('session');status,_,raw=request('/api/operations/'+path,'POST',body,{'Origin':origin,'x-csrf-token':session['csrf'],'x-operation-nonce':session['nonce']})
     self.assertEqual(status,200,raw.decode());return json.loads(raw)
    get('session');get('session')
    self.assertEqual(sent_cookie_names['/api/operations/session'],['carecart_ops'])
    self.assertEqual(request('/app')[0],200)
    self.assertEqual(sent_cookie_names['/app'],['carecart_app'])
    cases=get('cases')['projection']['cases'];self.assertEqual(len(cases),1);case=cases[0];self.assertEqual(case['state'],'AwaitingHumanApproval')
    payload={'requestId':str(__import__('uuid').uuid4()),'action':'approve','expectedRevision':case['version']}
    review=mutate('cases/'+case['caseId']+'/wallet-reviews',payload)['review'];review_id=review['id'];terms=review['terms']
    self.assertEqual(terms['transaction']['actions'][0]['params']['deposit'],'1')
    mutate('wallet-reviews/'+review_id+'/handoff',{'requestId':str(__import__('uuid').uuid4()),'termsHash':review['termsHash']})
    api.kill();api.wait(timeout=10);api=start_api();ready(api,api_ready)
    saved=get('wallet-reviews/'+review_id)['review'];self.assertEqual(saved['state'],'Handoff');self.assertEqual(saved['termsHash'],review['termsHash'])
    tx=mutate('wallet-reviews/'+review_id+'/mock-wallet',{'requestId':str(__import__('uuid').uuid4())});self.assertTrue(tx['simulated']);self.assertFalse(tx['publicChainExecution'])
    mutate('wallet-reviews/'+review_id+'/report',{'requestId':str(__import__('uuid').uuid4()),'outcome':'Submitted','transactionHash':tx['transactionHash']})
    self.assertEqual(get('cases/'+case['caseId'])['projection']['cases'][0]['state'],'AwaitingHumanApproval')
    observed=mutate('wallet-reviews/'+review_id+'/reconcile',{'requestId':str(__import__('uuid').uuid4())})['review']
    self.assertFalse(observed['transactionVerified']);current=get('cases/'+case['caseId'])['projection']['cases'][0]
    self.assertEqual(current['state'],'DispatchInProgress');self.assertEqual(current['evidenceKind'],'mocked-rpc')
    api.terminate();api.wait(timeout=10);api=start_api();ready(api,api_ready)
    after=get('cases/'+case['caseId'])['projection']['cases'][0]
    self.assertEqual(after['poHash'],case['poHash']);self.assertEqual(after['version'],current['version'])
    self.assertEqual(get('wallet-reviews/'+review_id)['review']['transactionHash'],tx['transactionHash'])
    mutate('logout',{})
    self.assertEqual(request('/api/operations/session')[0],401)
    self.assertEqual(list(cookies),[])
    print('Verified: real local HTTP/proxy/CLI and restart; wallet and chain MOCKED; no browser or public-chain proof.')
   finally:
    for p in reversed(processes):
     if p.poll() is None:
      p.terminate()
      try:p.wait(timeout=10)
      except subprocess.TimeoutExpired:p.kill();p.wait(timeout=10)
    for log in logs:log.close()
if __name__=='__main__':unittest.main()

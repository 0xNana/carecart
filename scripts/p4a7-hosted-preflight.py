#!/usr/bin/env python3
"""Read-only hosted Supabase configuration probe. Never signs in, creates accounts, sends email or reads wallet configuration."""
import argparse,hashlib,json,os,urllib.error,urllib.parse,urllib.request
from pathlib import Path

FIELDS={'SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','CARECART_AUTH_MODE','CARECART_PUBLIC_ORIGIN'}
def configuration(path):
 values={}
 if path.is_file():
  for line in path.read_text().splitlines():
   line=line.strip().removeprefix('export ')
   if not line or line.startswith('#') or '=' not in line:continue
   name,value=line.split('=',1)
   if name.strip() in FIELDS:values[name.strip()]=value.strip().strip('\"\'')
 return {**values,**{name:os.environ[name] for name in FIELDS if name in os.environ}}

class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*_args,**_kwargs):return None

def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--env-file',type=Path,default=Path('.env.identity'));parser.add_argument('--output',type=Path,default=Path('/tmp/carecart-hosted-preflight.json'));args=parser.parse_args()
 report={'provider':'genuine configured hosted Supabase (read-only probe)','configurationFile':str(args.env_file),'hostedAuthenticationAccepted':False,'accountMutations':0,'emailsRequested':0,'publicChainCalls':0,'valuesRedacted':True,'probes':[]}
 try:
  config=configuration(args.env_file);url=urllib.parse.urlsplit(config.get('SUPABASE_URL',''));origin=urllib.parse.urlsplit(config.get('CARECART_PUBLIC_ORIGIN',''));_ports=(url.port,origin.port)
 except (OSError,ValueError,UnicodeError):
  config={};url=origin=urllib.parse.urlsplit('');report['configurationError']='Unreadable or invalid identity configuration (values redacted)'
 key=config.get('SUPABASE_PUBLISHABLE_KEY','')
 missing=[]
 if config.get('CARECART_AUTH_MODE')!='supabase':missing.append('CARECART_AUTH_MODE=supabase')
 if origin.scheme not in ['http','https'] or not origin.netloc or origin.path or origin.query or origin.fragment or origin.username or origin.password or (origin.scheme=='http' and origin.hostname not in ['127.0.0.1','localhost']):missing.append('CARECART_PUBLIC_ORIGIN: exact canonical HTTPS origin (loopback HTTP only for local testing)')
 valid_url=url.scheme=='https' and bool(url.hostname) and url.hostname.endswith('.supabase.co') and url.path in ['','/'] and not (url.username or url.password or url.query or url.fragment or url.port)
 valid_key=key.startswith('sb_publishable_') and 25<=len(key)<512 and key.isascii() and all(c.isalnum() or c in '_-' for c in key)
 if not valid_url:missing.append('SUPABASE_URL: configured HTTPS hosted project origin')
 if not valid_key:missing.append('SUPABASE_PUBLISHABLE_KEY: project publishable key')
 report['missingConfiguration']=missing;report['hostedTestIdentityAndInbox']='not requested or read by this public-configuration probe; required separately for acceptance'
 failed=False
 if valid_url and valid_key:
  base=urllib.parse.urlunsplit((url.scheme,url.netloc,'','',''));report['providerFingerprint']=hashlib.sha256(base.encode()).hexdigest()
  opener=urllib.request.build_opener(NoRedirect())
  for path in ['/auth/v1/settings','/auth/v1/.well-known/jwks.json']:
   entry={'path':path,'method':'GET'}
   try:
    with opener.open(urllib.request.Request(base+path,headers={'apikey':key}),timeout=12) as response:
     entry['status']=response.status;raw=response.read(65537)
     if len(raw)>65536:raise ValueError('Response exceeds bound')
     data=json.loads(raw)
    if path.endswith('settings'):
     entry['emailEnabled']=data.get('external',{}).get('email') is True
     entry['signupEnabled']=data.get('disable_signup') is False
     entry['emailConfirmationRequired']=data.get('mailer_autoconfirm') is False
     if not all(entry[k] for k in ['emailEnabled','signupEnabled','emailConfirmationRequired']):failed=True
    else:
     keys=data.get('keys',[]);entry['keyCount']=len(keys);entry['supportedAlgorithms']=sorted({k.get('alg') for k in keys if k.get('alg') in ['ES256','RS256']});entry['supportedSigningKeyPresent']=any(k.get('kid') and k.get('alg') in ['ES256','RS256'] and k.get('use','sig')=='sig' for k in keys)
     if not entry['supportedSigningKeyPresent']:failed=True
   except urllib.error.HTTPError as error:entry['status']=error.code;failed=True
   except Exception:entry['error']='Hosted probe unavailable, invalid response or TLS/network failure (details redacted)';failed=True
   report['probes'].append(entry)
 report['status']='BLOCKED: hosted provider prerequisites failed' if failed else 'BLOCKED: application identity configuration incomplete' if missing else 'Public configuration ready; authenticated acceptance still required'
 args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report));return 1 if failed else 2 if missing else 0

if __name__=='__main__':raise SystemExit(main())

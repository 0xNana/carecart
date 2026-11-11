"""Offline input/redaction tests, not hosted identity acceptance. No network calls are permitted by these invalid configurations."""
import json,os,subprocess,sys,tempfile,unittest
from pathlib import Path
SCRIPT=Path(__file__).with_name('p4a7-hosted-preflight.py')
class HostedPreflightInputTests(unittest.TestCase):
 def check_config(self,text):
  with tempfile.TemporaryDirectory(prefix='carecart-preflight-input-') as directory:
   root=Path(directory);source=root/'.env.identity';source.write_text(text);report=root/'report.json'
   result=subprocess.run([sys.executable,str(SCRIPT),'--env-file',str(source),'--output',str(report)],capture_output=True,text=True,timeout=10,env={'PATH':os.environ.get('PATH',''),'HOME':directory})
   self.assertEqual(result.returncode,2);self.assertNotIn('CANARY_PRIVATE',result.stdout+result.stderr);self.assertEqual(result.stderr,'')
   data=json.loads(report.read_text());self.assertEqual(data['probes'],[]);self.assertFalse(data['hostedAuthenticationAccepted']);self.assertEqual(data['accountMutations'],0);return data
 def test_missing_configuration_never_grants_acceptance(self):self.assertTrue(self.check_config('')['missingConfiguration'])
 def test_invalid_url_never_prints_private_values_or_traceback(self):self.assertIn('configurationError',self.check_config('SUPABASE_URL=https://project.supabase.co:CANARY_PRIVATE\nSUPABASE_PUBLISHABLE_KEY=CANARY_PRIVATE'))
 def test_service_role_and_unrelated_wallet_configuration_are_not_used(self):self.assertTrue(self.check_config('SUPABASE_URL=https://project.supabase.co\nSUPABASE_PUBLISHABLE_KEY=sb_secret_CANARY_PRIVATE\nSAFETY_ADMIN_PRIVATE_KEY=CANARY_PRIVATE')['missingConfiguration'])
if __name__=='__main__':unittest.main()

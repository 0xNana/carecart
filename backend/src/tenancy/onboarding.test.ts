import * as fs from 'node:fs';
import {dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {afterEach,expect,it,vi} from 'vitest';
import {testnetPreparation} from '../profiles/testnet';
import {PROJECT_ROOT} from '../profiles/storage';
import {OperationsError} from '../operations/auth';
import {ClinicRegistry} from './registry';
import {SupabaseIdentity,type VerifiedIdentity} from './identity';
import {ClinicRuntimePool} from './runtime';
import {createTenantApp} from './api';

function paymentGroupId(){
 if(!process.getgid)throw new Error('POSIX group support required');
 return process.getgid()+100000;
}

// Simulate the EC2 supplementary payment group, retaining real filesystem/SQLite
// operations. Newly created files still belong to the actual process group.
vi.mock('node:fs',async original=>{
 const actual=await original<typeof import('node:fs')>();
 const readFileSync=((...args:Parameters<typeof actual.readFileSync>)=>args[0]==='/etc/group'
  ?`carecart-payments:x:${paymentGroupId()}:\n`
  :actual.readFileSync(...args)) as typeof actual.readFileSync;
 return {...actual,readFileSync};
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();vi.unstubAllGlobals();});

it('MOCKED IDENTITY / REAL HTTP + SQLITE: new sample and empty clinics open privately when payment sharing is enabled',async()=>{
 const folder=fs.mkdtempSync(join(tmpdir(),'carecart-onboarding-'));
 const registry=new ClinicRegistry(join(folder,'registry.sqlite'));
 const preparation=testnetPreparation(JSON.parse(fs.readFileSync(join(PROJECT_ROOT,'profiles/testnet.demo.json'),'utf8')));
 const pool=new ClinicRuntimePool(undefined,{preparation,requireTestnet:true});
 const origin='https://carecart.example';
 const identity=new SupabaseIdentity({url:'https://fixture.supabase.co',publishableKey:'sb_publishable_fixture_only',origin});
 const users=new Map<string,VerifiedIdentity>();
 vi.spyOn(identity,'verify').mockImplementation(async token=>{
  const user=users.get(token);if(!user)throw new OperationsError(401,'AUTH_REQUIRED');return user;
 });
 const app=createTenantApp(registry,identity,origin,pool),paths:string[]=[];
 if(!process.getgroups)throw new Error('POSIX group support required');
 const groups=process.getgroups();vi.spyOn(process,'getgroups').mockReturnValue([...groups,paymentGroupId()]);
 vi.stubEnv('CARECART_SHARED_STATE_GROUP','carecart-payments');
 const network=vi.fn(()=>{throw new Error('Onboarding must not contact chain or AI')});vi.stubGlobal('fetch',network);
 try{
  const results:{clinicId:string;headers:Record<string,string>}[]=[];
  for(const demo of [true,false]){
   const token=randomUUID(),user={userId:randomUUID(),sessionId:randomUUID(),email:randomUUID()+'@example.invalid',expires:Date.now()+3600000};users.set(token,user);
   const login=await app.inject({method:'POST',url:'/api/identity/session',headers:{origin,authorization:'Bearer '+token},payload:{}});
   expect(login.statusCode,login.body).toBe(200);
   const headers={origin,authorization:'Bearer '+token,cookie:'carecart_identity='+login.json().token};
   const context=(await app.inject({url:'/api/identity/context',headers})).json();
   const created=await app.inject({method:'POST',url:'/api/identity/clinics',headers:{...headers,'x-csrf-token':context.csrf,'x-operation-nonce':context.nonce},payload:{requestId:randomUUID(),clinic:{name:'Onboarding fixture',country:'GH',timezone:'UTC',storeroom:'Main',syntheticDemo:demo}}});
   expect(created.statusCode,created.body).toBe(200);
   const clinicId=created.json().clinic.id;
   paths.push(join(PROJECT_ROOT,'backend/data/testnet-v2/clinics',clinicId,'state.sqlite'));
   const selected=await app.inject({method:'POST',url:'/api/identity/active-clinic',headers:{...headers,'x-csrf-token':context.csrf,'x-operation-nonce':(await app.inject({url:'/api/identity/context',headers})).json().nonce},payload:{requestId:randomUUID(),clinicId}});
   expect(selected.statusCode,selected.body).toBe(200);
   const tenantHeaders={...headers,'x-carecart-clinic':clinicId};
   for(let attempt=0;attempt<2;attempt++){
    const session=await app.inject({url:'/api/operations/session',headers:tenantHeaders});expect(session.statusCode,session.body).toBe(200);expect(session.json().clinicId).toBe(clinicId);
    const stock=await app.inject({url:'/api/operations/stock',headers:tenantHeaders});expect(stock.statusCode,stock.body).toBe(200);
    expect(stock.json().items[0].balance.onHand).toBe(demo?30:0);
   }
   results.push({clinicId,headers:tenantHeaders});
  }
  const forbidden=await app.inject({url:'/api/operations/stock',headers:{...results[0].headers,'x-carecart-clinic':results[1].clinicId}});
  expect(forbidden.statusCode).toBe(403);
  for(const path of paths){expect(fs.statSync(path).mode&0o777).toBe(0o600);expect(fs.statSync(path).gid).not.toBe(paymentGroupId());}
  expect(network).not.toHaveBeenCalled();
 }finally{
  await app.close();for(const path of paths)fs.rmSync(dirname(path),{recursive:true,force:true});fs.rmSync(folder,{recursive:true,force:true});
 }
});

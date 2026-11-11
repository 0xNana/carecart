import {it,expect,vi} from 'vitest';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {ClinicRegistry} from './registry';import {ClinicRuntimePool} from './runtime';import {SupabaseIdentity} from './identity';import {createTenantApp} from './api';
import {testnetPreparation} from '../profiles/testnet';import {PROJECT_ROOT} from '../profiles/storage';

it('readiness exposes no clinic/configuration details, requires explicit testnet configuration and never queries identity or chain',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'carecart-health-')),network=vi.fn(()=>{throw new Error('No network allowed')});
 const identity=new SupabaseIdentity({url:'https://fixture.supabase.co',publishableKey:'sb_publishable_fixture_only',origin:'https://carecart.example'},network);
 try{for(const configured of [false,true]){
  const registry=new ClinicRegistry(join(folder,configured?'ready.sqlite':'unconfigured.sqlite'));
  const preparation=configured?testnetPreparation(JSON.parse(readFileSync(join(PROJECT_ROOT,'profiles/testnet.demo.json'),'utf8'))):undefined;
  const app=createTenantApp(registry,identity,'https://carecart.example',new ClinicRuntimePool(undefined,{preparation,requireTestnet:true}));
  try{
   const response=await app.inject('/healthz');expect(response.statusCode).toBe(configured?200:503);expect(response.json()).toEqual({status:configured?'ok':'unavailable'});expect(response.headers['cache-control']).toBe('no-store');
   expect((await app.inject('/api/operations/stock')).statusCode).toBe(401);
   expect((await app.inject({method:'POST',url:'/healthz',headers:{origin:'https://carecart.example'},payload:{}})).statusCode).toBe(404);
  }finally{await app.close();}
 }expect(network).not.toHaveBeenCalled();}finally{rmSync(folder,{recursive:true,force:true});}
});

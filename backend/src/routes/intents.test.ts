import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {openDatabase,closeDatabase,loadDomainRecords} from '../db';
import {seedSyntheticData} from '../seed';
import {createServer} from '../server';
describe('retired public cross-chain simulation routes',()=>{
 let database:ReturnType<typeof openDatabase>,app:ReturnType<typeof createServer>;
 beforeEach(()=>{database=openDatabase(':memory:');seedSyntheticData(database);app=createServer({database});});
 afterEach(async()=>{await app.close();closeDatabase(database);vi.unstubAllGlobals();});
 it('returns no simulation or settlement and makes no network calls or data changes',async()=>{
  const network=vi.fn(()=>{throw new Error('Retired endpoints cannot call a provider')});vi.stubGlobal('fetch',network);const before=loadDomainRecords(database);
  for(const path of ['config','preview','dry-quote'])for(const method of ['GET','POST'] as const){const r=await app.inject({method,url:'/api/intents/'+path,payload:method==='POST'?{}:undefined});expect(r.statusCode).toBe(410);expect(r.json()).toEqual({error:{code:'SIMULATION_RETIRED',message:expect.any(String)}});}
  expect(network).not.toHaveBeenCalled();expect(loadDomainRecords(database)).toEqual(before);
 });
 it('cannot reactivate a retired route using payee, amount, network, dry or role overrides',async()=>{
  const network=vi.fn(()=>{throw new Error('No adapter')});vi.stubGlobal('fetch',network);const before=loadDomainRecords(database);
  for(const path of ['preview','dry-quote'])for(const extra of [{recipient:'attacker'},{amountAtomic:'1'},{dry:false},{network:'mainnet'},{role:'admin'}]){const r=await app.inject({method:'POST',url:'/api/intents/'+path,payload:{purchaseOrderId:'po-000001',destinationChain:'base',...extra}});expect(r.statusCode).toBe(410);}
  expect(network).not.toHaveBeenCalled();expect(loadDomainRecords(database)).toEqual(before);
 });
});

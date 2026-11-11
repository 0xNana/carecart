import {afterEach,expect,it,vi} from 'vitest';
import {readFileSync,rmSync,existsSync} from 'node:fs';import {join,dirname} from 'node:path';import {randomUUID} from 'node:crypto';
import {PROJECT_ROOT} from '../profiles/storage';import {testnetPreparation} from '../profiles/testnet';import {openClinicRuntime} from './runtime';import type {Clinic} from './registry';
const cleanups:(()=>void)[]=[];afterEach(()=>{for(const c of cleanups.splice(0).reverse())c();vi.unstubAllGlobals();});
const clinic=():Clinic=>{const id=randomUUID();return {id,name:'Synthetic retirement test',country:'GH',timezone:'Africa/Accra',storeroom:'Main',workspace:'tenant-'+id.replaceAll('-',''),syntheticDemo:true,status:'Active'};};
const raw=()=>JSON.parse(readFileSync(join(PROJECT_ROOT,'profiles/testnet.demo.json'),'utf8'));
it('operational mode requires an explicit testnet profile before any state exists; missing/mainnet/ambiguous config cannot fall back',()=>{
 const c=clinic(),path=join(PROJECT_ROOT,'backend/data/testnet-v2/clinics',c.id,'state.sqlite');expect(()=>openClinicRuntime(c,undefined,{requireTestnet:true})).toThrow(/no mainnet or fixture fallback/);expect(existsSync(path)).toBe(false);
 const r=raw();for(const bad of [{...r,profile:{...r.profile,network:'mainnet'}},{...r,profile:{...r.profile,testToken:undefined}},{...r,suppliers:[r.suppliers[0],r.suppliers[0],r.suppliers[2]]},{...r,privateKey:'not-loaded'}])expect(()=>testnetPreparation(bad)).toThrow();
});
it('key-free explicit preparation shares clinic ledger rules, isolates clinics and never queries or signs',()=>{
 const network=vi.fn(()=>{throw new Error('Preparation must not use any public RPC')});vi.stubGlobal('fetch',network);const preparation=testnetPreparation(raw());const a=clinic(),b=clinic();
 for(const c of [a,b])cleanups.push(()=>rmSync(join(PROJECT_ROOT,'backend/data/testnet-v2/clinics',c.id),{recursive:true,force:true}));
 const left=openClinicRuntime(a,undefined,{preparation,requireTestnet:true}),right=openClinicRuntime(b,undefined,{preparation,requireTestnet:true});cleanups.push(()=>left.close(),()=>right.close());
 expect(left.store.profile.network).toBe('testnet');expect(left.store.profile.testToken?.symbol).toBe('CCUSD');expect(left.inventory.path).not.toBe(right.inventory.path);expect(dirname(left.inventory.path)).toContain(a.id);
 left.inventory.move({id:'consume-fixture',productId:'mn-item-1',kind:'Consume',quantity:4,unit:'base',source:'synthetic'},'test');expect(left.inventory.balance('mn-item-1').onHand).toBe(26);expect(right.inventory.balance('mn-item-1').onHand).toBe(30);expect(left.inventory.config().financialExecution).toBe(false);expect(network).not.toHaveBeenCalled();
});

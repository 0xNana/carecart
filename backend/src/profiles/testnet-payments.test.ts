import {it,expect,vi,afterEach} from 'vitest';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {KeyPair,Account} from 'near-api-js';
import {PROJECT_ROOT} from './storage';
import {testnetPayments,assertTestnetPayments} from './testnet-payments';
import {SafetyVaultClient} from '../near/safety-client';
const clinicId=randomUUID();
function fixture(){return {version:1,ownerApproved:true,clinicId,suppliers:['medsupply-a.carecart.testnet','medsupply-b.carecart.testnet','medsupply-v2-c.carecart.testnet'],profile:{version:2,network:'testnet',rpcUrl:'https://test.rpc.fastnear.com',vault:'safety-v2.carecart.testnet',token:'token-v2.carecart.testnet',decimals:6,admin:'admin.carecart.testnet',guardian:'guardian-v2.carecart.testnet',treasury:'treasury.carecart.testnet',committer:'committer-v2.carecart.testnet',requester:'agent-v2.carecart.testnet',committerPublicKey:KeyPair.fromRandom('ed25519').getPublicKey().toString(),requesterPublicKey:KeyPair.fromRandom('ed25519').getPublicKey().toString(),maxKeyAllowanceYocto:'200000000000000000000000',codeHash:'BCpcRunpuzhjrshyq1yrKtsmABrAAPy6ZFmMrUvUUqK3',testToken:{symbol:'CCUSD',codeHash:'8SHC5cfTSwdgKTtuCJPnsgNCj8Q9P3LpsAhLNDpMd6FW'},databasePath:join(PROJECT_ROOT,'backend/data/testnet-v2/clinics',clinicId,'state.sqlite')}};}
afterEach(()=>vi.restoreAllMocks());
it('requires owner-reviewed exact testnet release, clinic-owned path and finite native-only role separation',()=>{
 const f=fixture(),grant=testnetPayments(f);expect(assertTestnetPayments(grant.profile,clinicId,grant)).toBeUndefined();
 for(const delta of [{ownerApproved:false},{clinicId:randomUUID()},{suppliers:[f.profile.admin,...f.suppliers.slice(1)]},{profile:{...f.profile,network:'mainnet'}},{profile:{...f.profile,codeHash:'1'.repeat(44)}},{profile:{...f.profile,maxKeyAllowanceYocto:'0'}},{profile:{...f.profile,maxKeyAllowanceYocto:'200000000000000000000001'}},{profile:{...f.profile,databasePath:join(PROJECT_ROOT,'backend/data/testnet-v2/other/state.sqlite')}}])expect(()=>testnetPayments({...f,...delta})).toThrow();
 expect(()=>assertTestnetPayments(grant.profile,randomUUID(),grant)).toThrow();expect(()=>assertTestnetPayments({...grant.profile,requesterPublicKey:KeyPair.fromRandom('ed25519').getPublicKey().toString()},clinicId,grant)).toThrow();
});
it('an activation manifest or forged tenant permit cannot turn arbitrary credentials into public signing authority',()=>{
 const f=testnetPayments(fixture()),sign=vi.spyOn(Account.prototype,'callFunctionRaw').mockRejectedValue(new Error('UNAUTHORIZED'));
 expect(()=>new SafetyVaultClient(f.profile,{requester:'not-loaded'},undefined,undefined)).toThrow();expect(sign).not.toHaveBeenCalled();
});

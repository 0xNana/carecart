import {afterEach, expect, it, vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {rmSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {Account, KeyPair} from 'near-api-js';
import {PROJECT_ROOT} from './storage';
import {testnetProfile} from './testnet';
import {safetyProfile} from '../near/safety-profile';
import {SafetyVaultClient, type SafetyReadTransport} from '../near/safety-client';
import {openInventoryOperations} from '../inventory/local';
import {financialPolicy} from '../near/human-review';
import {executeProcurementRole} from '../procurement/v2-bridge';
import {createOperationsApp} from '../operations/api';

const cleanups:(()=>void)[]=[];
afterEach(()=>{for(const close of cleanups.splice(0).reverse())close();vi.restoreAllMocks();});
function fixture(){
 const name='test-'+randomUUID();
 const profile=testnetProfile({version:2,network:'testnet',rpcUrl:'https://test.rpc.fastnear.com',
  vault:'safety-v2.carecart.testnet',token:'token-v2.carecart.testnet',decimals:6,
  admin:'admin.carecart.testnet',guardian:'guardian-v2.carecart.testnet',treasury:'treasury.carecart.testnet',
  committer:'committer-v2.carecart.testnet',requester:'agent-v2.carecart.testnet',
  committerPublicKey:KeyPair.fromRandom('ed25519').getPublicKey().toString(),requesterPublicKey:KeyPair.fromRandom('ed25519').getPublicKey().toString(),
  maxKeyAllowanceYocto:'200000000000000000000000',codeHash:'3'.repeat(44),
  testToken:{symbol:'CCUSD',codeHash:'2'.repeat(44)},databasePath:join(PROJECT_ROOT,'backend/data/testnet-v2',name,'state.sqlite')}).profile;
 cleanups.push(()=>rmSync(dirname(profile.databasePath),{recursive:true,force:true}));
 return {name,profile,suppliers:['medsupply-a.carecart.testnet','medsupply-b.carecart.testnet','medsupply-v2-c.carecart.testnet']};
}
it('pins a test-only six-decimal asset and rejects mainnet, Sandbox, legacy state and RPC fallback',()=>{
 const {profile}=fixture();expect(profile.testToken?.symbol).toBe('CCUSD');
 for(const delta of [{network:'mainnet'},{rpcUrl:'https://rpc.mainnet.near.org'},{rpcUrl:'http://127.0.0.1:3030'},
  {token:'token.carecart.testnet',decimals:0},{databasePath:join(PROJECT_ROOT,'backend/data/local-v2/other.sqlite')},
  {databasePath:join(PROJECT_ROOT,'backend/data/testnet-smoke.sqlite')},{databasePath:':memory:'},
  {testToken:undefined},{testToken:{symbol:'USDC',codeHash:'2'.repeat(44)}}])expect(()=>testnetProfile({...profile,...delta})).toThrow();
 expect(()=>safetyProfile({...profile,network:'mainnet'})).toThrow();
});
it('uses the real ledger, monitor and P1/P2 selection for testnet terms without relabeling mainnet records',async()=>{
 const testnet=fixture();let local=openInventoryOperations(testnet.name,Date.now,{dataset:'clinic',testnet});
 cleanups.push(()=>local.close());
 const sign=vi.spyOn(Account.prototype,'callFunctionRaw').mockRejectedValue(new Error('PUBLIC_SIGNING_FORBIDDEN'));
 local.inventory.configure({...local.inventory.config(),monitoring:true,automaticCases:true,automaticPreparation:true},'operator:test');
 local.inventory.move({id:'consume',productId:'mn-item-1',kind:'Consume',quantity:4,unit:'base',source:'manual'},'operator:test');
 for(let i=0;i<6;i++)expect(local.monitor.runOnce('testnet-preparation')?.state).toBe('Completed');
 const obligation=local.inventory.dashboard().obligations[0],c=local.workflow.get(obligation.caseId),order=local.store.resolve(c.poId!).canonical;
 expect(order).toMatchObject({profile:'testnet',token:testnet.profile.token,supplier:testnet.suppliers[0],destination:'Near'});
 expect(order.po_id).toMatch(/^tn-po-/);expect(c.domain!.quote.asset).toBe('CCUSD');expect(c.state).toBe('PoDrafted');
 const before=local.inventory.balance('mn-item-1').onHand;expect(before).toBe(26);
 const transport={viewNodeStatus:async()=>({chain_id:'testnet'}),viewAccount:async({accountId}:{accountId:string})=>({code_hash:accountId===order.token?testnet.profile.testToken!.codeHash:testnet.profile.codeHash}),
  callFunction:async({method,args}:{method:string;args:Record<string,unknown>})=>method==='ft_metadata'?{spec:'ft-1.0.0',symbol:'CCUSD',decimals:6}:method==='get_purchase_order'?order:method==='get_roles'?{supplier:args.account===order.supplier,committer:false,requester:false}:
  {profile:'testnet',admin:testnet.profile.admin,guardian:testnet.profile.guardian,treasury:testnet.profile.treasury,token:order.token,paused:false,spendable:'5000000',usage:{spent:'0',reserved:'0'},policy:{auto_per_po_limit:'10000000',hard_payout_limit:'25000000',daily_dispatch_limit:'25000000',accepted_deposit_ceiling:'5000000'}}} as unknown as SafetyReadTransport;
 const client=new SafetyVaultClient(testnet.profile,undefined,undefined,transport);
 expect(await client.canonicalOrder(order.po_id)).toEqual(order);
 expect(await financialPolicy(client,order)).toMatchObject({blocks:[],humanRequired:false});
 const originalStatus=transport.viewNodeStatus;
 transport.viewNodeStatus=async()=>({chain_id:'mainnet'}) as never;
 await expect(new SafetyVaultClient(testnet.profile,undefined,undefined,transport).canonicalOrder(order.po_id)).rejects.toThrow(/chain mismatch/);
 transport.viewNodeStatus=originalStatus;
 const originalAccount=transport.viewAccount;
 transport.viewAccount=async()=>({code_hash:'4'.repeat(44)}) as never;
 await expect(new SafetyVaultClient(testnet.profile,undefined,undefined,transport).canonicalOrder(order.po_id)).rejects.toThrow(/Unreviewed/);
 transport.viewAccount=originalAccount;
 await expect(client.finalTransaction('3'.repeat(44))).rejects.toThrow(/Injected/);
 expect(()=>new SafetyVaultClient(testnet.profile,{requester:'not-loaded'})).toThrow(/activation.*disabled/i);
 await expect(executeProcurementRole(local.store,'requester',{poId:order.po_id,expectedHash:c.poHash},{CARECART_SAFETY_WRITES:'approved',SAFETY_REQUESTER_PRIVATE_KEY:'not-loaded'})).rejects.toThrow(/activation.*disabled/i);
 expect(local.inventory.balance('mn-item-1').onHand).toBe(before);
 local.inventory.move({id:'physical-receipt',productId:'mn-item-1',kind:'Receive',quantity:30,unit:'base',source:'manual',orderId:order.po_id,receiptReference:'TESTNET-DELIVERY-1',supplierId:c.domain!.quote.supplierId},'operator:test');
 expect(()=>local.inventory.move({id:'duplicate',productId:'mn-item-1',kind:'Receive',quantity:30,unit:'base',source:'manual',receiptReference:'TESTNET-DELIVERY-1'},'operator:test')).toThrow();
 local.close();local=openInventoryOperations(testnet.name,Date.now,{dataset:'clinic',testnet});
 for(let i=0;i<6;i++)local.monitor.runOnce('restarted');
 expect(local.store.resolve(order.po_id).canonical).toEqual(order);expect(local.inventory.balance('mn-item-1').onHand).toBe(56);
 expect(local.workflow.get(c.caseId).paymentState).toBe('Unobserved');expect(sign).not.toHaveBeenCalled();
});
it('keeps the testnet preparation API authenticated and rejects every financial binding',async()=>{
 const testnet=fixture(),local=openInventoryOperations(testnet.name,Date.now,{dataset:'clinic',testnet});
 cleanups.push(()=>local.close());const origin='http://127.0.0.1:3005',credential='synthetic-operator-'.repeat(3);
 const options={workflow:local.workflow,inventory:local.inventory,origin,operatorCredential:credential};
 const app=createOperationsApp(options);
 try{
  expect((await app.inject('/api/operations/stock')).statusCode).toBe(401);
  const login=await app.inject({method:'POST',url:'/api/operations/login',headers:{origin},payload:{credential}});
  const cookie=String(login.headers['set-cookie']).split(';')[0];
  const s=(await app.inject({url:'/api/operations/session',headers:{cookie}})).json();
  expect(s.deployment).toBe('testnet-preparation');expect(s.walletMode).toBe('disabled');
  const post=await app.inject({method:'POST',url:'/api/operations/stock/movements',headers:{cookie,origin,'x-csrf-token':s.csrf,'x-operation-nonce':s.nonce},
   payload:{requestId:randomUUID(),movement:{id:'http-consume',productId:'mn-item-1',kind:'Consume',quantity:4,unit:'base',source:'manual'}}});
  expect(post.statusCode).toBe(200);expect(local.inventory.balance('mn-item-1').onHand).toBe(26);
  expect(()=>createOperationsApp({...options,financial:{} as never})).toThrow(/preparation/i);
  expect(()=>createOperationsApp({...options,humanReview:{} as never})).toThrow(/preparation/i);
 }finally{await app.close();}
});

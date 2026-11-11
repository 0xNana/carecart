import {afterEach, expect, it, vi} from 'vitest';
import {Account} from 'near-api-js';
import {openDatabase, loadDomainRecords} from '../db';
import {seedSyntheticData} from '../seed';
import {createServer,startServer} from '../server';
import {VaultPaymentAdapter, type PaymentOutcome} from '../payments/adapter';

const cleanups:(()=>Promise<unknown>|void)[]=[];
afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();vi.restoreAllMocks();vi.unstubAllEnvs();});
function fixture(){
 const database=openDatabase(':memory:');seedSyntheticData(database);
 const sign=vi.spyOn(Account.prototype,'callFunctionRaw').mockRejectedValue(new Error('SIGNING_FORBIDDEN'));
 const adapter=new VaultPaymentAdapter(database,{
  getPurchaseOrder:vi.fn(),getPaymentState:vi.fn(),commitPurchaseOrder:vi.fn(),requestPayment:vi.fn(),
 },{tokenAccountId:'token.testnet',assetCode:'CCTEST'});
 const payment=vi.spyOn(adapter,'requestPayment').mockResolvedValue({} as PaymentOutcome);
 const app=createServer({database});
 cleanups.push(()=>{database.close();},()=>app.close());
 return {app,database,payment,sign,adapter};
}
const attempts=[
 ['/api/supplier-quotes',{itemId:'item-000001'}],
 ['/api/purchase-orders',{requestId:'anonymous-request',itemId:'item-000001',quoteId:'quote-000002'}],
 ['/api/agent/tasks',{itemId:'item-000001',quoteId:'quote-000002'}],
 ['/api/agent/tick',{itemId:'item-000001'}],
 ['/api/payments',{purchaseOrderId:'po-000001'}],
] as const;
it('retires every legacy mutation before persistence, adapter invocation or signing',async()=>{
 const {app,database,payment,sign}=fixture();const before=loadDomainRecords(database);
 for(const [url,payload] of attempts){
  const response=await app.inject({method:'POST',url,payload});
  expect(response.statusCode,url).toBe(410);
  expect(response.json().error.code).toBe('LEGACY_EXECUTION_RETIRED');
 }
 expect(loadDomainRecords(database)).toEqual(before);expect(payment).not.toHaveBeenCalled();expect(sign).not.toHaveBeenCalled();
});
it('forged roles, identities, cookies, bearer tokens and environment labels cannot restore retired execution',async()=>{
 const {app,database,payment,sign}=fixture();const before=loadDomainRecords(database);
 for(const token of ['', 'invalid', 'a'.repeat(64)])for(const [url,payload] of attempts){
  const response=await app.inject({method:'POST',url,headers:{origin:'http://localhost:3000',cookie:`carecart_ops=${token}`,authorization:'Bearer forged-operator','x-role':'operator'},
   payload:{...payload,userId:'admin',role:'operator',walletAddress:'admin.testnet',environment:'testnet'}});
  expect(response.statusCode).toBe(410);
 }
 expect(loadDomainRecords(database)).toEqual(before);expect(payment).not.toHaveBeenCalled();expect(sign).not.toHaveBeenCalled();
});
it('repeated and concurrent anonymous payment/PO requests cannot create work or invoke an adapter',async()=>{
 const {app,database,payment,sign}=fixture();const before=loadDomainRecords(database);
 const responses=await Promise.all(Array.from({length:20},(_,i)=>{
  const [url,payload]=attempts[i%attempts.length];return app.inject({method:'POST',url,payload});
 }));
 expect(responses.every(r=>r.statusCode===410)).toBe(true);
 expect(loadDomainRecords(database)).toEqual(before);expect(payment).not.toHaveBeenCalled();expect(sign).not.toHaveBeenCalled();
});
it('keeps synthetic reads available without any financial or procurement mutation capability',async()=>{
 const {app,payment,sign}=fixture();
 for(const url of ['/api/dashboard','/api/inventory','/api/inventory/item-000001/forecast'])
  expect((await app.inject(url)).statusCode).toBe(200);
 expect(payment).not.toHaveBeenCalled();expect(sign).not.toHaveBeenCalled();
});
it('refuses attempts to attach payment or legacy AI dependencies to the public server',()=>{
 const {database,adapter,payment,sign}=fixture();
 const injected={database,paymentAdapter:adapter};
 expect(()=>createServer(injected)).toThrow(/dependencies.*forbidden/i);
 expect(()=>createServer({database,manualAi:{}} as Parameters<typeof createServer>[0])).toThrow(/dependencies.*forbidden/i);
 expect(payment).not.toHaveBeenCalled();expect(sign).not.toHaveBeenCalled();
});
it('rejects inherited signing credentials and non-demo journals before opening state or listening',async()=>{
 vi.stubEnv('PO_COMMITTER_PRIVATE_KEY','not-a-real-key');
 await expect(startServer()).rejects.toThrow(/credentials.*forbidden/i);
 vi.stubEnv('PO_COMMITTER_PRIVATE_KEY','');vi.stubEnv('CARECART_DATABASE_PATH','backend/data/sandbox-v2/state.sqlite');
 await expect(startServer()).rejects.toThrow(/database is fixed/);
});

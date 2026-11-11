import {PUBLIC_TOKENS} from '../near/token-registry';
import {afterEach,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';import {rmSync} from 'node:fs';import {dirname,join} from 'node:path';
import {KeyPair,baseEncode} from 'near-api-js';import {quoteHash,type QuoteResponse} from '@defuse-protocol/one-click-sdk-typescript';
import {openLocalOperations} from './local';import {createOperationsApp} from './api';
import {syntheticLocalCatalog} from '../procurement/v2-catalog';import {V2ProcurementStore} from '../procurement/v2-store';
import {ReplenishmentWorkflow} from '../workflow/cases';import {observeVault} from '../workflow/capabilities';
import {SafetyVaultClient,type SafetyReadTransport} from '../near/safety-client';
import {SettlementJournal} from '../intents/journal';import * as settlement from '../intents/settlement';
import {signed,tokens} from '../intents/fixtures/settlement';
const cleanup:(()=>void|Promise<void>)[]=[];afterEach(async()=>{for(const c of cleanup.splice(0).reverse())await c();vi.restoreAllMocks();vi.unstubAllGlobals();});
it.each(['approve','reject'] as const)('MOCK PROVIDER/RPC/WALLET + REAL FIXTURE CRYPTO: Base %s joins API, immutable review and case observation',async action=>{
 const template=openLocalOperations(`base-wallet-${randomUUID()}`);const folder=dirname(template.store.profile.databasePath);
 cleanup.push(()=>rmSync(folder,{recursive:true,force:true}));cleanup.push(()=>template.close());
 const route={route_id:'base-fixture',version:1,supplier:'supplier-a.local-ops.near',recipient:`0x${'a'.repeat(40)}`,
  asset_id:`nep141:base-${settlement.BASE_USDC}.omft.near`,active:true};
 const catalog=syntheticLocalCatalog(['a','b','c'].map((s,i)=>({id:`mn-supplier-${i+1}`,account:`supplier-${s}.local-ops.near`,destination:i===0?{Base:route}:'Near'})));
 const store=new V2ProcurementStore({...template.store.profile,databasePath:join(folder,'base-state.sqlite')},catalog);cleanup.push(()=>store.close());
 const workflow=new ReplenishmentWorkflow(store);cleanup.push(()=>workflow.close());
 const c=workflow.ingest({caseId:'base-case',itemId:'mn-item-1',eventId:'base-event',idempotencyKey:'base-event'});const canonical=c.domain!.purchaseOrder.canonical;const p=store.profile;
 const now=new Date();const order:settlement.SettlementOrder={profile:'local-usdc-v2',poId:c.poId!,vault:p.vault,treasury:p.treasury,supplier:canonical.supplier,token:settlement.NEAR_USDC,
  amount:canonical.amount,invoiceDigest:canonical.invoice_digest,routeId:route.route_id,routeVersion:1,recipient:route.recipient,destinationChain:'base',destinationToken:settlement.BASE_USDC,maxFeeAtomic:'100000'};
 const list=tokens.map(t=>t.blockchain==='base'?{...t,assetId:route.asset_id}:t);const expected=settlement.buildSettlementRequest(order,list,now);
 const key=KeyPair.fromRandom('ed25519');const raw=(await signed()).raw;raw.timestamp=now.toISOString();raw.quoteRequest=expected;
 Object.assign(raw.quote,{amountIn:order.amount,minAmountIn:order.amount,amountOut:(BigInt(order.amount)-1000n).toString(),minAmountOut:(BigInt(order.amount)-2000n).toString(),deadline:expected.deadline,timeWhenInactive:expected.deadline});
 raw.signature=baseEncode(key.sign(new TextEncoder().encode(quoteHash(raw as unknown as QuoteResponse))).signature);
 const q=settlement.verifySettlementQuote(order,raw,expected,now,key.getPublicKey().toString());
 const original=settlement.revalidateStoredQuote;
 // Only this explicit test trust root is substituted. The actual signature, signed bytes, expiry and token verification execute.
 vi.spyOn(settlement,'revalidateStoredQuote').mockImplementation((stored,list)=>original(stored,list,new Date(),key.getPublicKey().toString()));
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json(list)));
 const journal=new SettlementJournal(p.databasePath,store.fingerprint);cleanup.push(()=>journal.close());journal.prepare('base-attempt',q);
 const quote={attempt_id:'base-attempt',po_id:c.poId!,route_id:route.route_id,route_version:1,signed_quote_hash:q.identityHash,deposit_account:raw.quote.depositAddress,
  deadline_ns:(BigInt(Date.parse(q.expiresAt))*1_000_000n).toString(),min_amount_out:raw.quote.minAmountOut,storage_deposit_yocto:'1000000000000000000000'};
 const payment={status:'PendingApproval',reason:'None',attempt_id:'base-attempt',reserved_day:0};
 const transport={viewNodeStatus:async()=>({chain_id:p.network}),viewAccount:async({accountId}:{accountId:string})=>({code_hash:accountId===p.token?PUBLIC_TOKENS[p.network].codeHash:p.codeHash}),callFunction:async({method}:{method:string})=>{
  if(method==='ft_metadata')return {decimals:6,symbol:'USDC',spec:'ft-1.0.0'};if(method==='get_state')return {profile:p.network,admin:p.admin,guardian:p.guardian,treasury:p.treasury,token:p.token,paused:false,
   spendable:'5000000',policy:{auto_per_po_limit:'10000000',hard_payout_limit:'25000000',daily_dispatch_limit:'25000000',accepted_deposit_ceiling:'5000000'},usage:{spent:'0',reserved:'0'}};
  if(method==='get_roles')return {supplier:true,committer:false,requester:false};if(method==='get_purchase_order')return canonical;
  if(method==='get_payment')return payment;if(method==='get_route')return route;if(method==='get_quote')return quote;throw new Error('Unexpected mocked read');
 }} as unknown as SafetyReadTransport;
 const client=new SafetyVaultClient(p,undefined,undefined,transport);
 workflow.observe(c.caseId,await observeVault(store,c.poId!,'mocked-rpc',new Date(),client));
 let submissions=0;
 const app=createOperationsApp({workflow,origin:'http://localhost:3000',operatorCredential:'operator-'.repeat(5),humanReview:{kind:'mocked-rpc',client,
  mockWallet:async()=>{submissions++;payment.status=action==='approve'?'Dispatched':'Rejected';return `mock:${randomUUID()}`;}}});cleanup.push(()=>app.close());
 const login=await app.inject({method:'POST',url:'/api/operations/login',headers:{origin:'http://localhost:3000'},payload:{credential:'operator-'.repeat(5)}});
 const cookie=login.headers['set-cookie']!.toString().split(';')[0];
 const mutate=async(url:string,payload:object)=>{const s=(await app.inject({url:'/api/operations/session',headers:{cookie}})).json();
  return app.inject({method:'POST',url:'/api/operations/'+url,headers:{cookie,origin:'http://localhost:3000','x-csrf-token':s.csrf,'x-operation-nonce':s.nonce},payload});};
 const response=await mutate(`cases/${c.caseId}/wallet-reviews`,{requestId:randomUUID(),action,expectedRevision:workflow.get(c.caseId).version});expect(response.statusCode).toBe(200);
 const r=response.json().review;expect(r.terms.transaction.actions[0].params.deposit).toBe('1');
 if(action==='approve'){
  expect(r.terms.base.quote.signedBytesBase64).toBe(q.signedBytesBase64);quote.min_amount_out='1';
  expect((await mutate(`wallet-reviews/${r.id}/handoff`,{requestId:randomUUID(),termsHash:r.termsHash})).statusCode).not.toBe(200);
  quote.min_amount_out=raw.quote.minAmountOut;
 }else expect(r.terms.transaction.actions[0].params.args).toEqual({po_id:c.poId});
 expect((await mutate(`wallet-reviews/${r.id}/handoff`,{requestId:randomUUID(),termsHash:r.termsHash})).statusCode).toBe(200);
 const tx=await mutate(`wallet-reviews/${r.id}/mock-wallet`,{requestId:randomUUID()});expect(tx.statusCode).toBe(200);
 expect((await mutate(`wallet-reviews/${r.id}/report`,{requestId:randomUUID(),outcome:'Submitted',transactionHash:tx.json().transactionHash})).statusCode).toBe(200);
 expect(workflow.get(c.caseId).state).toBe('AwaitingHumanApproval');
 expect((await mutate(`wallet-reviews/${r.id}/reconcile`,{requestId:randomUUID()})).statusCode).toBe(200);
 const after=workflow.get(c.caseId);expect(after.state).toBe(action==='approve'?'SourceDispatched':'Rejected');expect(after.settlement).toBeNull();expect(submissions).toBe(1);
 expect(after.evidenceKind).toBe('mocked-rpc');
});

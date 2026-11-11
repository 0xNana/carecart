import {PUBLIC_TOKENS} from '../near/token-registry';
import { afterEach, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { Account, JsonRpcProvider, KeyPair, baseEncode } from 'near-api-js';
import { quoteHash, type QuoteResponse } from '@defuse-protocol/one-click-sdk-typescript';
import { PROJECT_ROOT } from '../profiles/storage';
import { safetyProfile } from '../near/safety-profile';
import { quoteCommitmentHash, SafetyOrderSchema, type SafetyOrder } from '../near/commitments';
import { SettlementQuotes, BASE_USDC, NEAR_USDC, digest, buildSettlementRequest, verifySettlementQuote, type SettlementOrder } from '../intents/settlement';
import { signed } from '../intents/fixtures/settlement';
import { SettlementJournal } from '../intents/journal';
import { syntheticLocalCatalog } from '../procurement/v2-catalog';
import { V2ProcurementStore } from '../procurement/v2-store';
import { reconcileProcurement } from '../procurement/v2-bridge';
import { ReplenishmentWorkflow } from './cases';
import { OperationJournal } from '../near/operation-journal';
import { observeVault, settlementCapability } from './capabilities';

const now = new Date('2026-11-03T12:00:00Z');
const stores: V2ProcurementStore[] = [];
const directories: string[] = [];
const workflows: ReplenishmentWorkflow[] = [];
afterEach(() => {
  for (const workflow of workflows.splice(0)) workflow.close();
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
  vi.restoreAllMocks();vi.unstubAllGlobals();
});

function fixture(options: { base?: boolean; aboveAuto?: boolean } = {}) {
  const parent = join(PROJECT_ROOT, 'backend/data/local-v2'); mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(join(parent, 'bridge-test-')); directories.push(directory);
  const committer = KeyPair.fromRandom('ed25519'), requester = KeyPair.fromRandom('ed25519');
  const profile = safetyProfile({ version: 2, network: 'mainnet', rpcUrl: 'https://rpc.mainnet.near.org',
    vault: 'vault.demo.near', admin: 'admin.demo.near', guardian: 'guardian.demo.near', treasury: 'treasury.demo.near',
    committer: 'committer.demo.near', requester: 'requester.demo.near', token: NEAR_USDC, decimals: 6,
    committerPublicKey: committer.getPublicKey().toString(), requesterPublicKey: requester.getPublicKey().toString(),
    maxKeyAllowanceYocto: '20000000000000000000000', codeHash: '1'.repeat(44), databasePath: join(directory, 'state.sqlite'),
  }).profile;
  const route = { route_id: 'base-alpha', version: 1, supplier: 'supplier-a.demo.near', recipient: `0x${'a'.repeat(40)}`,
    asset_id: `nep141:base-${BASE_USDC}.omft.near`, active: true };
  const catalog = syntheticLocalCatalog(['a', 'b', 'c'].map((letter, index) => ({ id: `mn-supplier-${index + 1}`,
    account: `supplier-${letter}.demo.near`, destination: options.base && index === 0 ? { Base: route } : 'Near' })));
  if (options.aboveAuto) for (const entry of catalog.entries) if (entry.itemId === 'mn-item-1') entry.unitPriceAtomic = '1000001';
  const store = new V2ProcurementStore(profile, catalog); stores.push(store);
  const orders = new Map<string, SafetyOrder>();
  const payments = new Map<string, { status: string; reason: string; attempt_id: string; reserved_day: number }>();
  const faults = { wrongNetwork: false, wrongDecimals: false, unknownSupplier: false, timeout: false, noEffect: false };
  // Real v2 client and journals; RPC/signing transport alone is replaced. No transaction is signed.
  vi.spyOn(JsonRpcProvider.prototype, 'viewNodeStatus').mockImplementation(async () => ({ chain_id: faults.wrongNetwork ? 'testnet' : 'mainnet' }) as never);
  vi.spyOn(JsonRpcProvider.prototype, 'viewAccount').mockImplementation(async({accountId})=>({code_hash:accountId===profile.token?PUBLIC_TOKENS[profile.network].codeHash:profile.codeHash}) as never);
  vi.spyOn(JsonRpcProvider.prototype, 'viewAccessKey').mockImplementation(async ({ accountId }) => ({ permission: { FunctionCall: {
    receiver_id: profile.vault, allowance: '10000000000000000000000',
    method_names: accountId === profile.committer ? ['commit_purchase_order', 'commit_quote'] : ['request_payment', 'request_crosschain'],
  } } }) as never);
  vi.spyOn(JsonRpcProvider.prototype, 'callFunction').mockImplementation(async ({ method, args }) => {
    const input = args as Record<string, string>;
    if (method === 'ft_metadata') return { decimals: faults.wrongDecimals ? 0 : 6, symbol: 'USDC',spec:'ft-1.0.0' };
    if (method === 'get_state') return { profile: 'mainnet', admin: profile.admin, guardian: profile.guardian, treasury: profile.treasury, token: profile.token };
    if (method === 'get_roles') return { supplier: !faults.unknownSupplier, committer: input.account === profile.committer, requester: input.account === profile.requester };
    if (method === 'get_purchase_order') return orders.get(input.po_id);
    if (method === 'get_payment') return payments.get(input.po_id);
    if (method === 'get_route') return route;
    throw new Error(`Unexpected fixture RPC ${method}`);
  });
  const transport = vi.spyOn(Account.prototype, 'callFunctionRaw').mockImplementation(async function (this: Account, input) {
    if (input.methodName === 'commit_purchase_order') {
      expect(this.accountId).toBe(profile.committer);
      const order = SafetyOrderSchema.parse((input.args as { order: unknown }).order);
      orders.set(order.po_id, order);
      payments.set(order.po_id, { status: 'Committed', reason: 'None', attempt_id: '', reserved_day: 0 });
    } else if (input.methodName === 'request_payment') {
      expect(this.accountId).toBe(profile.requester);
      const { po_id } = input.args as { po_id: string };
      expect(Object.keys(input.args!)).toEqual(['po_id']);
      if (!faults.noEffect) payments.set(po_id, { status: BigInt(orders.get(po_id)!.amount) > 10_000_000n ? 'PendingApproval' : 'Dispatching',
        reason: options.aboveAuto ? 'AutoThreshold' : 'None', attempt_id: '', reserved_day: 1 });
      if (faults.timeout) throw new Error('fixture RPC timeout');
    } else throw new Error('Unexpected signing capability');
    return { transaction: { hash: `mock-transaction-${transport.mock.calls.length}` } } as never;
  });
  const env = (role: 'committer' | 'requester') => ({ CARECART_SAFETY_WRITES: 'approved',
    ...(role === 'committer' ? { SAFETY_COMMITTER_PRIVATE_KEY: committer.toString() } : { SAFETY_REQUESTER_PRIVATE_KEY: requester.toString() }) });
  const select = (itemId = 'mn-item-1') => {
    store.inventoryEvent({ eventId: 'inventory-1', itemId }, now);
    const order = store.selectQuote({ eventId: 'inventory-1' }, now);
    return { order, input: { poId: order.canonical.po_id, expectedHash: digest(order.canonical) } };
  };
  return { store, profile, catalog, transport, orders, payments, faults, env, select };
}

const identity = { caseId:'case-1',idempotencyKey:'inventory-1',eventId:'inventory-1',itemId:'mn-item-1' };
function caseFixture(options: { base?: boolean; aboveAuto?: boolean } = {}) {
  const f = fixture(options); const workflow = new ReplenishmentWorkflow(f.store); workflows.push(workflow);
  const c = workflow.ingest(identity, now);
  const command = (role: 'committer'|'requester') => ({ caseId:c.caseId,role,expectedVersion:workflow.get(c.caseId).version,expectedHash:c.poHash! });
  const observe = async () => workflow.observe(c.caseId, await observeVault(f.store,c.poId!,'mocked-rpc',now));
  return { ...f,workflow,c,command,observe };
}
it('MOCKED RPC: coordinates separate roles, observes canonical success and never duplicates a request', async () => {
 const f = caseFixture();
 await f.workflow.act(f.command('committer'),f.env('committer'),now);
 expect(f.workflow.get(f.c.caseId).state).toBe('CommitmentPending');
 expect((await f.observe()).state).toBe('PoCommitted');
 await f.workflow.act(f.command('requester'),f.env('requester'),now);
 expect((await f.observe()).state).toBe('DispatchInProgress');
 await expect(f.workflow.act(f.command('requester'),f.env('requester'),now)).rejects.toThrow();
 expect(f.transport).toHaveBeenCalledTimes(2);
 f.payments.set(f.c.poId!,{status:'Paid',reason:'None',attempt_id:'',reserved_day:1});
 const paid = await f.observe();
 expect(paid.state).toBe('SameChainConfirmed'); expect(paid.evidenceKind).toBe('mocked-rpc');
 expect(paid.paymentState).toBe('Paid');
});
it('refuses forged financial observations and unauthorized workflow actions before any transport', async () => {
 const f = caseFixture();
 expect(() => f.workflow.observe(f.c.caseId,{payment:{status:'Paid'}} as never)).toThrow(/observation/);
 await expect(f.workflow.act(f.command('requester'),f.env('requester'),now)).rejects.toThrow();
 await expect(f.workflow.act(f.command('committer'),{},now)).rejects.toThrow();
 expect(f.workflow.get(f.c.caseId).state).toBe('PoDrafted'); expect(f.transport).not.toHaveBeenCalled();
});

it('MOCKED RPC: preserves uncertain commitment across reopen and requires positive reconciliation without another send', async () => {
 const f=caseFixture(); f.transport.mockImplementationOnce(async () => {throw new Error('timeout');});
 await expect(f.workflow.act(f.command('committer'),f.env('committer'),now)).rejects.toThrow(/reconciliation/);
 expect(f.workflow.get(f.c.caseId).state).toBe('RequiresReconciliation');
 f.workflow.close(); const reopened=new ReplenishmentWorkflow(f.store); workflows.push(reopened);
 await expect(reopened.act({caseId:f.c.caseId,role:'committer',expectedHash:f.c.poHash!,expectedVersion:reopened.get(f.c.caseId).version},f.env('committer'),now)).rejects.toThrow();
 expect(f.transport).toHaveBeenCalledTimes(1);
 await expect(reopened.reconcile(f.c.caseId,'commit')).rejects.toThrow();
 f.orders.set(f.c.poId!,f.c.domain!.purchaseOrder.canonical);
 f.payments.set(f.c.poId!,{status:'Committed',reason:'None',attempt_id:'',reserved_day:0});
 await reconcileProcurement(f.store,{poId:f.c.poId!,operation:'commit'},now);
 expect(reopened.observe(f.c.caseId,await observeVault(f.store,f.c.poId!,'mocked-rpc',now)).state).toBe('PoCommitted');
 expect(f.transport).toHaveBeenCalledTimes(1);
});
it('MOCKED RPC: above-threshold request stops for human review, then canonical rejection remains terminal', async () => {
 const f=caseFixture({aboveAuto:true});
 await f.workflow.act(f.command('committer'),f.env('committer'),now); await f.observe();
 await f.workflow.act(f.command('requester'),f.env('requester'),now);
 const pending=await f.observe(); expect(pending.state).toBe('AwaitingHumanApproval'); expect(pending.humanInterventions).toContain('HumanWalletReview');
 f.payments.set(f.c.poId!,{status:'Rejected',reason:'None',attempt_id:'',reserved_day:1});
 expect((await f.observe()).state).toBe('Rejected');
 f.payments.set(f.c.poId!,{status:'Paid',reason:'None',attempt_id:'',reserved_day:1});
 await expect(f.observe()).rejects.toThrow(/Unauthorized/);
 expect(f.workflow.get(f.c.caseId).state).toBe('Rejected');
});
it.each(['Paid','Failed'])('MOCKED RPC: late %s callback across UTC midnight updates workflow only from fresh canonical state', async status => {
 const f=caseFixture(); await f.workflow.act(f.command('committer'),f.env('committer'),now); await f.observe();
 await f.workflow.act(f.command('requester'),f.env('requester'),now); await f.observe();
 const tomorrow=new Date(now.getTime()+86400000);
 f.payments.set(f.c.poId!,{status,reason:'None',attempt_id:'',reserved_day:1});
 const observation=await observeVault(f.store,f.c.poId!,'mocked-rpc',tomorrow);
 const c=f.workflow.observe(f.c.caseId,observation);
 expect(c.state).toBe(status==='Paid'?'SameChainConfirmed':'Failed'); expect(c.vault!.payment.reserved_day).toBe(1);
 // Workflow performs no reservation accounting; Rust tests verify original-day release/debit.
});
it('MOCKED RPC: Base source dispatch never becomes destination settlement from journal labels', async () => {
 const f=caseFixture({base:true}); await f.workflow.act(f.command('committer'),f.env('committer'),now); await f.observe();
 expect(f.workflow.get(f.c.caseId).nextAction).toBe('HumanCrossChainReview');
 await expect(f.workflow.act(f.command('requester'),f.env('requester'),now)).rejects.toThrow(/human review/);
 f.payments.set(f.c.poId!,{status:'Dispatched',reason:'None',attempt_id:'base-attempt',reserved_day:1});
 const c=await f.observe(); expect(c.state).toBe('SourceDispatched'); expect(c.settlement).toBeNull();
 expect(c.nextAction).toBe('VerifyDestinationOrRefund'); expect(f.transport).toHaveBeenCalledTimes(1);
});
it('MOCKED RPC: concurrent operators cannot both submit the same commitment', async () => {
 const f=caseFixture(); const other=new ReplenishmentWorkflow(f.store); workflows.push(other); const command=f.command('committer');
 const results=await Promise.allSettled([f.workflow.act(command,f.env('committer'),now),other.act(command,f.env('committer'),now)]);
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1); expect(f.transport).toHaveBeenCalledTimes(1);
});
it('MOCKED RPC: refuses missing/corrupt operation evidence and cannot use cached P1 success as a case transition', async () => {
 const f=caseFixture(); await f.workflow.act(f.command('committer'),f.env('committer'),now);
 expect(f.workflow.get(f.c.caseId).state).toBe('CommitmentPending');
 const db=new Database(f.profile.databasePath);
 try { db.prepare("UPDATE backend_operations SET evidence='not-json'").run(); await expect(f.observe()).rejects.toThrow();
   db.prepare('DELETE FROM backend_operations').run(); await expect(f.observe()).rejects.toThrow(/Missing operation/);
 } finally {db.close();}
 expect(f.workflow.get(f.c.caseId).state).toBe('CommitmentPending'); expect(f.transport).toHaveBeenCalledTimes(1);
});
it('MOCKED RPC: refuses changed PO authority, stale observations and overlapping role environments', async () => {
 const f=caseFixture();
 await expect(f.workflow.act(f.command('committer'),{...f.env('committer'),AGENT_FC_PRIVATE_KEY:'legacy-crossover'},now)).rejects.toThrow(/Separate/);
 await f.workflow.act(f.command('committer'),f.env('committer'),now); await f.observe();
 const stale=await observeVault(f.store,f.c.poId!,'mocked-rpc',new Date(now.getTime()-1000));
 expect(()=>f.workflow.observe(f.c.caseId,stale)).toThrow(/Stale/);
 f.orders.set(f.c.poId!,{...f.c.domain!.purchaseOrder.canonical,amount:'4000000'});
 await expect(f.observe()).rejects.toThrow(/conflict/); expect(f.transport).toHaveBeenCalledTimes(1);
});

async function settlementFixture(kind:'settlement'|'refund',partial=false) {
 const f=caseFixture({base:true}); await f.workflow.act(f.command('committer'),f.env('committer'),now); await f.observe();
 const supplier=f.catalog.suppliers[0]; if(supplier.destination==='Near')throw new Error('Base fixture required'); const route=supplier.destination.Base;
 const canonical=f.c.domain!.purchaseOrder.canonical;
 const order:SettlementOrder={profile:'local-usdc-v2',poId:f.c.poId!,vault:f.profile.vault,treasury:f.profile.treasury,
  supplier:canonical.supplier,token:NEAR_USDC,amount:canonical.amount,invoiceDigest:canonical.invoice_digest,
  routeId:route.route_id,routeVersion:route.version,recipient:route.recipient,destinationChain:'base',destinationToken:BASE_USDC,maxFeeAtomic:'100000'};
 const tokens=[{assetId:`nep141:${NEAR_USDC}`,blockchain:'near',contractAddress:NEAR_USDC,symbol:'USDC',decimals:6},
  {assetId:route.asset_id,blockchain:'base',contractAddress:BASE_USDC,symbol:'USDC',decimals:6}];
 const expected=buildSettlementRequest(order,tokens,now);const {raw,key}=await signed();
 raw.timestamp=now.toISOString();raw.quoteRequest=expected;raw.quote.deadline=expected.deadline;raw.quote.timeWhenInactive=expected.deadline;
 raw.signature=baseEncode(key.sign(new TextEncoder().encode(quoteHash(raw as unknown as QuoteResponse))).signature);
 const verified=verifySettlementQuote(order,raw,expected,now,key.getPublicKey().toString());
 const journal=new SettlementJournal(f.profile.databasePath,f.store.fingerprint);journal.prepare('base-attempt',verified);
 f.payments.set(f.c.poId!,{status:'Dispatched',reason:'None',attempt_id:'base-attempt',reserved_day:1});
 const commitment={attempt_id:'base-attempt',po_id:f.c.poId!,route_id:route.route_id,route_version:route.version,signed_quote_hash:verified.identityHash,
  deposit_account:raw.quote.depositAddress,deadline_ns:(BigInt(Date.parse(expected.deadline))*1000000n).toString(),min_amount_out:'980000',storage_deposit_yocto:'0'};
 const lookup=vi.mocked(JsonRpcProvider.prototype.callFunction);const original=lookup.getMockImplementation()!;
 lookup.mockImplementation(async input => input.method==='get_quote'?commitment:original(input));
 const refundAmount=partial?'999000':order.amount;
 function transfer(txHash:string,oldOwner:string,newOwner:string,amount:string) {
  return {final_execution_status:'FINAL',status:{SuccessValue:''},transaction:{hash:txHash},receipts_outcome:[{id:`receipt-${txHash}`,
   outcome:{executor_id:NEAR_USDC,status:{SuccessValue:''},logs:[`EVENT_JSON:${JSON.stringify({standard:'nep141',event:'ft_transfer',data:[{old_owner_id:oldOwner,new_owner_id:newOwner,amount}]})}`]}}]};
 }
 const source={...transfer('source-proof',f.profile.vault,raw.quote.depositAddress,order.amount),transaction:{hash:'source-proof',signer_id:f.profile.admin,
  receiver_id:f.profile.vault,actions:[{FunctionCall:{method_name:'approve_payment',deposit:'1',gas:120000000000000,
   args:Buffer.from(JSON.stringify({po_id:order.poId,expected_quote_hash:verified.identityHash,expected_commitment_hash:quoteCommitmentHash(commitment)})).toString('base64')}}]}};
 vi.spyOn(JsonRpcProvider.prototype,'viewTransactionStatusWithReceipts').mockImplementation(async input =>
  (input.txHash==='source-proof'?source:transfer('refund-proof','intents.near',f.profile.treasury,refundAmount)) as never);
 const destHash=`0x${'d'.repeat(64)}`; const blockHash=`0x${'e'.repeat(64)}`;
 vi.spyOn(SettlementQuotes.prototype,'status').mockResolvedValue({status:kind==='settlement'?'SUCCESS':'REFUNDED',correlationId:'fixture',updatedAt:now.toISOString(),quoteResponse:raw,
  swapDetails:{destinationChainTxHashes:kind==='settlement'?[{hash:destHash,explorerUrl:'https://example.invalid'}]:[],
   originChainTxHashes:kind==='refund'?[{hash:'refund-proof',explorerUrl:'https://example.invalid'}]:[],refundedAmount:refundAmount}});
 const fault={wrongReceipt:false};
 vi.stubGlobal('fetch',vi.fn(async(_url:unknown,init:RequestInit)=>{
  const {method}=JSON.parse(String(init.body));const result=method==='eth_chainId'?'0x2105':method==='eth_getBlockByNumber'?{number:'0x10',hash:blockHash}:
   {transactionHash:destHash,status:'0x1',blockNumber:'0x10',blockHash,logs:[{address:BASE_USDC,
    topics:['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',`0x${'0'.repeat(64)}`,`0x${(fault.wrongReceipt?'c'.repeat(40):order.recipient.slice(2)).padStart(64,'0')}`],
    data:`0x${BigInt(990000).toString(16).padStart(64,'0')}`,logIndex:'0x0'}]};return Response.json({jsonrpc:'2.0',id:1,result});}));
 const capability=settlementCapability(f.store,{baseRpcUrl:'https://base.example.invalid',apiKey:'',refundSigners:{'refund-proof':'intents.near'},kind:'mocked-rpc',clock:()=>now});
 return {...f,journal,capability,fault};
}
it('MOCKED RPC: destination settlement requires independent source and Base receipt verification, including after restart',async()=>{
 const f=await settlementFixture('settlement');
 try {
  const operations=new OperationJournal(f.profile.databasePath,f.store.fingerprint);
  const intent={method:'request_crosschain',args:{po_id:f.c.poId!,attempt_id:'base-attempt'}};
  operations.begin('request_crosschain:base-attempt',intent);
  operations.confirm('request_crosschain:base-attempt',intent,{transactionHash:'mock-source-request',reconciled:false});operations.close();
  expect(f.workflow.get(f.c.caseId).operationIds).toContain('request_crosschain:base-attempt');
  expect(f.workflow.get(f.c.caseId).domain!.operations).toEqual(expect.arrayContaining([expect.objectContaining({operation_key:'request_crosschain:base-attempt'})]));
  const observation=await f.capability.reconcile(f.c.poId!,'base-attempt','source-proof');
  expect(f.workflow.observe(f.c.caseId,observation).state).toBe('DestinationSettled');
  f.workflow.close();const reopened=new ReplenishmentWorkflow(f.store);workflows.push(reopened);
  expect(reopened.get(f.c.caseId).state).toBe('DestinationSettled');
  f.fault.wrongReceipt=true;
  // Even a terminal journal is reverified; it cannot substitute for a destination receipt.
  await expect(f.capability.reconcile(f.c.poId!,'base-attempt','source-proof')).rejects.toThrow(/receipt unavailable/);
 } finally {f.journal.close();vi.unstubAllGlobals();}
});
it.each([false,true])('MOCKED RPC: refund is terminal and preserves partial/full distinction (%s)',async partial=>{
 const f=await settlementFixture('refund',partial);
 try {
  const observation=await f.capability.reconcile(f.c.poId!,'base-attempt','source-proof');
  const c=f.workflow.observe(f.c.caseId,observation);expect(c.state).toBe('Refunded');expect(c.settlement!.fullRefund).toBe(!partial);
  expect(c.humanInterventions.includes('ReviewPartialRefund')).toBe(partial);
  // A source-only observation cannot erase the independently checked refund.
  await expect(f.observe()).rejects.toThrow(/Unauthorized/);
 } finally {f.journal.close();vi.unstubAllGlobals();}
});
it('MOCKED RPC: provider SUCCESS with wrong destination receipt remains source-dispatched',async()=>{
 const f=await settlementFixture('settlement');
 try {f.fault.wrongReceipt=true;const observation=await f.capability.reconcile(f.c.poId!,'base-attempt','source-proof');
  expect(f.workflow.observe(f.c.caseId,observation).state).toBe('SourceDispatched');
 } finally {f.journal.close();vi.unstubAllGlobals();}
});

it('MOCKED RPC: observation/local-write crash boundary rolls back the entire audit transition and reobserves safely',async()=>{
 const f=caseFixture();await f.workflow.act(f.command('committer'),f.env('committer'),now);await f.observe();
 await f.workflow.act(f.command('requester'),f.env('requester'),now);await f.observe();
 f.payments.set(f.c.poId!,{status:'Paid',reason:'None',attempt_id:'',reserved_day:1});
 const observation=await observeVault(f.store,f.c.poId!,'mocked-rpc',now);const before=f.workflow.get(f.c.caseId);
 const db=new Database(f.profile.databasePath);
 try {
  db.exec("CREATE TRIGGER test_abort_case_update BEFORE UPDATE ON replenishment_cases BEGIN SELECT RAISE(ABORT,'fixture crash at local update'); END");
  expect(()=>f.workflow.observe(f.c.caseId,observation,before.version)).toThrow(/fixture crash/);
  expect(f.workflow.get(f.c.caseId)).toEqual(before);
  db.exec('DROP TRIGGER test_abort_case_update');
  f.workflow.close();const reopened=new ReplenishmentWorkflow(f.store);workflows.push(reopened);
  expect(reopened.observe(f.c.caseId,await observeVault(f.store,f.c.poId!,'mocked-rpc',now),before.version).state).toBe('SameChainConfirmed');
  expect(f.transport).toHaveBeenCalledTimes(2);
 } finally {db.close();}
});
it('MOCKED RPC: no-effect request timeout stays frozen across reopen despite elapsed time',async()=>{
 const f=caseFixture();await f.workflow.act(f.command('committer'),f.env('committer'),now);await f.observe();
 f.faults.timeout=true;f.faults.noEffect=true;
 await expect(f.workflow.act(f.command('requester'),f.env('requester'),now)).rejects.toThrow(/reconciliation/);
 f.workflow.close();const reopened=new ReplenishmentWorkflow(f.store);workflows.push(reopened);
 const later=new Date(now.getTime()+10*86400000);
 expect(reopened.prepare(f.c.caseId,later).state).toBe('RequiresReconciliation');
 await expect(reopened.act({caseId:f.c.caseId,role:'requester',expectedHash:f.c.poHash!,expectedVersion:reopened.get(f.c.caseId).version},f.env('requester'),later)).rejects.toThrow();
 expect(f.transport).toHaveBeenCalledTimes(2);
});

it('MOCKED RPC: JSON clones cannot manufacture financial observations and sealed evidence is immutable',async()=>{
 const f=caseFixture();await f.workflow.act(f.command('committer'),f.env('committer'),now);
 const observation=await observeVault(f.store,f.c.poId!,'mocked-rpc',now);
 const forged=JSON.parse(JSON.stringify(observation));forged.payment.status='Paid';
 expect(()=>f.workflow.observe(f.c.caseId,forged)).toThrow(/capability observation/);
 expect(Object.isFrozen(observation.payment)).toBe(true);
 expect(()=>{observation.payment.status='Paid';}).toThrow();
 expect(f.workflow.observe(f.c.caseId,observation).state).toBe('PoCommitted');
});

it('MOCKED RPC: an executed commitment with failed local journal confirmation reconciles without a second send',async()=>{
 const f=caseFixture();
 // Initialize only the existing operation journal schema, then fail the confirmation transaction.
 const journal=new OperationJournal(f.profile.databasePath,f.store.fingerprint);journal.close();
 const db=new Database(f.profile.databasePath);
 try {
  db.exec("CREATE TRIGGER test_abort_confirmation BEFORE INSERT ON backend_operations WHEN NEW.state='Confirmed' BEGIN SELECT RAISE(ABORT,'fixture journal crash'); END");
  await expect(f.workflow.act(f.command('committer'),f.env('committer'),now)).rejects.toThrow(/reconciliation/);
  expect(f.orders.has(f.c.poId!)).toBe(true);expect(f.workflow.get(f.c.caseId).state).toBe('RequiresReconciliation');
  db.exec('DROP TRIGGER test_abort_confirmation');
  await reconcileProcurement(f.store,{poId:f.c.poId!,operation:'commit'},now);
  expect((await f.observe()).state).toBe('PoCommitted');expect(f.transport).toHaveBeenCalledTimes(1);
 } finally {db.close();}
});
it('MOCKED RPC: refuses an expired draft before authorizing or invoking a commitment',async()=>{
 const f=caseFixture();const later=new Date(now.getTime()+8*86400000);
 await expect(f.workflow.act(f.command('committer'),f.env('committer'),later)).rejects.toThrow(/quote expired/);
 const unchanged=f.workflow.get(f.c.caseId);expect(unchanged.state).toBe('PoDrafted');expect(unchanged.version).toBe(f.c.version);
 expect(f.transport).not.toHaveBeenCalled();
});

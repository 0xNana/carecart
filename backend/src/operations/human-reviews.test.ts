import {afterEach,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';import {rmSync} from 'node:fs';import {basename,dirname} from 'node:path';
import {openLocalOperations} from './local';import {MockWalletLedger} from './mock-wallet-ledger';
import {HumanReviews} from './human-reviews';import {OperatorAuth} from './auth';import {createOperationsApp} from './api';
import {SafetyVaultClient} from '../near/safety-client';
const cleanup:(()=>void|Promise<void>)[]=[];
afterEach(async()=>{for(const f of cleanup.splice(0).reverse())await f();vi.restoreAllMocks();});
async function fixture(seed=true){
 const local=openLocalOperations(`wallet-test-${randomUUID()}`);let clock=Date.now();const ledger=new MockWalletLedger(local.workflow,()=>clock);
 cleanup.push(()=>rmSync(dirname(local.store.profile.databasePath),{recursive:true,force:true}));cleanup.push(()=>local.close());cleanup.push(()=>ledger.close());
 const c=local.workflow.ingest({caseId:'wallet-case',itemId:'mn-item-1',eventId:'wallet-event',idempotencyKey:'wallet-event'});
 clock=Date.now();if(seed)await ledger.seedPending(c.caseId);
 const auth=new OperatorAuth(local.store,'http://localhost:3000','operator-'.repeat(5),'viewer-'.repeat(6),()=>clock);cleanup.push(()=>auth.close());
 const login=auth.login('operator-'.repeat(5));const s=auth.session(login.token);const reviews=new HumanReviews(local.workflow,auth,ledger.binding);
 const prepare=(action:'approve'|'reject'='approve')=>reviews.prepare(c.caseId,{requestId:randomUUID(),action,expectedRevision:local.workflow.get(c.caseId).version},s,auth.issueNonce(s));
 const handoff=(r:Awaited<ReturnType<typeof prepare>>)=>reviews.handoff(r.id,{requestId:randomUUID(),termsHash:r.termsHash},s,auth.issueNonce(s));
 return {local,ledger,auth,s,reviews,c,login,prepare,handoff,advance:(ms:number)=>{clock+=ms;}};
}
it('MOCK WALLET/RPC: independently reviews, hands off once and records submission without payment success',async()=>{
 const f=await fixture();const r=await f.prepare();expect(r.state).toBe('Prepared');expect(r.terms!.transaction.actions[0].params.deposit).toBe('1');
 expect(f.local.workflow.get(f.c.caseId).state).toBe('AwaitingHumanApproval');
 await f.handoff(r);await expect(f.handoff(r)).rejects.toThrow(/STALE_OR_UNRESOLVED/);
 const tx=await f.reviews.mockSubmit(r.id,{requestId:randomUUID()},f.s,f.auth.issueNonce(f.s));expect(tx.simulated).toBe(true);
 const report=f.reviews.report(r.id,{requestId:randomUUID(),outcome:'Submitted',transactionHash:tx.transactionHash},f.s,f.auth.issueNonce(f.s));
 expect(report.state).toBe('Submitted');expect(report.transactionVerified).toBe(false);expect(f.local.workflow.get(f.c.caseId).state).toBe('AwaitingHumanApproval');
 await f.reviews.reconcile(r.id);expect(f.local.workflow.get(f.c.caseId).state).toBe('DispatchInProgress');
 expect(f.local.workflow.get(f.c.caseId).evidenceKind).toBe('mocked-rpc');
});
it('MOCK WALLET/RPC: delayed callbacks and UTC rollover require a new independent read',async()=>{
 const f=await fixture();const r=await f.prepare();await f.handoff(r);await f.reviews.mockSubmit(r.id,{requestId:randomUUID()},f.s,f.auth.issueNonce(f.s));
 await f.reviews.reconcile(r.id);const before=f.local.workflow.get(f.c.caseId);f.advance(86400000);
 f.ledger.callback(f.c.poId!,'Paid');expect(f.local.workflow.get(f.c.caseId).state).toBe('DispatchInProgress');
 await f.reviews.reconcile(r.id);const after=f.local.workflow.get(f.c.caseId);
 expect(after.state).toBe('SameChainConfirmed');expect(after.vault!.payment.reserved_day).toBe(before.vault!.payment.reserved_day);
 expect(f.ledger.accounting().usage).toEqual({spent:'0',reserved:'0'});expect(BigInt(f.ledger.accounting().spendable)).toBe(5_000_000n-BigInt(r.terms!.order.amount));
 expect(after.evidenceKind).toBe('mocked-rpc');expect(f.reviews.get(r.id).transactionVerified).toBe(false);
});
it('MOCK WALLET/RPC: failed callbacks release mock reservations exactly once without exceeding accepted funds',async()=>{
 const f=await fixture();const r=await f.prepare();await f.handoff(r);const amount=BigInt(r.terms!.order.amount);
 await f.reviews.mockSubmit(r.id,{requestId:randomUUID()},f.s,f.auth.issueNonce(f.s));
 expect(BigInt(f.ledger.accounting().spendable)).toBe(5_000_000n-amount);expect(BigInt(f.ledger.accounting().usage.reserved)).toBe(amount);
 f.ledger.callback(f.c.poId!,'Failed');expect(f.ledger.accounting().spendable).toBe('5000000');expect(f.ledger.accounting().usage.reserved).toBe('0');
 expect(()=>f.ledger.callback(f.c.poId!,'Failed')).toThrow(/pending mock callback/);
 await f.reviews.reconcile(r.id);expect(f.local.workflow.get(f.c.caseId).state).toBe('Failed');
});
it('MOCK WALLET/RPC: rejection is terminal and a later contradictory Paid observation fails closed',async()=>{
 const f=await fixture();const r=await f.prepare('reject');expect(r.terms!.transaction.actions[0].params.args).toEqual({po_id:f.c.poId});
 await f.handoff(r);await f.reviews.mockSubmit(r.id,{requestId:randomUUID()},f.s,f.auth.issueNonce(f.s));await f.reviews.reconcile(r.id);
 expect(f.local.workflow.get(f.c.caseId).state).toBe('Rejected');
 f.ledger.db.prepare("UPDATE mock_wallet_vault SET payment_json=? WHERE po_id=?").run(JSON.stringify({status:'Paid',reason:'None',attempt_id:'',reserved_day:0}),f.c.poId);
 await expect(f.reviews.reconcile(r.id)).rejects.toThrow(/Unauthorized workflow transition/);
 expect(f.local.workflow.get(f.c.caseId).state).toBe('Rejected');
});
it('MOCK WALLET/RPC: no committed PO, altered amount and altered recipient cannot reach handoff',async()=>{
 const missing=await fixture(false);await expect(missing.prepare()).rejects.toThrow(/Canonical v2 record unavailable/);
 const f=await fixture();const r=await f.prepare();const order=structuredClone(r.terms!.order);order.supplier='attacker.near';
 f.ledger.db.prepare('UPDATE mock_wallet_vault SET order_json=? WHERE po_id=?').run(JSON.stringify(order),f.c.poId);
 await expect(f.handoff(r)).rejects.toThrow(/Canonical PO changed/);expect(f.reviews.get(r.id).state).toBe('Prepared');
 order.supplier=r.terms!.order.supplier;order.amount='1';f.ledger.db.prepare('UPDATE mock_wallet_vault SET order_json=? WHERE po_id=?').run(JSON.stringify(order),f.c.poId);
 await expect(f.handoff(r)).rejects.toThrow(/Canonical PO changed/);
});
it('MOCK WALLET/RPC: changed committed hash, pending state or daily policy blocks handoff',async()=>{
 const f=await fixture();const r=await f.prepare();
 f.ledger.db.prepare('UPDATE mock_wallet_vault SET payment_json=? WHERE po_id=?').run(JSON.stringify({...r.terms!.payment,status:'Rejected'}),f.c.poId);
 await expect(f.handoff(r)).rejects.toThrow(/not pending/);
});
it('MOCK WALLET/RPC: duplicate requests are idempotent, conflicting payloads and concurrent handoffs fail',async()=>{
 const f=await fixture();const input={requestId:randomUUID(),action:'approve',expectedRevision:f.local.workflow.get(f.c.caseId).version};const nonce=f.auth.issueNonce(f.s);
 const r=await f.reviews.prepare(f.c.caseId,input,f.s,nonce);
 expect((await f.reviews.prepare(f.c.caseId,input,f.s,nonce)).id).toBe(r.id);
 await expect(f.reviews.prepare(f.c.caseId,{...input,action:'reject'},f.s,nonce)).rejects.toThrow(/NONCE_REPLAY/);
 const results=await Promise.allSettled([f.handoff(r),f.handoff(r)]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
});
it('MOCK WALLET/RPC: expiry and pre-handoff cancellation are safe; post-handoff cancellation stays ambiguous',async()=>{
 const f=await fixture();const r=await f.prepare();f.advance(120001);await expect(f.handoff(r)).rejects.toThrow(/STALE_OR_UNRESOLVED/);
 expect((await f.reviews.reconcile(r.id)).state).toBe('Expired');const next=await f.prepare();
 expect(f.reviews.report(next.id,{requestId:randomUUID(),outcome:'Cancelled',transactionHash:null},f.s,f.auth.issueNonce(f.s)).state).toBe('Cancelled');
 const sent=await f.prepare();await f.handoff(sent);
 expect(f.reviews.report(sent.id,{requestId:randomUUID(),outcome:'Cancelled',transactionHash:null},f.s,f.auth.issueNonce(f.s)).state).toBe('Ambiguous');
 await f.reviews.reconcile(sent.id);await expect(f.prepare()).rejects.toThrow(/WALLET_REVIEW_UNRESOLVED/);
});
it('MOCK WALLET/RPC: ambiguous handoff survives reopen without replay or inferred non-execution',async()=>{
 const f=await fixture();const r=await f.prepare();await f.handoff(r);const before=f.reviews.get(r.id);
 f.auth.close();f.ledger.close();f.local.close();
 const local=openLocalOperations(basename(dirname(f.local.store.profile.databasePath)));const ledger=new MockWalletLedger(local.workflow);
 const auth=new OperatorAuth(local.store,'http://localhost:3000','operator-'.repeat(5),'viewer-'.repeat(6));
 cleanup.push(()=>local.close());cleanup.push(()=>ledger.close());cleanup.push(()=>auth.close());const reviews=new HumanReviews(local.workflow,auth,ledger.binding);
 expect(reviews.get(r.id)).toEqual(before);expect((await reviews.reconcile(r.id)).state).toBe('Handoff');
 expect(local.workflow.get(f.c.caseId).state).toBe('AwaitingHumanApproval');
});
it('MOCK WALLET/RPC: missing audit or corrupt review terms fail closed',async()=>{
 const f=await fixture();const r=await f.prepare();
 f.auth.database.prepare("UPDATE human_wallet_reviews SET terms_json='{}' WHERE id=?").run(r.id);expect(()=>f.reviews.get(r.id)).toThrow(/WALLET_EVIDENCE_INVALID/);
 f.auth.database.prepare('UPDATE human_wallet_reviews SET terms_json=? WHERE id=?').run(JSON.stringify(r.terms),r.id);
 f.auth.database.prepare('DELETE FROM human_wallet_events WHERE review_id=?').run(r.id);expect(()=>f.reviews.get(r.id)).toThrow(/WALLET_EVIDENCE_INVALID/);
});
it('MOCK WALLET/RPC: requester credentials cannot cross into the key-free review process',async()=>{
 const f=await fixture();const signedClient=new SafetyVaultClient(f.local.store.profile,{requester:'not-an-operational-key'});
 expect(()=>new HumanReviews(f.local.workflow,f.auth,{kind:'mocked-rpc',client:signedClient})).toThrow(/Signing authority is forbidden/);
 expect(()=>new HumanReviews(f.local.workflow,f.auth,{kind:'public-rpc',client:f.ledger.binding.client})).toThrow(/Injected reads must be labeled mocked/);
});
it('MOCK WALLET/RPC: a forged wallet success report cannot advance canonical payment state',async()=>{
 const f=await fixture();const r=await f.prepare();await f.handoff(r);
 f.reviews.report(r.id,{requestId:randomUUID(),outcome:'Submitted',transactionHash:`mock:${randomUUID()}`},f.s,f.auth.issueNonce(f.s));
 expect((await f.reviews.reconcile(r.id)).state).toBe('Submitted');expect(f.local.workflow.get(f.c.caseId).state).toBe('AwaitingHumanApproval');
 await expect(f.prepare()).rejects.toThrow(/UNRESOLVED/);
});
it('MOCK WALLET/RPC API: authentication, operator role, CSRF, replay, signing isolation and strict bodies apply',async()=>{
 const f=await fixture();const app=createOperationsApp({workflow:f.local.workflow,origin:'http://localhost:3000',operatorCredential:'operator-'.repeat(5),viewerCredential:'viewer-'.repeat(6),humanReview:f.ledger.binding});cleanup.push(()=>app.close());
 const url=`/api/operations/cases/${f.c.caseId}/wallet-reviews`;
 expect((await app.inject({method:'POST',url,payload:{}})).statusCode).toBe(401);
 const viewerLogin=await app.inject({method:'POST',url:'/api/operations/login',headers:{origin:'http://localhost:3000'},payload:{credential:'viewer-'.repeat(6)}});
 const viewerCookie=viewerLogin.headers['set-cookie']!.toString().split(';')[0];
 expect((await app.inject({method:'POST',url,headers:{cookie:viewerCookie},payload:{}})).statusCode).toBe(403);
 const cookie=`carecart_ops=${f.login.token}`;const session=(await app.inject({url:'/api/operations/session',headers:{cookie}})).json();
 const headers={cookie,origin:'http://localhost:3000','x-csrf-token':session.csrf,'x-operation-nonce':session.nonce};
 const payload={requestId:randomUUID(),action:'approve',expectedRevision:f.local.workflow.get(f.c.caseId).version};
 expect((await app.inject({method:'POST',url,headers:{...headers,origin:'http://evil.invalid'},payload})).statusCode).toBe(403);
 expect((await app.inject({method:'POST',url,headers,payload:{...payload,recipient:'attacker.near',amount:'1'}})).statusCode).toBe(400);
 const prepared=await app.inject({method:'POST',url,headers,payload});expect(prepared.statusCode).toBe(200);
 expect((await app.inject({method:'POST',url,headers,payload:{...payload,requestId:randomUUID()}})).statusCode).toBe(409);
 expect((await app.inject({method:'POST',url:'/api/operations/request_payment',headers,payload:{poId:f.c.poId}})).statusCode).toBe(404);
 expect(prepared.body).not.toMatch(/PRIVATE_KEY|fixture-provider-secret/);
});

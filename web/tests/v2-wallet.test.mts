import {test} from 'node:test';import assert from 'node:assert/strict';
import {V2WalletController,V2WalletPendingError,jsonHash,validateWalletReview,type WalletReview,type V2Wallet,type WalletProfile,type WalletReviewApi} from '../src/lib/v2-wallet.ts';
const profile:WalletProfile={profileFingerprint:'a'.repeat(64),network:'mainnet',vault:'vault.local-ops.near',admin:'admin.local-ops.near',codeHash:'1'.repeat(44),token:'native-usdc-fixture',decimals:6};
async function fixture(base=false){
 const order={po_id:'mn-po-'+'b'.repeat(56),profile:'mainnet' as const,supplier:'supplier.local-ops.near',token:'native-usdc-fixture',amount:'1000000',invoice_digest:'c'.repeat(64),
  destination:base?{Base:{route_id:'base-route',version:1,route_hash:'f'.repeat(64)}}:'Near' as const};
 const args=base?{po_id:order.po_id,expected_quote_hash:'d'.repeat(64),expected_commitment_hash:'e'.repeat(64)}:{po_id:order.po_id,expected_quote_hash:null,expected_commitment_hash:null};
 const review:WalletReview={id:crypto.randomUUID(),caseId:'case-local',state:'Prepared',termsHash:null,expiresAt:new Date(Date.now()+60000).toISOString(),execution:'mocked-rpc',publicSigningEnabled:false,transactionHash:null,transactionVerified:false,events:[],
  terms:{abi:'carecart-safety-vault-v2',profileFingerprint:profile.profileFingerprint,codeHash:profile.codeHash,action:'approve',canonicalHash:await jsonHash(order),order,recipient:base?'0x'+'a'.repeat(40):order.supplier,
   payment:{status:'PendingApproval',reason:'AutoThreshold',attempt_id:base?'attempt-base':''},policy:{hard_payout_limit:'25000000'},spendable:'5000000',usage:{spent:'0',reserved:'0'},approvalBlocks:[],
   transaction:{network:'mainnet',receiverId:profile.vault,signerId:profile.admin,actions:[{type:'FunctionCall',params:{methodName:'approve_payment',args,deposit:'1',gas:'120000000000000'}}]},
   base:base?{summary:{quoteIdentityHash:'d'.repeat(64),quoteCommitmentHash:'e'.repeat(64),reviewValidUntil:new Date(Date.now()+60000).toISOString()},quote:{signature:'mock-verified-elsewhere'},commitment:{},reviewHash:'1'.repeat(64)}:null}};
 review.termsHash=await jsonHash(review.terms);
 let signed=0;let handoffs=0;const reports:{outcome:string;hash:string|null}[]=[];
 const wallet:V2Wallet={execution:'isolated-mock',getNetwork:async()=>profile.network,getAccounts:async()=>[{accountId:profile.admin}],signAndSendTransaction:async tx=>{assert.equal(tx.actions[0].params.deposit,'1');signed++;return {transactionHash:'mock:'+crypto.randomUUID()};}};
 const api:WalletReviewApi={handoff:async()=>{handoffs++;return {...structuredClone(review),state:'Handoff'};},report:async(_id,outcome,hash)=>{reports.push({outcome,hash});return {...structuredClone(review),state:outcome==='Submitted'?'Submitted':'Ambiguous',transactionHash:hash};}};
 return {review,wallet,api,reports,controller:new V2WalletController(profile),signed:()=>signed,handoffs:()=>handoffs};
}
test('MOCK WALLET: explicit approval returns only an unverified submission report',async()=>{
 const f=await fixture();const result=await f.controller.submit(f.review,f.wallet,f.api,true);
 assert.equal(result.state,'Submitted');assert.equal(result.transactionVerified,false);assert.equal(f.signed(),1);assert.equal(f.handoffs(),1);
});
test('MOCK WALLET: no signing without explicit human confirmation',async()=>{
 const f=await fixture();await assert.rejects(f.controller.submit(f.review,f.wallet,f.api,false),/EXPLICIT_HUMAN/);assert.equal(f.signed(),0);assert.equal(f.handoffs(),0);
});
test('MOCK WALLET: wrong network, wrong signer, wrong contract and wrong ABI are refused',async()=>{
 for(const attack of ['network','signer','contract','abi']){const f=await fixture();
  if(attack==='network')f.wallet.getNetwork=async()=>'testnet';
  if(attack==='signer')f.wallet.getAccounts=async()=>[{accountId:'requester.local-ops.near'}];
  if(attack==='contract')f.review.terms!.transaction.receiverId='attacker.near';
  if(attack==='abi')Object.assign(f.review.terms!,{abi:'legacy-v1'});
  f.review.termsHash=await jsonHash(f.review.terms);
  await assert.rejects(f.controller.submit(f.review,f.wallet,f.api,true));assert.equal(f.signed(),0);assert.equal(f.handoffs(),0);
 }
});
test('MOCK WALLET: missing yocto, altered PO hash, amount, recipient and extra transaction actions fail',async()=>{
 for(const attack of ['deposit','hash','amount','recipient','actions']){const f=await fixture();const t=f.review.terms!;
  if(attack==='deposit')t.transaction.actions[0].params.deposit='0';if(attack==='hash')t.canonicalHash='0'.repeat(64);
  if(attack==='amount')t.order.amount='2';if(attack==='recipient')t.recipient='attacker.near';
  if(attack==='actions')t.transaction.actions.push(t.transaction.actions[0]);f.review.termsHash=await jsonHash(t);
  await assert.rejects(f.controller.submit(f.review,f.wallet,f.api,true));assert.equal(f.signed(),0);
 }
});
test('MOCK WALLET: Base approval binds both hashes; same-chain hashes must be null; rejection uses only PO ID',async()=>{
 const f=await fixture(true);await validateWalletReview(f.review);f.review.terms!.transaction.actions[0].params.args.expected_commitment_hash='f'.repeat(64);f.review.termsHash=await jsonHash(f.review.terms);
 await assert.rejects(validateWalletReview(f.review),/BASE_REVIEW_INVALID/);
 const near=await fixture();near.review.terms!.transaction.actions[0].params.args.expected_quote_hash='a'.repeat(64);near.review.termsHash=await jsonHash(near.review.terms);
 await assert.rejects(validateWalletReview(near.review),/SAME_CHAIN/);
 const rejected=await fixture();rejected.review.terms!.action='reject';rejected.review.terms!.transaction.actions[0].params.methodName='reject_payment';
 rejected.review.terms!.transaction.actions[0].params.args={po_id:rejected.review.terms!.order.po_id};rejected.review.termsHash=await jsonHash(rejected.review.terms);
 await validateWalletReview(rejected.review);
});
test('MOCK WALLET: expired review, expired Base quote and fabricated payment completion fail closed',async()=>{
 const expired=await fixture();expired.review.expiresAt='2000-01-01T00:00:00Z';await assert.rejects(validateWalletReview(expired.review),/EXPIRED/);
 const base=await fixture(true);base.review.terms!.base!.summary.reviewValidUntil='2000-01-01T00:00:00Z';base.review.termsHash=await jsonHash(base.review.terms);await assert.rejects(validateWalletReview(base.review));
 const paid=await fixture();paid.review.terms!.payment.status='Paid';paid.review.termsHash=await jsonHash(paid.review.terms);await assert.rejects(validateWalletReview(paid.review));
});
test('MOCK WALLET: account switching during revalidation stops signing and reports ambiguity',async()=>{
 const f=await fixture();let reads=0;f.wallet.getAccounts=async()=>[{accountId:++reads===1?profile.admin:'requester.local-ops.near'}];
 await assert.rejects(f.controller.submit(f.review,f.wallet,f.api,true),/ACCOUNT_CHANGED/);assert.equal(f.signed(),0);assert.equal(f.reports[0].outcome,'Ambiguous');
});
test('MOCK WALLET: changed revalidated transaction blocks signing',async()=>{
 const f=await fixture();f.api.handoff=async()=>{const changed=structuredClone(f.review);changed.state='Handoff';changed.terms!.transaction.receiverId='attacker.near';return changed;};
 await assert.rejects(f.controller.submit(f.review,f.wallet,f.api,true));assert.equal(f.signed(),0);assert.equal(f.reports[0].outcome,'Ambiguous');
});
test('MOCK WALLET: cancellation is reported without assuming non-execution',async()=>{
 const f=await fixture();f.wallet.signAndSendTransaction=async()=>{throw Object.assign(new Error('Wallet cancelled'),{code:4001});};
 await assert.rejects(f.controller.submit(f.review,f.wallet,f.api,true),/cancelled/);assert.equal(f.reports[0].outcome,'Cancelled');
});
test('MOCK WALLET: timeout does not cancel or resend; a late result is still recorded',async()=>{
 const f=await fixture();let resolve!:(value:unknown)=>void;f.wallet.signAndSendTransaction=()=>new Promise(r=>{resolve=r;});
 await assert.rejects(f.controller.submit(f.review,f.wallet,f.api,true,10),V2WalletPendingError);
 await assert.rejects(f.controller.submit(f.review,f.wallet,f.api,true),/ALREADY_ACTIVE/);assert.equal(f.handoffs(),1);
 resolve({transactionHash:'mock:'+crypto.randomUUID()});await new Promise(r=>setTimeout(r,0));assert.equal(f.reports[0].outcome,'Submitted');
});
test('MOCK WALLET: public evidence cannot enable signing in P3B',async()=>{
 const f=await fixture();f.review.execution='public-rpc';await assert.rejects(f.controller.submit(f.review,f.wallet,f.api,true),/PUBLIC_SIGNING_DISABLED/);assert.equal(f.signed(),0);
});
test('RENDERED UI / MOCK DATA: wallet review labels simulation, disables signing until confirmation and retains ambiguity',async()=>{
 const {mkdtempSync,writeFileSync,symlinkSync,readFileSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');
 const {join,resolve}=await import('node:path');const {pathToFileURL}=await import('node:url');const {default:ts}=await import('typescript');
 const {createElement}=await import('react');const {renderToStaticMarkup}=await import('react-dom/server');const folder=mkdtempSync(join(tmpdir(),'carecart-v2-ui-'));
 try{
  symlinkSync(resolve('node_modules'),join(folder,'node_modules'),'dir');
  const code=ts.transpileModule(readFileSync('src/components/v2-wallet-review.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText
   .replaceAll('../lib/v2-wallet',pathToFileURL(resolve('src/lib/v2-wallet.ts')).href);
  writeFileSync(join(folder,'review.mjs'),code);const {V2WalletReview}=await import(pathToFileURL(join(folder,'review.mjs')).href);
  const f=await fixture();const props={client:{},session:{role:'operator',walletMode:'isolated-mock',walletProfile:profile},caseId:f.review.caseId,revision:1,paymentState:'PendingApproval',reviews:[f.review],onRefresh:async()=>{}};
  const html=renderToStaticMarkup(createElement(V2WalletReview,props));assert.match(html,/simulated execution only/);assert.match(html,/exactly 1 yoctoNEAR/);assert.match(html,/disabled="">Confirm simulated wallet approval/);
  props.paymentState='Rejected';const stale=renderToStaticMarkup(createElement(V2WalletReview,props));assert.match(stale,/<input[^>]*disabled/);props.paymentState='PendingApproval';
  f.review.state='Ambiguous';const uncertain=renderToStaticMarkup(createElement(V2WalletReview,props));assert.match(uncertain,/Do not resend/);assert.match(uncertain,/verified transaction attribution: false/);
  assert.doesNotMatch(uncertain,/PRIVATE_KEY|OPERATOR_SECRET|NEAR_CLOUD_API_KEY/);
 }finally{rmSync(folder,{recursive:true,force:true});}
});

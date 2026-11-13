import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWorkflowProjection, caseStateLabel } from '../src/lib/workflow.ts';
const fixture = (kind='mocked-rpc',status='Paid',state='SameChainConfirmed') => ({format:'carecart-workflow-v1',dataOrigin:'synthetic',generatedAt:'2026-11-03T12:00:00Z',profileFingerprint:'a'.repeat(64),
 cases:[{caseId:'case-1',idempotencyKey:'e',eventId:'e',itemId:'mn-item-1',state,version:8,poId:'mn-po-'+ 'a'.repeat(56),poHash:'b'.repeat(64),nextAction:'InspectTerminalEvidence',humanInterventions:[],createdAt:'2026-11-03T12:00:00Z',updatedAt:'2026-11-03T12:00:00Z',
 inventory:{item:{name:'Synthetic saline',onHand:1,reorderPoint:5,usageUnits:60},forecasts:[{supplierId:'mn-supplier-1',leadTimeDays:3,leadTimeDemand:6,recommendedQuantity:10}],quotes:[{id:'q1',supplierId:'mn-supplier-1',supplierAccount:'supplier.demo.near',quantity:10,amountAtomic:'1000000',expiresAt:'2026-11-10T12:00:00Z'}]},
 domain:{purchaseOrder:{quoteId:'q1',decisionPolicy:'lowest-total-then-supplier-id-v1',canonical:{amount:'1000000',destination:'Near'}},operations:[],settlement:[]},
 paymentState:status,evidenceKind:kind,vault:kind==='local-only'?null:{kind,checkedAt:'2026-11-03T12:00:00Z',canonicalHash:'b'.repeat(64),payment:{status,reason:'None',attempt_id:'',reserved_day:1}},settlement:null,timeline:[]}]});

test('mocked confirmation is labeled as mocked execution, never a real USDC settlement',()=>{
 const c=parseWorkflowProjection(fixture()).cases[0];
 assert.equal(caseStateLabel(c),'Demo payment complete'); assert.doesNotMatch(caseStateLabel(c),/Testnet|Verified|USDC settled/);
});
test('saved public RPC evidence remains a recorded observation requiring revalidation',()=>{
 const c=parseWorkflowProjection(fixture('public-rpc')).cases[0];
 assert.equal(caseStateLabel(c),'Testnet payment confirmed');
});
test('rejects unsupported success, missing evidence and source dispatch relabeled as destination settlement',()=>{
 for(const f of [fixture('local-only'),fixture('mocked-rpc','Dispatching'),fixture('mocked-rpc','Dispatched','DestinationSettled')])
  assert.throws(()=>parseWorkflowProjection(f));
});
test('rejects unknown provenance, invalid integer amounts, duplicate cases and nonworkflow JSON',()=>{
 assert.throws(()=>parseWorkflowProjection({cases:[]}));
 assert.throws(()=>parseWorkflowProjection(fixture('verified-by-agent')));
 const amount=fixture(); amount.cases[0].domain.purchaseOrder.canonical.amount='1.000001'; assert.throws(()=>parseWorkflowProjection(amount));
 const duplicate=fixture();duplicate.cases.push(duplicate.cases[0]); assert.throws(()=>parseWorkflowProjection(duplicate));
});

test('renders persisted case data, mock labels, audit references and disabled financial controls',async()=>{
 const {mkdtempSync,writeFileSync,symlinkSync,readFileSync,rmSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');const {join,resolve}=await import('node:path');const {pathToFileURL}=await import('node:url');
 const {createElement}=await import('react');const {renderToStaticMarkup}=await import('react-dom/server');
 const {default:ts}=await import('typescript');
 const folder=mkdtempSync(join(tmpdir(),'carecart-workspace-'));
 try {
  symlinkSync(resolve('node_modules'),join(folder,'node_modules'),'dir');
  for(const [source,target] of [['src/lib/workflow.ts','workflow.mjs'],['src/components/operations-workspace.tsx','workspace.mjs']]) {
   let code=ts.transpileModule(readFileSync(source,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
   for(const [from,to] of [['./product-copy.ts',pathToFileURL(resolve('src/lib/product-copy.ts')).href],['../lib/product-copy',pathToFileURL(resolve('src/lib/product-copy.ts')).href],['../lib/workflow','./workflow.mjs'],['next/link','next/link.js']])code=code.replaceAll(`'${from}'`,`'${to}'`).replaceAll(`"${from}"`,`"${to}"`);
   writeFileSync(join(folder,target),code);
  }
  const {OperationsWorkspace}=await import(pathToFileURL(join(folder,'workspace.mjs')).href);
  const snapshot=fixture();snapshot.cases[0].inventory.item.name='<script>unsafe</script>';
  const withTimeline={...snapshot,cases:snapshot.cases.map(c=>({...c,timeline:[{eventType:'PoDrafted',previousState:'QuotesAvailable',resultingState:'PoDrafted',actor:'operator:demo',timestamp:'2026-11-03T12:00:00Z',evidenceReference:'b'.repeat(64),operationId:null}]}))};
  const html=renderToStaticMarkup(createElement(OperationsWorkspace,{initialProjection:parseWorkflowProjection(withTimeline)}));
  assert.match(html,/case-1/);assert.match(html,/Demo payment complete/);assert.doesNotMatch(html,/Mocked RPC|Mocked Paid/);
  const preparation=renderToStaticMarkup(createElement(OperationsWorkspace,{initialProjection:parseWorkflowProjection(snapshot),source:'authenticated',testnetAssets:true}));
  assert.match(preparation,/amounts in demo credits/);assert.doesNotMatch(preparation,/USDC|CCUSD/);
  assert.match(html,/This saved report is read-only/);assert.doesNotMatch(html,/Confirm payment|Authorize payment/);assert.match(html,/bbbbbbbbbbbbbbbbbbbb/);
  assert.doesNotMatch(html,/<script>unsafe/);assert.match(html,/&lt;script&gt;unsafe/);
  const empty=renderToStaticMarkup(createElement(OperationsWorkspace));assert.match(empty,/Choose a saved order report/);assert.doesNotMatch(empty,/case-1/);
 } finally {rmSync(folder,{recursive:true,force:true});}
});

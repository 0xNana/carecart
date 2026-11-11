import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePlaygroundRun} from '../test-support/synthetic-scenario.ts';
import {proxyOperatorRequest} from '../src/lib/operator-proxy.ts';

function fixture(){
 const fingerprint='a'.repeat(64);
 return {execution:'local-simulation',network:'none',financialExecution:false,
  projection:{format:'carecart-workflow-v1',dataOrigin:'synthetic',generatedAt:'2026-11-03T12:00:00Z',profileFingerprint:fingerprint,
   cases:[{caseId:'simulation-1',eventId:'stock-1',itemId:'mn-item-1',state:'PoDrafted',poId:'mn-po-'+'a'.repeat(56),poHash:'b'.repeat(64),
    nextAction:'AuthorizeCommitment',humanInterventions:['AuthorizeCommitment'],createdAt:'2026-11-03T12:00:00Z',updatedAt:'2026-11-03T12:00:00Z',paymentState:'Unobserved',evidenceKind:'local-only',
    inventory:{item:{name:'Gloves',onHand:8,reorderPoint:28,usageUnits:120},forecasts:[],quotes:[{id:'q1',supplierId:'mn-supplier-1',supplierAccount:'supplier-a.local-ops.near',quantity:40,amountAtomic:'2000000',expiresAt:'2026-11-03T13:00:00Z'}]},
    domain:{purchaseOrder:{quoteId:'q1',decisionPolicy:'lowest-total-then-supplier-id-v1',canonical:{amount:'2000000',destination:'Near'}},operations:[],settlement:[]},vault:null,settlement:null,timeline:[]}]},
  stock:{dataOrigin:'synthetic',financialExecution:false,profileFingerprint:fingerprint,config:{financialExecution:false},items:[],runs:[],obligations:[]}};
}
test('Playground accepts only an isolated local proposal with no public financial evidence',()=>{
 const f=fixture();const result=parsePlaygroundRun(f,'c'.repeat(64));
 assert.equal(result.projection.cases[0].selection?.amount,'2000000');
 assert.throws(()=>parsePlaygroundRun(f,'a'.repeat(64)),/ISOLATION/);
 for(const override of [{network:'mainnet'},{network:'testnet'},{financialExecution:true},{execution:'public-rpc'}])
  assert.throws(()=>parsePlaygroundRun({...fixture(),...override},'c'.repeat(64)),/ENVIRONMENT/);
 const fake=fixture();fake.projection.cases[0].paymentState='Paid';
 assert.throws(()=>parsePlaygroundRun(fake,'c'.repeat(64)),/FINANCIAL/);
 const payee=fixture();payee.projection.cases[0].inventory.quotes[0].supplierAccount='supplier.near';
 assert.throws(()=>parsePlaygroundRun(payee,'c'.repeat(64)),/FINANCIAL/);
});
test('retired Playground proxy never forwards simulation, network or financial endpoints',async()=>{
 let calls=0;
 const fetcher:typeof fetch=async()=>{calls++;throw new Error('Retired endpoints must not reach an upstream');};
 const request=()=>new Request('http://localhost:3000/api/operations/playground/runs',{method:'POST',headers:{Host:'localhost:3000',Origin:'http://localhost:3000','Content-Type':'application/json'},body:'{}'});
 assert.equal((await proxyOperatorRequest(request(),['playground','runs'],'http://127.0.0.1:3002',fetcher)).status,404);
 for(const route of [['playground','mainnet'],['playground','sign'],['playground','reset-production']])
  assert.equal((await proxyOperatorRequest(request(),route,'http://127.0.0.1:3002',fetcher)).status,404);
 assert.equal(calls,0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import type {WorkspaceCase} from '../src/lib/workflow.ts';
import {paymentActivity,paymentActivityState,paymentSupplier} from '../src/lib/payment-activity.ts';
function purchase(change:Partial<WorkspaceCase>={}):WorkspaceCase {
 return {caseId:'case-1',eventId:'event-1',itemId:'gloves',state:'PoDrafted',poId:'order-123',poHash:null,nextAction:'AuthorizeCommitment',humanInterventions:[],createdAt:'2026-11-14T10:00:00Z',updatedAt:'2026-11-14T10:00:00Z',paymentState:'Unobserved',evidenceKind:'public-rpc',item:{name:'Medical gloves',onHand:10,reorderPoint:20,usageUnits:1},forecasts:[],quotes:[{id:'quote-1',supplierId:'supplier-a',supplierAccount:'supplier-a.testnet',quantity:10,amountAtomic:'1000000',expiresAt:'2026-11-15T10:00:00Z'}],selection:{quoteId:'quote-1',policy:'LowestCost',amount:'1000000',destination:'Near'},vault:null,settlement:null,operations:[],settlementReferences:[],timeline:[],...change};
}
test('payment activity distinguishes review, processing and saved receipts without asserting supplier payment proof',()=>{
 assert.deepEqual(paymentActivityState(purchase()),{label:'Ready for review',group:'attention'});
 assert.equal(paymentActivityState(purchase({state:'DispatchInProgress'})).group,'processing');
 assert.deepEqual(paymentActivityState(purchase({state:'SameChainConfirmed',humanInterventions:['OldReview']})),{label:'Receipt available',group:'recorded'});
 assert.equal(paymentActivityState(purchase({state:'RequiresReconciliation'})).label,'Check status');
 for(const state of ['Failed','Rejected','Expired'])assert.equal(paymentActivityState(purchase({state})).group,'attention');
 assert.equal(paymentActivityState(purchase({state:'AwaitingHumanApproval'})).label,'Needs approval');
});
test('payment search and filters use the selected supplier and never include unprepared stock cases',()=>{
 const prepared=purchase(),processing=purchase({caseId:'case-2',state:'PaymentRequestPending'}),stockOnly=purchase({caseId:'case-3',selection:null,poId:null});
 const rows=[prepared,processing,stockOnly];
 assert.equal(paymentActivity(rows,'all','').length,2);
 assert.deepEqual(paymentActivity(rows,'processing','').map(x=>x.caseId),['case-2']);
 assert.equal(paymentActivity(rows,'all','MEDICAL GLOVES').length,2);
 assert.equal(paymentActivity(rows,'all','supplier-a.testnet').length,2);
 assert.equal(paymentActivity(rows,'all','order-123').length,2);
 assert.equal(paymentActivity(rows,'all','no match').length,0);
 assert.equal(paymentSupplier(stockOnly),'Supplier not selected');
});

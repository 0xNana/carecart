import test from 'node:test';
import assert from 'node:assert/strict';
import {statusLabel,stockActionLabel,unitLabel,actionError,displayTime,testnetTransactionUrl} from '../src/lib/product-copy.ts';

test('payment labels preserve pending, ambiguous and independently confirmed distinctions',()=>{
 assert.equal(statusLabel('Submitted'),'Submitted · awaiting verification');
 assert.equal(statusLabel('SourceDispatched'),'Destination verification pending');
 assert.equal(statusLabel('RequiresReconciliation'),'Verification required');
 assert.equal(statusLabel('SameChainConfirmed'),'Payment confirmed');
 for(const state of ['Submitted','DispatchInProgress','SourceDispatched','RequiresReconciliation','PoDrafted'])assert.doesNotMatch(statusLabel(state),/Payment confirmed|Delivery received/);
});
test('explorer links cannot turn fixture, Sandbox, mainnet or arbitrary evidence into public testnet proof',()=>{
 const evidence=JSON.stringify({transactionHash:'Dfk9PUaGc6Gqc2533esgfB7zcG7kt3kSD5ixYuefQzvK'});
 assert.match(testnetTransactionUrl('public-rpc','testnet',evidence)!,/^https:\/\/testnet.nearblocks.io\/txns\//);
 for(const execution of ['mocked-rpc','sandbox-rpc','disabled'])assert.equal(testnetTransactionUrl(execution,'testnet',evidence),null);
 assert.equal(testnetTransactionUrl('public-rpc','mainnet',evidence),null);
 for(const invalid of ['{',JSON.stringify({transactionHash:'javascript:alert(1)'}),JSON.stringify({transactionHash:'https://example.com'})])assert.equal(testnetTransactionUrl('public-rpc','testnet',invalid),null);
});
test('stock and procurement copy does not change underlying identifiers',()=>{
 assert.equal(statusLabel('PoDrafted'),'Order prepared');assert.equal(statusLabel('Dispense'),'Stock dispensed');
 assert.equal(statusLabel('NewAuditEvent'),'New Audit Event');assert.equal(statusLabel('Unobserved'),'Not verified');
});
test('forms describe an action to take rather than a completed event, with readable stock units',()=>{
 assert.equal(stockActionLabel('Receive'),'Receive Stock');assert.notEqual(stockActionLabel('Consume'),statusLabel('Consume'));
 assert.equal(unitLabel('box',1),'box');assert.equal(unitLabel('box',10),'boxes');assert.equal(unitLabel('each',10),'items');
});
test('errors offer safe recovery without displaying arbitrary service responses or secrets',()=>{
 assert.match(actionError(new Error('AUTH_EXPIRED')),/Sign in again/);
 assert.match(actionError(new Error('INSUFFICIENT_AVAILABLE_STOCK')),/available stock/);
 assert.match(actionError(new Error('DUPLICATE_RECEIPT_REFERENCE')),/already recorded/);
 assert.match(actionError(new Error('CSRF_OR_NONCE_INVALID')),/Refresh/);
 assert.doesNotMatch(actionError(new Error('PRIVATE_SERVICE_TRACE_123')),/PRIVATE_SERVICE_TRACE/);
 assert.equal(actionError(new Error('CASE_OR_SERVICE_EVIDENCE_INVALID'),'Review saved stock activity before retrying.'),'Review saved stock activity before retrying.');
 assert.equal(displayTime(null),'Not recorded');assert.equal(displayTime('invalid'),'Not recorded');
});

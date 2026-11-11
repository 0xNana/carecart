import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildTestnetPlan} from './plan-testnet-mvp.mjs';
const plan=buildTestnetPlan();
test('testnet proposal preserves caps, isolates new contracts and contains no activation or arbitrary payout',()=>{
 assert.equal(plan.network,'testnet');assert.equal(plan.publicSigningEnabled,false);assert.equal(plan.mainnetAllowed,false);
 assert.notEqual(plan.accounts.vault,'vault.carecart.testnet');assert.notEqual(plan.accounts.token,'token.carecart.testnet');
 assert.deepEqual(plan.policy,{auto_per_po_limit:'10000000',hard_payout_limit:'25000000',daily_dispatch_limit:'25000000',accepted_deposit_ceiling:'5000000'});
 assert.equal(plan.unpauseIncluded,false);assert.equal(plan.smoke.publicSubmissionAuthorized,false);
 assert(plan.setupCalls.every(c=>c.signer.endsWith('.testnet')&&c.receiver.endsWith('.testnet')&&c.authorization==='NOT AUTHORIZED'));
 assert(plan.setupCalls.every(c=>!['unpause','approve_payment','request_payment','request_crosschain','ft_transfer'].includes(c.method)));
 assert.deepEqual(plan.restrictedKeys.map(k=>k.methods),[['commit_purchase_order'],['request_payment']]);
 assert.equal(plan.testAsset.symbol,'CCUSD');assert.match(plan.testAsset.issuer,/NOT Circle/);
 assert.equal(plan.resources.realMoneyRequired,false);
});
test('committed offline demo binds the exact local artifact hashes but is not deployment evidence',()=>{
 const demo=JSON.parse(readFileSync(new URL('../profiles/testnet.demo.json',import.meta.url)));
 assert.deepEqual(demo,plan.offlineWorkspace);assert.equal(demo.profile.codeHash,plan.artifacts.vault.codeHash);
 assert.equal(demo.profile.testToken.codeHash,plan.artifacts.token.codeHash);
 assert.equal(plan.status,'APPROVAL REQUIRED; NOT EXECUTABLE');assert(plan.blockers.length>0);
});

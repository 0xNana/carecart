import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('landing describes budgeted autonomy accurately and uses actual product screenshots',()=>{
 const landing=readFileSync('src/components/landing-page.tsx','utf8').replace(/\s+/g,' ');
 assert.match(landing,/Your medical supplies shouldn&apos;t run out before you notice\./);
 assert.match(landing,/Give AI a budget, not your wallet\./);
 assert.match(landing,/CCUSD/);assert.match(landing,/no cash value/);assert.match(landing,/Circle USDC/);
 assert.match(landing,/\/screenshots\/carecart-product-preview\.png/);
 assert.match(landing,/Eligible orders can proceed automatically/);
 assert.doesNotMatch(landing,/Clinic approval before every|Each purchase needs clinic authorization|A clinic approver authorizes each purchase|paymentMock|inventoryMock|poPrepared/);
});

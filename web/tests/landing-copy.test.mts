import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('product copy distinguishes automatic stock planning from clinic-approved payments',()=>{
 const landing=readFileSync('src/components/landing-page.tsx','utf8');
 const layout=readFileSync('src/app/layout.tsx','utf8');
 assert.match(landing,/Automatic stock monitoring and purchase planning/);
 assert.match(landing,/Clinic approval before every supplier payment/);
 assert.match(landing,/Each purchase needs clinic authorization/);
 assert.match(landing,/A clinic approver authorizes each purchase/);
 assert.match(layout,/manage payments with clinic approval and spending safeguards/);
 assert.doesNotMatch(landing,/Give AI a budget|Autonomous healthcare procurement|Autonomous replenishment/);
 assert.doesNotMatch(layout,/Give AI a budget|autonomous procurement/);
});

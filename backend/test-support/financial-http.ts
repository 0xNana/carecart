/** P4B disposable HTTP fixture: actual startup, fail-fast signing/payment/external-network traps. */
import {writeFileSync} from 'node:fs';import {Account} from 'near-api-js';
import {VaultPaymentAdapter} from '../src/payments/adapter';import {financialMain} from '../src/ops/financial-workspace';
const path=process.env.CARECART_P4B_SPY_FILE!;if(!/^\/tmp\/carecart-p4b-[A-Za-z0-9_/-]+\.json$/.test(path))throw new Error('Temporary spy path required');
const counts={adapter:0,signing:0,externalSubmission:0};const save=()=>writeFileSync(path,JSON.stringify(counts));save();
VaultPaymentAdapter.prototype.requestPayment=async()=>{counts.adapter++;save();throw new Error('NO_ADAPTER');};
Account.prototype.callFunctionRaw=async()=>{counts.signing++;save();throw new Error('NO_SIGNING');};
const fetch0=globalThis.fetch;globalThis.fetch=async(input,init)=>{const u=new URL(typeof input==='object'&&'url' in input?input.url:String(input));if(!['127.0.0.1','localhost','[::1]'].includes(u.hostname)){counts.externalSubmission++;save();throw new Error('NO_EXTERNAL_NETWORK');}return fetch0(input,init);};
void financialMain();

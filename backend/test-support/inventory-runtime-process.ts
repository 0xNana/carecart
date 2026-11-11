/** Disposable P4A acceptance harness. Real application startup with fail-fast financial spies. */
import {writeFileSync} from 'node:fs';
import {Account} from 'near-api-js';
import {VaultPaymentAdapter} from '../src/payments/adapter';
import {ReplenishmentWorkflow} from '../src/workflow/cases';
import {inventoryMain} from '../src/ops/inventory';
import {startOperationsServer} from '../src/operations/server';
const path=process.env.CARECART_P4A_SPY_FILE!;
if(!/^\/tmp\/carecart-p4a-[A-Za-z0-9_/-]+\.json$/.test(path))throw new Error('Temporary spy output required');
const counts={adapter:0,signing:0,externalSubmission:0,financialWorkflow:0};
const persist=()=>writeFileSync(path,JSON.stringify(counts));persist();
VaultPaymentAdapter.prototype.requestPayment=async()=>{counts.adapter++;persist();throw new Error('ADAPTER_FORBIDDEN');};
Account.prototype.callFunctionRaw=async()=>{counts.signing++;persist();throw new Error('SIGNING_FORBIDDEN');};
ReplenishmentWorkflow.prototype.act=async()=>{counts.financialWorkflow++;persist();throw new Error('FINANCIAL_WORKFLOW_FORBIDDEN');};
const original=globalThis.fetch;
globalThis.fetch=async(input,init)=>{const url=new URL(typeof input==='object'&&'url' in input?input.url:String(input));if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)){counts.externalSubmission++;persist();throw new Error('EXTERNAL_NETWORK_FORBIDDEN');}return original(input,init);};
if(process.argv[2]==='api'&&process.env.CARECART_OPERATIONS_MODE!=='testnet-preparation')void startOperationsServer().then(app=>{for(const signal of ['SIGTERM','SIGINT'] as const)process.once(signal,()=>void app.close());});
else void inventoryMain();

export interface FundingSnapshot {
 profileFingerprint:string;
 network:'testnet';
 asset:{symbol:'CCUSD';decimals:6};
 accounts:{treasury:string;vault:string;token:string};
 balances:{treasuryToken:string;vaultToken:string;treasuryNearYocto:string;vaultNearYocto:string;accounted:string;spendable:string;reservedPayment:string;reservedWithdrawal:string};
 policy:{paused:boolean;acceptedDepositCeiling:string};
 observedAt:string;
}
const atomic=(value:unknown):value is string=>typeof value==='string'&&/^(0|[1-9][0-9]*)$/.test(value);
const account=(value:unknown):value is string=>typeof value==='string'&&/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(value);
const record=(value:unknown):Record<string,unknown>|null=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
export function parseFundingSnapshot(value:unknown,expectedFingerprint:string):FundingSnapshot {
 const x=record(value),asset=record(x?.asset),accounts=record(x?.accounts),balances=record(x?.balances),policy=record(x?.policy);
 if(!x||!asset||!accounts||!balances||!policy||x.profileFingerprint!==expectedFingerprint||x.network!=='testnet'||asset.symbol!=='CCUSD'||asset.decimals!==6||
  !account(accounts.treasury)||!account(accounts.vault)||!account(accounts.token)||typeof policy.paused!=='boolean'||
  typeof x.observedAt!=='string'||!Number.isFinite(Date.parse(x.observedAt)))throw new Error('Funding profile or asset mismatch');
 const amountFields=['treasuryToken','vaultToken','treasuryNearYocto','vaultNearYocto','accounted','spendable','reservedPayment','reservedWithdrawal'];
 if(amountFields.some(k=>!atomic(balances[k]))||!atomic(policy.acceptedDepositCeiling))throw new Error('Invalid funding balance');
 return x as unknown as FundingSnapshot;
}
export function parseTokenInput(value:string):string|null {
 const normalized=value.trim();if(!/^(?:[0-9]+(?:\.[0-9]{0,6})?|\.[0-9]{1,6})$/.test(normalized))return null;
 const [whole='0',fraction='']=normalized.replace(/^\./,'0.').split('.');
 const amount=BigInt(whole)*BigInt(1_000_000)+BigInt((fraction+'000000').slice(0,6));return amount>BigInt(0)?amount.toString():null;
}
export function tokenAmount(atomicAmount:string):string {
 const amount=BigInt(atomicAmount),cents=(amount+BigInt(5_000))/BigInt(10_000);
 return `${(cents/BigInt(100)).toString()}.${(cents%BigInt(100)).toString().padStart(2,'0')}`;
}
export function nearAmount(yocto:string):string {
 const amount=BigInt(yocto),scaled=(amount+BigInt('50000000000000000000'))/BigInt('100000000000000000000');
 return `${(scaled/BigInt(10_000)).toString()}.${(scaled%BigInt(10_000)).toString().padStart(4,'0')}`;
}

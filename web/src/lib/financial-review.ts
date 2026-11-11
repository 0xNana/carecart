import {jsonHash} from './v2-wallet.ts';
export interface FinancialAuthorization {id:string;role:'committer'|'requester';state:string;termsHash:string;expiresAt:string;execution:string;publicSigningEnabled:boolean;error:string|null;events:{state:string;timestamp:string;error:string|null}[]}
export interface FinancialReview {
 profileFingerprint:string;caseId:string;revision:number;state:string;nextAction:string;canonicalHash:string;
 canonical:{po_id:string;profile:string;supplier:string;token:string;amount:string;invoice_digest:string;destination:'Near'|{Base:unknown}};
 quote:{id:string;supplierId:string;supplierAccount:string;quantity:number;unitPriceAtomic:string;amountAtomic:string;issuedAt:string;expiresAt:string;asset:string;decimals:number};
 quoteExpired:boolean;policy:{limits:Record<string,string>;spendable:string|null;usage:{spent:string;reserved:string}|null;blocks:string[];observed:boolean;humanRequired:boolean;supplierApproved:boolean|null};
 requiredAuthority:string;approvalStatus:string;operations:{operation_key:string;state:string;evidence:string|null}[];settlement:unknown;
 controller?:string;execution:'disabled'|'mocked-rpc'|'sandbox-rpc'|'public-rpc';publicSigningEnabled:boolean;authorizations:FinancialAuthorization[];
}
/** Projection validation is defense in depth. Server-side revalidation remains authoritative. */
export async function parseFinancialReview(raw:unknown,fingerprint:string):Promise<FinancialReview>{const r=raw as FinancialReview;
 if(!r||r.profileFingerprint!==fingerprint||r.publicSigningEnabled!==(r.execution==='public-rpc')||!['disabled','mocked-rpc','sandbox-rpc','public-rpc'].includes(r.execution)||
  !Number.isSafeInteger(r.revision)||r.revision<0||!r.canonical||await jsonHash(r.canonical)!==r.canonicalHash||
  !/^[1-9][0-9]{0,38}$/.test(r.canonical.amount)||r.quote?.decimals!==6||!Number.isSafeInteger(r.quote.quantity)||r.quote.quantity<1||
  r.quote.supplierAccount!==r.canonical.supplier||r.quote.amountAtomic!==r.canonical.amount||
  !/^[1-9][0-9]{0,38}$/.test(r.quote.unitPriceAtomic)||BigInt(r.quote.unitPriceAtomic)*BigInt(r.quote.quantity)!==BigInt(r.canonical.amount)||
  !Number.isFinite(Date.parse(r.quote.expiresAt))||!Array.isArray(r.policy?.blocks)||!Array.isArray(r.authorizations)||!Array.isArray(r.operations))throw new Error('FINANCIAL_REVIEW_INVALID');
 if(['sandbox-rpc','public-rpc'].includes(r.execution)&&(r.canonical.profile!=='testnet'||r.quote.asset!=='CCUSD'))throw new Error('FINANCIAL_ENVIRONMENT_INVALID');
 for(const [key,max] of Object.entries({auto_per_po_limit:'10000000',hard_payout_limit:'25000000',daily_dispatch_limit:'25000000',accepted_deposit_ceiling:'50000000'})){
  const n=r.policy.limits[key];if(!/^[1-9][0-9]{0,38}$/.test(n)||BigInt(n)>BigInt(max))throw new Error('FINANCIAL_POLICY_INVALID');
 }
 return r;
}

import { z } from 'zod';
import type { SafetyVaultClient } from './safety-client';
import type {VaultReader} from './vault-reader';import {isSandboxProfile} from '../sandbox/profile';
import { SafetyOrderSchema,type SafetyOrder } from './commitments';
import type { SettlementJournal } from '../intents/journal';
import {digest} from '../intents/settlement';
import {Payment} from '../workflow/model';
const atomic=z.string().regex(/^(0|[1-9][0-9]{0,38})$/).refine(s=>BigInt(s)<2n**128n);
const policy=z.object({auto_per_po_limit:atomic,hard_payout_limit:atomic,daily_dispatch_limit:atomic,accepted_deposit_ceiling:atomic}).strict();
const stateSchema=z.object({profile:z.enum(['mainnet','testnet']),admin:z.string(),guardian:z.string(),treasury:z.string(),token:z.string(),paused:z.boolean(),
 policy,spendable:atomic,usage:z.object({spent:atomic,reserved:atomic}).strict()});
const rolesSchema=z.object({supplier:z.boolean(),committer:z.boolean(),requester:z.boolean()}).strict();
export interface V2Transaction {
 network:'mainnet'|'testnet'|'sandbox';signerId:string;receiverId:string;
 actions:[{type:'FunctionCall';params:{methodName:'approve_payment'|'reject_payment';args:{po_id:string;expected_quote_hash?:string|null;expected_commitment_hash?:string|null};deposit:'1';gas:'120000000000000'}}];
}
/** Fresh read-only review. Inputs are independently resolved canonical records, never browser payment terms. */
export async function paymentReview(client:VaultReader,raw:SafetyOrder,action:'approve'|'reject',journal?:SettlementJournal,
 reviewedBase?:Awaited<ReturnType<SafetyVaultClient['approvalReview']>>) {
 const order=SafetyOrderSchema.parse(raw);const canonical=await client.canonicalOrder(order.po_id);
 if(digest(canonical)!==digest(order))throw new Error('Canonical PO changed');
 const assessment=await financialPolicy(client,order);const p=client.profile;
 const payment=Payment.parse(await client.view('get_payment',{po_id:order.po_id}));
 if(payment.status!=='PendingApproval')throw new Error('Payment is not pending human approval');
 const limits=assessment.policy,blocks=assessment.blocks;
 if(action==='approve'&&blocks.length)throw new Error(`Approval blocked: ${blocks.join(',')}`);
 let base:Awaited<ReturnType<SafetyVaultClient['approvalReview']>>|null=null;
 let args:V2Transaction['actions'][0]['params']['args']={po_id:order.po_id};
 if(order.destination==='Near'){
  if(payment.attempt_id!=='')throw new Error('Same-chain attempt conflict');
  if(action==='approve')args={...args,expected_quote_hash:null,expected_commitment_hash:null};
 }else if(action==='approve'){
  if(!journal||!payment.attempt_id)throw new Error('Verified settlement attempt required');
  base=reviewedBase?await client.revalidateApproval(payment.attempt_id,reviewedBase,journal):await client.approvalReview(payment.attempt_id,journal);
  if(digest(base.canonicalOrder)!==digest(order))throw new Error('Base review PO conflict');
  if(action==='approve')args=base.args;
 }
 // Recheck the profile/release and immutable PO after the asynchronous quote/route reads.
 if(digest(await client.canonicalOrder(order.po_id))!==digest(order)||digest(Payment.parse(await client.view('get_payment',{po_id:order.po_id})))!==digest(payment))
  throw new Error('Payment changed during review');
 const transaction:V2Transaction={network:isSandboxProfile(p)?'sandbox':p.network,signerId:p.admin,receiverId:p.vault,actions:[{type:'FunctionCall',params:{
  methodName:action==='approve'?'approve_payment':'reject_payment',args,deposit:'1',gas:'120000000000000'}}]};
 return {abi:'carecart-safety-vault-v2' as const,profileFingerprint:digest(p),codeHash:p.codeHash,action,canonicalHash:digest(order),order,
  recipient:base?.summary.recipient ?? (order.destination!=='Near'&&action==='reject'?'No transfer (rejection only)':order.supplier),payment,policy:limits,spendable:assessment.spendable,usage:assessment.usage,approvalBlocks:blocks,
  transaction,base};
}
/** Shared read-only policy assessment. This does not authorize a transaction. */
export async function financialPolicy(client:VaultReader,raw:SafetyOrder){
 const order=SafetyOrderSchema.parse(raw);
 const p=client.profile;const state=stateSchema.parse(await client.view('get_state',{}));
 if(state.profile!==p.network||state.admin!==p.admin||state.guardian!==p.guardian||state.treasury!==p.treasury||state.token!==p.token)throw new Error('Vault identity changed');
 const adminRoles=rolesSchema.parse(await client.view('get_roles',{account:p.admin}));
 if(adminRoles.committer||adminRoles.requester||[p.guardian,p.treasury,p.committer,p.requester].includes(p.admin))throw new Error('Independent human admin required');
 const roles=rolesSchema.parse(await client.view('get_roles',{account:order.supplier}));
 const limits=state.policy;
 if(BigInt(limits.auto_per_po_limit)>10_000_000n||BigInt(limits.accepted_deposit_ceiling)>50_000_000n||BigInt(limits.hard_payout_limit)>25_000_000n||BigInt(limits.daily_dispatch_limit)>25_000_000n||
  BigInt(limits.auto_per_po_limit)>BigInt(limits.hard_payout_limit)||Object.values(limits).some(v=>BigInt(v)<=0n))throw new Error('Unsupported v2 hard policy');
 const blocks:string[]=[];
 if(state.paused)blocks.push('Paused');if(!roles.supplier)blocks.push('UnknownSupplier');
 if(BigInt(order.amount)>BigInt(limits.hard_payout_limit)||BigInt(order.amount)>25_000_000n)blocks.push('HardPayoutLimit');
 if(BigInt(order.amount)>BigInt(state.spendable))blocks.push('InsufficientFunds');
 if(BigInt(state.usage.spent)+BigInt(state.usage.reserved)+BigInt(order.amount)>BigInt(limits.daily_dispatch_limit))blocks.push('DailyLimit');

 return {...state,supplierApproved:roles.supplier,blocks,humanRequired:BigInt(order.amount)>BigInt(limits.auto_per_po_limit)};
}

export type PaymentReview=Awaited<ReturnType<typeof paymentReview>>;

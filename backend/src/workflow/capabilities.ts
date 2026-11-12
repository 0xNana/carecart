import { JsonRpcProvider } from 'near-api-js';
import { z } from 'zod';
import { digest, SettlementQuotes } from '../intents/settlement';
import { SettlementJournal } from '../intents/journal';
import { baseRpc, SettlementRecovery } from '../intents/recovery';
import { verifyBaseReceipt, verifyNearRefund } from '../intents/receipts';
import { SafetyVaultClient } from '../near/safety-client';
import {profileFingerprint} from '../near/safety-profile';
import { V2ProcurementStore, ProcurementPoId } from '../procurement/v2-store';
import type {WorkflowProcurement,WorkflowSnapshot} from './procurement-port';
import type {VaultReader} from '../near/vault-reader';
import {isSandboxProfile} from '../sandbox/profile';
import { Payment } from './model';
import { executeProcurementRole } from '../procurement/v2-bridge';

export const Observation = z.object({ poId:z.union([ProcurementPoId,z.string().regex(/^sb-po-[a-f0-9]{56}$/)]),profileFingerprint:z.string().regex(/^[a-f0-9]{64}$/),
  canonicalHash:z.string().regex(/^[a-f0-9]{64}$/),checkedAt:z.iso.datetime(),kind:z.enum(['mocked-rpc','public-rpc','sandbox-rpc']),
  payment:Payment,settlement:z.object({attemptId:z.string(),state:z.enum(['Dispatched','Settled','Refunded']),
    sourceTransactionHash:z.string().min(1),proof:z.unknown(),fullRefund:z.boolean().optional()}).strict().nullable(),
}).strict();
export type FinancialObservation = z.infer<typeof Observation>;
const checked = new WeakSet<object>();
function freeze(value: unknown): void {
  if (value && typeof value === 'object') { Object.freeze(value); for (const v of Object.values(value)) freeze(v); }
}
function seal(value: FinancialObservation) {
  const parsed = Observation.parse(value); freeze(parsed); checked.add(parsed); return parsed;
}
export function assertCheckedObservation(value: unknown): asserts value is FinancialObservation {
  if (!value || typeof value !== 'object' || !checked.has(value)) throw new Error('Independent capability observation required');
}
/** Read-only interfaces future tools can consume. No key, amount or recipient input. */
export interface InventoryForecasting { evaluate(eventId: string): WorkflowSnapshot }
export interface SupplierEvaluation { compare(eventId: string): WorkflowSnapshot['quotes'] }
export interface PurchaseOrderConstruction { construct(eventId: string, now: Date): ReturnType<V2ProcurementStore['selectQuote']> }
/** Operational-only capability; deliberately excluded from the key-free domain capabilities. */
export interface PaymentCommitment { execute: typeof executeProcurementRole }
export const restrictedPaymentCapability:PaymentCommitment=Object.freeze({execute:executeProcurementRole});
export interface PaymentStatusObservation { observe(poId: string): Promise<FinancialObservation> }
export interface SettlementReconciliation { reconcile(poId: string, attemptId: string, sourceTxHash: string): Promise<FinancialObservation> }
export function domainCapabilities(store: WorkflowProcurement) {
  return Object.freeze({
    forecasting: { evaluate:(eventId:string) => store.eventSnapshot(eventId) } satisfies InventoryForecasting,
    suppliers: { compare:(eventId:string) => store.eventSnapshot(eventId).quotes } satisfies SupplierEvaluation,
    orders: { construct:(eventId:string,now:Date) => store.selectQuote({eventId},now) } satisfies PurchaseOrderConstruction,
  });
}
/** No credentials. RPC errors and absent orders are never interpreted as successful execution. */
export async function observeVault(store: WorkflowProcurement, poId: string,
  kind: 'mocked-rpc'|'public-rpc'|'sandbox-rpc' = 'public-rpc', now = new Date(), readClient?:VaultReader): Promise<FinancialObservation> {
  const local = store.resolve(poId).canonical;
  const client = readClient ?? new SafetyVaultClient(store.profile);
  if(isSandboxProfile(store.profile)!==(kind==='sandbox-rpc'))throw new Error('Explicit Sandbox/public observation separation required');
  if(profileFingerprint(client.profile)!==store.fingerprint)throw new Error('Observation client profile mismatch');
  if(client.injectedReads&&kind!=='mocked-rpc')throw new Error('Injected reads cannot prove public-chain execution');
  const canonical = await client.canonicalOrder(poId); // profile/release/token checks + finalized lookup
  if (digest(local) !== digest(canonical)) throw new Error('Canonical procurement/vault conflict');
  const payment = Payment.parse(await client.view('get_payment',{po_id:poId}));
  if ((local.destination === 'Near' && (payment.attempt_id !== '' || payment.status === 'Dispatched')) ||
      (local.destination !== 'Near' && payment.status === 'Paid')) throw new Error('Canonical payment destination conflict');
  // Re-resolve after asynchronous I/O; changing procurement rows cannot change this observation's authority.
  if (digest(store.resolve(poId).canonical) !== digest(local)) throw new Error('Procurement changed during observation');
  return seal({poId,profileFingerprint:store.fingerprint,canonicalHash:digest(local),checkedAt:now.toISOString(),kind,payment,settlement:null});
}

/** Explicit read-only operational capability. Existing journal terminal labels alone are insufficient. */
export function settlementCapability(store: V2ProcurementStore, settings: {
  baseRpcUrl:string; apiKey:string; refundSigners:Record<string,string>; kind?:'mocked-rpc'|'public-rpc'; clock?:()=>Date;
}): SettlementReconciliation {
  return { async reconcile(poId,attemptId,sourceTxHash) {
    const local = store.resolve(poId).canonical;
    if (local.destination === 'Near') throw new Error('Base order required');
    const journal = new SettlementJournal(store.profile.databasePath,store.fingerprint);
    try {
      if (journal.get(attemptId).poId !== poId) throw new Error('Settlement attempt/PO conflict');
      const client = new SafetyVaultClient(store.profile);
      // Independently checks canonical PO/route, approval receipt and exact source debit every time,
      // including when a journal already claims terminal settlement.
      await client.observeDispatch(attemptId,sourceTxHash,journal);
      const vault = await observeVault(store,poId,settings.kind,settings.clock?.() ?? new Date());
      if (vault.payment.status !== 'Dispatched' || vault.payment.attempt_id !== attemptId) throw new Error('Source dispatch unavailable');
      const recovery = new SettlementRecovery(new SettlementQuotes(settings.apiKey),store.profile.rpcUrl,settings.baseRpcUrl);
      await recovery.reconcile(journal,attemptId,settings.refundSigners);
      const attempt = journal.get(attemptId);
      let state:'Dispatched'|'Settled'|'Refunded' = 'Dispatched'; let proof:unknown = null; let fullRefund:boolean|undefined;
      if (attempt.state === 'Settled' || attempt.state === 'Refunded') {
        const saved = z.object({receipt:z.object({transactionHash:z.string().min(1)}),amount:z.string().regex(/^[1-9][0-9]*$/)}).parse(attempt.evidence);
        if (attempt.state === 'Settled') {
          const verified = await verifyBaseReceipt(attempt.quote,[saved.receipt.transactionHash],attempt.quote.response.quote.minAmountOut,baseRpc(settings.baseRpcUrl));
          if (!verified) throw new Error('Independent destination receipt unavailable');
          proof=verified; state='Settled';
        } else {
          if (BigInt(saved.amount)>BigInt(local.amount)) throw new Error('Refund exceeds committed amount');
          const signer=settings.refundSigners[saved.receipt.transactionHash];
          if (!signer) throw new Error('Reviewed refund transaction signer required');
          const raw=await new JsonRpcProvider({url:store.profile.rpcUrl}).viewTransactionStatusWithReceipts({
            txHash:saved.receipt.transactionHash,accountId:signer,waitUntil:'FINAL'});
          const verified=verifyNearRefund(attempt.quote,saved.receipt.transactionHash,saved.amount,raw);
          if (!verified) throw new Error('Independent refund receipt unavailable');
          proof=verified; state='Refunded'; fullRefund=BigInt(saved.amount)===BigInt(local.amount);
        }
      }
      return seal({...vault,settlement:{attemptId,state,sourceTransactionHash:sourceTxHash,proof,fullRefund}});
    } finally { journal.close(); }
  } };
}

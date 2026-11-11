import {assertTenantExecution,assertTenantSigningProfile,type TenantExecutionPermit} from '../tenancy/treasury-authority';
import { z } from 'zod';
import { digest } from '../intents/settlement';
import { SafetyOrderSchema, type SafetyOrder } from '../near/commitments';
import { SafetyVaultClient } from '../near/safety-client';
import { OperationJournal, type WriteEvidence } from '../near/operation-journal';
import { roleCredentials } from '../ops/role-credentials';
import { ProcurementPoId, V2ProcurementStore } from './v2-store';

const ReviewedPo = z.object({ poId: ProcurementPoId, expectedHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const PaymentSchema = z.object({ status: z.enum(['Committed', 'PendingApproval', 'Registering', 'Dispatching', 'Dispatched',
  'Paid', 'Rejected', 'Blocked', 'Expired', 'Failed']), reason: z.string().max(128), attempt_id: z.string().max(64),
  reserved_day: z.number().int().nonnegative(), }).strict();
function matches(expected: SafetyOrder, actual: unknown) {
  if (digest(SafetyOrderSchema.parse(actual)) !== digest(expected)) throw new Error('Canonical procurement/onchain PO conflict');
}
async function observe(store: V2ProcurementStore, client: SafetyVaultClient, poId: string,
  stage: 'commit' | 'request' | 'reconcile', operation: WriteEvidence, now: Date) {
  const expected = store.resolve(poId).canonical;
  matches(expected, await client.canonicalOrder(poId));
  const vaultPayment = PaymentSchema.parse(await client.view('get_payment', { po_id: poId }));
  const observation = { operation, canonicalHash: digest(expected), vaultPayment, source: 'finalized-vault-view' };
  store.recordObservation(poId, stage, observation, now);
  return observation;
}

/**
 * Internal/manual interface, not an HTTP endpoint or model tool. Each invocation loads
 * exactly one restricted role. Public input contains only a registered PO ID and its
 * operator-reviewed hash; all payment authority comes from persisted, revalidated terms.
 */
export async function executeProcurementRole(store: V2ProcurementStore, roleInput: 'committer' | 'requester', input: unknown,
  environment: NodeJS.ProcessEnv = process.env, now = new Date(),tenantPermit?:TenantExecutionPermit) {
  const role = z.enum(['committer', 'requester']).parse(roleInput);
  if(store.profile.testToken){try{assertTenantSigningProfile(store.profile,role,tenantPermit);}catch{throw new Error('Public testnet activation is disabled without a consumed clinic authorization');}}
  const { poId, expectedHash } = ReviewedPo.parse(input);
  const order = store.resolve(poId).canonical;
  assertTenantExecution(store.profile.databasePath,role,poId,tenantPermit,digest(order));
  if (environment.CARECART_SAFETY_WRITES !== 'approved' || expectedHash !== digest(order))
    throw new Error('Exact operator PO authorization required');
  if (role === 'requester' && order.destination !== 'Near') throw new Error('Cross-chain procurement requires separate human review');
  const credentials = roleCredentials(role, environment);
  const journal = new OperationJournal(store.profile.databasePath, store.fingerprint,tenantPermit);
  try {
    const client = new SafetyVaultClient(store.profile, credentials, journal);
    if (role === 'committer') {
      const committed = await client.lookupOrder(poId);
      if (committed) matches(order, committed);
      else if (Date.parse(store.quoteExpiry(poId)) <= now.getTime()) throw new Error('Supplier quote expired before commitment');
      matches(order, store.resolve(poId).canonical);
      return await observe(store, client, poId, 'commit', await client.commitOrder(order), now);
    }
    // Refuse drafts and conflicting commitments before reaching the requester capability.
    matches(order, await client.canonicalOrder(poId));
    matches(order, store.resolve(poId).canonical);
    return await observe(store, client, poId, 'request', await client.submitPayment(poId), now);
  } finally { journal.close(); }
}

/** No keys, resets or resends: P0 canonical-effect reconciliation only. */
export async function reconcileProcurement(store: V2ProcurementStore, input: unknown, now = new Date()) {
  const { poId, operation } = z.object({ poId: ProcurementPoId, operation: z.enum(['commit', 'request']) }).strict().parse(input);
  const order = store.resolve(poId).canonical;
  if (operation === 'request' && order.destination !== 'Near') throw new Error('Cross-chain procurement requires separate human review');
  const journal = new OperationJournal(store.profile.databasePath, store.fingerprint);
  try {
    const client = new SafetyVaultClient(store.profile, undefined, journal);
    const effect = operation === 'commit' ? { method: 'commit_purchase_order', args: { order } }
      : { method: 'request_payment', args: { po_id: poId } };
    return await observe(store, client, poId, 'reconcile', await client.reconcileOperation(effect), now);
  } finally { journal.close(); }
}

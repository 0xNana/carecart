import { z } from 'zod';
export const WorkflowState = z.enum(['Opened', 'InventoryRecorded', 'ForecastEvaluated', 'QuotesAvailable',
  'SupplierSelected', 'PoDrafted', 'CommitmentPending', 'PoCommitted', 'PaymentRequestPending',
  'AwaitingHumanApproval', 'DispatchInProgress', 'SameChainConfirmed', 'SourceDispatched',
  'DestinationSettled', 'Refunded', 'Rejected', 'Failed', 'Expired', 'RequiresReconciliation']);
export type WorkflowState = z.infer<typeof WorkflowState>;
export const Identity = z.object({ caseId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), eventId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  itemId: z.string().regex(/^(?:mn|sb)-item-[1-9][0-9]*$/) }).strict();
export type Identity = z.infer<typeof Identity>;
export const Payment = z.object({ status: z.enum(['Committed','PendingApproval','Registering','Dispatching','Dispatched',
  'Paid','Rejected','Blocked','Expired','Failed']), reason: z.string().max(128), attempt_id: z.string().max(64),
  reserved_day: z.number().int().nonnegative() }).strict();
export const terminal = new Set<WorkflowState>(['SameChainConfirmed','DestinationSettled','Refunded','Rejected','Failed','Expired']);
export const preparation: WorkflowState[] = ['Opened','InventoryRecorded','ForecastEvaluated','QuotesAvailable','SupplierSelected','PoDrafted'];
export function nextAction(state: WorkflowState, crossChain: boolean) {
  if (preparation.slice(0,-1).includes(state)) return 'ResumePreparation';
  if (state === 'PoDrafted') return 'AuthorizeCommitment';
  if (state === 'PoCommitted') return crossChain ? 'HumanCrossChainReview' : 'AuthorizePaymentRequest';
  if (state === 'AwaitingHumanApproval') return 'HumanWalletReview';
  if (state === 'RequiresReconciliation' || state === 'CommitmentPending' || state === 'PaymentRequestPending') return 'ReadOnlyReconciliation';
  if (state === 'SourceDispatched') return 'VerifyDestinationOrRefund';
  return terminal.has(state) ? 'InspectTerminalEvidence' : 'ObserveCanonicalState';
}
export function permitted(from: WorkflowState, to: WorkflowState) {
  if (from === to) return true;
  if (terminal.has(from)) return false;
  if (to === 'RequiresReconciliation') return true;
  const i = preparation.indexOf(from);
  if (i >= 0 && i < preparation.length-1) return to === preparation[i+1] || to === 'Expired' || to === 'Failed';
  if (to === 'CommitmentPending') return from === 'PoDrafted';
  if (to === 'PaymentRequestPending') return from === 'PoCommitted';
  if (preparation.includes(to)) return false;
  // Canonical observations may catch up after a restart, including missed intermediate callbacks.
  if (from === 'SourceDispatched') return ['DestinationSettled','Refunded'].includes(to);
  if (from === 'DispatchInProgress') return ['SameChainConfirmed','SourceDispatched','Failed'].includes(to);
  if (from === 'AwaitingHumanApproval') return ['DispatchInProgress','SameChainConfirmed','SourceDispatched','Rejected','Expired','Failed'].includes(to);
  return ['PoCommitted','AwaitingHumanApproval','DispatchInProgress','SameChainConfirmed','SourceDispatched',
    'DestinationSettled','Refunded','Rejected','Failed','Expired'].includes(to);
}

import { buildTransaction, requirePending, NETWORK, type AdminAction, type CanonicalPayment, type VaultState, type WalletTransaction } from './near.ts';
export interface Review { action: AdminAction; transaction: WalletTransaction; payment?: CanonicalPayment }
export interface SigningWallet {
  getAccounts(params: { network: 'testnet' }): Promise<{ accountId: string }[]>;
  signAndSendTransaction(params: WalletTransaction): Promise<unknown>;
}
export interface WalletOutcome { confirmed: boolean; hash?: string }
/** A deadline is not cancellation: the wallet can still finish the original request. */
export class WalletResponsePendingError extends Error {
  readonly completion: Promise<WalletOutcome>;
  constructor(completion: Promise<WalletOutcome>) {
    super('The wallet has not responded. The original request may still complete. Check the wallet and refresh on-chain state before any retry.');
    this.name = 'WalletResponsePendingError';
    this.completion = completion;
  }
}
export function waitForWallet<T>(request: Promise<T>, milliseconds: number, timeout: () => Error): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(timeout()), milliseconds);
    request.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}
function requireUnpausedApproval(state: VaultState, action: AdminAction) {
  if (action.method === 'approve_payment' && state.paused) throw new Error('The vault is paused. Resume payments before reviewing approval.');
}
export function createReview(state: VaultState, signer: string, action: AdminAction, payment?: CanonicalPayment): Review {
  const copy = structuredClone(action);
  requireUnpausedApproval(state, copy);
  if (copy.method === 'approve_payment' || copy.method === 'reject_payment') {
    if (!payment || payment.purchaseOrder?.po_id !== copy.args.po_id) throw new Error('Load the canonical payment before review.');
    requirePending(payment, state.tokenId);
  }
  return { action: copy, transaction: buildTransaction(state, signer, copy), payment: payment && structuredClone(payment) };
}
/** Invoked only by the review dialog's explicit confirmation button. No stored keys or background signing. */
export async function submitReviewed(review: Review, wallet: SigningWallet, readState: () => Promise<VaultState>, readPayment: (poId: string) => Promise<CanonicalPayment>,
  options: { preflightMs?: number; signingMs?: number; onSigning?: () => void } = {}): Promise<WalletOutcome> {
  const preflight = <T>(task: Promise<T>, label: string) => waitForWallet(task, options.preflightMs ?? 15000,
    () => new Error(`${label} timed out. No signing request was sent. Refresh and review again.`));
  const state = await preflight(readState(), 'Vault check');
  requireUnpausedApproval(state, review.action);
  const accounts = await preflight(wallet.getAccounts({ network: NETWORK }), 'Wallet account check');
  if (!accounts.some((account) => account.accountId === review.transaction.signerId)) throw new Error('The wallet account changed. Reconnect and review again.');
  const fresh = buildTransaction(state, review.transaction.signerId, review.action);
  if (JSON.stringify(fresh) !== JSON.stringify(review.transaction)) throw new Error('The transaction configuration changed. Review again.');
  if (review.action.method === 'approve_payment' || review.action.method === 'reject_payment') {
    const current = await preflight(readPayment(review.action.args.po_id), 'Canonical payment check');
    requirePending(current, state.tokenId);
    if (JSON.stringify(current.purchaseOrder) !== JSON.stringify(review.payment?.purchaseOrder)) throw new Error('The canonical purchase order changed. Review again.');
  }
  options.onSigning?.();
  const completion = wallet.signAndSendTransaction(fresh).then(walletOutcome);
  return waitForWallet(completion, options.signingMs ?? 45000, () => new WalletResponsePendingError(completion));
}
function walletOutcome(outcome: unknown): WalletOutcome {
  // Redirecting wallets may not return an outcome. Never infer settlement from a wallet opening.
  if (!outcome || typeof outcome !== 'object') return { confirmed: false };
  const result = outcome as { transaction?: { hash?: string }; status?: object; receipts_outcome?: { outcome: { status: object } }[] };
  if ((result.status && 'Failure' in result.status) || result.receipts_outcome?.some((receipt) => 'Failure' in receipt.outcome.status)) {
    throw new Error('The transaction or a contract receipt failed. Refresh the on-chain status before trying again.');
  }
  return { hash: result.transaction?.hash, confirmed: !!result.status && 'SuccessValue' in result.status };
}

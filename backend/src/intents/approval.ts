import { formatUsdc } from '../amounts';
import { SafetyQuoteSchema, quoteCommitmentHash, type SafetyQuote } from '../near/commitments';
import { BASE_USDC, type VerifiedQuote } from './settlement';

/** A hash alone does not prove that the other onchain commitment fields match the signed quote. */
export function assertQuoteCommitment(q: VerifiedQuote, attemptId: string, raw: unknown): SafetyQuote {
  const c = SafetyQuoteSchema.parse(raw);
  if (c.attempt_id !== attemptId || c.po_id !== q.order.poId || c.route_id !== q.order.routeId ||
      c.route_version !== q.order.routeVersion || c.signed_quote_hash !== q.identityHash ||
      c.deposit_account !== q.response.quote.depositAddress || c.min_amount_out !== q.response.quote.minAmountOut ||
      c.deadline_ns !== (BigInt(Date.parse(q.expiresAt)) * 1_000_000n).toString())
    throw new Error('Canonical quote commitment differs from verified signed quote');
  return c;
}

export function quoteApprovalSummary(q: VerifiedQuote, commitment: SafetyQuote) {
  const input = BigInt(q.order.amount);
  const minimum = BigInt(q.response.quote.minAmountOut);
  return {
    poId: q.order.poId, attemptId: commitment.attempt_id,
    sourceNetwork: 'NEAR mainnet', sourceToken: q.order.token,
    destinationChain: 'base', destinationChainId: 8453, destinationToken: BASE_USDC,
    recipient: q.order.recipient, refundTo: q.order.treasury,
    routeId: q.order.routeId, routeVersion: q.order.routeVersion,
    inputAtomic: q.order.amount, inputUsdc: formatUsdc(input),
    quotedOutputAtomic: q.response.quote.amountOut, quotedOutputUsdc: formatUsdc(BigInt(q.response.quote.amountOut)),
    minimumOutputAtomic: q.response.quote.minAmountOut, minimumOutputUsdc: formatUsdc(minimum),
    withdrawalFeeAtomic: q.response.quote.withdrawFee, refundFeeAtomic: q.response.quote.refundFee,
    maximumFeeAndLossBudgetAtomic: q.order.maxFeeAtomic,
    maximumLossAtMinimumOutputAtomic: (input > minimum ? input - minimum : 0n).toString(),
    storageDepositYocto: commitment.storage_deposit_yocto,
    expiresAt: q.expiresAt, reviewValidUntil: new Date(Date.parse(q.expiresAt) - 30000).toISOString(),
    quoteIdentityHash: q.identityHash, signerPublicKey: q.signerPublicKey,
    quoteCommitmentHash: quoteCommitmentHash(commitment),
    providerReference: q.response.correlationId,
  };
}

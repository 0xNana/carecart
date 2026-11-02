import { describe, expect, it } from 'vitest';
import { assertQuoteCommitment, quoteApprovalSummary } from './approval';
import { verifySettlementQuote } from './settlement';
import { signed, order, now } from './fixtures/settlement';

describe('signed quote versus canonical approval commitment', () => {
  it('binds all execution fields, including deadline and minimum output, to the signed response', async () => {
    const { raw, expected, key } = await signed();
    const q = verifySettlementQuote(order, raw, expected, now, key.getPublicKey().toString());
    const commitment = {
      attempt_id: 'attempt-1', po_id: order.poId, route_id: order.routeId, route_version: order.routeVersion,
      signed_quote_hash: q.identityHash, deposit_account: raw.quote.depositAddress,
      deadline_ns: (BigInt(Date.parse(q.expiresAt)) * 1_000_000n).toString(),
      min_amount_out: raw.quote.minAmountOut, storage_deposit_yocto: '1250000000000000000000',
    };
    expect(assertQuoteCommitment(q, 'attempt-1', commitment)).toEqual(commitment);
    for (const change of [
      { attempt_id: 'attempt-2' }, { po_id: 'another-po' }, { route_id: 'another-route' }, { route_version: 2 },
      { signed_quote_hash: 'c'.repeat(64) }, { deposit_account: 'c'.repeat(64) },
      { deadline_ns: (BigInt(commitment.deadline_ns) + 1n).toString() }, { min_amount_out: '1' },
    ]) expect(() => assertQuoteCommitment(q, 'attempt-1', { ...commitment, ...change })).toThrow();
    const summary = quoteApprovalSummary(q, commitment);
    expect(summary).toMatchObject({ destinationChain: 'base', destinationChainId: 8453,
      inputUsdc: '1.000000', minimumOutputUsdc: '0.980000', maximumLossAtMinimumOutputAtomic: '20000',
      recipient: order.recipient, refundTo: order.treasury, storageDepositYocto: commitment.storage_deposit_yocto });
  });
});

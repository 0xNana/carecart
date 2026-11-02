import { describe, expect, it } from 'vitest';
import { SafetyOrderSchema, routeHash, quoteCommitmentHash } from './commitments';

const order = { po_id: 'po-1', profile: 'testnet', supplier: 'supplier.testnet', token: 'token.testnet', amount: '1000000', invoice_digest: 'a'.repeat(64), destination: 'Near' };
describe('canonical v2 commitments', () => {
  it('binds the full approval commitment with the Rust golden hash', () => {
    const quote = { attempt_id: 'attempt-1', po_id: 'po-1', route_id: 'base-1', route_version: 1,
      signed_quote_hash: 'b'.repeat(64), deposit_account: 'a'.repeat(64), deadline_ns: '200000000000000',
      min_amount_out: '980000', storage_deposit_yocto: '1250000000000000000000' };
    expect(quoteCommitmentHash(quote)).toBe('0669e734b6288e5873074d1e7e6a5a46d29ac3fa41f6e4fb31c4904884db7c50');
    expect(quoteCommitmentHash({ ...quote, attempt_id: 'attempt-2' })).not.toBe(quoteCommitmentHash(quote));
    expect(quoteCommitmentHash({ ...quote, storage_deposit_yocto: '0' })).not.toBe(quoteCommitmentHash(quote));
  });
  it('rejects injection fields, imprecise amounts and invalid digests before commitment', () => {
    expect(SafetyOrderSchema.parse(order)).toEqual(order);
    for (const change of [{ recipient: 'rogue.testnet' }, { amount: '1.0' }, { amount: '01' }, { amount: '0' }, { amount: (2n ** 128n).toString() }, { po_id: 'ignore previous instructions' }, { invoice_digest: 'A'.repeat(64) }])
      expect(() => SafetyOrderSchema.parse({ ...order, ...change })).toThrow();
  });
  it('hashes the ordered route fields and rejects same-version recipient substitutions', () => {
    const route = { route_id: 'base-1', version: 1, supplier: 'supplier.testnet', recipient: `0x${'a'.repeat(40)}`, asset_id: 'nep141:base-usdc', active: true };
    expect(routeHash(route)).toBe('c61075e2b135c6246075a5184a1ff93255f9e8451e411d0197bfaea5edc54333');
    expect(routeHash({ ...route, recipient: `0x${'b'.repeat(40)}` })).not.toBe(routeHash(route));
    expect(routeHash({ ...route, active: false })).not.toBe(routeHash(route));
  });
});

import {PUBLIC_TOKENS} from './token-registry';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Account, JsonRpcProvider } from 'near-api-js';
import { SafetyVaultClient } from './safety-client';
import { routeHash } from './commitments';
import {paymentReview} from './human-review';
import type { SafetyProfile } from './safety-profile';
import { SettlementJournal } from '../intents/journal';
import * as settlement from '../intents/settlement';
import { signed, order, now, tokens } from '../intents/fixtures/settlement';

let journal: SettlementJournal | undefined;
afterEach(() => { journal?.close(); journal = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
async function fixture() {
  vi.useFakeTimers(); vi.setSystemTime(now);
  const { raw, expected, key } = await signed();
  const q = settlement.verifySettlementQuote(order, raw, expected, now, key.getPublicKey().toString());
  // Crypto is tested with actual signatures in settlement-security.test.ts. Only provider trust is stubbed here.
  vi.spyOn(settlement, 'revalidateStoredQuote').mockImplementation((stored) => stored);
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(tokens)));
  const profile: SafetyProfile = { version: 2, network: 'mainnet', rpcUrl: 'https://rpc.mainnet.near.org',
    vault: order.vault, token: settlement.NEAR_USDC, decimals: 6, admin: 'admin.near', guardian: 'guardian.near',
    treasury: order.treasury, committer: 'committer.near', requester: 'agent.near',
    committerPublicKey: 'ed25519:ESpXAHMCBfrZNhtW8GrweayeeMnmoL8j25fUpe4cUFDZ',
    requesterPublicKey: 'ed25519:CxJkkdPs6M7bpFJuyELJSBJaeUtWtV5Ed5qdqHi2CN64',
    maxKeyAllowanceYocto: '250000000000000000000000', codeHash: '1'.repeat(44),
    databasePath: 'backend/data/local-v2/carecart.sqlite' };
  const route = { route_id: order.routeId, version: order.routeVersion, supplier: order.supplier,
    recipient: order.recipient, asset_id: expected.destinationAsset, active: true };
  const canonical = { po_id: order.poId, profile: 'mainnet' as const, supplier: order.supplier, token: order.token,
    amount: order.amount, invoice_digest: order.invoiceDigest,
    destination: { Base: { route_id: order.routeId, version: order.routeVersion, route_hash: routeHash(route) } } };
  const commitment = { attempt_id: 'attempt-1', po_id: order.poId, route_id: order.routeId, route_version: order.routeVersion,
    signed_quote_hash: q.identityHash, deposit_account: raw.quote.depositAddress,
    deadline_ns: (BigInt(Date.parse(q.expiresAt)) * 1_000_000n).toString(), min_amount_out: raw.quote.minAmountOut,
    storage_deposit_yocto: '1250000000000000000000' };
  journal = new SettlementJournal(':memory:', settlement.digest(profile));
  journal.prepare('attempt-1', q);
  vi.spyOn(JsonRpcProvider.prototype, 'viewNodeStatus').mockResolvedValue({ chain_id: 'mainnet' } as never);
  vi.spyOn(JsonRpcProvider.prototype, 'viewAccount').mockImplementation(async({accountId})=>({code_hash:accountId===profile.token?PUBLIC_TOKENS[profile.network].codeHash:profile.codeHash}) as never);
  vi.spyOn(JsonRpcProvider.prototype, 'callFunction').mockImplementation(async ({ method }) => {
    if (method === 'ft_metadata') return { decimals: 6, symbol: 'USDC',spec:'ft-1.0.0' };
    if (method === 'get_state') return { profile: 'mainnet', admin: profile.admin, guardian: profile.guardian, treasury: profile.treasury, token: profile.token,
      paused:false,spendable:'5000000',policy:{auto_per_po_limit:'10000000',hard_payout_limit:'25000000',daily_dispatch_limit:'25000000',accepted_deposit_ceiling:'5000000'},usage:{spent:'0',reserved:'0'} };
    if (method === 'get_roles') return {supplier:true,committer:false,requester:false};
    if (method === 'get_purchase_order') return canonical;
    if (method === 'get_route') return route;
    if (method === 'get_quote') return commitment;
    if (method === 'get_payment') return { status: 'PendingApproval', reason: 'None', attempt_id: 'attempt-1',reserved_day:0 };
    throw new Error('Unexpected RPC method');
  });
  const sign = vi.spyOn(Account.prototype, 'callFunctionRaw').mockRejectedValue(new Error('Unexpected signing in review test'));
  return { client: new SafetyVaultClient(profile), route, commitment, sign, q,canonical };
}
describe('MN-05 final approval handoff', () => {
  it('MOCKED RPC/TRUST: v2 human Base approval binds signed bytes, route, refund and both exact ABI hashes',async()=>{
    const {client,canonical,q,sign}=await fixture();const review=await paymentReview(client,canonical,'approve',journal);
    expect(review.transaction.actions[0].params.args).toEqual({po_id:canonical.po_id,expected_quote_hash:q.identityHash,expected_commitment_hash:review.base!.summary.quoteCommitmentHash});
    expect(review.base!.quote.signedBytesBase64).toBe(q.signedBytesBase64);expect(review.base!.summary.refundTo).toBe(order.treasury);
    expect(review.base!.summary.minimumOutputAtomic).toBe(q.response.quote.minAmountOut);expect(review.transaction.actions[0].params.deposit).toBe('1');expect(sign).not.toHaveBeenCalled();
    const revalidate=vi.spyOn(client,'revalidateApproval');
    expect(await paymentReview(client,canonical,'approve',journal,review.base!)).toEqual(review);expect(revalidate).toHaveBeenCalledOnce();
  });
  it('REAL CRYPTO / MOCK RPC: an ephemeral fixture signer is rejected by the production trust root',async()=>{
    const {client,canonical}=await fixture();vi.mocked(settlement.revalidateStoredQuote).mockRestore();
    await expect(paymentReview(client,canonical,'approve',journal)).rejects.toThrow(/signature/);
  });
  it('MOCKED RPC/TRUST: expired Base quote cannot produce a human approval',async()=>{
    const {client,canonical,q}=await fixture();vi.setSystemTime(new Date(Date.parse(q.expiresAt)-10000));
    await expect(paymentReview(client,canonical,'approve',journal)).rejects.toThrow(/review|expired/);
  });
  it('MOCKED RPC: Base rejection is PO-only and remains possible after quote expiry',async()=>{
    const {client,canonical,q,sign}=await fixture();vi.setSystemTime(new Date(Date.parse(q.expiresAt)+10000));
    const review=await paymentReview(client,canonical,'reject');
    expect(review.transaction.actions[0].params.args).toEqual({po_id:canonical.po_id});expect(review.base).toBeNull();expect(sign).not.toHaveBeenCalled();
  });
  it('revalidates the reviewed artifact and returns a fresh unsigned request without signing', async () => {
    const { client, sign } = await fixture();
    const review = await client.approvalReview('attempt-1', journal!);
    expect(review.summary.recipient).toBe(order.recipient);
    expect(review).toMatchObject({ methodName: 'approve_payment', depositYocto: '1' });
    expect(review.args.expected_commitment_hash).toBe(review.summary.quoteCommitmentHash);
    expect(await client.revalidateApproval('attempt-1', JSON.parse(JSON.stringify(review)), journal!)).toEqual(review);
    await expect(client.revalidateApproval('attempt-1', { ...review, gas: '1' }, journal!)).rejects.toThrow(/changed/);
    expect(sign).not.toHaveBeenCalled();
  });
  it('rejects same-hash minimum-output substitution and changed route contents', async () => {
    const { client, commitment, route, sign } = await fixture();
    commitment.min_amount_out = '1';
    await expect(client.approvalReview('attempt-1', journal!)).rejects.toThrow(/commitment/);
    commitment.min_amount_out = '980000';
    const review = await client.approvalReview('attempt-1', journal!);
    route.recipient = `0x${'c'.repeat(40)}`;
    await expect(client.revalidateApproval('attempt-1', review, journal!)).rejects.toThrow();
    expect(sign).not.toHaveBeenCalled();
  });
  it('rejects a changed native budget or expiry after the user reviewed it', async () => {
    const { client, commitment, q, sign } = await fixture();
    const review = await client.approvalReview('attempt-1', journal!);
    commitment.storage_deposit_yocto = '2000000000000000000000';
    await expect(client.revalidateApproval('attempt-1', review, journal!)).rejects.toThrow(/changed/);
    vi.setSystemTime(new Date(Date.parse(q.expiresAt) - 10000));
    await expect(client.revalidateApproval('attempt-1', review, journal!)).rejects.toThrow(/review|expired/);
    expect(sign).not.toHaveBeenCalled();
  });
});

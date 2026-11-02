import { afterEach, describe, expect, it } from 'vitest';
import {
  buildSettlementRequest,
  verifySettlementQuote,
  BASE_USDC,
  NEAR_USDC,
  resolveSettlementAssets,
  type WetQuote,
} from './settlement';
import { SettlementJournal } from './journal';
import {
  verifyBaseReceipt,
  verifyNearRefund,
  verifyNearDispatch,
  type Rpc,
} from './receipts';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { now, order, tokens, signed } from './fixtures/settlement';
let journal: SettlementJournal | undefined;
let dir: string | undefined;
afterEach(() => {
  journal?.close();
  journal = undefined;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});
describe('signed Base settlement boundary', () => {
  it('binds final human approval and canonical source-token receipt to the exact quoted transfer', async () => {
    const { raw, expected, key } = await signed();
    const q = verifySettlementQuote(
      order,
      raw,
      expected,
      now,
      key.getPublicKey().toString(),
    );
    const proof = {
      final_execution_status: 'FINAL',
      status: { SuccessValue: '' },
      transaction: {
        hash: 'source-hash',
        signer_id: 'admin.near',
        receiver_id: order.vault,
        actions: [
          {
            FunctionCall: {
              method_name: 'approve_payment',
              deposit: '1',
              gas: 120_000_000_000_000,
              args: Buffer.from(
                JSON.stringify({
                  po_id: order.poId,
                  expected_quote_hash: q.identityHash,
                  expected_commitment_hash: 'b'.repeat(64),
                }),
              ).toString('base64'),
            },
          },
        ],
      },
      receipts_outcome: [
        {
          id: 'token-receipt',
          outcome: {
            executor_id: NEAR_USDC,
            status: { SuccessValue: '' },
            logs: [
              `EVENT_JSON:${JSON.stringify({ standard: 'nep141', event: 'ft_transfer', data: [{ old_owner_id: order.vault, new_owner_id: raw.quote.depositAddress, amount: order.amount }] })}`,
            ],
          },
        },
      ],
    };
    expect(
      verifyNearDispatch(q, 'source-hash', 'admin.near', proof, 'b'.repeat(64)),
    ).toMatchObject({ amount: order.amount, finality: 'FINAL' });
    expect(() => verifyNearDispatch(q, 'source-hash', 'admin.near', proof, 'c'.repeat(64))).toThrow('quote mismatch');
    const changed = structuredClone(proof);
    changed.transaction.receiver_id = 'rogue.near';
    expect(() =>
      verifyNearDispatch(q, 'source-hash', 'admin.near', changed, 'b'.repeat(64)),
    ).toThrow();
    proof.receipts_outcome[0].outcome.executor_id = 'rogue.near';
    expect(() =>
      verifyNearDispatch(q, 'source-hash', 'admin.near', proof, 'b'.repeat(64)),
    ).toThrow('amount not proven');
  });
  it('requires source proof and preserves partial-refund evidence without claiming a full refund', async () => {
    const { raw, expected, key } = await signed();
    const q = verifySettlementQuote(
      order,
      raw,
      expected,
      now,
      key.getPublicKey().toString(),
    );
    journal = new SettlementJournal(':memory:', 'a'.repeat(64));
    journal.prepare('refund-attempt', q);
    journal.reconcileSource(
      'refund-attempt',
      { status: 'Dispatched', attempt_id: 'refund-attempt' },
      {
        signed_quote_hash: q.identityHash,
        deposit_account: raw.quote.depositAddress,
      },
    );
    const status = {
      status: 'REFUNDED',
      correlationId: 'fixture',
      updatedAt: now.toISOString(),
      quoteResponse: raw,
      swapDetails: {
        destinationChainTxHashes: [],
        originChainTxHashes: [],
        refundedAmount: '999000',
      },
    };
    await expect(
      journal.reconcileDestination('refund-attempt', status, async () => null),
    ).rejects.toThrow('source transaction');
    journal.recordSource('refund-attempt', { transactionHash: 'source-proof' });
    expect(
      (
        await journal.reconcileDestination(
          'refund-attempt',
          status,
          async () => null,
        )
      ).state,
    ).toBe('Dispatched');
    const result = await journal.reconcileDestination(
      'refund-attempt',
      status,
      async () => ({
        key: 'independent-near-refund',
        evidence: { fixture: true },
      }),
    );
    expect(result.state).toBe('Refunded');
    expect(result.evidence).toMatchObject({
      amount: '999000',
      fullRefund: false,
      backendVerified: true,
    });
  });
  it('resolves canonical six-decimal contracts from the live list, never symbol alone', () => {
    expect(resolveSettlementAssets(tokens).destination.assetId).toBe(
      'live-base-id',
    );
    expect(
      resolveSettlementAssets([
        ...tokens,
        {
          assetId: 'native-near',
          blockchain: 'near',
          symbol: 'NEAR',
          decimals: 24,
        },
      ]).destination.assetId,
    ).toBe('live-base-id');
    expect(() =>
      resolveSettlementAssets([
        { ...tokens[0] },
        { ...tokens[1], contractAddress: `0x${'c'.repeat(40)}` },
      ]),
    ).toThrow();
    expect(() =>
      buildSettlementRequest({ ...order, amount: '25000001' }, tokens, now),
    ).toThrow();
  });
  it('cryptographically verifies the SDK signed message and rejects every execution substitution', async () => {
    const { raw, expected, key } = await signed();
    const trust = key.getPublicKey().toString();
    expect(
      verifySettlementQuote(order, raw, expected, now, trust).identityHash,
    ).toMatch(/^[0-9a-f]{64}$/);
    expect(() => verifySettlementQuote(order, raw, expected, now)).toThrow(
      'signature',
    );
    for (const mutate of [
      (r: WetQuote) => {
        r.quote.depositAddress = 'c'.repeat(64);
      },
      (r: WetQuote) => {
        r.quote.minAmountOut = '970000';
      },
      (r: WetQuote) => {
        r.quoteRequest.recipient = `0x${'d'.repeat(40)}`;
      },
      (r: WetQuote) => {
        r.quoteRequest.refundTo = 'rogue.near';
      },
      (r: WetQuote) => {
        r.quote.withdrawFee = '100001';
      },
    ]) {
      const changed = structuredClone(raw);
      mutate(changed);
      expect(() =>
        verifySettlementQuote(order, changed, expected, now, trust),
      ).toThrow();
    }
    expect(() =>
      verifySettlementQuote(
        order,
        raw,
        expected,
        new Date(now.getTime() + 600001),
        trust,
      ),
    ).toThrow();
    expect(() =>
      verifySettlementQuote(
        order,
        { ...raw, quoteRequest: { ...expected, appFees: [] } },
        expected,
        now,
        trust,
      ),
    ).toThrow();
  });
  it('survives restart, never equates provider SUCCESS with settlement and prevents duplicate source attempts', async () => {
    const { raw, expected, key } = await signed();
    const q = verifySettlementQuote(
      order,
      raw,
      expected,
      now,
      key.getPublicKey().toString(),
    );
    dir = mkdtempSync(join(tmpdir(), 'carecart-settlement-'));
    const path = join(dir, 'settlement.sqlite');
    journal = new SettlementJournal(path, 'a'.repeat(64));
    journal.prepare('attempt-1', q);
    expect(() => journal!.prepare('attempt-2', q)).toThrow();
    journal.reconcileSource(
      'attempt-1',
      { status: 'Dispatched', attempt_id: 'attempt-1' },
      {
        signed_quote_hash: q.identityHash,
        deposit_account: raw.quote.depositAddress,
      },
    );
    journal.recordSource('attempt-1', { transactionHash: 'fixture-source' });
    journal.close();
    journal = new SettlementJournal(path, 'a'.repeat(64));
    expect(journal.get('attempt-1').state).toBe('Dispatched');
    expect(journal.get('attempt-1').sourceEvidence).toEqual({
      transactionHash: 'fixture-source',
    });
    const status = {
      status: 'SUCCESS',
      correlationId: 'fixture',
      updatedAt: now.toISOString(),
      quoteResponse: raw,
      swapDetails: { destinationChainTxHashes: [], originChainTxHashes: [] },
    };
    expect(
      (
        await journal.reconcileDestination(
          'attempt-1',
          status,
          async () => null,
        )
      ).state,
    ).toBe('Dispatched');
    expect(
      (
        await journal.reconcileDestination('attempt-1', status, async () => ({
          key: 'verified-independent-receipt',
          evidence: { fixture: true },
        }))
      ).state,
    ).toBe('Settled');
    expect(
      (
        await journal.reconcileDestination('attempt-1', status, async () => {
          throw new Error('must not replay');
        })
      ).state,
    ).toBe('Settled');
    expect(() => new SettlementJournal(path, 'b'.repeat(64))).toThrow(
      'profile mismatch',
    );
  });
  it('permits a refreshed quote attempt only for the same immutable PO', async () => {
    const { raw, expected, key } = await signed();
    const q = verifySettlementQuote(order, raw, expected, now, key.getPublicKey().toString());
    journal = new SettlementJournal(':memory:', 'a'.repeat(64));
    journal.prepare('expired-attempt', q);
    journal.reconcileSource('expired-attempt', { status: 'Expired', attempt_id: 'expired-attempt' }, {
      signed_quote_hash: q.identityHash, deposit_account: raw.quote.depositAddress,
    });
    for (const change of [{ amount: '2000000' }, { supplier: 'other.near' }, { recipient: `0x${'c'.repeat(40)}` }, { routeVersion: 2 }]) {
      expect(() => journal!.prepare('substitution', { ...q, order: { ...q.order, ...change }, reviewHash: 'c'.repeat(64) })).toThrow(/Immutable PO/);
    }
    expect(journal.prepare('refreshed-attempt', { ...q, reviewHash: 'b'.repeat(64) }).poId).toBe(q.order.poId);
  });
  it('validates independent Base finality, canonical block, token and recipient', async () => {
    const { raw, expected, key } = await signed();
    const q = verifySettlementQuote(
      order,
      raw,
      expected,
      now,
      key.getPublicKey().toString(),
    );
    const h = `0x${'1'.repeat(64)}`,
      bh = `0x${'2'.repeat(64)}`;
    let wrong = false;
    const rpc: Rpc = async (method, params) =>
      method === 'eth_chainId'
        ? '0x2105'
        : method === 'eth_getBlockByNumber'
          ? { number: params[0] === 'finalized' ? '0x64' : '0x60', hash: bh }
          : {
              transactionHash: h,
              status: '0x1',
              blockNumber: '0x60',
              blockHash: bh,
              logs: [
                {
                  address: BASE_USDC,
                  topics: [
                    '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
                    `0x${'0'.repeat(64)}`,
                    `0x${(wrong ? 'c'.repeat(40) : order.recipient.slice(2)).padStart(64, '0')}`,
                  ],
                  data: `0x${BigInt(990000).toString(16).padStart(64, '0')}`,
                  logIndex: '0x0',
                },
              ],
            };
    expect(await verifyBaseReceipt(q, [h], '980000', rpc)).not.toBeNull();
    wrong = true;
    expect(await verifyBaseReceipt(q, [h], '980000', rpc)).toBeNull();
    await expect(
      verifyBaseReceipt(q, [h], '980000', async () => '0xaa36a7'),
    ).rejects.toThrow('Base');
  });
  it('requires a successful FINAL canonical-token treasury transfer for refund proof', async () => {
    const { raw, expected, key } = await signed();
    const q = verifySettlementQuote(
      order,
      raw,
      expected,
      now,
      key.getPublicKey().toString(),
    );
    const proof = {
      final_execution_status: 'FINAL',
      status: { SuccessValue: '' },
      transaction: { hash: 'near-refund' },
      receipts_outcome: [
        {
          id: 'receipt-1',
          outcome: {
            executor_id: NEAR_USDC,
            status: { SuccessValue: '' },
            logs: [
              `EVENT_JSON:${JSON.stringify({ standard: 'nep141', event: 'ft_transfer', data: [{ old_owner_id: 'intents.near', new_owner_id: order.treasury, amount: '999000' }] })}`,
            ],
          },
        },
      ],
    };
    expect(verifyNearRefund(q, 'near-refund', '999000', proof)).not.toBeNull();
    expect(verifyNearRefund(q, 'near-refund', '1000000', proof)).toBeNull();
    proof.receipts_outcome[0].outcome.executor_id = 'rogue.near';
    expect(verifyNearRefund(q, 'near-refund', '999000', proof)).toBeNull();
  });
});

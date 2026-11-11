/** Offline fixtures only; ephemeral signer is never trusted by the production adapter. */
import { KeyPair, baseEncode } from 'near-api-js';
import { quoteHash, type QuoteResponse } from '@defuse-protocol/one-click-sdk-typescript';
import { buildSettlementRequest, BASE_USDC, NEAR_USDC, type SettlementOrder, type WetQuote } from '../settlement';

export const now = new Date('2026-11-02T12:00:00Z');
export const order: SettlementOrder = {
  profile: 'local-usdc-v2',
  poId: 'po-base-1',
  vault: 'vault.near',
  treasury: 'treasury.near',
  supplier: 'supplier.near',
  token: NEAR_USDC,
  amount: '1000000',
  invoiceDigest: 'a'.repeat(64),
  routeId: 'base-1',
  routeVersion: 1,
  recipient: `0x${'a'.repeat(40)}`,
  destinationChain: 'base',
  destinationToken: BASE_USDC,
  maxFeeAtomic: '100000',
};
export const tokens = [
  {
    assetId: 'live-origin-id',
    blockchain: 'near',
    contractAddress: NEAR_USDC,
    decimals: 6,
    symbol: 'USDC',
  },
  {
    assetId: 'live-base-id',
    blockchain: 'base',
    contractAddress: BASE_USDC,
    decimals: 6,
    symbol: 'USDC',
  },
];
export function signed() {
  const expected = buildSettlementRequest(order, tokens, now);
  const key = KeyPair.fromRandom('ed25519');
  const raw: WetQuote = {
    correlationId: 'fixture',
    timestamp: now.toISOString(),
    signature: 'pending',
    quoteRequest: expected,
    quote: {
      amountIn: '1000000',
      amountInFormatted: '1',
      amountInUsd: '1',
      minAmountIn: '1000000',
      amountOut: '990000',
      amountOutFormatted: '.99',
      amountOutUsd: '.99',
      minAmountOut: '980000',
      depositAddress: 'b'.repeat(64),
      deadline: expected.deadline,
      timeWhenInactive: expected.deadline,
      timeEstimate: 60,
      refundFee: '1000',
      withdrawFee: '1000',
    },
  };
  const bytes = key.sign(
    new TextEncoder().encode(quoteHash(raw as unknown as QuoteResponse)),
  ).signature;
  raw.signature = baseEncode(bytes);
  return Promise.resolve({ raw, expected, key });
}

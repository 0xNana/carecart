import { createHash } from 'node:crypto';
import {
  quoteHash,
  verifyQuoteSignature,
  type QuoteResponse,
} from '@defuse-protocol/one-click-sdk-typescript';
import { z } from 'zod';

export const NEAR_USDC =
  '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
export const BASE_USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
// SDK 0.1.26 quote-signature.ts; rotate only through a reviewed source change.
export const ONECLICK_SIGNER =
  'ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc';
const atomic = z.string().regex(/^(0|[1-9][0-9]{0,38})$/).refine((v) => BigInt(v) < 2n ** 128n);
const positive = atomic.refine((v) => BigInt(v) > 0n);
const account = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/)
  .refine((v) => !v.endsWith('.testnet'));
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
export const SettlementOrderSchema = z
  .object({
    profile: z.literal('mainnet-usdc-v2'),
    poId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
    vault: account,
    treasury: account,
    supplier: account,
    token: z.literal(NEAR_USDC),
    amount: positive.refine((v) => BigInt(v) <= 25_000_000n),
    invoiceDigest: z.string().regex(/^[0-9a-f]{64}$/),
    routeId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
    routeVersion: z.number().int().positive().max(4_294_967_295),
    recipient: address,
    destinationChain: z.literal('base'),
    destinationToken: z.literal(BASE_USDC),
    maxFeeAtomic: atomic,
  })
  .strict()
  .refine((o) => BigInt(o.maxFeeAtomic) < BigInt(o.amount), 'Fee/loss budget must be less than PO input');
export type SettlementOrder = z.infer<typeof SettlementOrderSchema>;
const tokenSchema = z.object({
  assetId: z.string().min(1),
  blockchain: z.string(),
  contractAddress: z.string().optional(),
  decimals: z.number().int(),
  symbol: z.string(),
});
export const WetQuoteSchema = z
  .object({
    correlationId: z.string().min(1).max(256),
    timestamp: z.iso.datetime(),
    signature: z.string().min(1).max(256),
    quoteRequest: z
      .object({
        dry: z.literal(false),
        swapType: z.literal('EXACT_INPUT'),
        slippageTolerance: z.number().int().min(0).max(100),
        originAsset: z.string(),
        destinationAsset: z.string(),
        amount: positive,
        depositType: z.literal('ORIGIN_CHAIN'),
        recipientType: z.literal('DESTINATION_CHAIN'),
        refundType: z.literal('ORIGIN_CHAIN'),
        refundTo: account,
        recipient: address,
        deadline: z.iso.datetime(),
      })
      .strict(),
    quote: z
      .object({
        amountIn: positive,
        amountInFormatted: z.string(),
        amountInUsd: z.string(),
        minAmountIn: atomic,
        amountOut: positive,
        amountOutFormatted: z.string(),
        amountOutUsd: z.string(),
        minAmountOut: positive,
        depositAddress: z.string().regex(/^[0-9a-f]{64}$/),
        deadline: z.iso.datetime(),
        timeWhenInactive: z.iso.datetime(),
        timeEstimate: z.number().nonnegative(),
        refundFee: atomic,
        withdrawFee: atomic,
      })
      .strict(),
  })
  .strict();
export type WetQuote = z.infer<typeof WetQuoteSchema>;
export interface VerifiedQuote {
  order: SettlementOrder;
  response: WetQuote;
  signedMessage: string;
  signedBytesBase64: string;
  signerPublicKey: string;
  identityHash: string;
  reviewHash: string;
  expiresAt: string;
}
export const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function resolveSettlementAssets(list: unknown) {
  const tokens = z.array(tokenSchema).parse(list);
  const origins = tokens.filter(
    (t) =>
      t.blockchain === 'near' &&
      t.contractAddress === NEAR_USDC &&
      t.decimals === 6 &&
      t.symbol === 'USDC',
  );
  const destinations = tokens.filter(
    (t) =>
      t.blockchain === 'base' &&
      t.contractAddress?.toLowerCase() === BASE_USDC &&
      t.decimals === 6 &&
      t.symbol === 'USDC',
  );
  if (origins.length !== 1 || destinations.length !== 1 ||
      origins[0].assetId === destinations[0].assetId ||
      tokens.filter((t) => t.assetId === origins[0].assetId).length !== 1 ||
      tokens.filter((t) => t.assetId === destinations[0].assetId).length !== 1)
    throw new Error('Canonical native USDC route unavailable or ambiguous');
  return { origin: origins[0], destination: destinations[0] };
}
export function buildSettlementRequest(
  input: SettlementOrder,
  list: unknown,
  now = new Date(),
) {
  const order = SettlementOrderSchema.parse(input);
  const assets = resolveSettlementAssets(list);
  return {
    dry: false as const,
    swapType: 'EXACT_INPUT' as const,
    slippageTolerance: 100,
    originAsset: assets.origin.assetId,
    destinationAsset: assets.destination.assetId,
    amount: order.amount,
    depositType: 'ORIGIN_CHAIN' as const,
    recipientType: 'DESTINATION_CHAIN' as const,
    refundType: 'ORIGIN_CHAIN' as const,
    refundTo: order.treasury,
    recipient: order.recipient,
    deadline: new Date(now.getTime() + 600000).toISOString(),
  };
}
/** Pure verifier permits a fixture trust root; production adapter always supplies ONECLICK_SIGNER. */
export function verifySettlementQuote(
  orderInput: SettlementOrder,
  raw: unknown,
  expected: ReturnType<typeof buildSettlementRequest>,
  now = new Date(),
  trustRoot = ONECLICK_SIGNER,
): VerifiedQuote {
  const order = SettlementOrderSchema.parse(orderInput);
  const response = WetQuoteSchema.parse(raw);
  expected = WetQuoteSchema.shape.quoteRequest.parse(expected);
  if (
    Object.keys(expected).some(
      (k) =>
        response.quoteRequest[k as keyof typeof expected] !==
        expected[k as keyof typeof expected],
    )
  )
    throw new Error('Quote request substitution');
  // These extra comparisons bind the expected request itself to the immutable order.
  if (
    expected.amount !== order.amount ||
    expected.refundTo !== order.treasury ||
    expected.recipient !== order.recipient ||
    response.quote.amountIn !== order.amount
  )
    throw new Error('PO quote mismatch');
  if (
    BigInt(response.quote.minAmountOut) > BigInt(response.quote.amountOut) ||
    BigInt(response.quote.minAmountIn) === 0n ||
    BigInt(response.quote.minAmountIn) > BigInt(order.amount) ||
    BigInt(order.amount) - BigInt(response.quote.minAmountOut) > BigInt(order.maxFeeAtomic) ||
    BigInt(response.quote.refundFee) + BigInt(response.quote.withdrawFee) >
      BigInt(order.maxFeeAtomic)
  )
    throw new Error('Quote bounds or fee budget exceeded');
  const expiry = Math.min(
    Date.parse(response.quote.deadline),
    Date.parse(response.quote.timeWhenInactive),
    Date.parse(expected.deadline),
  );
  if (
    expiry <= now.getTime() + 30000 ||
    expiry > now.getTime() + 600000 ||
    Math.abs(now.getTime() - Date.parse(response.timestamp)) > 60000
  )
    throw new Error('Expired or stale quote');
  if (!verifyQuoteSignature(response as unknown as QuoteResponse, trustRoot))
    throw new Error('Untrusted quote signature');
  const signedMessage = quoteHash(response as unknown as QuoteResponse);
  const signedBytesBase64 = Buffer.from(signedMessage, 'utf8').toString('base64');
  const identityHash = createHash('sha256').update(signedMessage).digest('hex');
  // SDK signed message is the UTF-8 Base58 digest, not an arbitrary JSON hash.
  return {
    order,
    response,
    signedMessage,
    signedBytesBase64,
    signerPublicKey: trustRoot,
    identityHash,
    reviewHash: digest({ order, response, identityHash, signerPublicKey: trustRoot, signedBytesBase64 }),
    expiresAt: new Date(expiry).toISOString(),
  };
}
/** Recheck persisted bytes, live asset identity and expiry immediately before commitment/review. */
export function revalidateStoredQuote(
  stored: VerifiedQuote,
  list: unknown,
  now = new Date(),
  trustRoot = ONECLICK_SIGNER,
): VerifiedQuote {
  // Historical issue time is used to reverify the signature without requiring a newly issued quote.
  // Actual current time still controls expiry and rejects a future-dated persisted response.
  if (Date.parse(stored.response.timestamp) > now.getTime() + 60000)
    throw new Error('Stored quote issue time is in the future');
  const expected = {
    ...buildSettlementRequest(stored.order, list, now),
    deadline: stored.response.quoteRequest.deadline,
  };
  const verified = verifySettlementQuote(
    stored.order,
    stored.response,
    expected,
    new Date(stored.response.timestamp),
    trustRoot,
  );
  if (
    verified.reviewHash !== stored.reviewHash ||
    verified.identityHash !== stored.identityHash ||
    verified.signedMessage !== stored.signedMessage ||
    verified.signedBytesBase64 !== stored.signedBytesBase64 ||
    verified.signerPublicKey !== stored.signerPublicKey ||
    verified.expiresAt !== stored.expiresAt ||
    Date.parse(verified.expiresAt) <= now.getTime() + 30000
  )
    throw new Error('Stored quote changed or expired');
  return verified;
}
/** No signing or deposit method. The testnet preview adapter remains completely separate. */
export class SettlementQuotes {
  constructor(
    private readonly apiKey: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}
  private async request(path: string, body?: object): Promise<unknown> {
    const r = await this.fetcher(`https://1click.chaindefuser.com${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': this.apiKey },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'error',
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) throw new Error('Settlement provider unavailable');
    return r.json();
  }
  async prepare(order: SettlementOrder, now = new Date()) {
    if (!this.apiKey)
      throw new Error('Explicit settlement API configuration required');
    const list = await this.request('/v0/tokens');
    const expected = buildSettlementRequest(order, list, now);
    return verifySettlementQuote(
      order,
      await this.request('/v0/quote', expected),
      expected,
      now,
      ONECLICK_SIGNER,
    );
  }
  async status(depositAccount: string) {
    if (!/^[0-9a-f]{64}$/.test(depositAccount))
      throw new Error('Invalid deposit account');
    return this.request(
      `/v0/status?depositAddress=${encodeURIComponent(depositAccount)}`,
    );
  }
}
export const ExecutionStatusSchema = z.object({
  correlationId: z.string(),
  updatedAt: z.iso.datetime(),
  quoteResponse: WetQuoteSchema,
  status: z.enum([
    'PENDING_DEPOSIT',
    'KNOWN_DEPOSIT_TX',
    'PROCESSING',
    'SUCCESS',
    'FAILED',
    'REFUNDED',
    'INCOMPLETE_DEPOSIT',
  ]),
  swapDetails: z
    .object({
      destinationChainTxHashes: z.array(
        z.object({ hash: z.string(), explorerUrl: z.string() }),
      ),
      originChainTxHashes: z.array(
        z.object({ hash: z.string(), explorerUrl: z.string() }),
      ),
      refundedAmount: atomic.optional(),
    })
    .passthrough(),
});

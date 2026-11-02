import { z } from 'zod';
import { parseAtomicAmount } from '../domain';

export const DestinationChain = z.enum(['base', 'arb', 'sol']);
export type DestinationChain = z.infer<typeof DestinationChain>;
export const PREVIEW_NOTICE = 'Preview/simulation only. No deposit, swap or settlement is initiated.';
const API_ORIGIN = 'https://1click.chaindefuser.com';
const Atomic = z.string().regex(/^(0|[1-9][0-9]{0,77})$/);
const PositiveAtomic = Atomic.refine((value) => BigInt(value) > 0n);
const TokenSchema = z.object({ assetId: z.string().min(1), decimals: z.number().int().min(0).max(38),
  blockchain: z.string().min(1), symbol: z.string().min(1), price: z.number().nonnegative(), priceUpdatedAt: z.iso.datetime(),
  contractAddress: z.string().optional() });

// Required fields follow the official QuoteResponse/Quote models (SDK 0.1.26) and live API docs.
// Dry quotes omit deadline/timeWhenInactive/depositAddress in quote; the request still has a deadline.
export const DryQuoteResponseSchema = z.object({ correlationId: z.string().min(1), timestamp: z.iso.datetime(), signature: z.string(),
  quoteRequest: z.object({ dry: z.literal(true), swapType: z.literal('EXACT_INPUT'), slippageTolerance: z.number().int(),
    originAsset: z.string(), destinationAsset: z.string(), amount: PositiveAtomic, refundTo: z.string(), recipient: z.string(),
    depositType: z.literal('ORIGIN_CHAIN'), recipientType: z.literal('DESTINATION_CHAIN'), refundType: z.literal('ORIGIN_CHAIN'), deadline: z.iso.datetime() }),
  quote: z.object({ amountIn: PositiveAtomic, amountInFormatted: z.string(), amountInUsd: z.string(), minAmountIn: Atomic,
    amountOut: PositiveAtomic, amountOutFormatted: z.string(), amountOutUsd: z.string(), minAmountOut: Atomic,
    timeEstimate: z.number().nonnegative(), depositAddress: z.never().optional(), depositMemo: z.never().optional(),
    chainDepositAddresses: z.never().optional(), deadline: z.never().optional(), timeWhenInactive: z.never().optional() }),
});
export interface DryPreviewConfig { originAssetId: string; destinationAssetId: string; amountAtomic: string; recipient: string; refundTo: string; apiKey?: string }
export class PreviewError extends Error {
  constructor(readonly code: 'PREVIEW_NOT_CONFIGURED' | 'PREVIEW_UPSTREAM_ERROR' | 'PREVIEW_INVALID_RESPONSE' | 'PREVIEW_ASSET_UNSUPPORTED', message: string) { super(message); }
}
export function loadDryPreviewConfiguration(env: NodeJS.ProcessEnv = process.env): DryPreviewConfig | undefined {
  if (!env.ONECLICK_PREVIEW_ENABLED || env.ONECLICK_PREVIEW_ENABLED === 'false') return undefined;
  if (env.ONECLICK_PREVIEW_ENABLED !== 'true') throw new Error('ONECLICK_PREVIEW_ENABLED must be true or false');
  if ((env.ONECLICK_BASE_URL || API_ORIGIN) !== API_ORIGIN) throw new Error('Dry previews require the official HTTPS 1Click host');
  const schema = z.object({ originAssetId: z.string().trim().min(1), destinationAssetId: z.string().trim().min(1),
    amountAtomic: PositiveAtomic, recipient: z.string().trim().min(1).max(256), refundTo: z.string().trim().min(1).max(256) });
  const result = schema.safeParse({ originAssetId: env.ONECLICK_PREVIEW_ORIGIN_ASSET_ID,
    destinationAssetId: env.ONECLICK_PREVIEW_DESTINATION_ASSET_ID, amountAtomic: env.ONECLICK_PREVIEW_AMOUNT_ATOMIC,
    recipient: env.ONECLICK_PREVIEW_RECIPIENT, refundTo: env.ONECLICK_PREVIEW_REFUND_TO });
  if (!result.success) throw new Error('Enabled 1Click dry previews need a complete reviewed route, amount, recipient and refund address');
  return { ...result.data, apiKey: env.ONECLICK_JWT?.trim() || undefined };
}

/** No network, signing or payment-state writes. Mock destinations deliberately are not real addresses. */
export function simulateCrossChain(input: { purchaseOrderId: string; supplierId: string; supplierName: string; amountAtomic: string; assetCode: string; destinationChain: DestinationChain }, now: Date) {
  parseAtomicAmount(input.amountAtomic);
  return { mode: 'mock_simulation' as const, status: 'preview_only' as const, settlement: 'not_initiated' as const,
    notice: PREVIEW_NOTICE, generatedAt: now.toISOString(), ...input, originNetwork: 'NEAR testnet',
    simulatedRecipient: `simulation:${input.supplierId}:${input.destinationChain}`,
    steps: ['Synthetic PO selected', 'Cross-chain route simulated', 'Human review would be required for a future live payout', 'Stopped before any deposit or settlement'],
  };
}

/** Optional indicative MAINNET market data, independent of CCTEST PO amounts. Only tokens + dry quote exist here. */
export class DryQuotePreview {
  constructor(private readonly config: DryPreviewConfig, private readonly fetcher: typeof fetch = fetch) {}
  private async request(path: '/v0/tokens' | '/v0/quote', body?: object): Promise<unknown> {
    try {
      const response = await this.fetcher(`${API_ORIGIN}${path}`, { method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json', ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}) },
        body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(12000), redirect: 'error' });
      if (!response.ok) throw new Error('upstream unavailable');
      return await response.json();
    } catch { throw new PreviewError('PREVIEW_UPSTREAM_ERROR', 'The optional dry quote service is unavailable. Try the offline simulation.'); }
  }
  async preview(now = new Date()) {
    const parsedTokens = z.array(TokenSchema).safeParse(await this.request('/v0/tokens'));
    if (!parsedTokens.success) throw new PreviewError('PREVIEW_INVALID_RESPONSE', 'The live token list has an invalid format.');
    // Resolve exact IDs from the current list: never synthesize IDs or choose a token by symbol alone.
    const origin = parsedTokens.data.find((token) => token.assetId === this.config.originAssetId);
    const destination = parsedTokens.data.find((token) => token.assetId === this.config.destinationAssetId);
    if (!origin || !destination || origin.blockchain !== 'near' || !['base', 'arb', 'sol'].includes(destination.blockchain)) {
      throw new PreviewError('PREVIEW_ASSET_UNSUPPORTED', 'The configured NEAR-to-cross-chain assets are not supported by the live token list.');
    }
    const request = { dry: true as const, swapType: 'EXACT_INPUT' as const, slippageTolerance: 100,
      originAsset: origin.assetId, destinationAsset: destination.assetId, amount: this.config.amountAtomic,
      depositType: 'ORIGIN_CHAIN' as const, recipientType: 'DESTINATION_CHAIN' as const, refundType: 'ORIGIN_CHAIN' as const,
      recipient: this.config.recipient, refundTo: this.config.refundTo, deadline: new Date(now.getTime() + 600000).toISOString() };
    const response = DryQuoteResponseSchema.safeParse(await this.request('/v0/quote', request));
    if (!response.success) throw new PreviewError('PREVIEW_INVALID_RESPONSE', 'The service did not return a valid dry-only quote. No payment was initiated.');
    const { quote, quoteRequest } = response.data;
    if (Object.entries(request).some(([key, value]) => quoteRequest[key as keyof typeof quoteRequest] !== value)
      || quote.amountIn !== request.amount || BigInt(quote.minAmountOut) > BigInt(quote.amountOut)) {
      throw new PreviewError('PREVIEW_INVALID_RESPONSE', 'The dry quote does not match the reviewed market-data request.');
    }
    // Return a small allowlist; raw provider payload/signature/deposit fields never reach the browser or logs.
    return { mode: 'oneclick_dry_preview' as const, status: 'preview_only' as const, settlement: 'not_initiated' as const,
      notice: PREVIEW_NOTICE, dry: true as const, quoteNetwork: 'mainnet_market_data' as const,
      unrelatedToTestPurchaseOrder: true, correlationId: response.data.correlationId, generatedAt: response.data.timestamp,
      origin: { assetId: origin.assetId, blockchain: origin.blockchain, symbol: origin.symbol, decimals: origin.decimals },
      destination: { assetId: destination.assetId, blockchain: destination.blockchain, symbol: destination.symbol, decimals: destination.decimals },
      amountInAtomic: quote.amountIn, amountOutAtomic: quote.amountOut, minAmountOutAtomic: quote.minAmountOut,
      timeEstimateSeconds: quote.timeEstimate, recipient: request.recipient, refundTo: request.refundTo,
    };
  }
}

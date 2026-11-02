import { afterEach, describe, expect, it, vi } from 'vitest';
import { DryQuotePreview, DryQuoteResponseSchema, loadDryPreviewConfiguration, type DryPreviewConfig } from './preview';
const now = new Date('2026-11-02T10:00:00.000Z');
const config: DryPreviewConfig = { originAssetId: 'live-near-asset', destinationAssetId: 'live-base-asset', amountAtomic: '1000000', recipient: 'configured-destination', refundTo: 'configured-refund' };
const tokens = [
  { assetId: config.originAssetId, blockchain: 'near', symbol: 'USDC', decimals: 6, price: 1, priceUpdatedAt: now.toISOString() },
  { assetId: config.destinationAssetId, blockchain: 'base', symbol: 'USDC', decimals: 6, price: 1, priceUpdatedAt: now.toISOString() },
];
function response(request: object) {
  return { correlationId: 'fixture-dry-quote', timestamp: now.toISOString(), signature: 'fixture-not-a-verified-signature', quoteRequest: request,
    quote: { amountIn: config.amountAtomic, amountInFormatted: '1', amountInUsd: '1', minAmountIn: '990000',
      amountOut: '990000', amountOutFormatted: '0.99', amountOutUsd: '0.99', minAmountOut: '980100', timeEstimate: 120 } };
}
function service(mutate?: (value: ReturnType<typeof response>) => unknown, liveTokens = tokens) {
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).endsWith('/tokens')) return Response.json(liveTokens);
    const request = JSON.parse(String(init?.body));
    const value = response(request);
    return Response.json(mutate ? mutate(value) : value);
  });
  return { preview: new DryQuotePreview(config, fetcher), fetcher };
}
afterEach(() => vi.restoreAllMocks());
describe('1Click preview boundary', () => {
  it('defaults off regardless of existing API credentials and rejects incomplete enabled configuration', () => {
    expect(loadDryPreviewConfiguration({ ONECLICK_JWT: 'fixture-key' })).toBeUndefined();
    expect(() => loadDryPreviewConfiguration({ ONECLICK_PREVIEW_ENABLED: 'true' })).toThrow(/complete reviewed route/);
    expect(() => loadDryPreviewConfiguration({ ONECLICK_PREVIEW_ENABLED: 'true', ONECLICK_BASE_URL: 'http://localhost' })).toThrow(/official HTTPS/);
  });
  it('resolves exact assets from the fresh live list and sends only dry:true to the documented quote endpoint', async () => {
    const { preview, fetcher } = service();
    const result = await preview.preview(now);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['https://1click.chaindefuser.com/v0/tokens', 'https://1click.chaindefuser.com/v0/quote']);
    const request = JSON.parse(String(fetcher.mock.calls[1][1]?.body));
    expect(request).toMatchObject({ dry: true, originAsset: tokens[0].assetId, destinationAsset: tokens[1].assetId, amount: '1000000' });
    expect(DryQuoteResponseSchema.safeParse(response(request)).success).toBe(true);
    expect(result).toMatchObject({ mode: 'oneclick_dry_preview', status: 'preview_only', settlement: 'not_initiated', unrelatedToTestPurchaseOrder: true });
    expect(result).not.toHaveProperty('depositAddress'); expect(result).not.toHaveProperty('signature');
  });
  it('does not call quote for missing assets or same-chain destinations', async () => {
    for (const list of [tokens.slice(0, 1), tokens.map((token) => ({ ...token, blockchain: 'near' }))]) {
      const { preview, fetcher } = service(undefined, list);
      await expect(preview.preview(now)).rejects.toMatchObject({ code: 'PREVIEW_ASSET_UNSUPPORTED' });
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
  it('rejects wet quotes, leaked deposit addresses and deposit memos', async () => {
    for (const change of [
      (value: ReturnType<typeof response>) => ({ ...value, quoteRequest: { ...value.quoteRequest, dry: false } }),
      (value: ReturnType<typeof response>) => ({ ...value, quote: { ...value.quote, depositAddress: 'DO-NOT-DISPLAY' } }),
      (value: ReturnType<typeof response>) => ({ ...value, quote: { ...value.quote, depositMemo: 'DO-NOT-DISPLAY' } }),
    ]) await expect(service(change).preview.preview(now)).rejects.toMatchObject({ code: 'PREVIEW_INVALID_RESPONSE' });
  });
  it('rejects mismatched recipient, amount and malformed documented response fields', async () => {
    for (const change of [
      (value: ReturnType<typeof response>) => ({ ...value, quoteRequest: { ...value.quoteRequest, recipient: 'attacker' } }),
      (value: ReturnType<typeof response>) => ({ ...value, quote: { ...value.quote, amountIn: '2000000' } }),
      (value: ReturnType<typeof response>) => ({ ...value, quote: { ...value.quote, minAmountOut: '9999999999' } }),
      (value: ReturnType<typeof response>) => ({ ...value, quote: { ...value.quote, timeEstimate: '120' } }),
    ]) await expect(service(change).preview.preview(now)).rejects.toMatchObject({ code: 'PREVIEW_INVALID_RESPONSE' });
  });
  it('returns a sanitized failure without provider payloads or credentials', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => { throw new Error('private transport detail'); });
    await expect(new DryQuotePreview({ ...config, apiKey: 'secret-fixture' }, fetcher).preview(now)).rejects.toMatchObject({ code: 'PREVIEW_UPSTREAM_ERROR', message: expect.not.stringContaining('private') });
  });
});

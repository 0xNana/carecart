import { describe, expect, it, vi } from 'vitest';
import { baseEncode } from 'near-api-js';
import { quoteHash, type QuoteResponse } from '@defuse-protocol/one-click-sdk-typescript';
import { ONECLICK_SIGNER, SettlementQuotes, resolveSettlementAssets, revalidateStoredQuote, verifySettlementQuote, type WetQuote } from './settlement';
import { now, order, tokens, signed } from './fixtures/settlement';

describe('MN-05 persisted quote and provider boundary', () => {
  it('rejects selected asset IDs reused by a different token record', () => {
    expect(() => resolveSettlementAssets([...tokens, { ...tokens[0], blockchain: 'eth' }])).toThrow(/ambiguous/);
    expect(() => resolveSettlementAssets([tokens[0], { ...tokens[1], assetId: tokens[0].assetId }])).toThrow(/ambiguous/);
  });
  it('persists exact signed bytes and the verified signer, and rejects metadata substitutions', async () => {
    const { raw, expected, key } = await signed();
    const signer = key.getPublicKey().toString();
    const q = verifySettlementQuote(order, raw, expected, now, signer);
    expect(q.signerPublicKey).toBe(signer);
    expect(Buffer.from(q.signedBytesBase64, 'base64').toString('utf8')).toBe(q.signedMessage);
    expect(revalidateStoredQuote(q, tokens, new Date(now.getTime() + 120000), signer)).toEqual(q);
    for (const change of [
      { expiresAt: new Date(now.getTime() + 3600000).toISOString() },
      { signedBytesBase64: Buffer.from('tampered').toString('base64') },
      { signerPublicKey: ONECLICK_SIGNER },
    ]) expect(() => revalidateStoredQuote({ ...q, ...change }, tokens, now, signer)).toThrow();
  });
  it('rejects authenticated but economically invalid USDC quotes', async () => {
    for (const change of [{ minAmountOut: '1' }, { minAmountIn: '0' }, { amountOut: (2n ** 128n).toString() }]) {
      const { raw, expected, key } = await signed();
      const altered: WetQuote = { ...raw, quote: { ...raw.quote, ...change } };
      altered.signature = baseEncode(key.sign(new TextEncoder().encode(quoteHash(altered as unknown as QuoteResponse))).signature);
      expect(() => verifySettlementQuote(order, altered, expected, now, key.getPublicKey().toString())).toThrow();
    }
  });
  it('rejects stale/expired evidence and changed live asset listings', async () => {
    const { raw, expected, key } = await signed();
    const signer = key.getPublicKey().toString();
    const q = verifySettlementQuote(order, raw, expected, now, signer);
    expect(() => revalidateStoredQuote(q, tokens, new Date(now.getTime() + 590000), signer)).toThrow();
    expect(() => revalidateStoredQuote(q, [{ ...tokens[0] }, { ...tokens[1], assetId: 'different-route' }], now, signer)).toThrow();
    expect(() => revalidateStoredQuote(q, tokens, new Date(now.getTime() - 120000), signer)).toThrow();
  });
  it('requests quotes with the pinned trust root and never accepts fixture-signed provider responses', async () => {
    const { raw } = await signed();
    const transport = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(init?.redirect).toBe('error');
      expect(new Headers(init?.headers).get('X-API-Key')).toBe('fixture-api-token');
      return Response.json(String(url).endsWith('/v0/tokens') ? tokens : raw);
    }) as unknown as typeof fetch;
    await expect(new SettlementQuotes('fixture-api-token', transport).prepare(order, now)).rejects.toThrow('signature');
    expect(vi.mocked(transport).mock.calls.map(([url]) => String(url))).toEqual([
      'https://1click.chaindefuser.com/v0/tokens', 'https://1click.chaindefuser.com/v0/quote',
    ]);
    const body = JSON.parse(String(vi.mocked(transport).mock.calls[1][1]?.body));
    expect(body).toMatchObject({ dry: false, recipient: order.recipient, refundTo: order.treasury });
    expect(Object.keys(body)).not.toContain('appFees');
  });
});

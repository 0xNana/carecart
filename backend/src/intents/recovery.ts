import { JsonRpcProvider } from 'near-api-js';
import { z } from 'zod';
import { SettlementQuotes, type VerifiedQuote } from './settlement';
import { SettlementJournal } from './journal';
import { verifyBaseReceipt, verifyNearRefund, type Rpc } from './receipts';

export function baseRpc(url: string, fetcher: typeof fetch = fetch): Rpc {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password)
    throw new Error('Reviewed HTTPS Base RPC required');
  return async (method, params) => {
    if (
      ![
        'eth_chainId',
        'eth_getBlockByNumber',
        'eth_getTransactionReceipt',
      ].includes(method)
    )
      throw new Error('Read-only Base RPC method required');
    const r = await fetcher(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      redirect: 'error',
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) throw new Error('Base receipt RPC unavailable');
    const body = (await r.json()) as { result?: unknown; error?: unknown };
    if (body.error || body.result === undefined)
      throw new Error('Base receipt RPC failed');
    return body.result;
  };
}
/** Destination evidence is fetched independently of 1Click. This class cannot dispatch funds. */
export class SettlementRecovery {
  private readonly near: JsonRpcProvider;
  private readonly base: Rpc;
  constructor(
    private readonly quotes: SettlementQuotes,
    nearRpc: string,
    baseRpcUrl: string,
  ) {
    const u = new URL(nearRpc);
    if (u.protocol !== 'https:' || u.username || u.password)
      throw new Error('Reviewed HTTPS NEAR RPC required');
    this.near = new JsonRpcProvider({ url: nearRpc });
    this.base = baseRpc(baseRpcUrl);
  }
  async reconcile(
    journal: SettlementJournal,
    attemptId: string,
    refundSignerIds: Record<string, string> = {},
  ) {
    const a = journal.get(attemptId);
    if (a.state !== 'Dispatched') return a;
    if (
      a.quote.order.profile !== 'local-usdc-v2' ||
      (await this.near.viewNodeStatus()).chain_id !== 'mainnet'
    )
      throw new Error('Mainnet recovery profile required');
    const status = await this.quotes.status(
      a.quote.response.quote.depositAddress,
    );
    return journal.reconcileDestination(
      attemptId,
      status,
      async (q: VerifiedQuote, hashes, kind, amount) => {
        if (kind === 'settlement')
          return verifyBaseReceipt(q, hashes, amount, this.base);
        for (const hash of hashes) {
          const signer = refundSignerIds[hash];
          if (!signer) continue;
          z.string()
            .min(2)
            .max(64)
            .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/)
            .parse(signer);
          const tx = await this.near.viewTransactionStatusWithReceipts({
            txHash: hash,
            accountId: signer,
            waitUntil: 'FINAL',
          });
          const proof = verifyNearRefund(q, hash, amount, tx);
          if (proof) return proof;
        }
        return null;
      },
    );
  }
}

import { createHash } from 'node:crypto';
import { z } from 'zod';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const account = z.string().min(2).max(64).regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const version = z.number().int().min(1).max(4_294_967_295);
const positiveAtomic = z.string().regex(/^[1-9][0-9]{0,38}$/).refine((s) => BigInt(s) < 2n ** 128n);
export const SafetyOrderSchema = z.object({
  po_id: id, profile: z.enum(['testnet', 'mainnet']), supplier: account, token: account,
  amount: positiveAtomic,
  invoice_digest: hash,
  destination: z.union([z.literal('Near'), z.object({ Base: z.object({ route_id: id, version, route_hash: hash }).strict() }).strict()]),
}).strict();
export type SafetyOrder = z.infer<typeof SafetyOrderSchema>;
export const SafetyQuoteSchema = z.object({
  attempt_id: id, po_id: id, route_id: id, route_version: version,
  signed_quote_hash: hash, deposit_account: z.string().regex(/^[0-9a-f]{64}$/),
  deadline_ns: z.string().regex(/^[1-9][0-9]{0,19}$/).refine((s) => BigInt(s) < 2n ** 64n),
  min_amount_out: positiveAtomic,
  storage_deposit_yocto: z.string().regex(/^(0|[1-9][0-9]{0,22})$/).refine((s) => BigInt(s) <= 10n ** 22n),
}).strict();
export type SafetyQuote = z.infer<typeof SafetyQuoteSchema>;
export function quoteCommitmentHash(raw: SafetyQuote): string {
  const q = SafetyQuoteSchema.parse(raw);
  return createHash('sha256').update(JSON.stringify([q.attempt_id, q.po_id, q.route_id, q.route_version,
    q.signed_quote_hash, q.deposit_account, q.deadline_ns, q.min_amount_out, q.storage_deposit_yocto])).digest('hex');
}
export const SafetyRouteSchema = z.object({
  route_id: id, version, supplier: account,
  recipient: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  asset_id: z.string().min(1).max(256), active: z.boolean(),
}).strict();
export type SafetyRoute = z.infer<typeof SafetyRouteSchema>;
export function routeHash(raw: SafetyRoute): string {
  const r = SafetyRouteSchema.parse(raw);
  // Must match Route::commitment_hash in the fresh-init v2 contract.
  return createHash('sha256').update(JSON.stringify([r.route_id, r.version, r.supplier, r.recipient, r.asset_id, r.active])).digest('hex');
}

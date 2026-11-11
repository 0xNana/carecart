import { z } from 'zod';
import { procurementFixtures } from '../profiles/procurement-fixtures';
import { BASE_USDC, NEAR_USDC } from '../intents/settlement';
import { SafetyOrderSchema, SafetyRouteSchema } from '../near/commitments';

const supplierId = z.string().regex(/^mn-supplier-[1-9][0-9]*$/);
export const CatalogItemId = z.string().regex(/^mn-item-[1-9][0-9]*$/);
const humanAccount = SafetyOrderSchema.shape.supplier.refine((s) => !s.endsWith('.testnet'));
const SupplierSchema = z.object({ id: supplierId, account: humanAccount,
  destination: z.union([z.literal('Near'), z.object({ Base: SafetyRouteSchema }).strict()]),
}).strict().superRefine((s, ctx) => {
  if (s.destination !== 'Near' && (!s.destination.Base.active || s.destination.Base.supplier !== s.account ||
      s.destination.Base.asset_id !== `nep141:base-${BASE_USDC}.omft.near`))
    ctx.addIssue({ code: 'custom', message: 'Reviewed active native-USDC Base route must belong to the supplier' });
});
const quantity = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
function checkCatalog(c:{items:{id:string}[];suppliers:{id:string;account:string}[];entries:{itemId:string;supplierId:string}[]},ctx:z.RefinementCtx){
  const unique=(values:string[])=>new Set(values).size===values.length;
  if(!unique(c.items.map(v=>v.id))||!unique(c.suppliers.map(v=>v.id))||!unique(c.suppliers.map(v=>v.account))||
    !unique(c.entries.map(v=>`${v.itemId}:${v.supplierId}`))||c.entries.some(e=>!c.items.some(i=>i.id===e.itemId)||!c.suppliers.some(s=>s.id===e.supplierId)))
    ctx.addIssue({code:'custom',message:'Unique registered inventory, suppliers and catalog entries required'});
}
export const LocalCatalogSchema = z.object({
  version: z.literal(1), profile: z.literal('local-usdc-v2'), token: z.literal(NEAR_USDC),
  decimals: z.literal(6), asset: z.literal('USDC'),
  items: z.array(z.object({ id: CatalogItemId, name: z.string().min(1), onHand: quantity,
    reorderPoint: quantity, usageUnits: quantity }).strict()).min(1),
  suppliers: z.array(SupplierSchema).min(1),
  entries: z.array(z.object({ itemId: CatalogItemId, supplierId, unitPriceAtomic: SafetyOrderSchema.shape.amount,
    leadTimeDays: z.number().int().positive().max(365) }).strict()).min(1),
}).strict().superRefine(checkCatalog);
export type LocalCatalog = z.infer<typeof LocalCatalogSchema>;
/** Same deterministic decision inputs, explicitly different chain, asset and supplier identities. */
export const TestnetCatalogSchema=z.object({...LocalCatalogSchema.shape,
  profile:z.literal('testnet-ccusd-v2'),token:SafetyOrderSchema.shape.token.refine(s=>s.endsWith('.testnet')),
  asset:z.literal('CCUSD'),suppliers:z.array(z.object({id:supplierId,
    account:SafetyOrderSchema.shape.supplier.refine(s=>s.endsWith('.testnet')),destination:z.literal('Near')}).strict()).min(1),
}).strict().superRefine(checkCatalog);
export type TestnetCatalog=z.infer<typeof TestnetCatalogSchema>;

/** Public, owner-reviewed mappings only; no defaults invent payable accounts. No credentials or RPC. */
export function syntheticLocalCatalog(mappings: unknown): LocalCatalog {
  const suppliers = z.array(SupplierSchema).length(3).parse(mappings);
  const fixture = procurementFixtures();
  if (suppliers.some((s) => !fixture.suppliers.some((f) => f.id === s.id)))
    throw new Error('Unknown synthetic supplier mapping');
  return LocalCatalogSchema.parse({ version: 1, profile: fixture.profile, token: NEAR_USDC, decimals: 6, asset: 'USDC',
    items: fixture.items.map((i) => ({ id: i.id, name: i.name, onHand: i.onHand, reorderPoint: i.reorderPoint, usageUnits: 60 })),
    suppliers,
    entries: fixture.items.flatMap((item, i) => suppliers.map((supplier, rank) => ({
      itemId: item.id, supplierId: supplier.id, leadTimeDays: 3,
      unitPriceAtomic: (BigInt(fixture.orders[i].unitPriceAtomic) * BigInt(100 + rank * 10) / 100n).toString(),
    }))),
  });
}

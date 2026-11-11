import {z} from 'zod';
export const StockId=z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export const Reference=z.string().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/);
const count=z.number().int().nonnegative().max(1_000_000);
export const ProductSchema=z.object({id:z.string().regex(/^mn-item-[1-9][0-9]*$/),clinicId:StockId,storeroomId:StockId,sku:StockId,
 name:z.string().min(1).max(150),baseUnit:z.string().regex(/^[a-z][a-z-]{0,31}$/),packSize:count.refine(n=>n>0),
 baselineDailyDemand:count,leadTimeDays:z.number().int().min(1).max(365),safetyStock:count,targetStock:count,source:z.literal('synthetic')}).strict();
export type Product=z.infer<typeof ProductSchema>;
export const Products=z.array(ProductSchema).min(1).max(1000).superRefine((products,ctx)=>{
 if(new Set(products.map(p=>p.id)).size!==products.length||new Set(products.map(p=>`${p.clinicId}:${p.storeroomId}:${p.sku}`)).size!==products.length)
  ctx.addIssue({code:'custom',message:'Unique product and location/SKU identities required'});
});
export const Movement=z.object({id:StockId,productId:ProductSchema.shape.id,
 kind:z.enum(['Opening','Receive','Consume','Dispense','Reserve','Release','AdjustUp','AdjustDown','Expire','Unusable','ConfirmInbound','CancelInbound']),
 quantity:count.refine(n=>n>0),unit:z.enum(['base','pack']),source:z.enum(['synthetic','manual','external']),orderId:Reference.optional(),expiresAt:z.iso.datetime().optional(),
 lotId:StockId.optional(),corrects:StockId.optional(),reason:z.string().min(1).max(200).refine(value=>value.trim().length>0,'Meaningful reason required').optional(),receiptReference:Reference.optional(),
 supplierId:StockId.optional(),batch:Reference.optional(),receivedAt:z.iso.datetime().optional(),
 destination:z.string().min(1).max(100).refine(value=>value.trim().length>0,'Department or purpose required').optional(),reference:Reference.optional(),
 confirmationReference:Reference.optional(),confirmedAt:z.iso.datetime().optional()}).strict();
export const Autonomy=z.object({monitoring:z.boolean(),automaticCases:z.boolean(),automaticPreparation:z.boolean(),financialExecution:z.literal(false),
 intervalSeconds:z.number().int().min(1).max(86400),maxInventoryAgeSeconds:z.number().int().min(60).max(31_536_000).default(604800),
 maxCatalogAgeSeconds:z.number().int().min(60).max(31_536_000).default(86400)}).strict();
export const OrderLink=z.object({orderId:Reference,productId:ProductSchema.shape.id,caseId:StockId,quantity:count.refine(n=>n>0),
 canonicalHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();

export const TenantBinding=z.object({clinicId:z.uuid(),storeroomId:StockId,syntheticDemo:z.boolean()}).strict();
export type TenantBinding=z.infer<typeof TenantBinding>;

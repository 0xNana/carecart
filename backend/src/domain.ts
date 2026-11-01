/** A branded identifier allocated by the backend's trusted ID registry. */
export type RegistryId<Kind extends string> = string & {
  readonly __registryKind: Kind;
};

export const ID_REGISTRY = {
  inventoryItem: 'item',
  supplier: 'supplier',
  usageRecord: 'usage',
  quote: 'quote',
  purchaseOrder: 'po',
  payment: 'payment',
  auditEvent: 'audit',
} as const;

export type IdKind = keyof typeof ID_REGISTRY;
export type InventoryItemId = RegistryId<'inventoryItem'>;
export type SupplierId = RegistryId<'supplier'>;
export type UsageRecordId = RegistryId<'usageRecord'>;
export type QuoteId = RegistryId<'quote'>;
export type PurchaseOrderId = RegistryId<'purchaseOrder'>;
export type PaymentId = RegistryId<'payment'>;
export type AuditEventId = RegistryId<'auditEvent'>;

/** Integer token units, represented as bigint in TypeScript and decimal TEXT in SQLite. */
export type AtomicAmount = bigint & { readonly __atomicAmount: true };
export const MAX_ATOMIC_AMOUNT = (1n << 128n) - 1n;

function assertAtomicAmountRange(value: bigint): AtomicAmount {
  if (value < 0n) throw new RangeError('atomic amount must be non-negative');
  if (value > MAX_ATOMIC_AMOUNT) throw new RangeError('atomic amount exceeds the NEP-141 U128 range');
  return value as AtomicAmount;
}

export function parseAtomicAmount(value: string | bigint): AtomicAmount {
  if (typeof value === 'bigint') return assertAtomicAmountRange(value);

  if (value.startsWith('-')) throw new RangeError('atomic amount must be non-negative');
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new TypeError('atomic amount must be a whole-number decimal string');
  }
  return assertAtomicAmountRange(BigInt(value));
}

export function formatAtomicAmount(value: AtomicAmount): string {
  return value.toString();
}

export type DataOrigin = 'synthetic';
export type PurchaseOrderStatus = 'draft' | 'committed' | 'cancelled' | 'paid';
export type PaymentStatus =
  | 'not_requested'
  | 'checking_balance'
  | 'pending_approval'
  | 'blocked'
  | 'processing'
  | 'paid'
  | 'failed'
  | 'rejected';
export type AuditEntityType = 'inventory_item' | 'supplier' | 'quote' | 'purchase_order' | 'payment';
export type AuditEventType = 'synthetic_seeded' | 'purchase_order_created' | 'payment_status_changed';

export interface InventoryItem {
  id: InventoryItemId;
  name: string;
  unit: string;
  onHand: number;
  reorderPoint: number;
  dataOrigin: DataOrigin;
}

export interface Supplier {
  id: SupplierId;
  displayName: string;
  nearAccountId: string | null;
  dataOrigin: DataOrigin;
}

/** Trusted synthetic pricing and lead-time data used by the quote simulator. */
export interface SupplierCatalogEntry {
  supplierId: SupplierId;
  itemId: InventoryItemId;
  leadTimeDays: number;
  unitPriceAtomic: AtomicAmount;
  assetCode: string;
}

export interface UsageRecord {
  id: UsageRecordId;
  itemId: InventoryItemId;
  quantity: number;
  occurredAt: string;
}

export interface Quote {
  id: QuoteId;
  supplierId: SupplierId;
  itemId: InventoryItemId;
  quantity: number;
  unitPriceAtomic: AtomicAmount;
  totalAmountAtomic: AtomicAmount;
  assetCode: string;
  quotedAt: string;
  expiresAt: string;
}

export interface PurchaseOrder {
  id: PurchaseOrderId;
  quoteId: QuoteId;
  supplierId: SupplierId;
  itemId: InventoryItemId;
  quantity: number;
  amountAtomic: AtomicAmount;
  assetCode: string;
  status: PurchaseOrderStatus;
  requestId: string | null;
  createdAt: string;
}

export interface Payment {
  id: PaymentId;
  purchaseOrderId: PurchaseOrderId;
  amountAtomic: AtomicAmount;
  assetCode: string;
  status: PaymentStatus;
  requestId: string | null;
  updatedAt: string;
}

export interface AuditEvent {
  id: AuditEventId;
  entityType: AuditEntityType;
  entityId: string;
  eventType: AuditEventType;
  payload: Readonly<Record<string, unknown>>;
  occurredAt: string;
}

import { allocateId, type DatabaseHandle } from '../db';
import {
  formatAtomicAmount,
  parseAtomicAmount,
  type PurchaseOrder,
  type PurchaseOrderStatus,
} from '../domain';

export interface CreatePurchaseOrderInput {
  requestId: string;
  itemId: string;
  quoteId: string;
}

export type CreatePurchaseOrderResult =
  | { kind: 'created'; purchaseOrder: PurchaseOrder }
  | { kind: 'replayed'; purchaseOrder: PurchaseOrder }
  | {
      kind:
        | 'item_not_found'
        | 'quote_not_found'
        | 'quote_item_mismatch'
        | 'quote_expired'
        | 'quote_already_used'
        | 'idempotency_key_reused';
    };

interface PurchaseOrderRow {
  id: string;
  quote_id: string;
  supplier_id: string;
  item_id: string;
  quantity: number;
  amount_atomic: string;
  asset_code: string;
  status: PurchaseOrderStatus;
  request_id: string | null;
  created_at: string;
}

interface QuoteRow {
  id: string;
  supplier_id: string;
  item_id: string;
  quantity: number;
  unit_price_atomic: string;
  total_amount_atomic: string;
  asset_code: string;
  expires_at: string;
}

/** Create a draft PO entirely from a persisted, unexpired quote and trusted IDs. */
export function createPurchaseOrder(
  database: DatabaseHandle,
  input: CreatePurchaseOrderInput,
  now = new Date(),
): CreatePurchaseOrderResult {
  const createdAt = now.toISOString();

  return database.transaction((): CreatePurchaseOrderResult => {
    const existing = database
      .prepare('SELECT * FROM purchase_orders WHERE request_id = ?')
      .get(input.requestId) as PurchaseOrderRow | undefined;
    if (existing) {
      if (existing.item_id !== input.itemId || existing.quote_id !== input.quoteId) {
        return { kind: 'idempotency_key_reused' };
      }
      return { kind: 'replayed', purchaseOrder: toPurchaseOrder(existing) };
    }

    const itemExists = database
      .prepare('SELECT 1 FROM inventory_items WHERE id = ?')
      .get(input.itemId);
    if (!itemExists) return { kind: 'item_not_found' };

    const quote = database
      .prepare(
        `SELECT id, supplier_id, item_id, quantity, unit_price_atomic, total_amount_atomic,
                asset_code, expires_at
         FROM quotes WHERE id = ?`,
      )
      .get(input.quoteId) as QuoteRow | undefined;
    if (!quote) return { kind: 'quote_not_found' };
    if (quote.item_id !== input.itemId) return { kind: 'quote_item_mismatch' };
    const expiresAtMs = Date.parse(quote.expires_at);
    if (!Number.isFinite(expiresAtMs)) throw new Error('persisted quote has an invalid expiry time');
    if (expiresAtMs <= now.getTime()) return { kind: 'quote_expired' };

    const quoteAlreadyUsed = database
      .prepare('SELECT 1 FROM purchase_orders WHERE quote_id = ?')
      .get(quote.id);
    if (quoteAlreadyUsed) return { kind: 'quote_already_used' };

    if (!Number.isSafeInteger(quote.quantity) || quote.quantity <= 0) {
      throw new Error('persisted quote has an invalid quantity');
    }
    const unitPriceAtomic = parseAtomicAmount(quote.unit_price_atomic);
    const expectedAmountAtomic = parseAtomicAmount(unitPriceAtomic * BigInt(quote.quantity));
    const storedAmountAtomic = parseAtomicAmount(quote.total_amount_atomic);
    if (expectedAmountAtomic !== storedAmountAtomic) {
      throw new Error('persisted quote total does not match its quantity and unit price');
    }

    const purchaseOrder: PurchaseOrder = {
      id: allocateId(database, 'purchaseOrder'),
      requestId: input.requestId,
      quoteId: quote.id as PurchaseOrder['quoteId'],
      supplierId: quote.supplier_id as PurchaseOrder['supplierId'],
      itemId: quote.item_id as PurchaseOrder['itemId'],
      quantity: quote.quantity,
      amountAtomic: expectedAmountAtomic,
      assetCode: quote.asset_code,
      status: 'draft',
      createdAt,
    };

    database
      .prepare(
        `INSERT INTO purchase_orders
           (id, quote_id, supplier_id, item_id, quantity, amount_atomic, asset_code,
            status, request_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        purchaseOrder.id,
        purchaseOrder.quoteId,
        purchaseOrder.supplierId,
        purchaseOrder.itemId,
        purchaseOrder.quantity,
        formatAtomicAmount(purchaseOrder.amountAtomic),
        purchaseOrder.assetCode,
        purchaseOrder.status,
        purchaseOrder.requestId,
        purchaseOrder.createdAt,
      );

    database
      .prepare(
        `INSERT INTO audit_events
           (id, entity_type, entity_id, event_type, payload_json, occurred_at)
         VALUES (?, 'purchase_order', ?, 'purchase_order_created', ?, ?)`,
      )
      .run(
        allocateId(database, 'auditEvent'),
        purchaseOrder.id,
        JSON.stringify({
          requestId: purchaseOrder.requestId,
          quoteId: purchaseOrder.quoteId,
          itemId: purchaseOrder.itemId,
          supplierId: purchaseOrder.supplierId,
          quantity: purchaseOrder.quantity,
          amountAtomic: formatAtomicAmount(purchaseOrder.amountAtomic),
          assetCode: purchaseOrder.assetCode,
          status: purchaseOrder.status,
        }),
        purchaseOrder.createdAt,
      );

    return { kind: 'created', purchaseOrder };
  }).immediate();
}

function toPurchaseOrder(row: PurchaseOrderRow): PurchaseOrder {
  return {
    id: row.id as PurchaseOrder['id'],
    requestId: row.request_id,
    quoteId: row.quote_id as PurchaseOrder['quoteId'],
    supplierId: row.supplier_id as PurchaseOrder['supplierId'],
    itemId: row.item_id as PurchaseOrder['itemId'],
    quantity: row.quantity,
    amountAtomic: parseAtomicAmount(row.amount_atomic),
    assetCode: row.asset_code,
    status: row.status,
    createdAt: row.created_at,
  };
}

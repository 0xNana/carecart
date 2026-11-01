import type { DatabaseHandle } from './db';
import { allocateId } from './db';
import { formatAtomicAmount, parseAtomicAmount, type InventoryItemId, type SupplierId } from './domain';

const SEED_KEY = 'carecart-synthetic-v1';
const CATALOG_SEED_KEY = 'carecart-supplier-catalog-v1';
const SEED_TIME = '2026-11-01T00:00:00.000Z';
const ASSET_CODE = 'CCTEST';

/**
 * Insert deterministic demo data once. IDs come from the backend-owned SQLite registry;
 * no model, browser, patient, hospital, or real supplier supplies an identifier.
 * Returns false when this seed version was already applied.
 */
export function seedSyntheticData(database: DatabaseHandle): boolean {
  const seededBaseData = database.transaction(() => {
    const existing = database
      .prepare('SELECT 1 FROM seed_runs WHERE seed_key = ?')
      .get(SEED_KEY);
    if (existing) return false;

    const entityTables = [
      'inventory_items',
      'suppliers',
      'usage_records',
      'quotes',
      'purchase_orders',
      'payments',
      'audit_events',
    ];
    const hasExistingEntities = entityTables.some(
      (table) => database.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get() !== undefined,
    );
    const hasAllocatedIds =
      database.prepare('SELECT 1 FROM id_registry WHERE next_value <> 1 LIMIT 1').get() !== undefined;
    if (hasExistingEntities || hasAllocatedIds) {
      throw new Error('synthetic seed must run before domain records or IDs are created');
    }

    const insertItem = database.prepare(
      `INSERT INTO inventory_items (id, name, unit, on_hand, reorder_point, data_origin)
       VALUES (?, ?, ?, ?, ?, 'synthetic')`,
    );
    const gloveItemId = allocateId(database, 'inventoryItem') as InventoryItemId;
    const salineItemId = allocateId(database, 'inventoryItem') as InventoryItemId;
    insertItem.run(gloveItemId, 'Synthetic nitrile examination gloves', 'box', 4, 12);
    insertItem.run(salineItemId, 'Synthetic sterile saline solution', 'case', 28, 32);

    const insertSupplier = database.prepare(
      `INSERT INTO suppliers (id, display_name, near_account_id, data_origin)
       VALUES (?, ?, NULL, 'synthetic')`,
    );
    const supplierAlphaId = allocateId(database, 'supplier') as SupplierId;
    const supplierBetaId = allocateId(database, 'supplier') as SupplierId;
    insertSupplier.run(supplierAlphaId, 'Synthetic Demo Supplier Alpha');
    insertSupplier.run(supplierBetaId, 'Synthetic Demo Supplier Beta');

    const insertUsage = database.prepare(
      'INSERT INTO usage_records (id, item_id, quantity, occurred_at) VALUES (?, ?, ?, ?)',
    );
    const usageRows = [
      [gloveItemId, 8, '2026-10-15T00:00:00.000Z'],
      [gloveItemId, 10, '2026-10-22T00:00:00.000Z'],
      [gloveItemId, 9, '2026-10-29T00:00:00.000Z'],
      [salineItemId, 4, '2026-10-18T00:00:00.000Z'],
    ] as const;
    for (const [itemId, quantity, occurredAt] of usageRows) {
      insertUsage.run(allocateId(database, 'usageRecord'), itemId, quantity, occurredAt);
    }

    const insertQuote = database.prepare(
      `INSERT INTO quotes
         (id, supplier_id, item_id, quantity, unit_price_atomic, total_amount_atomic, asset_code, quoted_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const quoteAlphaId = allocateId(database, 'quote');
    const quoteBetaId = allocateId(database, 'quote');
    const quoteQuantity = 10;
    const alphaUnitPrice = parseAtomicAmount(120n);
    const betaUnitPrice = parseAtomicAmount(135n);
    insertQuote.run(
      quoteAlphaId,
      supplierAlphaId,
      gloveItemId,
      quoteQuantity,
      formatAtomicAmount(alphaUnitPrice),
      formatAtomicAmount(parseAtomicAmount(alphaUnitPrice * BigInt(quoteQuantity))),
      ASSET_CODE,
      '2026-11-01T00:00:00.000Z',
      '2026-11-08T00:00:00.000Z',
    );
    insertQuote.run(
      quoteBetaId,
      supplierBetaId,
      gloveItemId,
      quoteQuantity,
      formatAtomicAmount(betaUnitPrice),
      formatAtomicAmount(parseAtomicAmount(betaUnitPrice * BigInt(quoteQuantity))),
      ASSET_CODE,
      '2026-11-01T00:00:00.000Z',
      '2026-11-08T00:00:00.000Z',
    );

    const purchaseOrderId = allocateId(database, 'purchaseOrder');
    const orderAmount = parseAtomicAmount(alphaUnitPrice * BigInt(quoteQuantity));
    database
      .prepare(
        `INSERT INTO purchase_orders
           (id, quote_id, supplier_id, item_id, quantity, amount_atomic, asset_code, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?)`,
      )
      .run(
        purchaseOrderId,
        quoteAlphaId,
        supplierAlphaId,
        gloveItemId,
        quoteQuantity,
        formatAtomicAmount(orderAmount),
        ASSET_CODE,
        SEED_TIME,
      );

    const paymentId = allocateId(database, 'payment');
    database
      .prepare(
        `INSERT INTO payments
           (id, purchase_order_id, amount_atomic, asset_code, status, request_id, updated_at)
         VALUES (?, ?, ?, ?, 'not_requested', NULL, ?)`,
      )
      .run(paymentId, purchaseOrderId, formatAtomicAmount(orderAmount), ASSET_CODE, SEED_TIME);

    database
      .prepare(
        `INSERT INTO audit_events (id, entity_type, entity_id, event_type, payload_json, occurred_at)
         VALUES (?, 'purchase_order', ?, 'synthetic_seeded', ?, ?)`,
      )
      .run(
        allocateId(database, 'auditEvent'),
        purchaseOrderId,
        JSON.stringify({ seedKey: SEED_KEY, status: 'draft' }),
        SEED_TIME,
      );

    database
      .prepare('INSERT INTO seed_runs (seed_key, completed_at) VALUES (?, ?)')
      .run(SEED_KEY, SEED_TIME);
    return true;
  })();

  seedSyntheticSupplierCatalog(database);
  return seededBaseData;
}

/** Add trusted catalog records separately so existing CC-05 databases can be upgraded in place. */
function seedSyntheticSupplierCatalog(database: DatabaseHandle): void {
  database.transaction(() => {
    const existing = database
      .prepare('SELECT 1 FROM seed_runs WHERE seed_key = ?')
      .get(CATALOG_SEED_KEY);
    if (existing) return;

    const suppliers = database
      .prepare('SELECT id, display_name FROM suppliers ORDER BY id')
      .all() as Array<{ id: string; display_name: string }>;
    const items = database
      .prepare('SELECT id, name FROM inventory_items ORDER BY id')
      .all() as Array<{ id: string; name: string }>;
    const supplierAlpha = suppliers.find((supplier) =>
      supplier.display_name === 'Synthetic Demo Supplier Alpha',
    );
    const supplierBeta = suppliers.find((supplier) =>
      supplier.display_name === 'Synthetic Demo Supplier Beta',
    );
    const gloves = items.find((item) => item.name === 'Synthetic nitrile examination gloves');
    const saline = items.find((item) => item.name === 'Synthetic sterile saline solution');
    if (!supplierAlpha || !supplierBeta || !gloves || !saline) {
      throw new Error('synthetic supplier catalog requires the registered CC-05 demo records');
    }

    const insertEntry = database.prepare(
      `INSERT INTO supplier_catalog
         (supplier_id, item_id, lead_time_days, unit_price_atomic, asset_code)
       VALUES (?, ?, ?, ?, ?)`
    );
    const entries = [
      [supplierAlpha.id, gloves.id, 3, 120],
      [supplierBeta.id, gloves.id, 6, 135],
      [supplierAlpha.id, saline.id, 3, 210],
      [supplierBeta.id, saline.id, 6, 220],
    ] as const;
    for (const [supplierId, itemId, leadTimeDays, unitPrice] of entries) {
      insertEntry.run(
        supplierId,
        itemId,
        leadTimeDays,
        formatAtomicAmount(parseAtomicAmount(BigInt(unitPrice))),
        ASSET_CODE,
      );
    }

    database
      .prepare('INSERT INTO seed_runs (seed_key, completed_at) VALUES (?, ?)')
      .run(CATALOG_SEED_KEY, SEED_TIME);
  }).immediate();
}

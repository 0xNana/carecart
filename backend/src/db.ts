import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import Database from 'better-sqlite3';

import {
  ID_REGISTRY,
  MAX_ATOMIC_AMOUNT,
  parseAtomicAmount,
  type AuditEvent,
  type AuditEntityType,
  type IdKind,
  type InventoryItem,
  type Payment,
  type PaymentStatus,
  type PurchaseOrder,
  type PurchaseOrderStatus,
  type Quote,
  type RegistryId,
  type Supplier,
  type SupplierCatalogEntry,
  type UsageRecord,
} from './domain';

const MIGRATIONS = [
  {
    version: 1,
    sql: `
      CREATE TABLE inventory_items (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL CHECK (length(trim(name)) > 0),
        unit TEXT NOT NULL CHECK (length(trim(unit)) > 0),
        on_hand INTEGER NOT NULL CHECK (on_hand >= 0),
        reorder_point INTEGER NOT NULL CHECK (reorder_point >= 0),
        data_origin TEXT NOT NULL CHECK (data_origin = 'synthetic')
      );

      CREATE TABLE suppliers (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
        near_account_id TEXT,
        data_origin TEXT NOT NULL CHECK (data_origin = 'synthetic')
      );

      CREATE TABLE usage_records (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL REFERENCES inventory_items(id),
        quantity INTEGER NOT NULL CHECK (quantity >= 0),
        occurred_at TEXT NOT NULL
      );
      CREATE INDEX usage_records_item_time ON usage_records(item_id, occurred_at);

      CREATE TABLE quotes (
        id TEXT PRIMARY KEY,
        supplier_id TEXT NOT NULL REFERENCES suppliers(id),
        item_id TEXT NOT NULL REFERENCES inventory_items(id),
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        unit_price_atomic TEXT NOT NULL CHECK (
          length(unit_price_atomic) > 0 AND
          length(unit_price_atomic) <= 39 AND
          unit_price_atomic NOT GLOB '*[^0-9]*' AND
          unit_price_atomic <> '0' AND
          substr(unit_price_atomic, 1, 1) BETWEEN '1' AND '9' AND
          (length(unit_price_atomic) < 39 OR unit_price_atomic <= '${MAX_ATOMIC_AMOUNT}')
        ),
        total_amount_atomic TEXT NOT NULL CHECK (
          length(total_amount_atomic) > 0 AND
          length(total_amount_atomic) <= 39 AND
          total_amount_atomic NOT GLOB '*[^0-9]*' AND
          total_amount_atomic <> '0' AND
          substr(total_amount_atomic, 1, 1) BETWEEN '1' AND '9' AND
          (length(total_amount_atomic) < 39 OR total_amount_atomic <= '${MAX_ATOMIC_AMOUNT}')
        ),
        asset_code TEXT NOT NULL CHECK (length(trim(asset_code)) > 0),
        quoted_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        CHECK (expires_at >= quoted_at)
      );

      CREATE TABLE purchase_orders (
        id TEXT PRIMARY KEY,
        quote_id TEXT NOT NULL REFERENCES quotes(id),
        supplier_id TEXT NOT NULL REFERENCES suppliers(id),
        item_id TEXT NOT NULL REFERENCES inventory_items(id),
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        amount_atomic TEXT NOT NULL CHECK (
          length(amount_atomic) > 0 AND
          length(amount_atomic) <= 39 AND
          amount_atomic NOT GLOB '*[^0-9]*' AND
          amount_atomic <> '0' AND
          substr(amount_atomic, 1, 1) BETWEEN '1' AND '9' AND
          (length(amount_atomic) < 39 OR amount_atomic <= '${MAX_ATOMIC_AMOUNT}')
        ),
        asset_code TEXT NOT NULL CHECK (length(trim(asset_code)) > 0),
        status TEXT NOT NULL CHECK (status IN ('draft', 'committed', 'cancelled', 'paid')),
        created_at TEXT NOT NULL
      );

      CREATE TABLE payments (
        id TEXT PRIMARY KEY,
        purchase_order_id TEXT NOT NULL UNIQUE REFERENCES purchase_orders(id),
        amount_atomic TEXT NOT NULL CHECK (
          length(amount_atomic) > 0 AND
          length(amount_atomic) <= 39 AND
          amount_atomic NOT GLOB '*[^0-9]*' AND
          amount_atomic <> '0' AND
          substr(amount_atomic, 1, 1) BETWEEN '1' AND '9' AND
          (length(amount_atomic) < 39 OR amount_atomic <= '${MAX_ATOMIC_AMOUNT}')
        ),
        asset_code TEXT NOT NULL CHECK (length(trim(asset_code)) > 0),
        status TEXT NOT NULL CHECK (status IN (
          'not_requested', 'checking_balance', 'pending_approval', 'blocked',
          'processing', 'paid', 'failed', 'rejected'
        )),
        request_id TEXT UNIQUE,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE audit_events (
        id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL CHECK (entity_type IN (
          'inventory_item', 'supplier', 'quote', 'purchase_order', 'payment'
        )),
        entity_id TEXT NOT NULL,
        event_type TEXT NOT NULL CHECK (event_type IN (
          'synthetic_seeded', 'purchase_order_created', 'payment_status_changed'
        )),
        payload_json TEXT NOT NULL CHECK (
          json_valid(payload_json) AND json_type(payload_json) = 'object'
        ),
        occurred_at TEXT NOT NULL
      );
      CREATE INDEX audit_events_entity_time ON audit_events(entity_type, entity_id, occurred_at);

      CREATE TABLE id_registry (
        entity_kind TEXT PRIMARY KEY,
        prefix TEXT NOT NULL UNIQUE,
        next_value INTEGER NOT NULL CHECK (next_value > 0)
      );

      CREATE TABLE seed_runs (
        seed_key TEXT PRIMARY KEY,
        completed_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE supplier_catalog (
        supplier_id TEXT NOT NULL REFERENCES suppliers(id),
        item_id TEXT NOT NULL REFERENCES inventory_items(id),
        lead_time_days INTEGER NOT NULL CHECK (lead_time_days > 0),
        unit_price_atomic TEXT NOT NULL CHECK (
          length(unit_price_atomic) > 0 AND
          length(unit_price_atomic) <= 39 AND
          unit_price_atomic NOT GLOB '*[^0-9]*' AND
          unit_price_atomic <> '0' AND
          substr(unit_price_atomic, 1, 1) BETWEEN '1' AND '9' AND
          (length(unit_price_atomic) < 39 OR unit_price_atomic <= '${MAX_ATOMIC_AMOUNT}')
        ),
        asset_code TEXT NOT NULL CHECK (length(trim(asset_code)) > 0),
        PRIMARY KEY (supplier_id, item_id)
      );
    `,
  },
  {
    version: 3,
    sql: `
      ALTER TABLE purchase_orders ADD COLUMN request_id TEXT;
      CREATE UNIQUE INDEX purchase_orders_request_id_unique
        ON purchase_orders(request_id) WHERE request_id IS NOT NULL;
      CREATE UNIQUE INDEX purchase_orders_quote_unique ON purchase_orders(quote_id);
    `,
  },
  {
    version: 4,
    sql: `
      ALTER TABLE purchase_orders ADD COLUMN commit_transaction_hash TEXT;
      ALTER TABLE payments ADD COLUMN request_transaction_hash TEXT;
    `,
  },
] as const;

export type DatabaseHandle = Database.Database;
export const DEFAULT_DATABASE_PATH = resolve(__dirname, '../data/carecart.sqlite');

export function openDatabase(databasePath = DEFAULT_DATABASE_PATH): DatabaseHandle {
  if (databasePath !== ':memory:') {
    mkdirSync(dirname(resolve(databasePath)), { recursive: true });
  }

  const database = new Database(databasePath);
  database.pragma('foreign_keys = ON');
  database.pragma('busy_timeout = 5000');
  if (databasePath !== ':memory:') {
    database.pragma('journal_mode = WAL');
  }
  migrateDatabase(database);
  return database;
}

export function closeDatabase(database: DatabaseHandle): void {
  database.close();
}

export function migrateDatabase(database: DatabaseHandle): void {
  database.transaction(() => {
    database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const appliedVersions = new Set(
      (database.prepare('SELECT version FROM schema_migrations').pluck().all() as number[]),
    );
    const latestVersion = MIGRATIONS.at(-1)?.version ?? 0;
    const databaseVersion = Math.max(0, ...appliedVersions);
    const initializeIdRegistry = !appliedVersions.has(1);
    if (databaseVersion > latestVersion) {
      throw new Error(`database schema version ${databaseVersion} is newer than this backend`);
    }

    const markMigration = database.prepare('INSERT INTO schema_migrations (version) VALUES (?)');
    for (const migration of MIGRATIONS) {
      if (appliedVersions.has(migration.version)) continue;
      database.exec(migration.sql);
      markMigration.run(migration.version);
    }

    if (initializeIdRegistry) {
      const addRegistry = database.prepare(
        'INSERT INTO id_registry (entity_kind, prefix, next_value) VALUES (?, ?, 1)',
      );
      for (const [kind, prefix] of Object.entries(ID_REGISTRY)) {
        addRegistry.run(kind, prefix);
      }
    }
  }).immediate();
}

/** Allocate an ID from the trusted per-entity registry inside an atomic SQLite transaction. */
export function allocateId<Kind extends IdKind>(
  database: DatabaseHandle,
  kind: Kind,
): RegistryId<Kind> {
  return database.transaction(() => {
    const row = database
      .prepare('SELECT prefix, next_value FROM id_registry WHERE entity_kind = ?')
      .get(kind) as { prefix: string; next_value: number } | undefined;
    if (!row) throw new Error(`no trusted ID registry configured for ${kind}`);
    if (row.prefix !== ID_REGISTRY[kind]) {
      throw new Error(`registry prefix for ${kind} does not match the trusted prefix`);
    }
    if (
      !Number.isSafeInteger(row.next_value) ||
      row.next_value < 1 ||
      row.next_value >= Number.MAX_SAFE_INTEGER
    ) {
      throw new Error(`invalid next ID sequence for ${kind}`);
    }

    const result = database
      .prepare('UPDATE id_registry SET next_value = ? WHERE entity_kind = ? AND next_value = ?')
      .run(row.next_value + 1, kind, row.next_value);
    if (result.changes !== 1) throw new Error(`could not allocate ID for ${kind}`);
    return `${row.prefix}-${String(row.next_value).padStart(6, '0')}` as RegistryId<Kind>;
  }).immediate();
}

export interface DomainRecords {
  inventoryItems: InventoryItem[];
  suppliers: Supplier[];
  supplierCatalogEntries: SupplierCatalogEntry[];
  usageRecords: UsageRecord[];
  quotes: Quote[];
  purchaseOrders: PurchaseOrder[];
  payments: Payment[];
  auditEvents: AuditEvent[];
}

/** Read persisted rows into the typed domain model used by backend services. */
export function loadDomainRecords(database: DatabaseHandle): DomainRecords {
  const inventoryItems = database
    .prepare('SELECT id, name, unit, on_hand, reorder_point, data_origin FROM inventory_items ORDER BY id')
    .all() as Array<{
    id: string;
    name: string;
    unit: string;
    on_hand: number;
    reorder_point: number;
    data_origin: 'synthetic';
  }>;
  const suppliers = database
    .prepare('SELECT id, display_name, near_account_id, data_origin FROM suppliers ORDER BY id')
    .all() as Array<{
    id: string;
    display_name: string;
    near_account_id: string | null;
    data_origin: 'synthetic';
  }>;
  const supplierCatalogEntries = database
    .prepare(
      `SELECT supplier_id, item_id, lead_time_days, unit_price_atomic, asset_code
       FROM supplier_catalog ORDER BY supplier_id, item_id`,
    )
    .all() as Array<{
    supplier_id: string;
    item_id: string;
    lead_time_days: number;
    unit_price_atomic: string;
    asset_code: string;
  }>;
  const usageRecords = database
    .prepare('SELECT id, item_id, quantity, occurred_at FROM usage_records ORDER BY id')
    .all() as Array<{ id: string; item_id: string; quantity: number; occurred_at: string }>;
  const quotes = database
    .prepare(
      `SELECT id, supplier_id, item_id, quantity, unit_price_atomic, total_amount_atomic,
              asset_code, quoted_at, expires_at
       FROM quotes ORDER BY id`,
    )
    .all() as Array<{
    id: string;
    supplier_id: string;
    item_id: string;
    quantity: number;
    unit_price_atomic: string;
    total_amount_atomic: string;
    asset_code: string;
    quoted_at: string;
    expires_at: string;
  }>;
  const purchaseOrders = database
    .prepare(
      `SELECT id, quote_id, supplier_id, item_id, quantity, amount_atomic, asset_code, status,
              request_id, created_at
       FROM purchase_orders ORDER BY id`,
    )
    .all() as Array<{
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
  }>;
  const payments = database
    .prepare(
      `SELECT id, purchase_order_id, amount_atomic, asset_code, status, request_id, updated_at
       FROM payments ORDER BY id`,
    )
    .all() as Array<{
    id: string;
    purchase_order_id: string;
    amount_atomic: string;
    asset_code: string;
    status: PaymentStatus;
    request_id: string | null;
    updated_at: string;
  }>;
  const auditEvents = database
    .prepare(
      `SELECT id, entity_type, entity_id, event_type, payload_json, occurred_at
       FROM audit_events ORDER BY id`,
    )
    .all() as Array<{
    id: string;
    entity_type: AuditEntityType;
    entity_id: string;
    event_type: AuditEvent['eventType'];
    payload_json: string;
    occurred_at: string;
  }>;

  return {
    inventoryItems: inventoryItems.map((row) => ({
      id: row.id as InventoryItem['id'],
      name: row.name,
      unit: row.unit,
      onHand: row.on_hand,
      reorderPoint: row.reorder_point,
      dataOrigin: row.data_origin,
    })),
    suppliers: suppliers.map((row) => ({
      id: row.id as Supplier['id'],
      displayName: row.display_name,
      nearAccountId: row.near_account_id,
      dataOrigin: row.data_origin,
    })),
    supplierCatalogEntries: supplierCatalogEntries.map((row) => ({
      supplierId: row.supplier_id as SupplierCatalogEntry['supplierId'],
      itemId: row.item_id as SupplierCatalogEntry['itemId'],
      leadTimeDays: row.lead_time_days,
      unitPriceAtomic: parseAtomicAmount(row.unit_price_atomic),
      assetCode: row.asset_code,
    })),
    usageRecords: usageRecords.map((row) => ({
      id: row.id as UsageRecord['id'],
      itemId: row.item_id as UsageRecord['itemId'],
      quantity: row.quantity,
      occurredAt: row.occurred_at,
    })),
    quotes: quotes.map((row) => ({
      id: row.id as Quote['id'],
      supplierId: row.supplier_id as Quote['supplierId'],
      itemId: row.item_id as Quote['itemId'],
      quantity: row.quantity,
      unitPriceAtomic: parseAtomicAmount(row.unit_price_atomic),
      totalAmountAtomic: parseAtomicAmount(row.total_amount_atomic),
      assetCode: row.asset_code,
      quotedAt: row.quoted_at,
      expiresAt: row.expires_at,
    })),
    purchaseOrders: purchaseOrders.map((row) => ({
      id: row.id as PurchaseOrder['id'],
      quoteId: row.quote_id as PurchaseOrder['quoteId'],
      supplierId: row.supplier_id as PurchaseOrder['supplierId'],
      itemId: row.item_id as PurchaseOrder['itemId'],
      quantity: row.quantity,
      amountAtomic: parseAtomicAmount(row.amount_atomic),
      assetCode: row.asset_code,
      status: row.status,
      requestId: row.request_id,
      createdAt: row.created_at,
    })),
    payments: payments.map((row) => ({
      id: row.id as Payment['id'],
      purchaseOrderId: row.purchase_order_id as Payment['purchaseOrderId'],
      amountAtomic: parseAtomicAmount(row.amount_atomic),
      assetCode: row.asset_code,
      status: row.status,
      requestId: row.request_id,
      updatedAt: row.updated_at,
    })),
    auditEvents: auditEvents.map((row) => ({
      id: row.id as AuditEvent['id'],
      entityType: row.entity_type,
      entityId: row.entity_id,
      eventType: row.event_type,
      payload: parseJsonObject(row.payload_json),
      occurredAt: row.occurred_at,
    })),
  };
}

function parseJsonObject(json: string): Readonly<Record<string, unknown>> {
  const value: unknown = JSON.parse(json);
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new Error('audit payload must be a JSON object');
  }
  return value as Readonly<Record<string, unknown>>;
}

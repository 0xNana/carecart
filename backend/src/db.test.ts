import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import { allocateId, closeDatabase, migrateDatabase, openDatabase } from './db';
import { seedSyntheticData } from './seed';

describe('backend database setup', () => {
  let database: ReturnType<typeof openDatabase> | undefined;
  let temporaryDirectory: string | undefined;

  afterEach(() => {
    if (database?.open) closeDatabase(database);
    database = undefined;
    if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = undefined;
  });

  it('migrates an empty local database and can repeat migrations safely', () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'carecart-db-'));
    const databasePath = join(temporaryDirectory, 'new', 'carecart.sqlite');
    database = openDatabase(databasePath);
    migrateDatabase(database);

    const tables = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);

    expect(tables).toEqual([
      'audit_events',
      'id_registry',
      'inventory_items',
      'payments',
      'purchase_orders',
      'quotes',
      'schema_migrations',
      'seed_runs',
      'supplier_catalog',
      'suppliers',
      'usage_records',
    ]);
    expect(database.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(database.prepare('SELECT version FROM schema_migrations').pluck().all()).toEqual([1, 2, 3, 4]);

    closeDatabase(database);
    database = openDatabase(databasePath);
    expect(database.prepare('SELECT version FROM schema_migrations').pluck().all()).toEqual([1, 2, 3, 4]);
  });

  it('upgrades an existing v3 database without losing procurement records', () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'carecart-upgrade-'));
    const path = join(temporaryDirectory, 'carecart.sqlite');
    database = openDatabase(path);
    seedSyntheticData(database);
    database.exec(`ALTER TABLE purchase_orders DROP COLUMN commit_transaction_hash;
      ALTER TABLE payments DROP COLUMN request_transaction_hash;
      DELETE FROM schema_migrations WHERE version = 4;`);
    closeDatabase(database);
    database = openDatabase(path);
    expect(database.prepare('SELECT status, commit_transaction_hash FROM purchase_orders').get())
      .toEqual({ status: 'draft', commit_transaction_hash: null });
    expect(database.prepare('SELECT status, request_transaction_hash FROM payments').get())
      .toEqual({ status: 'not_requested', request_transaction_hash: null });
  });

  it('allocates unique typed identifiers from the database registry', () => {
    database = openDatabase(':memory:');

    const first = allocateId(database, 'purchaseOrder');
    const second = allocateId(database, 'purchaseOrder');

    expect(first).toBe('po-000001');
    expect(second).toBe('po-000002');
    expect(allocateId(database, 'supplier')).toBe('supplier-000001');

    database.prepare("UPDATE id_registry SET prefix = 'untrusted' WHERE entity_kind = 'supplier'").run();
    expect(() => allocateId(database!, 'supplier')).toThrow(/trusted prefix/);
  });

  it('rejects invalid foreign keys and non-integer atomic amount strings', () => {
    database = openDatabase(':memory:');

    expect(() =>
      database!.prepare(
        `INSERT INTO usage_records (id, item_id, quantity, occurred_at)
         VALUES ('usage-test', 'missing-item', 1, '2026-11-01T00:00:00.000Z')`,
      ).run(),
    ).toThrow();
    expect(() =>
      database!.prepare(
        `INSERT INTO quotes
           (id, supplier_id, item_id, quantity, unit_price_atomic, total_amount_atomic, asset_code, quoted_at)
         VALUES ('quote-test', 'missing-supplier', 'missing-item', 1, '1.5', '1.5', 'CCTEST', '2026-11-01T00:00:00.000Z')`,
      ).run(),
    ).toThrow();
  });
});

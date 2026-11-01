import { afterEach, describe, expect, it } from 'vitest';

import { allocateId, closeDatabase, loadDomainRecords, migrateDatabase, openDatabase } from './db';
import { formatAtomicAmount, parseAtomicAmount } from './domain';
import { seedSyntheticData } from './seed';

describe('synthetic backend seed', () => {
  const databases: ReturnType<typeof openDatabase>[] = [];
  const createMemoryDatabase = () => {
    const database = openDatabase(':memory:');
    databases.push(database);
    return database;
  };

  afterEach(() => {
    for (const database of databases.splice(0)) {
      if (database.open) closeDatabase(database);
    }
  });

  it('seeds every domain table deterministically with synthetic records', () => {
    const first = createMemoryDatabase();
    const second = createMemoryDatabase();

    expect(seedSyntheticData(first)).toBe(true);
    expect(seedSyntheticData(second)).toBe(true);

    const snapshot = (database: ReturnType<typeof openDatabase>) => ({
      inventory: database.prepare('SELECT * FROM inventory_items ORDER BY id').all(),
      suppliers: database.prepare('SELECT * FROM suppliers ORDER BY id').all(),
      usage: database.prepare('SELECT * FROM usage_records ORDER BY id').all(),
      quotes: database.prepare('SELECT * FROM quotes ORDER BY id').all(),
      supplierCatalog: database.prepare('SELECT * FROM supplier_catalog ORDER BY supplier_id, item_id').all(),
      purchaseOrders: database.prepare('SELECT * FROM purchase_orders ORDER BY id').all(),
      payments: database.prepare('SELECT * FROM payments ORDER BY id').all(),
      audit: database.prepare('SELECT * FROM audit_events ORDER BY id').all(),
    });

    expect(snapshot(first)).toEqual(snapshot(second));
    expect(first.prepare('SELECT count(*) AS count FROM inventory_items').get()).toEqual({
      count: 2,
    });
    expect(first.prepare('SELECT count(*) AS count FROM suppliers').get()).toEqual({
      count: 2,
    });
    expect(first.prepare('SELECT count(*) AS count FROM usage_records').get()).toEqual({
      count: 4,
    });
    expect(first.prepare('SELECT count(*) AS count FROM quotes').get()).toEqual({ count: 2 });
    expect(first.prepare('SELECT count(*) AS count FROM supplier_catalog').get()).toEqual({ count: 4 });
    expect(first.prepare('SELECT count(*) AS count FROM purchase_orders').get()).toEqual({
      count: 1,
    });
    expect(first.prepare('SELECT count(*) AS count FROM payments').get()).toEqual({ count: 1 });
    expect(first.prepare('SELECT count(*) AS count FROM audit_events').get()).toEqual({
      count: 1,
    });
    expect(first.prepare('SELECT DISTINCT data_origin FROM suppliers').pluck().all()).toEqual([
      'synthetic',
    ]);

    const records = loadDomainRecords(first);
    expect(records.inventoryItems[0]?.id).toMatch(/^item-[0-9]{6}$/);
    expect(records.inventoryItems.every((item) => item.name.startsWith('Synthetic '))).toBe(true);
    expect(records.suppliers.every((supplier) => supplier.nearAccountId === null)).toBe(true);
    expect(records.suppliers.every((supplier) => supplier.displayName.startsWith('Synthetic Demo '))).toBe(
      true,
    );
    expect(records.quotes[0]?.totalAmountAtomic).toBe(1_200n);
    expect(records.purchaseOrders[0]?.amountAtomic).toBe(1_200n);
    expect(records.payments[0]?.status).toBe('not_requested');
    expect(records.auditEvents[0]?.payload).toEqual({
      seedKey: 'carecart-synthetic-v1',
      status: 'draft',
    });
    expect(records.supplierCatalogEntries).toHaveLength(4);
  });

  it('is idempotent and leaves generated IDs stable on repeated seed calls', () => {
    const database = createMemoryDatabase();

    expect(seedSyntheticData(database)).toBe(true);
    const idsBefore = database
      .prepare('SELECT id FROM purchase_orders ORDER BY id')
      .pluck()
      .all();
    expect(seedSyntheticData(database)).toBe(false);
    expect(database.prepare('SELECT id FROM purchase_orders ORDER BY id').pluck().all()).toEqual(
      idsBefore,
    );
  });

  it('adds the trusted catalog to an existing CC-05 database without reseeding domain records', () => {
    const database = createMemoryDatabase();
    seedSyntheticData(database);
    const originalQuoteIds = database.prepare('SELECT id FROM quotes ORDER BY id').pluck().all();
    const originalItemIds = database
      .prepare('SELECT id FROM inventory_items ORDER BY id')
      .pluck()
      .all();

    database.exec('DROP TABLE supplier_catalog');
    database.prepare('DELETE FROM seed_runs WHERE seed_key = ?').run('carecart-supplier-catalog-v1');
    database.prepare('DELETE FROM schema_migrations WHERE version = 2').run();
    migrateDatabase(database);

    expect(seedSyntheticData(database)).toBe(false);
    expect(database.prepare('SELECT id FROM quotes ORDER BY id').pluck().all()).toEqual(
      originalQuoteIds,
    );
    expect(database.prepare('SELECT id FROM inventory_items ORDER BY id').pluck().all()).toEqual(
      originalItemIds,
    );
    expect(loadDomainRecords(database).supplierCatalogEntries).toHaveLength(4);
  });

  it('does not shift deterministic fixture IDs when the registry was already used', () => {
    const database = createMemoryDatabase();
    allocateId(database, 'inventoryItem');

    expect(() => seedSyntheticData(database)).toThrow(/must run before/);
  });

  it('stores atomic amounts exactly without floating-point conversion', () => {
    const amount = parseAtomicAmount('900719925474099312345678901');
    expect(formatAtomicAmount(amount)).toBe('900719925474099312345678901');
    expect(() => parseAtomicAmount('12.75')).toThrow(/whole-number/);
    expect(() => parseAtomicAmount('-4')).toThrow(/non-negative/);
    expect(parseAtomicAmount((1n << 128n) - 1n)).toBe((1n << 128n) - 1n);
    expect(() => parseAtomicAmount(1n << 128n)).toThrow(/NEP-141/);

    const database = createMemoryDatabase();
    seedSyntheticData(database);
    expect(() =>
      database
        .prepare("UPDATE quotes SET total_amount_atomic = '12.75' WHERE id = (SELECT id FROM quotes LIMIT 1)")
        .run(),
    ).toThrow();
    const quote = database
      .prepare('SELECT total_amount_atomic FROM quotes ORDER BY id LIMIT 1')
      .get() as { total_amount_atomic: string };
    expect(typeof quote.total_amount_atomic).toBe('string');
    expect(BigInt(quote.total_amount_atomic)).toBeGreaterThan(0n);

    database
      .prepare('UPDATE quotes SET total_amount_atomic = ? WHERE id = (SELECT id FROM quotes ORDER BY id LIMIT 1)')
      .run(formatAtomicAmount(amount));
    expect(loadDomainRecords(database).quotes[0]?.totalAmountAtomic).toBe(amount);
  });
});

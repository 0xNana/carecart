import { describe, expect, it } from 'vitest';
import { mainnetFixtures } from './mainnet-fixtures';
import { openDatabase, loadDomainRecords, closeDatabase } from '../db';
import { seedSyntheticData } from '../seed';

describe('mainnet-only synthetic fixtures', () => {
  it('provides six synthetic items and three suppliers without inventing payable accounts', () => {
    const fixtures = mainnetFixtures();
    expect(fixtures.profile).toBe('mainnet-usdc-v2');
    expect(fixtures.items).toHaveLength(6);
    expect(fixtures.suppliers).toHaveLength(3);
    expect(fixtures.suppliers.every((s) => s.nearAccountId === null && s.dataOrigin === 'synthetic')).toBe(true);
    expect(fixtures.orders.map((o) => o.amountAtomic)).toEqual(['1000000', '2000000', '3000000', '4000000', '5000000', '6200000']);
    for (const order of fixtures.orders) {
      expect(BigInt(order.unitPriceAtomic) * BigInt(order.quantity)).toBe(BigInt(order.amountAtomic));
      expect(order.assetCode).toBe('USDC');
      expect(order.status).toBe('draft');
      expect(order.executionAuthorized).toBe(false);
    }
    expect(fixtures.orders[5].requiresCeilingReview).toBe(true);
  });
  it('does not migrate, rescale or seed CCTEST payment records', () => {
    const db = openDatabase(':memory:');
    try {
      seedSyntheticData(db);
      const before = loadDomainRecords(db);
      mainnetFixtures();
      expect(loadDomainRecords(db)).toEqual(before);
      expect(before.payments[0]).toMatchObject({ assetCode: 'CCTEST', amountAtomic: 1200n });
    } finally { closeDatabase(db); }
  });
});

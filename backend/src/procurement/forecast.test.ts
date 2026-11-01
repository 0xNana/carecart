import { afterEach, describe, expect, it } from 'vitest';

import { closeDatabase, openDatabase } from '../db';
import { seedSyntheticData } from '../seed';
import { calculateInventoryForecast } from './forecast';

describe('deterministic inventory forecast', () => {
  let database: ReturnType<typeof openDatabase> | undefined;

  afterEach(() => {
    if (database?.open) closeDatabase(database);
    database = undefined;
  });

  it('uses fixed synthetic usage and supplier lead times to calculate integer quantities', () => {
    database = openDatabase(':memory:');
    seedSyntheticData(database);

    const forecast = calculateInventoryForecast(database, 'item-000001');

    expect(forecast).toMatchObject({
      itemId: 'item-000001',
      onHand: 4,
      reorderPoint: 12,
      isLowStock: true,
      usageWindowDays: 30,
      observedUsageUnits: 27,
    });
    expect(forecast?.supplierForecasts).toEqual([
      {
        supplierId: 'supplier-000001',
        supplierName: 'Synthetic Demo Supplier Alpha',
        leadTimeDays: 3,
        leadTimeDemand: 3,
        recommendedQuantity: 11,
      },
      {
        supplierId: 'supplier-000002',
        supplierName: 'Synthetic Demo Supplier Beta',
        leadTimeDays: 6,
        leadTimeDemand: 6,
        recommendedQuantity: 14,
      },
    ]);
  });

  it('returns no forecast for an item outside the trusted inventory registry', () => {
    database = openDatabase(':memory:');
    seedSyntheticData(database);

    expect(calculateInventoryForecast(database, 'item-999999')).toBeNull();
  });
});

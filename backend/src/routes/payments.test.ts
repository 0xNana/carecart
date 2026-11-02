import { afterEach, describe, expect, it } from 'vitest';

import { closeDatabase, openDatabase } from '../db';
import { seedSyntheticData } from '../seed';
import { createServer } from '../server';

describe('payment endpoint', () => {
  let database: ReturnType<typeof openDatabase> | undefined;
  let app: ReturnType<typeof createServer> | undefined;

  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
    if (database?.open) closeDatabase(database);
    database = undefined;
  });

  it('accepts only a registered purchase order ID and reports missing server configuration', async () => {
    database = openDatabase(':memory:');
    seedSyntheticData(database);
    app = createServer({ database });
    await app.ready();

    const invalid = await app.inject({
      method: 'POST',
      url: '/api/payments',
      payload: { purchaseOrderId: 'po-000001', amountAtomic: '1', supplierAccountId: 'attacker.near' },
    });
    const valid = await app.inject({
      method: 'POST',
      url: '/api/payments',
      payload: { purchaseOrderId: 'po-000001' },
    });

    expect(invalid.statusCode).toBe(400);
    expect(valid.statusCode).toBe(503);
    expect(valid.json().error.code).toBe('PAYMENTS_NOT_CONFIGURED');
  });
});

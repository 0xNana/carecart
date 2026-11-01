import { afterEach, describe, expect, it } from 'vitest';

import { closeDatabase, loadDomainRecords, openDatabase } from '../db';
import { seedSyntheticData } from '../seed';
import { createServer } from '../server';

describe('purchase order endpoint', () => {
  let database: ReturnType<typeof openDatabase> | undefined;
  let app: ReturnType<typeof createServer> | undefined;

  const startServer = async () => {
    database = openDatabase(':memory:');
    seedSyntheticData(database);
    app = createServer({ database, clock: () => new Date('2026-11-01T12:00:00.000Z') });
    await app.ready();
    return app;
  };

  const createFreshQuotes = async (server: Awaited<ReturnType<typeof createServer>>) => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/supplier-quotes',
      payload: { itemId: 'item-000001' },
    });
    expect(response.statusCode).toBe(201);
  };

  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
    if (database?.open) closeDatabase(database);
    database = undefined;
  });

  it('derives and audits the purchase order from the selected persisted quote', async () => {
    const server = await startServer();
    await createFreshQuotes(server);

    const response = await server.inject({
      method: 'POST',
      url: '/api/purchase-orders',
      payload: {
        requestId: 'carecart-po-request-0001',
        itemId: 'item-000001',
        quoteId: 'quote-000003',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      replayed: false,
      purchaseOrder: {
        id: 'po-000002',
        requestId: 'carecart-po-request-0001',
        quoteId: 'quote-000003',
        itemId: 'item-000001',
        supplierId: 'supplier-000001',
        quantity: 14,
        amountAtomic: '1680',
        assetCode: 'CCTEST',
        status: 'draft',
        createdAt: '2026-11-01T12:00:00.000Z',
      },
    });
    expect(response.json().purchaseOrder).not.toHaveProperty('destinationAccountId');
    expect(response.json().purchaseOrder).not.toHaveProperty('tokenId');
    expect(loadDomainRecords(database!).purchaseOrders).toHaveLength(2);

    const createdEvents = loadDomainRecords(database!).auditEvents.filter(
      (event) => event.eventType === 'purchase_order_created',
    );
    expect(createdEvents).toHaveLength(1);
    expect(createdEvents[0]).toMatchObject({
      entityType: 'purchase_order',
      entityId: 'po-000002',
      payload: {
        requestId: 'carecart-po-request-0001',
        quoteId: 'quote-000003',
        supplierId: 'supplier-000001',
        amountAtomic: '1680',
      },
    });
  });

  it('returns the same purchase order for a replay and writes only one audit event', async () => {
    const server = await startServer();
    await createFreshQuotes(server);
    const payload = {
      requestId: 'carecart-po-request-0002',
      itemId: 'item-000001',
      quoteId: 'quote-000003',
    };

    const first = await server.inject({ method: 'POST', url: '/api/purchase-orders', payload });
    database!
      .prepare('UPDATE quotes SET expires_at = ? WHERE id = ?')
      .run('2026-11-01T12:00:00.000Z', payload.quoteId);
    const second = await server.inject({ method: 'POST', url: '/api/purchase-orders', payload });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().replayed).toBe(true);
    expect(second.json().purchaseOrder).toEqual(first.json().purchaseOrder);
    expect(loadDomainRecords(database!).purchaseOrders).toHaveLength(2);
    expect(
      loadDomainRecords(database!).auditEvents.filter(
        (event) => event.eventType === 'purchase_order_created',
      ),
    ).toHaveLength(1);
  });

  it('rejects caller-supplied destination, token, route, amount, or quantity fields', async () => {
    const server = await startServer();
    await createFreshQuotes(server);
    const before = loadDomainRecords(database!);

    const response = await server.inject({
      method: 'POST',
      url: '/api/purchase-orders',
      payload: {
        requestId: 'carecart-po-request-0003',
        itemId: 'item-000001',
        quoteId: 'quote-000003',
        destinationAccountId: 'attacker.near',
        tokenId: 'attacker-token.near',
        route: 'untrusted-bridge',
        amountAtomic: '1',
        quantity: 1,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
    expect(loadDomainRecords(database!).purchaseOrders).toHaveLength(before.purchaseOrders.length);
    expect(loadDomainRecords(database!).auditEvents).toHaveLength(before.auditEvents.length);
  });

  it('returns structured errors for an unknown, mismatched, expired, or already-used quote', async () => {
    const server = await startServer();

    const unknown = await server.inject({
      method: 'POST',
      url: '/api/purchase-orders',
      payload: {
        requestId: 'carecart-po-request-0004',
        itemId: 'item-000001',
        quoteId: 'quote-999999',
      },
    });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error.code).toBe('QUOTE_NOT_FOUND');

    const mismatched = await server.inject({
      method: 'POST',
      url: '/api/purchase-orders',
      payload: {
        requestId: 'carecart-po-request-0005',
        itemId: 'item-000002',
        quoteId: 'quote-000002',
      },
    });
    expect(mismatched.statusCode).toBe(409);
    expect(mismatched.json().error.code).toBe('QUOTE_ITEM_MISMATCH');

    database!
      .prepare('UPDATE quotes SET expires_at = ? WHERE id = ?')
      .run('2026-11-01T11:59:59.999Z', 'quote-000002');
    const expired = await server.inject({
      method: 'POST',
      url: '/api/purchase-orders',
      payload: {
        requestId: 'carecart-po-request-0006',
        itemId: 'item-000001',
        quoteId: 'quote-000002',
      },
    });
    expect(expired.statusCode).toBe(409);
    expect(expired.json().error.code).toBe('QUOTE_EXPIRED');

    const used = await server.inject({
      method: 'POST',
      url: '/api/purchase-orders',
      payload: {
        requestId: 'carecart-po-request-0007',
        itemId: 'item-000001',
        quoteId: 'quote-000001',
      },
    });
    expect(used.statusCode).toBe(409);
    expect(used.json().error.code).toBe('QUOTE_ALREADY_USED');
  });

  it('rejects reuse of an idempotency key for a different quote', async () => {
    const server = await startServer();
    await createFreshQuotes(server);
    const first = await server.inject({
      method: 'POST',
      url: '/api/purchase-orders',
      payload: {
        requestId: 'carecart-po-request-0008',
        itemId: 'item-000001',
        quoteId: 'quote-000003',
      },
    });
    const reused = await server.inject({
      method: 'POST',
      url: '/api/purchase-orders',
      payload: {
        requestId: 'carecart-po-request-0008',
        itemId: 'item-000001',
        quoteId: 'quote-000004',
      },
    });

    expect(first.statusCode).toBe(201);
    expect(reused.statusCode).toBe(409);
    expect(reused.json().error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(loadDomainRecords(database!).purchaseOrders).toHaveLength(2);
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, closeDatabase } from '../db';
import { seedSyntheticData } from '../seed';
import { createServer } from '../server';
import { createSupplierQuotes } from '../procurement/suppliers';
import { createPurchaseOrder } from '../procurement/purchase-orders';

describe('judge dashboard read model', () => {
  let database: ReturnType<typeof openDatabase>;
  beforeEach(() => { database = openDatabase(':memory:'); });
  let app: ReturnType<typeof createServer>;
  afterEach(async () => { if (app) await app.close(); closeDatabase(database); });
  it('returns explicit empty collections before synthetic seed data exists', async () => {
    app = createServer({ database });
    const response = await app.inject({ method: 'GET', url: '/api/dashboard' });
    expect(response.json()).toMatchObject({ dataOrigin: 'synthetic', inventory: [], suppliers: [], quotes: [], purchaseOrders: [], auditEvents: [] });
  });
  it('serializes exact amounts, server quote eligibility and persisted draft/audit records', async () => {
    seedSyntheticData(database);
    app = createServer({ database, clock: () => new Date('2026-11-09T12:00:00Z') });
    // Fixture setup uses domain functions; the public HTTP mutations are retired.
    const quotes = createSupplierQuotes(database, 'item-000001', new Date('2026-11-09T12:00:00Z'));
    if (quotes.kind !== 'created') throw new Error('Synthetic quote fixture failed');
    const quote = quotes.quotes[0];
    const created = createPurchaseOrder(database, { itemId: 'item-000001', quoteId: quote.id, requestId: 'dashboard-order-0001' }, new Date('2026-11-09T12:00:00Z'));
    if (created.kind !== 'created') throw new Error('Synthetic order fixture failed');
    const response = await app.inject({ method: 'GET', url: '/api/dashboard' });
    const snapshot = response.json();
    expect(response.headers['cache-control']).toBe('no-store');
    expect(snapshot.inventory[0]).toMatchObject({ dataOrigin: 'synthetic', isLowStock: true });
    expect(snapshot.suppliers[0]).toEqual({ id: 'supplier-000001', displayName: 'Synthetic Demo Supplier Alpha' });
    expect(snapshot.quotes.find((entry: { id: string }) => entry.id === quote.id)).toMatchObject({ used: true, expired: false, totalAmountAtomic: quote.totalAmountAtomic.toString() });
    expect(snapshot.quotes.find((entry: { id: string }) => entry.id === 'quote-000001')).toMatchObject({ expired: true });
    expect(snapshot.purchaseOrders[0]).toMatchObject({ id: created.purchaseOrder.id, status: 'draft', paymentStatus: 'not_requested', amountAtomic: quote.totalAmountAtomic.toString() });
    expect(snapshot.purchaseOrders[0]).toMatchObject({ commitTransactionHash: null, requestTransactionHash: null, paymentUpdatedAt: null });
    expect(snapshot.auditEvents[0]).toMatchObject({ eventType: 'purchase_order_created', entityId: created.purchaseOrder.id });
  });
  it('includes persisted payment timestamps and public transaction hashes', async () => {
    seedSyntheticData(database);
    database.prepare('UPDATE purchase_orders SET commit_transaction_hash = ? WHERE id = ?').run('public-commit-hash', 'po-000001');
    database.prepare(`UPDATE payments SET status = ?, updated_at = ?, request_transaction_hash = ? WHERE purchase_order_id = ?`)
      .run('pending_approval', '2026-11-02T10:00:00.000Z', 'public-request-hash', 'po-000001');
    app = createServer({ database });
    const response = await app.inject({ method: 'GET', url: '/api/dashboard' });
    expect(response.json().purchaseOrders[0]).toMatchObject({ paymentStatus: 'pending_approval', commitTransactionHash: 'public-commit-hash',
      requestTransactionHash: 'public-request-hash', paymentUpdatedAt: '2026-11-02T10:00:00.000Z' });
  });
});

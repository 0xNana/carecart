import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, closeDatabase } from '../db';
import { seedSyntheticData } from '../seed';
import { createServer } from '../server';

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
    const quotes = await app.inject({ method: 'POST', url: '/api/supplier-quotes', payload: { itemId: 'item-000001' } });
    const quote = quotes.json().quotes[0];
    const created = await app.inject({ method: 'POST', url: '/api/purchase-orders', payload: { itemId: 'item-000001', quoteId: quote.quoteId, requestId: 'dashboard-order-0001' } });
    const response = await app.inject({ method: 'GET', url: '/api/dashboard' });
    const snapshot = response.json();
    expect(response.headers['cache-control']).toBe('no-store');
    expect(snapshot.inventory[0]).toMatchObject({ dataOrigin: 'synthetic', isLowStock: true });
    expect(snapshot.suppliers[0]).toEqual({ id: 'supplier-000001', displayName: 'Synthetic Demo Supplier Alpha' });
    expect(snapshot.quotes.find((entry: { id: string }) => entry.id === quote.quoteId)).toMatchObject({ used: true, expired: false, totalAmountAtomic: quote.totalAmountAtomic });
    expect(snapshot.quotes.find((entry: { id: string }) => entry.id === 'quote-000001')).toMatchObject({ expired: true });
    expect(snapshot.purchaseOrders[0]).toMatchObject({ id: created.json().purchaseOrder.id, status: 'draft', paymentStatus: 'not_requested', amountAtomic: quote.totalAmountAtomic });
    expect(snapshot.purchaseOrders[0]).toMatchObject({ commitTransactionHash: null, requestTransactionHash: null, paymentUpdatedAt: null });
    expect(snapshot.auditEvents[0]).toMatchObject({ eventType: 'purchase_order_created', entityId: created.json().purchaseOrder.id });
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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase, closeDatabase, loadDomainRecords } from '../db';
import { seedSyntheticData } from '../seed';
import { createServer } from '../server';
describe('cross-chain preview routes', () => {
  let database: ReturnType<typeof openDatabase>;
  let app: ReturnType<typeof createServer>;
  beforeEach(() => { database = openDatabase(':memory:'); seedSyntheticData(database); app = createServer({ database }); });
  afterEach(async () => { await app.close(); closeDatabase(database); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  it('runs mock flows entirely offline and does not mutate PO, payment or audit state', async () => {
    const network = vi.fn(() => { throw new Error('mock must not use network'); }); vi.stubGlobal('fetch', network);
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    const before = loadDomainRecords(database);
    const config = await app.inject({ method: 'GET', url: '/api/intents/config' });
    expect(config.json()).toMatchObject({ mode: 'mock_simulation', settlementEnabled: false, dryQuoteAvailable: false });
    for (const destinationChain of ['base', 'arb', 'sol']) {
      const result = await app.inject({ method: 'POST', url: '/api/intents/preview', payload: { purchaseOrderId: 'po-000001', destinationChain } });
      expect(result.statusCode).toBe(200);
      expect(result.json()).toMatchObject({ mode: 'mock_simulation', status: 'preview_only', settlement: 'not_initiated', supplierId: 'supplier-000001', amountAtomic: '1200', destinationChain });
      expect(result.json().simulatedRecipient).toBe(`simulation:supplier-000001:${destinationChain}`);
      expect(result.json()).not.toHaveProperty('depositAddress');
    }
    expect(network).not.toHaveBeenCalled(); expect(loadDomainRecords(database)).toEqual(before);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('mock_simulation'));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('not_initiated'));
  });
  it('rejects payee/amount/dry overrides and unknown records without invoking an adapter', async () => {
    for (const extra of [{ recipient: 'attacker' }, { amountAtomic: '1' }, { dry: false }, { supplierId: 'supplier-000002' }]) {
      const response = await app.inject({ method: 'POST', url: '/api/intents/preview', payload: { purchaseOrderId: 'po-000001', destinationChain: 'base', ...extra } });
      expect(response.statusCode).toBe(400);
    }
    expect((await app.inject({ method: 'POST', url: '/api/intents/preview', payload: { purchaseOrderId: 'po-999999', destinationChain: 'base' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/intents/dry-quote', payload: { dry: false } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/intents/dry-quote', payload: {} })).statusCode).toBe(503);
  });
});

import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { OperationJournal } from './operation-journal';

describe('durable backend write recovery', () => {
  it('freezes a lost response across restart until a finalized canonical observation resolves it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'carecart-operations-'));
    const file = join(dir, 'journal.sqlite');
    let journal = new OperationJournal(file, 'a'.repeat(64));
    const payload = { method: 'request_payment', args: { po_id: 'po-1' } };
    try {
      journal.begin('request:po-1', payload);
      journal.close();
      journal = new OperationJournal(file, 'a'.repeat(64));
      expect(() => journal.begin('request:po-1', payload)).toThrow(/reconcile/);
      journal.confirm('request:po-1', payload, { transactionHash: null, reconciled: true });
      expect(journal.begin('request:po-1', payload)).toEqual({ transactionHash: null, reconciled: true });
      expect(() => journal.begin('request:po-1', { method: 'request_payment', args: { po_id: 'po-2' } })).toThrow(/conflict/);
    } finally { journal.close(); rmSync(dir, { recursive: true }); }
  });
  it('preserves every PO field across separate quote attempt IDs', () => {
    const journal = new OperationJournal(':memory:', 'a'.repeat(64));
    const order = { po_id: 'po-1', profile: 'testnet', supplier: 'supplier.testnet', token: 'token.testnet', amount: '1000000', invoice_digest: 'a'.repeat(64), destination: 'Near' };
    try {
      journal.rememberOrder(order);
      journal.rememberOrder(order);
      expect(() => journal.rememberOrder({ ...order, amount: '2000000' })).toThrow(/immutable/);
      expect(() => journal.rememberOrder({ ...order, destination: 'Base' })).toThrow();
    } finally { journal.close(); }
  });
});

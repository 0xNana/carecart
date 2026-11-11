import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { SettlementJournal } from './journal';
import { verifySettlementQuote } from './settlement';
import { now, order, signed } from './fixtures/settlement';

let journal: SettlementJournal | undefined;
let directory: string | undefined;
afterEach(() => {
  journal?.close();
  journal = undefined;
  if (directory) rmSync(directory, { recursive: true });
  directory = undefined;
});

async function fixture() {
  const { raw, expected, key } = await signed();
  const quote = verifySettlementQuote(order, raw, expected, now, key.getPublicKey().toString());
  const commitment = { signed_quote_hash: quote.identityHash, deposit_account: raw.quote.depositAddress };
  return { quote, commitment };
}

it('persists pending-to-rejected reconciliation across restart and makes duplicate rejection a no-op', async () => {
  const { quote, commitment } = await fixture();
  directory = mkdtempSync(join(tmpdir(), 'carecart-rejected-'));
  const file = join(directory, 'journal.sqlite');
  journal = new SettlementJournal(file, 'a'.repeat(64));
  journal.prepare('attempt-1', quote);
  const rejected = journal.reconcileSource('attempt-1', { status: 'Rejected', attempt_id: 'attempt-1' }, commitment);
  expect(rejected.state).toBe('Rejected');
  expect(rejected.sourceEvidence).toBeNull();
  journal.close();
  journal = new SettlementJournal(file, 'a'.repeat(64));
  expect(journal.reconcileSource('attempt-1', { status: 'Rejected', attempt_id: 'attempt-1' }, commitment)).toEqual(rejected);
  const reader = new Database(file, { readonly: true });
  try {
    expect(reader.prepare('SELECT state FROM settlement_events ORDER BY id').pluck().all()).toEqual(['PendingApproval', 'Rejected']);
  } finally { reader.close(); }
});

it('never dispatches, verifies destination receipts or refreshes a rejected PO', async () => {
  const { quote, commitment } = await fixture();
  journal = new SettlementJournal(':memory:', 'a'.repeat(64));
  journal.prepare('attempt-1', quote);
  journal.reconcileSource('attempt-1', { status: 'Rejected', attempt_id: 'attempt-1' }, commitment);
  const rejected = journal.get('attempt-1');
  expect(journal.prepare('attempt-1', quote)).toEqual(rejected);
  for (const status of ['PendingApproval', 'Registering', 'Dispatching', 'Dispatched', 'Expired', 'Failed']) {
    expect(() => journal!.reconcileSource('attempt-1', { status, attempt_id: 'attempt-1' }, commitment)).toThrow(/transition/);
  }
  expect(() => journal!.prepare('attempt-2', quote)).toThrow(/Rejected PO/);
  expect(() => journal!.recordSource('attempt-1', { transactionHash: 'must-not-be-recorded' })).toThrow(/Rejected/);
  const verify = vi.fn();
  await expect(journal.reconcileDestination('attempt-1', {}, verify)).rejects.toThrow(/Source dispatch/);
  expect(verify).not.toHaveBeenCalled();
  expect(journal.get('attempt-1')).toEqual(rejected);
});

it('does not accept rejection for another attempt, mismatched commitment, or an in-flight transfer', async () => {
  const { quote, commitment } = await fixture();
  journal = new SettlementJournal(':memory:', 'a'.repeat(64));
  journal.prepare('attempt-1', quote);
  expect(() => journal!.reconcileSource('attempt-1', { status: 'Rejected', attempt_id: 'other' }, commitment)).toThrow(/commitment/);
  expect(() => journal!.reconcileSource('attempt-1', { status: 'Rejected', attempt_id: 'attempt-1' }, { ...commitment, signed_quote_hash: 'c'.repeat(64) })).toThrow(/commitment/);
  journal.reconcileSource('attempt-1', { status: 'Dispatching', attempt_id: 'attempt-1' }, commitment);
  expect(() => journal!.reconcileSource('attempt-1', { status: 'Rejected', attempt_id: 'attempt-1' }, commitment)).toThrow(/transition/);
  expect(journal.get('attempt-1').state).toBe('Dispatching');
});

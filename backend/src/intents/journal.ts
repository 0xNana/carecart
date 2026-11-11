import Database from 'better-sqlite3';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  digest,
  ExecutionStatusSchema,
  SettlementOrderSchema,
  type VerifiedQuote,
} from './settlement';

export type SettlementState =
  | 'PendingApproval'
  | 'Registering'
  | 'Dispatching'
  | 'Dispatched'
  | 'Settled'
  | 'Refunded'
  | 'Rejected'
  | 'Expired'
  | 'Failed'
  | 'Blocked';
interface Attempt {
  id: string;
  poId: string;
  state: SettlementState;
  reviewHash: string;
  quote: VerifiedQuote;
  evidence: unknown;
  sourceEvidence: unknown;
}
/** Dedicated v2 database. Never opens/migrates the existing CCTEST procurement database. */
export class SettlementJournal {
  private readonly db: Database.Database;
  constructor(
    path: string,
    readonly profileFingerprint: string,
  ) {
    if (!/^[0-9a-f]{64}$/.test(profileFingerprint))
      throw new Error('Reviewed profile fingerprint required');
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    if (
      this.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='purchase_orders'",
        )
        .get()
    ) {
      this.db.close();
      throw new Error('CCTEST database cannot be reused');
    }
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = FULL');
    this.db
      .exec(`CREATE TABLE IF NOT EXISTS settlement_profile (id INTEGER PRIMARY KEY CHECK(id=1), fingerprint TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS settlement_attempts (id TEXT PRIMARY KEY, po_id TEXT NOT NULL, state TEXT NOT NULL, review_hash TEXT NOT NULL, quote TEXT NOT NULL, evidence TEXT);
   CREATE UNIQUE INDEX IF NOT EXISTS one_live_attempt ON settlement_attempts(po_id) WHERE state NOT IN ('Expired','Failed','Blocked');
   CREATE TABLE IF NOT EXISTS settlement_events (id INTEGER PRIMARY KEY, attempt_id TEXT NOT NULL, state TEXT NOT NULL, evidence TEXT NOT NULL, created_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS settlement_proofs (proof_key TEXT PRIMARY KEY, attempt_id TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS settlement_source (attempt_id TEXT PRIMARY KEY, transaction_hash TEXT UNIQUE NOT NULL, evidence TEXT NOT NULL);`);
    this.db.exec('CREATE TABLE IF NOT EXISTS settlement_po_commitments (po_id TEXT PRIMARY KEY, immutable_hash TEXT NOT NULL)');
    const p = this.db
      .prepare('SELECT fingerprint FROM settlement_profile WHERE id=1')
      .get() as { fingerprint: string } | undefined;
    if (p && p.fingerprint !== profileFingerprint) {
      this.db.close();
      throw new Error('Database profile mismatch');
    }
    this.db
      .prepare('INSERT OR IGNORE INTO settlement_profile VALUES (1,?)')
      .run(profileFingerprint);
  }
  close() {
    this.db.close();
  }
  get(id: string): Attempt {
    const r = this.db
      .prepare('SELECT * FROM settlement_attempts WHERE id=?')
      .get(id) as
      | {
          id: string;
          po_id: string;
          state: SettlementState;
          review_hash: string;
          quote: string;
          evidence: string | null;
        }
      | undefined;
    if (!r) throw new Error('Unknown settlement attempt');
    const source = this.db
      .prepare('SELECT evidence FROM settlement_source WHERE attempt_id=?')
      .get(id) as { evidence: string } | undefined;
    return {
      id: r.id,
      poId: r.po_id,
      state: r.state,
      reviewHash: r.review_hash,
      quote: JSON.parse(r.quote),
      evidence: r.evidence ? JSON.parse(r.evidence) : null,
      sourceEvidence: source ? JSON.parse(source.evidence) : null,
    };
  }
  recordSource(id: string, proof: { transactionHash: string }) {
    this.db
      .transaction(() => {
        const a = this.get(id);
        if (a.state === 'Rejected') throw new Error('Rejected attempt cannot have source dispatch evidence');
        const existing = this.db
          .prepare(
            'SELECT transaction_hash FROM settlement_source WHERE attempt_id=?',
          )
          .get(id) as { transaction_hash: string } | undefined;
        if (existing) {
          if (existing.transaction_hash !== proof.transactionHash)
            throw new Error('Immutable source transaction conflict');
          return;
        }
        this.db
          .prepare('INSERT INTO settlement_source VALUES (?,?,?)')
          .run(id, proof.transactionHash, JSON.stringify(proof));
        this.event(id, a.state, { source: proof });
      })
      .immediate();
    return this.get(id);
  }
  prepare(id: string, quote: VerifiedQuote) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id))
      throw new Error('Invalid attempt ID');
    this.db
      .transaction(() => {
        const immutableHash = (q: VerifiedQuote) => {
          const o = SettlementOrderSchema.parse(q.order);
          return digest([o.profile, o.poId, o.vault, o.treasury, o.supplier, o.token, o.amount,
            o.invoiceDigest, o.routeId, o.routeVersion, o.recipient.toLowerCase(), o.destinationChain, o.destinationToken]);
        };
        const expected = immutableHash(quote);
        // Include attempts created by an older local journal before this table existed.
        const prior = this.db.prepare('SELECT quote, state FROM settlement_attempts WHERE po_id=?').all(quote.order.poId) as Array<{ quote: string; state: SettlementState }>;
        if (prior.some((row) => immutableHash(JSON.parse(row.quote) as VerifiedQuote) !== expected))
          throw new Error('Immutable PO conflict across quote attempts');
        const bound = this.db.prepare('SELECT immutable_hash FROM settlement_po_commitments WHERE po_id=?').get(quote.order.poId) as { immutable_hash: string } | undefined;
        if (bound && bound.immutable_hash !== expected) throw new Error('Immutable PO conflict across quote attempts');
        this.db.prepare('INSERT OR IGNORE INTO settlement_po_commitments VALUES (?,?)').run(quote.order.poId, expected);
        const old = this.db
          .prepare('SELECT review_hash FROM settlement_attempts WHERE id=?')
          .get(id) as { review_hash: string } | undefined;
        if (old) {
          if (old.review_hash !== quote.reviewHash)
            throw new Error('Immutable attempt conflict');
          return;
        }
        // Rejection is final for the PO, unlike an expired/failed quote attempt. Keep the
        // unique PO index occupied too: a restart or a fresh attempt ID cannot rearm it.
        if (prior.some((row) => row.state === 'Rejected'))
          throw new Error('Rejected PO cannot be retried');
        this.db
          .prepare(
            'INSERT INTO settlement_attempts (id,po_id,state,review_hash,quote) VALUES (?,?,?,?,?)',
          )
          .run(
            id,
            quote.order.poId,
            'PendingApproval',
            quote.reviewHash,
            JSON.stringify(quote),
          );
        this.event(id, 'PendingApproval', {
          reviewHash: quote.reviewHash,
          profile: this.profileFingerprint,
        });
      })
      .immediate();
    return this.get(id);
  }
  private event(id: string, state: SettlementState, evidence: unknown) {
    this.db
      .prepare(
        'INSERT INTO settlement_events (attempt_id,state,evidence,created_at) VALUES (?,?,?,?)',
      )
      .run(id, state, JSON.stringify(evidence), new Date().toISOString());
  }
  private update(id: string, state: SettlementState, evidence: unknown) {
    this.db
      .prepare('UPDATE settlement_attempts SET state=?,evidence=? WHERE id=?')
      .run(state, JSON.stringify(evidence), id);
    this.event(id, state, evidence);
  }
  /** Only reconciles canonical vault views. An RPC timeout leaves the prior state untouched. */
  reconcileSource(
    id: string,
    source: { status: string; attempt_id: string },
    committedQuote: { signed_quote_hash: string; deposit_account: string },
  ) {
    return this.db
      .transaction(() => {
        const a = this.get(id);
        if (
          source.attempt_id !== id ||
          committedQuote.signed_quote_hash !== a.quote.identityHash ||
          committedQuote.deposit_account !==
            a.quote.response.quote.depositAddress
        )
          throw new Error('Source commitment conflict');
        if (['Settled', 'Refunded'].includes(a.state)) return a;
        const allowed: Record<string, SettlementState[]> = {
          PendingApproval: [
            'Rejected',
            'Registering',
            'Dispatching',
            'Dispatched',
            'Expired',
            'Failed',
            'Blocked',
          ],
          Registering: ['Dispatching', 'Dispatched', 'Expired', 'Failed'],
          Dispatching: ['Dispatched', 'Failed'],
        };
        if (source.status === a.state) return a;
        if (!allowed[a.state]?.includes(source.status as SettlementState))
          throw new Error('Invalid source transition');
        this.update(id, source.status as SettlementState, {
          canonicalVault: source,
        });
        return this.get(id);
      })
      .immediate();
  }
  /** SUCCESS is only a provider report; independent finalized receipt verification is mandatory. */
  async reconcileDestination(
    id: string,
    raw: unknown,
    verify: (
      quote: VerifiedQuote,
      hashes: string[],
      kind: 'settlement' | 'refund',
      amount: string,
    ) => Promise<{ key: string; evidence: unknown } | null>,
  ) {
    const a = this.get(id);
    if (a.state === 'Settled' || a.state === 'Refunded') return a;
    if (a.state !== 'Dispatched')
      throw new Error('Source dispatch not confirmed');
    if (!a.sourceEvidence)
      throw new Error('Final source transaction evidence is required');
    const s = ExecutionStatusSchema.parse(raw);
    if (digest(s.quoteResponse) !== digest(a.quote.response))
      throw new Error('Status quote substitution');
    const report = {
      providerStatus: s.status,
      updatedAt: s.updatedAt,
      receiptVerification: 'pending',
    };
    this.db
      .transaction(() => {
        const current = this.get(id);
        if (
          current.state === 'Dispatched' &&
          digest(current.evidence) !== digest(report)
        )
          this.update(id, 'Dispatched', report);
      })
      .immediate();
    if (s.status !== 'SUCCESS' && s.status !== 'REFUNDED') return this.get(id); // Provider FAILED also does not prove funds returned.
    const kind = s.status === 'SUCCESS' ? 'settlement' : 'refund';
    const amount =
      kind === 'settlement'
        ? a.quote.response.quote.minAmountOut
        : s.swapDetails.refundedAmount;
    if (
      !amount ||
      BigInt(amount) <= 0n ||
      (kind === 'refund' && BigInt(amount) > BigInt(a.quote.order.amount))
    )
      throw new Error('Invalid receipt amount');
    const hashes = (
      kind === 'settlement'
        ? s.swapDetails.destinationChainTxHashes
        : s.swapDetails.originChainTxHashes
    ).map((x) => x.hash);
    const proof = await verify(a.quote, hashes, kind, amount);
    if (!proof) return this.get(id);
    return this.db
      .transaction(() => {
        const current = this.get(id);
        if (current.state !== 'Dispatched') return current;
        this.db
          .prepare('INSERT INTO settlement_proofs VALUES (?,?)')
          .run(proof.key, id);
        this.update(id, kind === 'settlement' ? 'Settled' : 'Refunded', {
          providerStatus: s.status,
          receipt: proof.evidence,
          amount,
          backendVerified: true,
          fullRefund:
            kind === 'refund' ? amount === a.quote.order.amount : undefined,
        });
        return this.get(id);
      })
      .immediate();
  }
}

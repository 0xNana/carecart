import {assertTenantExecution,type TenantExecutionPermit} from '../tenancy/treasury-authority';
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { secureStateDatabase } from '../storage/state-database-permissions';
import { dirname } from 'node:path';
import { digest } from '../intents/settlement';
import {financialDatabaseOwner} from '../tenancy/treasury';
import { SafetyOrderSchema } from './commitments';

export interface WriteEvidence { transactionHash: string | null; reconciled: boolean }
/** Persist intent before sending. Sending/ambiguous operations never automatically retry. */
export class OperationJournal {
  private readonly db: Database.Database;
  readonly persistent: boolean;
  constructor(readonly path: string, readonly profileFingerprint: string,readonly tenantPermit?:TenantExecutionPermit) {
    if (!/^[a-f0-9]{64}$/.test(profileFingerprint)) throw new Error('Reviewed profile fingerprint required');
    this.persistent = path !== ':memory:';
    if (this.persistent) mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    if (this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='purchase_orders'").get()) {
      this.db.close(); throw new Error('CCTEST database cannot be reused');
    }
    if (this.persistent) secureStateDatabase(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = FULL');
    this.db.exec(`CREATE TABLE IF NOT EXISTS commitment_profile(id INTEGER PRIMARY KEY CHECK(id=1), fingerprint TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS canonical_orders(po_id TEXT PRIMARY KEY, payload_hash TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS backend_operations(operation_key TEXT PRIMARY KEY, payload_hash TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('Sending','Ambiguous','Confirmed')), evidence TEXT);`);
    const previous = this.db.prepare('SELECT fingerprint FROM commitment_profile WHERE id=1').get() as { fingerprint: string } | undefined;
    if (previous && previous.fingerprint !== profileFingerprint) { this.db.close(); throw new Error('Operation journal profile mismatch'); }
    this.db.prepare('INSERT OR IGNORE INTO commitment_profile VALUES(1,?)').run(profileFingerprint);
  }
  close() { if (this.db.open) this.db.close(); }
  rememberOrder(raw: unknown) {
    const order = SafetyOrderSchema.parse(raw);
    this.db.transaction(() => {
      const previous = this.db.prepare('SELECT payload_hash FROM canonical_orders WHERE po_id=?').get(order.po_id) as { payload_hash: string } | undefined;
      if (previous && previous.payload_hash !== digest(order)) throw new Error('Local immutable PO conflict');
      this.db.prepare('INSERT OR IGNORE INTO canonical_orders VALUES(?,?,?)').run(order.po_id, digest(order), JSON.stringify(order));
    }).immediate();
    return order;
  }
  private operation(key: string, payload: object) {
    const row = this.db.prepare('SELECT * FROM backend_operations WHERE operation_key=?').get(key) as { payload_hash: string; state: string; evidence: string | null } | undefined;
    if (row && row.payload_hash !== digest(payload)) throw new Error('Immutable backend operation conflict');
    return row;
  }
  /** Recovery must refer to an existing exact intent, never create or replace one. */
  assertRecorded(key: string, payload: object): void {
    if (!this.operation(key, payload)) throw new Error('No recorded backend operation to reconcile');
  }
  begin(key: string, payload: object): WriteEvidence | null {
    const intent=payload as {method?:string;args?:{order?:unknown;po_id?:string}};
    const poId=intent.args?.order?SafetyOrderSchema.parse(intent.args.order).po_id:intent.args?.po_id;
    // Other method shapes cannot reuse a permit for a PO commitment/payment request.
    if(financialDatabaseOwner(this.path)&&key!==intent.method+':'+poId)throw new Error('Exact tenant operation key required');
    const role=intent.method==='commit_purchase_order'?'committer':'requester';
    assertTenantExecution(this.path,role,poId??'',intent.method==='commit_purchase_order'||intent.method==='request_payment'?this.tenantPermit:undefined,intent.args?.order?digest(SafetyOrderSchema.parse(intent.args.order)):undefined);
    return this.db.transaction(() => {
      const previous = this.operation(key, payload);
      if (previous?.state === 'Confirmed') return JSON.parse(previous.evidence!) as WriteEvidence;
      if (previous) throw new Error('Ambiguous backend operation: reconcile finalized canonical state before any retry');
      this.db.prepare("INSERT INTO backend_operations VALUES(?,?,'Sending',NULL)").run(key, digest(payload));
      return null;
    }).immediate();
  }
  confirm(key: string, payload: object, evidence: WriteEvidence): WriteEvidence {
    return this.db.transaction(() => {
      const previous = this.operation(key, payload);
      if (previous?.state === 'Confirmed') return JSON.parse(previous.evidence!) as WriteEvidence;
      this.db.prepare("INSERT INTO backend_operations VALUES(?,?,'Confirmed',?) ON CONFLICT(operation_key) DO UPDATE SET state='Confirmed',evidence=excluded.evidence")
        .run(key, digest(payload), JSON.stringify(evidence));
      return evidence;
    }).immediate();
  }
  ambiguous(key: string) {
    this.db.prepare("UPDATE backend_operations SET state='Ambiguous' WHERE operation_key=? AND state='Sending'").run(key);
  }
}

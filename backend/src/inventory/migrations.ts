import type Database from 'better-sqlite3';
import {digest} from '../intents/settlement';
import {Autonomy,TenantBinding,type Product} from './model';

/** Additive, transactional upgrades; movement and audit bodies are never rewritten. */
export function migrateInventory(db:Database.Database,fingerprint:string,products:Product[],clock:()=>number,tenant?:TenantBinding){
 db.transaction(()=>{
  // Inspect only after acquiring the write lock: another fresh process may still be initializing.
  // A genuinely empty database contains no unrelated work; any foreign schema remains forbidden.
  const initialized=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='inventory_identity'").get();
  if(!initialized&&db.prepare("SELECT 1 FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' LIMIT 1").get())
   throw new Error('Dedicated inventory workspace required; existing non-inventory database is preserved');
  const hasBinding=db.prepare("SELECT 1 FROM sqlite_master WHERE name='inventory_tenant_binding'").get();
  const owner=hasBinding?db.prepare('SELECT clinic_id,body_json FROM inventory_tenant_binding WHERE id=1').get() as {clinic_id:string|null;body_json:string}|undefined:undefined;
  if(tenant){TenantBinding.parse(tenant);if(initialized&&!owner)throw new Error('Legacy workspace requires migration review');if(owner&&owner.body_json!==JSON.stringify(tenant))throw new Error('Tenant ownership mismatch');}
  else if(owner?.clinic_id)throw new Error('Explicit tenant context required');
  db.exec(`CREATE TABLE IF NOT EXISTS inventory_schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS inventory_identity(id INTEGER PRIMARY KEY CHECK(id=1),fingerprint TEXT NOT NULL,products_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS inventory_locations(clinic_id TEXT NOT NULL,storeroom_id TEXT NOT NULL,PRIMARY KEY(clinic_id,storeroom_id));
    CREATE TABLE IF NOT EXISTS inventory_products(id TEXT PRIMARY KEY,body_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS inventory_movements(seq INTEGER PRIMARY KEY,id TEXT UNIQUE NOT NULL,product_id TEXT NOT NULL,kind TEXT NOT NULL,order_id TEXT,body_json TEXT NOT NULL,body_hash TEXT NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS inventory_opening_once ON inventory_movements(product_id) WHERE kind='Opening';
    CREATE TRIGGER IF NOT EXISTS inventory_movement_no_update BEFORE UPDATE ON inventory_movements BEGIN SELECT RAISE(ABORT,'Append-only inventory history'); END;
    CREATE TRIGGER IF NOT EXISTS inventory_movement_no_delete BEFORE DELETE ON inventory_movements BEGIN SELECT RAISE(ABORT,'Append-only inventory history'); END;
    CREATE TABLE IF NOT EXISTS inventory_audit(seq INTEGER PRIMARY KEY,body_json TEXT NOT NULL,body_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS inventory_requests(request_id TEXT PRIMARY KEY,payload_hash TEXT NOT NULL,result_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS inventory_autonomy(id INTEGER PRIMARY KEY CHECK(id=1),body_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS inventory_jobs(product_id TEXT PRIMARY KEY,next_due INTEGER NOT NULL,generation INTEGER NOT NULL,lease_owner TEXT,lease_until INTEGER,lease_token TEXT);
    CREATE TABLE IF NOT EXISTS inventory_job_failures(product_id TEXT PRIMARY KEY,failures INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS inventory_monitor_runs(id TEXT PRIMARY KEY,product_id TEXT NOT NULL,worker TEXT NOT NULL,state TEXT NOT NULL,started_at INTEGER NOT NULL,completed_at INTEGER,evidence_json TEXT,error TEXT);
    CREATE TABLE IF NOT EXISTS inventory_evaluations(event_id TEXT PRIMARY KEY,product_id TEXT NOT NULL,body_json TEXT NOT NULL,body_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS inventory_obligations(id TEXT PRIMARY KEY,product_id TEXT NOT NULL,event_id TEXT UNIQUE NOT NULL,case_id TEXT UNIQUE NOT NULL,closed_at INTEGER);
    CREATE UNIQUE INDEX IF NOT EXISTS inventory_active_obligation ON inventory_obligations(product_id) WHERE closed_at IS NULL;`);
  const version=(db.prepare('SELECT MAX(version) AS version FROM inventory_schema_migrations').get() as {version:number|null}).version??0;
  if(version>4)throw new Error('Unsupported inventory schema version');
  const old=db.prepare('SELECT fingerprint,products_hash FROM inventory_identity WHERE id=1').get() as {fingerprint:string;products_hash:string}|undefined;
  if(old&&old.fingerprint!==fingerprint)throw new Error('Inventory profile/configuration mismatch');
  if(old&&old.products_hash!==digest(products)){
   const stored=(db.prepare('SELECT body_json FROM inventory_products ORDER BY rowid').all() as {body_json:string}[]).map(row=>JSON.parse(row.body_json) as Product);
   if(version>1||digest(stored)!==old.products_hash||stored.some(p=>{const next=products.find(candidate=>candidate.id===p.id);return !next||digest(p)!==digest(next);}))
    throw new Error('Inventory profile/configuration mismatch; existing product definitions cannot change');
   db.prepare('UPDATE inventory_identity SET products_hash=? WHERE id=1').run(digest(products));
  }
  db.prepare('INSERT OR IGNORE INTO inventory_identity VALUES(1,?,?)').run(fingerprint,digest(products));
  db.prepare('INSERT OR IGNORE INTO inventory_schema_migrations VALUES(1,?)').run(new Date(clock()).toISOString());
  if(version<2){
   const columns=db.prepare('PRAGMA table_info(inventory_movements)').all() as {name:string}[];
   if(!columns.some(c=>c.name==='receipt_reference'))db.exec('ALTER TABLE inventory_movements ADD COLUMN receipt_reference TEXT');
   db.exec(`DROP INDEX IF EXISTS inventory_inbound_once;
    CREATE UNIQUE INDEX inventory_receipt_reference_once ON inventory_movements(product_id,receipt_reference) WHERE kind='Receive' AND receipt_reference IS NOT NULL;
    CREATE UNIQUE INDEX inventory_confirmation_once ON inventory_movements(order_id) WHERE kind='ConfirmInbound' AND json_extract(body_json,'$.confirmationReference') IS NOT NULL;
    CREATE TABLE inventory_order_links(order_id TEXT PRIMARY KEY,product_id TEXT NOT NULL,case_id TEXT NOT NULL,quantity INTEGER NOT NULL,canonical_hash TEXT NOT NULL);
    CREATE TRIGGER inventory_order_no_update BEFORE UPDATE ON inventory_order_links BEGIN SELECT RAISE(ABORT,'Immutable inventory order link'); END;
    CREATE TRIGGER inventory_order_no_delete BEFORE DELETE ON inventory_order_links BEGIN SELECT RAISE(ABORT,'Immutable inventory order link'); END;
    CREATE TABLE inventory_sources(id TEXT PRIMARY KEY,observed_at INTEGER NOT NULL,body_json TEXT NOT NULL,body_hash TEXT NOT NULL);
    CREATE TABLE inventory_worker_heartbeats(worker TEXT PRIMARY KEY,started_at INTEGER NOT NULL,last_seen INTEGER NOT NULL,phase TEXT NOT NULL,error TEXT);
    CREATE TRIGGER inventory_audit_no_update BEFORE UPDATE ON inventory_audit BEGIN SELECT RAISE(ABORT,'Append-only inventory audit'); END;
    CREATE TRIGGER inventory_audit_no_delete BEFORE DELETE ON inventory_audit BEGIN SELECT RAISE(ABORT,'Append-only inventory audit'); END;`);
   db.prepare('INSERT INTO inventory_schema_migrations VALUES(2,?)').run(new Date(clock()).toISOString());
  }
  if(version<3){
   db.exec(`CREATE TABLE inventory_tenant_binding(id INTEGER PRIMARY KEY CHECK(id=1),clinic_id TEXT,mode TEXT NOT NULL,body_json TEXT NOT NULL);
    CREATE TRIGGER inventory_tenant_no_update BEFORE UPDATE ON inventory_tenant_binding BEGIN SELECT RAISE(ABORT,'Immutable tenant binding');END;
    CREATE TRIGGER inventory_tenant_no_delete BEFORE DELETE ON inventory_tenant_binding BEGIN SELECT RAISE(ABORT,'Immutable tenant binding');END;`);
   db.prepare('INSERT INTO inventory_tenant_binding VALUES(1,?,?,?)').run(tenant?.clinicId??null,tenant?'clinic':'legacy-demo',JSON.stringify(tenant??null));
   db.prepare('INSERT INTO inventory_schema_migrations VALUES(3,?)').run(new Date(clock()).toISOString());
  }
  if(version<4){
   // The optional depletion reference identifies one exit from this storeroom, irrespective of
   // whether staff call it dispensing or direct consumption. Existing event bodies stay intact.
   db.exec(`CREATE UNIQUE INDEX inventory_depletion_reference_once ON inventory_movements(product_id,json_extract(body_json,'$.reference'))
    WHERE kind IN ('Dispense','Consume') AND json_extract(body_json,'$.reference') IS NOT NULL;`);
   db.prepare('INSERT INTO inventory_schema_migrations VALUES(4,?)').run(new Date(clock()).toISOString());
  }
  // The v1 initialization statement is idempotent; do not recreate its superseded index on reopen.
  db.exec('DROP INDEX IF EXISTS inventory_inbound_once');
  for(const p of products){
   db.prepare('INSERT OR IGNORE INTO inventory_locations VALUES(?,?)').run(p.clinicId,p.storeroomId);
   db.prepare('INSERT OR IGNORE INTO inventory_products VALUES(?,?)').run(p.id,JSON.stringify(p));
   db.prepare('INSERT OR IGNORE INTO inventory_jobs VALUES(?,?,0,NULL,NULL,NULL)').run(p.id,clock());
  }
  db.prepare('INSERT OR IGNORE INTO inventory_autonomy VALUES(1,?)').run(JSON.stringify(Autonomy.parse({monitoring:true,automaticCases:true,automaticPreparation:true,financialExecution:false,intervalSeconds:30})));
 }).immediate();
}

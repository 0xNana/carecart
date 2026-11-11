import Database from 'better-sqlite3';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { safetyProfile, type SafetyProfile } from '../near/safety-profile';
import {testnetProfile} from '../profiles/testnet';
import { SafetyOrderSchema, routeHash } from '../near/commitments';
import { digest } from '../intents/settlement';
import { parseAtomicAmount } from '../domain';
import { forecastQuantity } from './forecast';
import { LocalCatalogSchema, TestnetCatalogSchema, CatalogItemId, type LocalCatalog, type TestnetCatalog } from './v2-catalog';

const eventId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export const ProcurementPoId = z.string().regex(/^(?:mn|tn)-po-[a-f0-9]{56}$/);
const EventInput = z.object({ eventId, itemId: CatalogItemId }).strict();
const EventSchema = EventInput.extend({ issuedAt: z.iso.datetime() }).strict();
type InventoryEvent = z.infer<typeof EventSchema>;
const QuoteSchema = z.object({ id: z.string(), eventId, itemId: CatalogItemId, supplierId: z.string(),
  supplierAccount: z.string(), quantity: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  unitPriceAtomic: SafetyOrderSchema.shape.amount, amountAtomic: SafetyOrderSchema.shape.amount,
  profile: z.enum(['local-usdc-v2','testnet-ccusd-v2']), token: SafetyOrderSchema.shape.token, decimals: z.literal(6), asset: z.enum(['USDC','CCUSD']),
  destination: LocalCatalogSchema.shape.suppliers.element.shape.destination,
  issuedAt: z.iso.datetime(), expiresAt: z.iso.datetime(),
}).strict();
const OrderSchema = z.object({ eventId, quoteId: z.string(), quoteDigest: z.string(), invoiceReference: z.string(),
  decisionPolicy: z.literal('lowest-total-then-supplier-id-v1'),
  canonical: SafetyOrderSchema }).strict();
export type ProcurementOrder = z.infer<typeof OrderSchema>;
/** Local inventory runtime only. Prices, payees, token and routes remain in the trusted catalog. */
export interface InventoryQuoteSource {
 current(itemId:string):{onHand:number;reorderPoint:number;usageUnits:number};
 currentQuote(itemId:string,supplierId:string,leadTimeDays:number):{recommendedQuantity:number;leadTimeDemand:number};
 snapshot(eventId:string,itemId:string):{onHand:number;reorderPoint:number;usageUnits:number};
 quote(eventId:string,itemId:string,supplierId:string,leadTimeDays:number):{recommendedQuantity:number;leadTimeDemand:number;expiresAt:string};
}
function quoteRank(a: z.infer<typeof QuoteSchema>, b: z.infer<typeof QuoteSchema>) {
  return BigInt(a.amountAtomic) < BigInt(b.amountAtomic) ? -1 : BigInt(a.amountAtomic) > BigInt(b.amountAtomic) ? 1
    : a.supplierId < b.supplierId ? -1 : a.supplierId > b.supplierId ? 1 : 0;
}

/**
 * Explicit mainnet or testnet preparation domain, in its profile-bound v2 journal DB. Never runs the legacy
 * migrations/seed. Trusted catalog is supplied independently to each worker; DB hashes
 * detect changes but are not signatures or protection against compromise of both inputs.
 */
export class V2ProcurementStore {
  readonly profile: SafetyProfile;
  readonly fingerprint: string;
  private readonly db: Database.Database;
  private readonly catalog: LocalCatalog|TestnetCatalog;
  constructor(profile: SafetyProfile, trustedCatalog: unknown, private readonly inventorySource?:InventoryQuoteSource) {
    const bound = safetyProfile(profile);
    if(bound.profile.network==='testnet')testnetProfile(bound.profile);
    this.profile = Object.freeze(bound.profile);
    this.fingerprint = bound.fingerprint;
    if(inventorySource&&profile.network==='mainnet'&&(profile.vault!=='vault.local-ops.near'||!profile.databasePath.includes('/local-operations/')))
      throw new Error('Inventory preparation is local only; operational worker integration is not authorized');
    this.catalog = (profile.network==='testnet'?TestnetCatalogSchema:LocalCatalogSchema).parse(trustedCatalog);
    if(this.catalog.token!==profile.token)throw new Error('Catalog/profile token mismatch');
    if (this.catalog.suppliers.some((s) => [profile.vault, profile.token, profile.admin, profile.guardian, profile.treasury,
        profile.committer, profile.requester].includes(s.account)))
      throw new Error('Supplier accounts must be independent of vault authorities');
    mkdirSync(dirname(this.profile.databasePath), { recursive: true });
    this.db = new Database(this.profile.databasePath);
    try {
      if (this.table('purchase_orders') || this.table('inventory_items')) throw new Error('CCTEST database cannot be reused');
      for (const table of ['settlement_profile', 'commitment_profile']) {
        if (this.table(table)) {
          const row = this.db.prepare(`SELECT fingerprint FROM ${table} WHERE id=1`).get() as { fingerprint: string } | undefined;
          if (row && row.fingerprint !== this.fingerprint) throw new Error('Journal profile mismatch');
        }
      }
      chmodSync(this.profile.databasePath, 0o600);
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = FULL');
      this.db.exec(`CREATE TABLE IF NOT EXISTS v2_procurement_profile(id INTEGER PRIMARY KEY CHECK(id=1), fingerprint TEXT NOT NULL, catalog_hash TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS v2_procurement_records(kind TEXT NOT NULL,id TEXT NOT NULL,body_json TEXT NOT NULL,PRIMARY KEY(kind,id));
        CREATE TABLE IF NOT EXISTS v2_procurement_orders(po_id TEXT PRIMARY KEY,event_id TEXT UNIQUE NOT NULL,quote_id TEXT UNIQUE NOT NULL,body_json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS v2_procurement_observations(id INTEGER PRIMARY KEY,po_id TEXT NOT NULL,stage TEXT NOT NULL,body_json TEXT NOT NULL,observed_at TEXT NOT NULL);`);
      this.db.transaction(() => {
        const row = this.db.prepare('SELECT fingerprint,catalog_hash FROM v2_procurement_profile WHERE id=1').get() as
          { fingerprint: string; catalog_hash: string } | undefined;
        if (row && (row.fingerprint !== this.fingerprint || row.catalog_hash !== digest(this.catalog)))
          throw new Error('Procurement profile or trusted catalog mismatch');
        this.db.prepare('INSERT OR IGNORE INTO v2_procurement_profile VALUES(1,?,?)').run(this.fingerprint, digest(this.catalog));
        for (const item of this.catalog.items) this.seed('item', item.id, item);
        for (const supplier of this.catalog.suppliers) this.seed('supplier', supplier.id, supplier);
        for (const entry of this.catalog.entries) this.seed('catalog', `${entry.itemId}:${entry.supplierId}`, entry);
      }).immediate();
    } catch (error) { this.db.close(); throw error; }
  }
  close() { if (this.db.open) this.db.close(); }
  registeredInventory() {
    return this.catalog.items.map(item=>({...this.trusted('item',item.id,item),...(this.inventorySource?.current(item.id)??{})}));
  }
  registeredCatalog() {
    return {suppliers:this.catalog.suppliers.map(s=>({...this.trusted('supplier',s.id,s)})),
      entries:this.catalog.entries.map(e=>({...this.trusted('catalog',`${e.itemId}:${e.supplierId}`,e)}))};
  }
  inventoryForecast(id:unknown) {
    const itemId=CatalogItemId.parse(id);
    const trusted=this.trusted('item',itemId,this.catalog.items.find(i=>i.id===itemId));
    const item={...trusted,...(this.inventorySource?.current(itemId)??{})};
    return {item,usageWindowDays:30,suppliers:this.catalog.entries.filter(e=>e.itemId===itemId).map(e=>{
      const entry=this.trusted('catalog',`${itemId}:${e.supplierId}`,e);
      const supplier=this.trusted('supplier',e.supplierId,this.catalog.suppliers.find(s=>s.id===e.supplierId));
      return {supplierId:supplier.id,leadTimeDays:entry.leadTimeDays,
        ...(this.inventorySource?.currentQuote(itemId,supplier.id,entry.leadTimeDays)??forecastQuantity(item.onHand,item.reorderPoint,item.usageUnits,entry.leadTimeDays))};
    })};
  }
  private table(name: string) {
    return !!this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
  }
  private seed(kind: string, id: string, body: unknown) {
    this.db.prepare('INSERT OR IGNORE INTO v2_procurement_records VALUES(?,?,?)').run(kind, id, JSON.stringify(body));
  }
  private read(kind: string, id: string): unknown {
    const row = this.db.prepare('SELECT body_json FROM v2_procurement_records WHERE kind=? AND id=?').get(kind, id) as { body_json: string } | undefined;
    if (!row) throw new Error(`Unknown ${kind} record`);
    return JSON.parse(row.body_json);
  }
  private trusted<T>(kind: string, id: string, expected: T | undefined): T {
    if (!expected) throw new Error(`Unknown trusted ${kind}`);
    if (digest(this.read(kind, id)) !== digest(expected)) throw new Error(`Persisted ${kind} differs from trusted catalog`);
    return expected;
  }
  private event(id: string) {
    const event = EventSchema.parse(this.read('event', eventId.parse(id)));
    if (event.eventId !== id) throw new Error('Inventory event identity conflict');
    return event;
  }
  private expectedQuote(event: InventoryEvent, supplierId: string) {
    const item = this.trusted('item', event.itemId, this.catalog.items.find((i) => i.id === event.itemId));
    const supplier = this.trusted('supplier', supplierId, this.catalog.suppliers.find((s) => s.id === supplierId));
    const entryId = `${item.id}:${supplierId}`;
    const entry = this.trusted('catalog', entryId, this.catalog.entries.find((e) => e.itemId === item.id && e.supplierId === supplierId));
    const snapshot=this.inventorySource?.snapshot(event.eventId,event.itemId) ?? item;
    if (snapshot.onHand > snapshot.reorderPoint) throw new Error('No inventory reorder needed');
    const forecast = this.inventorySource?.quote(event.eventId,event.itemId,supplierId,entry.leadTimeDays) ?? forecastQuantity(item.onHand, item.reorderPoint, item.usageUnits, entry.leadTimeDays);
    if(!Number.isSafeInteger(forecast.recommendedQuantity)||forecast.recommendedQuantity<=0)throw new Error('Invalid inventory purchase quantity');
    const amount = parseAtomicAmount(BigInt(entry.unitPriceAtomic) * BigInt(forecast.recommendedQuantity));
    return QuoteSchema.parse({ id: `${this.profile.network==='testnet'?'tn':'mn'}-q-${digest([this.fingerprint, event.eventId, supplierId]).slice(0, 56)}`,
      eventId: event.eventId, itemId: item.id, supplierId, supplierAccount: supplier.account,
      quantity: forecast.recommendedQuantity, unitPriceAtomic: entry.unitPriceAtomic, amountAtomic: amount.toString(),
      profile: this.catalog.profile, token: this.catalog.token, decimals: this.catalog.decimals, asset: this.catalog.asset,
      destination: supplier.destination, issuedAt: event.issuedAt,
      expiresAt: 'expiresAt' in forecast ? forecast.expiresAt : new Date(Date.parse(event.issuedAt) + 7 * 86400000).toISOString(),
    });
  }
  private quotes(event: InventoryEvent) {
    return this.catalog.entries.filter((e) => e.itemId === event.itemId).map((entry) => {
      const expected = this.expectedQuote(event, entry.supplierId);
      if (digest(QuoteSchema.parse(this.read('quote', expected.id))) !== digest(expected))
        throw new Error('Persisted quote differs from trusted terms');
      return expected;
    }).sort(quoteRank);
  }
  inventoryEvent(input: unknown, now = new Date()) {
    const parsed = EventInput.parse(input);
    return this.db.transaction(() => {
      const exists = this.db.prepare("SELECT 1 FROM v2_procurement_records WHERE kind='event' AND id=?").get(parsed.eventId);
      if (exists) {
        const event = this.event(parsed.eventId);
        if (event.itemId !== parsed.itemId) throw new Error('Inventory event identity conflict');
        return { ...event, quotes: this.quotes(event) };
      }
      const event = EventSchema.parse({ ...parsed, issuedAt: now.toISOString() });
      const entries = this.catalog.entries.filter((e) => e.itemId === event.itemId);
      if (!entries.length) throw new Error('Unknown trusted inventory/catalog');
      const quotes = entries.map((entry) => this.expectedQuote(event, entry.supplierId)).sort(quoteRank);
      this.seed('event', event.eventId, event);
      for (const quote of quotes) this.seed('quote', quote.id, quote);
      return { ...event, quotes };
    }).immediate();
  }
  private construct(event: InventoryEvent, quote: z.infer<typeof QuoteSchema>): ProcurementOrder {
    const invoiceReference = `synthetic:${event.eventId}:${quote.id}`;
    const destination = quote.destination === 'Near' ? 'Near' : { Base: {
      route_id: quote.destination.Base.route_id, version: quote.destination.Base.version, route_hash: routeHash(quote.destination.Base),
    } };
    return OrderSchema.parse({ eventId: event.eventId, quoteId: quote.id, quoteDigest: digest(quote), invoiceReference,
      decisionPolicy: 'lowest-total-then-supplier-id-v1',
      canonical: { po_id: `${this.profile.network==='testnet'?'tn':'mn'}-po-${digest([this.fingerprint, event.eventId]).slice(0, 56)}`, profile: this.profile.network,
        supplier: quote.supplierAccount, token: quote.token, amount: quote.amountAtomic,
        invoice_digest: digest([this.fingerprint, event, quote, invoiceReference]), destination },
    });
  }
  /** Read-only, reconstructed domain snapshot for workflow capabilities; never payment authority. */
  eventSnapshot(id: string) {
    const event = this.event(id);
    const item = this.trusted('item', event.itemId, this.catalog.items.find((i) => i.id === event.itemId));
    const quotes = this.quotes(event);
    return { event, item:this.inventorySource?{...item,...this.inventorySource.snapshot(event.eventId,event.itemId)}:item, quotes, forecasts: quotes.map((quote) => {
      const entry = this.catalog.entries.find((e) => e.itemId === item.id && e.supplierId === quote.supplierId)!;
      return { supplierId: quote.supplierId, leadTimeDays: entry.leadTimeDays,
        ...(this.inventorySource?.quote(event.eventId,item.id,quote.supplierId,entry.leadTimeDays) ?? forecastQuantity(item.onHand, item.reorderPoint, item.usageUnits, entry.leadTimeDays)) };
    }) };
  }
  selectQuote(input: unknown, now = new Date()) {
    const { eventId: id } = z.object({ eventId }).strict().parse(input);
    return this.db.transaction(() => {
      const event = this.event(id);
      const existing = this.db.prepare('SELECT po_id FROM v2_procurement_orders WHERE event_id=?').get(id) as { po_id: string } | undefined;
      if (existing) return this.resolve(existing.po_id);
      const quotes = this.quotes(event);
      if (!quotes.length || quotes.some((q) => Date.parse(q.expiresAt) <= now.getTime())) throw new Error('Supplier quote expired');
      const order = this.construct(event, quotes[0]);
      const collision = this.db.prepare('SELECT 1 FROM v2_procurement_orders WHERE po_id=?').get(order.canonical.po_id);
      if (collision) throw new Error('Conflicting PO identifier');
      this.db.prepare('INSERT INTO v2_procurement_orders VALUES(?,?,?,?)').run(order.canonical.po_id, event.eventId, order.quoteId, JSON.stringify(order));
      return order;
    }).immediate();
  }
  resolve(id: unknown): ProcurementOrder {
    const poId = ProcurementPoId.parse(id);
    const row = this.db.prepare('SELECT event_id,quote_id,body_json FROM v2_procurement_orders WHERE po_id=?').get(poId) as
      { event_id: string; quote_id: string; body_json: string } | undefined;
    if (!row) throw new Error('Unknown procurement PO');
    const event = this.event(row.event_id);
    const quote = this.quotes(event)[0];
    if (!quote || quote.id !== row.quote_id) throw new Error('Persisted selection differs from deterministic decision');
    const expected = this.construct(event, quote);
    if (expected.canonical.po_id !== poId || digest(OrderSchema.parse(JSON.parse(row.body_json))) !== digest(expected))
      throw new Error('Conflicting PO identifier or immutable procurement fields');
    return expected;
  }
  quoteExpiry(poId: string) {
    const order = this.resolve(poId);
    return this.quotes(this.event(order.eventId)).find((q) => q.id === order.quoteId)!.expiresAt;
  }
  recordObservation(poId: string, stage: 'commit' | 'request' | 'reconcile', observation: unknown, now = new Date()) {
    this.resolve(poId);
    this.db.prepare('INSERT INTO v2_procurement_observations(po_id,stage,body_json,observed_at) VALUES(?,?,?,?)')
      .run(poId, stage, JSON.stringify(observation), now.toISOString());
  }
  inspect(poId: string) {
    const purchaseOrder = this.resolve(poId);
    const operations = this.table('backend_operations') ? this.db.prepare('SELECT operation_key,state,evidence FROM backend_operations WHERE operation_key IN (?,?)')
      .all(`commit_purchase_order:${poId}`, `request_payment:${poId}`) : [];
    const settlement = this.table('settlement_attempts') && this.table('settlement_source') ? this.db.prepare(`SELECT a.id,a.state,a.review_hash,a.evidence,s.evidence AS source_evidence
      FROM settlement_attempts a LEFT JOIN settlement_source s ON s.attempt_id=a.id WHERE a.po_id=?`).all(poId) : [];
    return { purchaseOrder, canonicalHash: digest(purchaseOrder.canonical), event: this.event(purchaseOrder.eventId), quote: QuoteSchema.parse(this.read('quote', purchaseOrder.quoteId)),
      operations, settlement, observations: this.db.prepare('SELECT stage,body_json,observed_at FROM v2_procurement_observations WHERE po_id=? ORDER BY id').all(poId),
      exceedsInitialDepositCeiling: BigInt(purchaseOrder.canonical.amount) > 5_000_000n,
      evidenceNotice: 'Saved observations are not independent receipt proofs; signing always rechecks canonical state.' };
  }
}

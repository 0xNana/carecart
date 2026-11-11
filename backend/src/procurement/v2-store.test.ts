import { afterEach, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { KeyPair } from 'near-api-js';
import { PROJECT_ROOT } from '../profiles/storage';
import { safetyProfile } from '../near/safety-profile';
import { NEAR_USDC, digest } from '../intents/settlement';
import { syntheticLocalCatalog } from './v2-catalog';
import { V2ProcurementStore } from './v2-store';

const clock = new Date('2026-11-03T12:00:00Z');
const directories: string[] = [];
const stores: V2ProcurementStore[] = [];
const mappings = ['a', 'b', 'c'].map((letter, i) => ({
  id: `mn-supplier-${i + 1}`, account: `supplier-${letter}.demo.near`, destination: 'Near',
}));
function fixtureProfile() {
  const parent = join(PROJECT_ROOT, 'backend/data/local-v2');
  mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(join(parent, 'p1-test-'));
  directories.push(directory);
  return safetyProfile({ version: 2, network: 'mainnet', rpcUrl: 'https://rpc.mainnet.near.org',
    vault: 'vault.demo.near', admin: 'admin.demo.near', guardian: 'guardian.demo.near', treasury: 'treasury.demo.near',
    committer: 'committer.demo.near', requester: 'requester.demo.near', token: NEAR_USDC, decimals: 6,
    committerPublicKey: KeyPair.fromRandom('ed25519').getPublicKey().toString(),
    requesterPublicKey: KeyPair.fromRandom('ed25519').getPublicKey().toString(),
    maxKeyAllowanceYocto: '20000000000000000000000', codeHash: '1'.repeat(44), databasePath: join(directory, 'state.sqlite'),
  }).profile;
}
function fixture() {
  const profile = fixtureProfile();
  const catalog = syntheticLocalCatalog(mappings);
  const store = new V2ProcurementStore(profile, catalog);
  stores.push(store);
  return { profile, catalog, store };
}
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

it('catalog projection cannot mutate trusted supplier or price configuration',()=>{
  const {store}=fixture();const projection=store.registeredCatalog();
  projection.suppliers[0].account='attacker.near';projection.entries[0].unitPriceAtomic='1';
  const trusted=store.registeredCatalog();
  expect(trusted.suppliers[0].account).toBe(mappings[0].account);
  expect(trusted.entries[0].unitPriceAtomic).not.toBe('1');
});

it('persists one inventory event, deterministic quotes, decision and canonical six-decimal PO across restart', () => {
  const { profile, catalog, store } = fixture();
  const input = { eventId: 'inventory-1', itemId: 'mn-item-1' };
  const event = store.inventoryEvent(input, clock);
  expect(event.quotes).toHaveLength(3);
  expect(event.quotes[0]).toMatchObject({ quantity: 10, amountAtomic: '1000000', token: NEAR_USDC, decimals: 6 });
  const selected = store.selectQuote({ eventId: input.eventId }, clock);
  expect(selected.canonical).toMatchObject({ profile: 'mainnet', supplier: mappings[0].account, token: NEAR_USDC,
    amount: '1000000', destination: 'Near' });
  expect(selected.canonical.invoice_digest).toMatch(/^[a-f0-9]{64}$/);
  expect(store.selectQuote({ eventId: input.eventId }, clock)).toEqual(selected);
  expect(store.inventoryEvent(input, clock)).toEqual(event);
  store.close();
  const reopened = new V2ProcurementStore(profile, catalog);
  stores.push(reopened);
  expect(reopened.resolve(selected.canonical.po_id)).toEqual(selected);
  expect(reopened.inspect(selected.canonical.po_id)).toMatchObject({ event: { eventId: 'inventory-1' }, purchaseOrder: selected });
  const db = new Database(profile.databasePath, { readonly: true });
  try { expect(db.prepare('SELECT count(*) FROM v2_procurement_orders').pluck().get()).toBe(1); }
  finally { db.close(); }
});

it('rejects an expired quote and conflicting inventory-event identity', () => {
  const { store } = fixture();
  store.inventoryEvent({ eventId: 'inventory-1', itemId: 'mn-item-1' }, clock);
  expect(() => store.inventoryEvent({ eventId: 'inventory-1', itemId: 'mn-item-2' }, clock)).toThrow(/conflict/);
  expect(() => store.selectQuote({ eventId: 'inventory-1' }, new Date(clock.getTime() + 8 * 86400000))).toThrow(/expired/);
});

it('rejects a quote changed after selection rather than changing payment authority', () => {
  const { profile, store } = fixture();
  const event = store.inventoryEvent({ eventId: 'inventory-1', itemId: 'mn-item-1' }, clock);
  const selected = store.selectQuote({ eventId: 'inventory-1' }, clock);
  const db = new Database(profile.databasePath);
  try {
    const changed = { ...event.quotes[0], amountAtomic: '4000000', supplierAccount: 'attacker.near' };
    db.prepare("UPDATE v2_procurement_records SET body_json=? WHERE kind='quote' AND id=?").run(JSON.stringify(changed), changed.id);
  } finally { db.close(); }
  expect(() => store.resolve(selected.canonical.po_id)).toThrow(/quote|trusted/);
});

it.each([
  { token: 'token.testnet' }, { decimals: 0 }, { asset: 'CCTEST' }, { profile: 'testnet-cctest' },
])('rejects CCTEST or incorrect mainnet catalog identity (%j)', (change) => {
  const { profile, catalog } = fixture();
  expect(() => new V2ProcurementStore(profile, { ...catalog, ...change })).toThrow();
});

it('rejects a wrong network/profile, legacy database and changed trusted registry', () => {
  const { profile, catalog } = fixture();
  expect(() => new V2ProcurementStore({ ...profile, network: 'testnet' }, catalog)).toThrow();
  expect(() => new V2ProcurementStore({ ...profile, token: 'token.testnet' }, catalog)).toThrow();
  expect(() => new V2ProcurementStore({ ...profile, databasePath: 'backend/data/testnet-smoke.sqlite' }, catalog)).toThrow();
  const legacyPath = join(dirname(profile.databasePath), 'legacy.sqlite');
  const legacy = new Database(legacyPath);
  legacy.exec('CREATE TABLE purchase_orders(id TEXT)'); legacy.close();
  expect(() => new V2ProcurementStore({ ...profile, databasePath: legacyPath }, catalog)).toThrow(/CCTEST/);
  const changed = structuredClone(catalog); changed.suppliers[0].account = 'changed.near';
  expect(() => new V2ProcurementStore(profile, changed)).toThrow(/catalog mismatch/);
});

it.each(['1.0000001', '0.100000', '0', '001', 100000])('rejects fractional, zero, noncanonical or numeric atomic prices (%s)', (price) => {
  const { profile, catalog } = fixture();
  expect(() => new V2ProcurementStore(profile, { ...catalog,
    entries: [{ ...catalog.entries[0], unitPriceAtomic: price }, ...catalog.entries.slice(1)] })).toThrow();
});

it.each([
  ['supplier', 'mn-supplier-1', { account: 'attacker.near' }],
  ['catalog', 'mn-item-1:mn-supplier-1', { unitPriceAtomic: '400000' }],
  ['item', 'mn-item-1', { usageUnits: 600000 }],
] as const)('rejects compromised persisted %s authority before generating quotes', (kind, id, change) => {
  const { profile, store } = fixture();
  const db = new Database(profile.databasePath);
  try {
    const row = db.prepare('SELECT body_json FROM v2_procurement_records WHERE kind=? AND id=?').get(kind, id) as { body_json: string };
    db.prepare('UPDATE v2_procurement_records SET body_json=? WHERE kind=? AND id=?').run(JSON.stringify({ ...JSON.parse(row.body_json), ...change }), kind, id);
  } finally { db.close(); }
  expect(() => store.inventoryEvent({ eventId: 'inventory-1', itemId: 'mn-item-1' }, clock)).toThrow(/trusted/);
});

it.each([{ amount: '4000000' }, { supplier: 'attacker.near' }, { token: 'token.testnet' }, { invoice_digest: 'b'.repeat(64) }])(
  'rejects a compromised PO instead of committing altered fields (%j)', (change) => {
    const { profile, store } = fixture();
    store.inventoryEvent({ eventId: 'inventory-1', itemId: 'mn-item-1' }, clock);
    const order = store.selectQuote({ eventId: 'inventory-1' }, clock);
    const db = new Database(profile.databasePath);
    try { db.prepare('UPDATE v2_procurement_orders SET body_json=? WHERE po_id=?').run(
      JSON.stringify({ ...order, canonical: { ...order.canonical, ...change } }), order.canonical.po_id); }
    finally { db.close(); }
    expect(() => store.resolve(order.canonical.po_id)).toThrow(/Conflicting PO/);
  });

it('does not let a compromised decision select another otherwise valid supplier quote', () => {
  const { profile, store } = fixture();
  const event = store.inventoryEvent({ eventId: 'inventory-1', itemId: 'mn-item-1' }, clock);
  const order = store.selectQuote({ eventId: 'inventory-1' }, clock);
  const other = event.quotes[1];
  const invoiceReference = `synthetic:${event.eventId}:${other.id}`;
  const forged = { ...order, quoteId: other.id, quoteDigest: digest(other), invoiceReference,
    canonical: { ...order.canonical, supplier: other.supplierAccount, amount: other.amountAtomic,
      invoice_digest: digest([store.fingerprint, { eventId: event.eventId, itemId: event.itemId, issuedAt: event.issuedAt }, other, invoiceReference]) } };
  const db = new Database(profile.databasePath);
  try { db.prepare('UPDATE v2_procurement_orders SET quote_id=?,body_json=? WHERE po_id=?').run(other.id, JSON.stringify(forged), order.canonical.po_id); }
  finally { db.close(); }
  expect(() => store.resolve(order.canonical.po_id)).toThrow(/selection|Conflicting PO/);
});

it('rejects arbitrary amount/recipient inputs, unregistered IDs and unknown supplier mappings', () => {
  const { store } = fixture();
  expect(() => store.inventoryEvent({ eventId: 'inventory-1', itemId: 'mn-item-1', amount: '4000000' }, clock)).toThrow();
  expect(() => store.selectQuote({ eventId: 'inventory-1', recipient: 'attacker.near' }, clock)).toThrow();
  expect(() => store.resolve('po-000001')).toThrow();
  expect(() => store.inventoryEvent({ eventId: 'inventory-1', itemId: 'mn-item-999' }, clock)).toThrow(/Unknown/);
  expect(() => syntheticLocalCatalog([{ ...mappings[0], id: 'mn-supplier-999' }, ...mappings.slice(1)])).toThrow(/Unknown/);
});

it('fails on a conflicting PO identifier instead of overwriting a different obligation', () => {
  const { profile, store } = fixture();
  store.inventoryEvent({ eventId: 'inventory-1', itemId: 'mn-item-1' }, clock);
  const order = store.selectQuote({ eventId: 'inventory-1' }, clock);
  store.inventoryEvent({ eventId: 'inventory-2', itemId: 'mn-item-1' }, clock);
  const collidingId = `mn-po-${digest([store.fingerprint, 'inventory-2']).slice(0, 56)}`;
  const db = new Database(profile.databasePath);
  try {
    db.prepare('INSERT INTO v2_procurement_orders VALUES(?,?,?,?)').run(collidingId, 'other-obligation', 'other-quote', JSON.stringify(order));
    expect(() => store.selectQuote({ eventId: 'inventory-2' }, clock)).toThrow(/Conflicting PO identifier/);
    expect(db.prepare('SELECT body_json FROM v2_procurement_orders WHERE po_id=?').pluck().get(collidingId)).toBe(JSON.stringify(order));
  } finally { db.close(); }
});

it('uses the same durable decision when two independently opened stores select the event', () => {
  const { profile, catalog, store } = fixture();
  store.inventoryEvent({ eventId: 'inventory-1', itemId: 'mn-item-1' }, clock);
  const another = new V2ProcurementStore(profile, catalog); stores.push(another);
  expect(another.selectQuote({ eventId: 'inventory-1' }, clock)).toEqual(store.selectQuote({ eventId: 'inventory-1' }, clock));
  const db = new Database(profile.databasePath, { readonly: true });
  try { expect(db.prepare('SELECT count(*) FROM v2_procurement_orders').pluck().get()).toBe(1); }
  finally { db.close(); }
});

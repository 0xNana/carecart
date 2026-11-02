import { afterEach, describe, expect, it } from 'vitest';
import { KeyPair } from 'near-api-js';
import { closeDatabase, openDatabase, type DatabaseHandle } from '../db';
import { seedSyntheticData } from '../seed';
import { assertRestrictedPermission, assertMatchingSecret, mapFreshSuppliers } from './setup-testnet';

let database: DatabaseHandle | undefined;
afterEach(() => { if (database) closeDatabase(database); database = undefined; });
describe('testnet backend preparation', () => {
  const permission = { FunctionCall: { receiver_id: 'vault.carecart.testnet', method_names: ['request_payment'], allowance: '250000000000000000000000' } };
  it('requires a funded exact-method key; rejects recovery and expanded permissions', () => {
    expect(() => assertRestrictedPermission(permission, 'request_payment')).not.toThrow();
    for (const bad of ['FullAccess', { FunctionCall: { ...permission.FunctionCall, receiver_id: 'rogue.carecart.testnet' } },
      { FunctionCall: { ...permission.FunctionCall, method_names: ['request_payment', 'approve_payment'] } },
      { FunctionCall: { ...permission.FunctionCall, allowance: null } }, { FunctionCall: { ...permission.FunctionCall, allowance: '0' } }]) {
      expect(() => assertRestrictedPermission(bad, 'request_payment')).toThrow('Restricted key permission mismatch');
    }
  });
  it('checks secret possession against the selected on-chain public key without exposing failures', () => {
    const key = KeyPair.fromRandom('ed25519');
    expect(() => assertMatchingSecret(key.toString(), key.getPublicKey().toString())).not.toThrow();
    expect(() => assertMatchingSecret('invalid-sensitive-input', key.getPublicKey().toString())).toThrow('Restricted key does not match');
    expect(() => assertMatchingSecret(key.toString(), KeyPair.fromRandom('ed25519').getPublicKey().toString())).toThrow('Restricted key does not match');
  });
  it('maps only the untouched synthetic fixture and preserves procurement/payment records', () => {
    database = openDatabase(':memory:'); seedSyntheticData(database);
    const before = database.prepare('SELECT * FROM purchase_orders').all();
    const payments = database.prepare('SELECT * FROM payments').all();
    mapFreshSuppliers(database);
    expect(database.prepare('SELECT near_account_id FROM suppliers ORDER BY id').pluck().all())
      .toEqual(['medsupply-a.carecart.testnet', 'medsupply-b.carecart.testnet']);
    expect(database.prepare('SELECT * FROM purchase_orders').all()).toEqual(before);
    expect(database.prepare('SELECT * FROM payments').all()).toEqual(payments);
    expect(() => mapFreshSuppliers(database!)).toThrow('Supplier mapping requires an untouched synthetic fixture');
  });
  it('refuses to remap a fixture that has a public commitment or recorded payment attempt', () => {
    database = openDatabase(':memory:'); seedSyntheticData(database);
    database.prepare("UPDATE purchase_orders SET commit_transaction_hash = 'public-receipt'").run();
    expect(() => mapFreshSuppliers(database!)).toThrow('Supplier mapping requires an untouched synthetic fixture');
    expect(database.prepare('SELECT near_account_id FROM suppliers').pluck().all()).toEqual([null, null]);
  });
});

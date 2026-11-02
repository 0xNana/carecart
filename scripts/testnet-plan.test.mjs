import test from 'node:test';
import assert from 'node:assert/strict';
import { ACCOUNTS, artifact, assertRestrictedKey, transactions } from './testnet-plan.mjs';

test('plan is fixed to supplied testnet accounts, explicit deposits and paused setup', () => {
  const file = { path: "/tmp/owner's builds/contract.wasm", sha256: 'reviewed-hash' };
  const rows = transactions({ vault: file, token: file });
  assert.equal(rows.length, 12);
  for (const row of rows) {
    assert.ok(Object.values(ACCOUNTS).includes(row.signer));
    assert.ok(Object.values(ACCOUNTS).includes(row.receiver));
    assert.match(row.command, /network-config testnet sign-with-keychain send$/);
    assert.equal(row.gasTgas, 100);
    assert.doesNotMatch(row.method, /request_payment|approve|crosschain|withdraw/);
  }
  assert.deepEqual(rows.filter((r) => r.method === 'set_paused').map((r) => r.args), [{ paused: true }]);
  assert.equal(rows.filter((r) => r.method === 'set_supplier_allowed').length, 2);
  assert.equal(rows.at(-1).args.amount, '10000');
  assert.match(rows[0].command, /owner'\\''s builds/);
  assert.equal(rows.filter((r) => r.depositNear === '0.01').length, 7);
});

test('key check rejects full access, extra methods, wrong receiver and unlimited allowance', () => {
  const make = (permission) => [{ public_key: 'ed25519:public', access_key: { permission } }];
  const good = { receiver_id: ACCOUNTS.vault, method_names: ['request_payment'], allowance: '250000000000000000000000' };
  assertRestrictedKey(make({ FunctionCall: good }), 'request_payment');
  for (const permission of ['FullAccess', { FunctionCall: { ...good, receiver_id: ACCOUNTS.rogue } },
    { FunctionCall: { ...good, method_names: ['request_payment', 'set_policy'] } },
    { FunctionCall: { ...good, allowance: null } }, { FunctionCall: { ...good, allowance: '0' } }]) {
    assert.throws(() => assertRestrictedKey(make(permission), 'request_payment'));
  }
});

test('artifact hash is derived from actual Wasm bytes; non-Wasm rejected', () => {
  assert.throws(() => artifact(Buffer.from('not wasm'), '/tmp/example'));
  const info = artifact(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]), '/tmp/minimal.wasm');
  assert.equal(info.sha256, '93a44bbb96c751218e4c00d479e4c14358122a389acca16205b1e4d0dc5f9476');
  assert.match(info.codeHash, /^[1-9A-HJ-NP-Za-km-z]{43,44}$/);
});

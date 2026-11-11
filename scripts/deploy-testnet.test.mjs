import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sourceManifest } from './testnet-source.mjs';
import { artifact, POLICY, TOKEN_METADATA } from './testnet-plan.mjs';

let fixtureId = 0;
/** Execute the real CLI module with fixture RPC, without subprocess/stdio dependencies.
 * Tests in this file are sequential; every process/global override is restored in finally.
 * This exercises CLI logic, not operating-system process startup or real network access.
 */
async function check(scenario, verify = false) {
  const directory = mkdtempSync(join(tmpdir(), 'carecart-plan-test-'));
  const original = { argv: process.argv, exitCode: process.exitCode, fetch: globalThis.fetch,
    log: console.log, error: console.error };
  const stdout = [], stderr = [];
  try {
    for (const name of ['carecart_vault.wasm', 'carecart_test_ft.wasm']) writeFileSync(join(directory, name), Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
    const source = sourceManifest();
    if (scenario === 'stale') source.files['rust-toolchain.toml'] = 'changed';
    writeFileSync(join(directory, 'source.json'), JSON.stringify(source));
    const codeHash = artifact(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]), '').codeHash;
    globalThis.fetch = async (_url, options) => {
      const {method, params} = JSON.parse(options.body);
      if (scenario === 'offline') throw new Error('fixture network unavailable');
      let result;
      if (method === 'status') result = {chain_id: scenario === 'mainnet' ? 'mainnet' : 'testnet'};
      else if (params.request_type === 'call_function') {
        const args = JSON.parse(Buffer.from(params.args_base64, 'base64').toString());
        const values = {
          ft_metadata: TOKEN_METADATA, ft_total_supply: '1000000',
          ft_balance_of: args.account_id === 'vault.carecart.testnet' ? '10000' : scenario === 'tokenvalid' ? '1000000' : '990000',
          storage_balance_bounds: {min: '1250000000000000000000', max: '1250000000000000000000'},
          storage_balance_of: {total: '1250000000000000000000', available: '0'},
          get_admin: 'admin.carecart.testnet', get_policy: POLICY,
          is_paused: true, get_commit_storage_reserve: '100000000000000000000000',
          is_supplier_allowed: args.supplier_id !== 'rogue.carecart.testnet', is_po_committer: true
        };
        result = {result: [...Buffer.from(JSON.stringify(values[params.method_name]))]};
      }
      else if (params.request_type === 'view_access_key_list') result = {keys: [{public_key: 'ed25519:public', access_key: {permission: {FunctionCall: {
        receiver_id: 'vault.carecart.testnet', method_names: [params.account_id.startsWith('agent.') ? 'request_payment' : 'commit_purchase_order'], allowance: '250000000000000000000000'
      }}}}]};
      else result = {amount: scenario === 'underfunded' ? '0' : '2500000000000000000000000', locked: '0', storage_usage: 1000,
        code_hash: ['configured', 'tokenvalid'].includes(scenario) ? codeHash : scenario === 'deployed' ? 'unexpected-code' : '11111111111111111111111111111111', block_height: 1};
      return new Response(JSON.stringify({result}), {status: 200});
    };
    console.log = (...values) => stdout.push(values.join(' '));
    console.error = (...values) => stderr.push(values.join(' '));
    process.exitCode = 0;
    process.argv = ['node', 'scripts/deploy-testnet.mjs', ...(verify ? [verify === 'token' ? '--verify-token' : '--verify', '--artifacts', directory] : ['--artifacts', directory])];
    await import(new URL(`./deploy-testnet.mjs?fixture=${fixtureId++}`, import.meta.url));
    return { status: process.exitCode, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
  } finally {
    process.argv = original.argv;
    process.exitCode = original.exitCode;
    globalThis.fetch = original.fetch;
    console.log = original.log;
    console.error = original.error;
    rmSync(directory, { recursive: true, force: true });
  }
}

test('preflight works with mocked RPC and fails closed on wrong network or missing RPC', async () => {
  const good = await check('fresh');
  assert.equal(good.status, 0, good.stderr);
  const plan = JSON.parse(good.stdout);
  assert.equal(plan.status, 'PROPOSAL_ONLY_NOT_AUTHORIZED');
  assert.equal(plan.transactions.length, 12);
  assert.deepEqual(plan.blockers, []);
  for (const scenario of ['mainnet', 'offline']) assert.equal((await check(scenario)).status, 1);
});

test('stale sources, existing code and insufficient funding stop a fresh deployment plan', async () => {
  assert.equal((await check('stale')).status, 1);
  for (const scenario of ['deployed', 'underfunded']) {
    const response = await check(scenario);
    assert.equal(response.status, 2, response.stderr);
    assert.ok(JSON.parse(response.stdout).blockers.length > 0);
  }
});

test('post-deploy verification rejects undeployed or unexpected code before claiming success', async () => {
  for (const scenario of ['fresh', 'deployed']) {
    const response = await check(scenario, true);
    assert.equal(response.status, 1);
    assert.match(response.stderr, /code hash mismatch/);
    assert.equal(response.stdout, '');
  }
});

test('staged verification accepts only the expected token and initial paused setup', async () => {
  const token = await check('tokenvalid', 'token');
  assert.equal(token.status, 0, token.stderr);
  assert.equal(JSON.parse(token.stdout).result, 'verified-initial-test-token');
  const setup = await check('configured', true);
  assert.equal(setup.status, 0, setup.stderr);
  assert.equal(JSON.parse(setup.stdout).result, 'verified-initial-paused-setup');
  assert.equal((await check('configured', 'token')).status, 1, 'Post-funding state must not be mistaken for initial token state');
});

test('fixture execution restores process and network hooks after both success and failure', async () => {
  const original = { argv: process.argv, exitCode: process.exitCode, fetch: globalThis.fetch,
    log: console.log, error: console.error };
  for (const scenario of ['fresh', 'offline']) {
    await check(scenario);
    assert.equal(process.argv, original.argv);
    assert.equal(process.exitCode, original.exitCode);
    assert.equal(globalThis.fetch, original.fetch);
    assert.equal(console.log, original.log);
    assert.equal(console.error, original.error);
  }
});

import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { parse } from 'dotenv';
import { KeyPair, type KeyPairString } from 'near-api-js';
import { closeDatabase, openDatabase, type DatabaseHandle } from '../db';
import { seedSyntheticData } from '../seed';

const ROOT = resolve(__dirname, '../../..');
const RPC = 'https://test.rpc.fastnear.com';
const VAULT = 'vault.carecart.testnet';
const TOKEN = 'token.carecart.testnet';
const ENV_PATH = resolve(ROOT, '.env.testnet');
const DB_PATH = resolve(ROOT, 'backend/data/testnet-smoke.sqlite');
const ROLES = [
  { accountId: 'committer.carecart.testnet', method: 'commit_purchase_order', env: 'PO_COMMITTER_PRIVATE_KEY' },
  { accountId: 'agent.carecart.testnet', method: 'request_payment', env: 'AGENT_FC_PRIVATE_KEY' },
] as const;
interface AccessKey { public_key: string; access_key: { permission: unknown } }
let phase = 'arguments';

export function assertRestrictedPermission(permission: unknown, method: string): void {
  const value = permission as { FunctionCall?: { receiver_id?: string; method_names?: string[]; allowance?: string | null } } | null;
  const fc = value && typeof value === 'object' ? value.FunctionCall : null;
  if (!fc || fc.receiver_id !== VAULT || fc.method_names?.length !== 1 || fc.method_names[0] !== method
    || typeof fc.allowance !== 'string' || !/^[0-9]+$/.test(fc.allowance) || BigInt(fc.allowance) <= 0n) {
    throw new Error('Restricted key permission mismatch');
  }
}

export function assertMatchingSecret(secret: string, publicKey: string): void {
  try {
    if (!secret.startsWith('ed25519:')) throw new Error();
    const pair = KeyPair.fromString(secret as KeyPairString);
    const message = Buffer.from('CareCart local restricted-key readiness check; not a transaction or NEP-413 authorization');
    if (pair.getPublicKey().toString() !== publicKey || !pair.verify(message, pair.sign(message).signature)) throw new Error();
  } catch { throw new Error('Restricted key does not match'); }
}

export function mapFreshSuppliers(database: DatabaseHandle): void {
  database.transaction(() => {
    const suppliers = database.prepare('SELECT id, display_name, near_account_id, data_origin FROM suppliers ORDER BY id').all();
    const expected = [
      { id: 'supplier-000001', display_name: 'Synthetic Demo Supplier Alpha', near_account_id: null, data_origin: 'synthetic' },
      { id: 'supplier-000002', display_name: 'Synthetic Demo Supplier Beta', near_account_id: null, data_origin: 'synthetic' },
    ];
    const committed = database.prepare("SELECT 1 FROM purchase_orders WHERE commit_transaction_hash IS NOT NULL OR status <> 'draft' LIMIT 1").get();
    const attempted = database.prepare("SELECT 1 FROM payments WHERE status <> 'not_requested' OR request_transaction_hash IS NOT NULL OR request_id IS NOT NULL LIMIT 1").get();
    const orders = database.prepare('SELECT count(*) FROM purchase_orders').pluck().get();
    if (JSON.stringify(suppliers) !== JSON.stringify(expected) || committed || attempted || orders !== 1) {
      throw new Error('Supplier mapping requires an untouched synthetic fixture');
    }
    database.prepare('UPDATE suppliers SET near_account_id = ? WHERE id = ?').run('medsupply-a.carecart.testnet', 'supplier-000001');
    database.prepare('UPDATE suppliers SET near_account_id = ? WHERE id = ?').run('medsupply-b.carecart.testnet', 'supplier-000002');
  })();
}

async function rpc<T>(method: string, params: unknown): Promise<T> {
  const response = await fetch(RPC, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 'testnet-backend-readiness', method, params }) });
  if (!response.ok) throw new Error('Public testnet RPC unavailable');
  const payload = await response.json() as { error?: unknown; result?: T };
  if (payload.error || payload.result === undefined) throw new Error('Public testnet RPC rejected readiness query');
  return payload.result;
}
async function view<T>(account_id: string, method_name: string, args = {}): Promise<T> {
  const response = await rpc<{ result: number[] }>('query', { request_type: 'call_function', finality: 'final', account_id, method_name,
    args_base64: Buffer.from(JSON.stringify(args)).toString('base64') });
  return JSON.parse(Buffer.from(response.result).toString('utf8')) as T;
}
function writePrivateFile(path: string, content: string) {
  const fd = openSync(path, 'wx', 0o600);
  try { writeFileSync(fd, content); fsyncSync(fd); } finally { closeSync(fd); }
}
function readKey(accountId: string, publicKey: string): string {
  const result = spawnSync('python3', [resolve(ROOT, 'scripts/read-restricted-testnet-key.py')], {
    input: JSON.stringify({ accountId, publicKey }), stdio: ['pipe', 'ignore', 'pipe', 'pipe'], timeout: 60000, maxBuffer: 65536,
  });
  // Never log child stdout/stderr/output, even on failure.
  if (result.error || result.status !== 0 || !result.output[3]) throw new Error('Restricted keychain lookup failed; no credentials were printed');
  try {
    const value = JSON.parse(result.output[3].toString()) as { privateKey: string };
    assertMatchingSecret(value.privateKey, publicKey);
    return value.privateKey;
  } catch { throw new Error('Restricted keychain credential validation failed'); }
}

async function main() {
  const mode = process.argv[2];
  if (process.argv.length !== 3 || !['--configure', '--check'].includes(mode)) throw new Error('Use --configure once, or --check for read-only readiness');
  phase = 'public testnet deployment and policy checks';
  if ((await rpc<{ chain_id: string }>('status', [])).chain_id !== 'testnet') throw new Error('RPC must report testnet');
  const review = JSON.parse(readFileSync(resolve(ROOT, 'docs/testnet-deployment-plan.json'), 'utf8'));
  for (const [account_id, role] of [[VAULT, 'vault'], [TOKEN, 'token']]) {
    const state = await rpc<{ code_hash: string }>('query', { request_type: 'view_account', finality: 'final', account_id });
    if (state.code_hash !== review.artifacts[role].codeHash) throw new Error('Deployed code differs from the reviewed artifacts');
  }
  const metadata = await view<{ symbol: string; decimals: number }>(TOKEN, 'ft_metadata');
  if (metadata.symbol !== 'CCTEST' || metadata.decimals !== 0 || await view(VAULT, 'get_admin') !== 'admin.carecart.testnet') throw new Error('Test token or admin mismatch');
  const policy = await view<{ token_id: string }>(VAULT, 'get_policy');
  if (policy.token_id !== TOKEN) throw new Error('Vault policy token mismatch');
  if (await view(VAULT, 'is_po_committer', { account_id: 'committer.carecart.testnet' }) !== true
    || BigInt(await view<string>(VAULT, 'get_commit_storage_reserve')) <= 0n) throw new Error('Committer role or storage reserve is not ready');
  for (const supplier_id of ['medsupply-a.carecart.testnet', 'medsupply-b.carecart.testnet']) {
    if (await view(VAULT, 'is_supplier_allowed', { supplier_id }) !== true
      || await view(TOKEN, 'storage_balance_of', { account_id: supplier_id }) === null) throw new Error('Supplier allowlist or token storage is not ready');
  }
  const paused = await view<boolean>(VAULT, 'is_paused');
  const selected: Array<{ accountId: string; method: string; publicKey: string; env: string }> = [];
  phase = 'public restricted-key permission checks';
  for (const role of ROLES) {
    const { keys } = await rpc<{ keys: AccessKey[] }>('query', { request_type: 'view_access_key_list', finality: 'final', account_id: role.accountId });
    const matches = keys.filter((key) => {
      try { assertRestrictedPermission(key.access_key.permission, role.method); return key.public_key.startsWith('ed25519:'); }
      catch { return false; }
    });
    if (matches.length !== 1) throw new Error('Expected exactly one funded restricted Ed25519 key per role');
    selected.push({ ...role, publicKey: matches[0].public_key });
  }
  if (mode === '--configure') {
    phase = 'initial paused state and unused preparation paths';
    if (!paused) throw new Error('Initial preparation requires the vault to remain paused');
    if (existsSync(ENV_PATH) || existsSync(DB_PATH)) throw new Error('Preparation files already exist; use --check, never overwrite/reset a live testnet database');
    if (await view(VAULT, 'get_purchase_order', { po_id: 'po-000001' }) !== null) throw new Error('Seed PO ID is already committed; stop and reconcile before creating a database');
    const secrets = selected.map((role) => { phase = `restricted keychain lookup for ${role.accountId}`; return readKey(role.accountId, role.publicKey); });
    phase = 'new synthetic database and trusted supplier mapping';
    mkdirSync(dirname(DB_PATH), { recursive: true, mode: 0o700 });
    const fd = openSync(DB_PATH, 'wx', 0o600); closeSync(fd);
    const database = openDatabase(DB_PATH);
    try { seedSyntheticData(database); mapFreshSuppliers(database); } finally { closeDatabase(database); }
    const environment = [
      '# Local testnet backend only. Restricted keys; never copy to web, Git or chat.',
      'NEAR_NETWORK=testnet', `NEAR_RPC_URL=${RPC}`, `VAULT_ID=${VAULT}`, `TEST_TOKEN_ID=${TOKEN}`, 'VAULT_ASSET_CODE=CCTEST',
      'PO_COMMITTER_ACCOUNT_ID=committer.carecart.testnet', `PO_COMMITTER_PRIVATE_KEY=${secrets[0]}`,
      'AGENT_ACCOUNT_ID=agent.carecart.testnet', `AGENT_FC_PRIVATE_KEY=${secrets[1]}`,
      'PORT=3101', `CARECART_DATABASE_PATH=${DB_PATH}`, 'ONECLICK_PREVIEW_ENABLED=false', '',
    ].join('\n');
    phase = 'owner-only testnet environment write';
    writePrivateFile(ENV_PATH, environment);
  }
  phase = 'prepared environment and database verification';
  const stat = lstatSync(ENV_PATH);
  if (!stat.isFile() || (stat.mode & 0o077) !== 0) throw new Error('Testnet env must be a regular file readable only by its owner');
  const environment = parse(readFileSync(ENV_PATH));
  if (environment.NEAR_NETWORK !== 'testnet' || environment.NEAR_RPC_URL !== RPC || environment.VAULT_ID !== VAULT
    || environment.TEST_TOKEN_ID !== TOKEN || environment.CARECART_DATABASE_PATH !== DB_PATH
    || environment.ONECLICK_PREVIEW_ENABLED !== 'false') throw new Error('Testnet environment configuration mismatch');
  for (const role of selected) assertMatchingSecret(environment[role.env] ?? '', role.publicKey);
  const database = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  let suppliers;
  try {
    suppliers = database.prepare('SELECT id, near_account_id FROM suppliers ORDER BY id').all();
    if (JSON.stringify(suppliers) !== JSON.stringify([
      { id: 'supplier-000001', near_account_id: 'medsupply-a.carecart.testnet' },
      { id: 'supplier-000002', near_account_id: 'medsupply-b.carecart.testnet' },
    ])) throw new Error('Trusted supplier mappings differ from the prepared database');
  } finally { database.close(); }
  console.log(JSON.stringify({ result: 'testnet-backend-prepared', network: 'testnet', envPath: ENV_PATH, envMode: '0600',
    databasePath: DB_PATH, signers: selected.map(({ accountId, method, publicKey }) => ({ accountId, method, publicKey, configured: true })),
    suppliers, paused, balanceCctest: await view(TOKEN, 'ft_balance_of', { account_id: VAULT }),
    transactionsSent: 0, browserWalletVerified: false, next: 'Start backend with the provided env-file command. Connect the testnet admin wallet; review resume/payment separately.' }, null, 2));
}

if (require.main === module) main().catch(() => {
  console.error(`Testnet preparation failed during ${phase}. No secret values are printed. Use --check after successful setup; never overwrite/reset a live testnet database.`);
  process.exitCode = 1;
});

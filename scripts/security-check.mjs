import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readlinkSync } from 'node:fs';
import { resolve } from 'node:path';

// Heuristic release guard, not a guarantee that every possible secret format is detectable.
// Reports only locations/rule names, never matched values. Git operations are read-only.
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const root = git('rev-parse', '--show-toplevel').trim();
const files = [...new Set(git('ls-files', '--cached', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean))];
const patterns = [
  ['near_private_key', /\bed25519:[1-9A-HJ-NP-Za-km-z]{80,90}\b/g],
  ['near_pq_private_key', /\bml-dsa-65:[1-9A-HJ-NP-Za-km-z]{5000,}\b/g],
  ['near_secp_private_key', /\bsecp256k1:[1-9A-HJ-NP-Za-km-z]{40,45}\b/g],
  ['private_key_block', /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g],
  ['github_token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{70,})\b/g],
  ['openai_key', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{40,}\b/g],
  ['aws_access_key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['mnemonic_assignment', /\b(?:seed[_-]?phrase|mnemonic)\s*[:=]\s*["'](?:[a-z]{3,}\s+){11,23}[a-z]{3,}["']/gi],
];
const findings = [];
let textFiles = 0;
function scan(buffer, location) {
  if (buffer.includes(0)) return;
  const content = buffer.toString('utf8');
  for (const [rule, pattern] of patterns) {
    pattern.lastIndex = 0;
    for (const match of content.matchAll(pattern)) {
      findings.push({ location, line: content.slice(0, match.index).split('\n').length, rule });
    }
  }
}
for (const file of files) {
  if (!existsSync(resolve(root, file))) continue; // Tracked deletions are not release files.
  if ((/(^|\/)\.env(?:$|\.)/.test(file) && file !== '.env.example') || /(?:\.pem|\.key)$/.test(file) || /(^|\/)\.near-credentials\//.test(file)) {
    findings.push({ location: file, rule: 'credential_file_in_source' });
  }
  const path = resolve(root, file);
  // A Git symlink stores its target text; do not follow it into local credential directories.
  const buffer = lstatSync(path).isSymbolicLink() ? Buffer.from(readlinkSync(path)) : readFileSync(path);
  if (!buffer.includes(0)) textFiles++;
  scan(buffer, file);
  if (/^(backend|web)\/src\//.test(file) && /\b(?:place_bid|highest_bidder|AuctionContract)\b/.test(buffer.toString())) findings.push({ location: file, rule: 'auction_scaffold' });
  if (/^contracts\/.*\/src\//.test(file) && /\b(?:place_bid|highest_bidder|AuctionContract)\b/.test(buffer.toString())) findings.push({ location: file, rule: 'auction_scaffold' });
  if (/^\.github\/workflows\/.*\.ya?ml$/.test(file) && /(?:near\s+contract\s+deploy|cargo\s+near\s+deploy)/.test(buffer.toString())) findings.push({ location: file, rule: 'automatic_deployment_workflow' });
  if (/^web\/src\//.test(file) && /process\.env\.NEXT_PUBLIC_[A-Z0-9_]*(?:PRIVATE_KEY|SECRET|API_KEY|JWT)/.test(buffer.toString())) findings.push({ location: file, rule: 'browser_secret_environment' });
}

// Scan every reachable historical blob, including files deleted from the current source.
const objects = git('rev-list', '--objects', '--all').trim().split('\n').filter(Boolean);
let historyBlobs = 0;
for (const object of objects) {
  const [oid, ...path] = object.split(' ');
  if (git('cat-file', '-t', oid).trim() !== 'blob') continue;
  historyBlobs++;
  scan(execFileSync('git', ['cat-file', 'blob', oid], { maxBuffer: 32 * 1024 * 1024 }), `history:${oid}:${path.join(' ')}`);
}
const sorted = (value) => JSON.stringify(Object.entries(value || {}).sort(([a], [b]) => a.localeCompare(b)));
for (const project of ['backend', 'web']) {
  const policy = readFileSync(resolve(root, project, '.npmrc'), 'utf8').split('\n')
    .filter((line) => /^\s*ignore-scripts\s*=/.test(line)).at(-1);
  if (!/^\s*ignore-scripts\s*=\s*true\s*$/.test(policy || '')) findings.push({ location: `${project}/.npmrc`, rule: 'install_scripts_not_blocked' });
  const pkg = JSON.parse(readFileSync(resolve(root, project, 'package.json')));
  const lock = JSON.parse(readFileSync(resolve(root, project, 'package-lock.json')));
  if (pkg.packageManager !== 'npm@12.2.1' || lock.lockfileVersion !== 3
    || sorted(pkg.dependencies) !== sorted(lock.packages[''].dependencies)
    || sorted(pkg.devDependencies) !== sorted(lock.packages[''].devDependencies)) findings.push({ location: project, rule: 'package_manager_or_lock_mismatch' });
}
for (const file of files.filter((file) => /^(?:(?:backend|web)\/)?(?:yarn\.lock|pnpm-lock\.yaml|bun\.lockb?)$/.test(file))) findings.push({ location: file, rule: 'competing_js_lockfile' });
for (const file of ['.env', 'web/.env.local', 'backend/data/security.sqlite-wal', 'backend/data/security.sqlite-shm']) {
  try { execFileSync('git', ['check-ignore', '--quiet', file]); }
  catch { findings.push({ location: file, rule: 'sensitive_generated_file_not_ignored' }); }
}
const example = readFileSync(resolve(root, '.env.example'), 'utf8');
if (!/^NEAR_NETWORK=testnet$/m.test(example) || !/^ONECLICK_PREVIEW_ENABLED=false$/m.test(example)) findings.push({ location: '.env.example', rule: 'unsafe_default_network_or_preview' });
for (const line of example.split('\n')) {
  if (/^[A-Z0-9_]*(?:PRIVATE_KEY|API_KEY|JWT|PASSWORD|SECRET)=.+/.test(line)) findings.push({ location: '.env.example', rule: 'nonempty_example_credential' });
}
console.log(JSON.stringify({ result: findings.length ? 'failed' : 'passed', scope: 'current non-ignored source and reachable Git history',
  textFiles, historyBlobs, findings, limitation: 'Pattern scan plus release-policy checks; not a cryptographic proof or a replacement for credential rotation if a leak is found.' }, null, 2));
if (findings.length) process.exitCode = 1;

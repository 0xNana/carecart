import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, relative } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
export function sourceManifest() {
  const files = ['rust-toolchain.toml', 'contracts/Cargo.toml', 'contracts/Cargo.lock'];
  function collect(directory) {
    for (const entry of readdirSync(resolve(root, directory), { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) collect(path);
      else if (entry.isFile()) files.push(path);
      else throw new Error(`Unexpected link or special source file: ${path}`);
    }
  }
  for (const contract of ['carecart-vault', 'test-ft']) {
    files.push(`contracts/${contract}/Cargo.toml`);
    collect(`contracts/${contract}/src`);
  }
  return { algorithm: 'sha256', files: Object.fromEntries(files.sort().map((path) =>
    [path, createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex')])) };
}
if (process.argv[1] && relative(root, resolve(process.argv[1])) === 'scripts/testnet-source.mjs') {
  if (process.argv.length !== 3 || process.argv[2] !== '--write') throw new Error('Usage: node scripts/testnet-source.mjs --write (after building both artifacts)');
  writeFileSync(resolve(root, 'artifacts/testnet/source.json'), JSON.stringify(sourceManifest(), null, 2) + '\n');
}

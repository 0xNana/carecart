import { mkdirSync, mkdtempSync, rmSync, symlinkSync, linkSync, writeFileSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { assertMainnetDatabasePath, MAINNET_DATABASE_PATH, PROJECT_ROOT } from './storage';

describe('mainnet state path isolation', () => {
  it('rejects traversal and memory aliases', () => {
    expect(() => assertMainnetDatabasePath(MAINNET_DATABASE_PATH)).not.toThrow();
    for (const path of [':memory:', '/tmp/carecart.sqlite', 'backend/data/mainnet-usdc-v2/../testnet-smoke.sqlite'])
      expect(() => assertMainnetDatabasePath(path)).toThrow();
  });
  it('rejects symlinks, dangling symlinks, directory links and hardlinks', () => {
    const parent = join(PROJECT_ROOT, 'backend/data/mainnet-usdc-v2');
    mkdirSync(parent, { recursive: true });
    const directory = mkdtempSync(join(parent, 'path-test-'));
    const external = mkdtempSync(join(tmpdir(), 'carecart-mn01-links-'));
    try {
      const target = join(external, 'legacy.sqlite');
      writeFileSync(target, 'isolated test fixture');
      symlinkSync(target, join(directory, 'linked.sqlite'));
      symlinkSync(join(external, 'absent.sqlite'), join(directory, 'dangling.sqlite'));
      symlinkSync(external, join(directory, 'directory'));
      // Keep the hardlink on the same filesystem as the project.
      const original = join(directory, 'original.sqlite');
      writeFileSync(original, 'isolated test fixture');
      linkSync(original, join(directory, 'hard.sqlite'));
      for (const name of ['linked.sqlite', 'dangling.sqlite', 'directory/legacy.sqlite', 'hard.sqlite'])
        expect(() => assertMainnetDatabasePath(join(directory, name))).toThrow(/links/);
    } finally {
      rmSync(directory, { recursive: true });
      rmSync(external, { recursive: true });
      try { rmdirSync(parent); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOTEMPTY') throw error;
      }
    }
  });
});

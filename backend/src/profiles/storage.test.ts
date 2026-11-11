import { mkdirSync, mkdtempSync, rmSync, symlinkSync, linkSync, writeFileSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { assertLocalV2DatabasePath, assertPrototypeProfile, LOCAL_V2_DATABASE_PATH, PROJECT_ROOT } from './storage';

describe('local-v2 state path isolation', () => {
  it('rejects traversal and memory aliases', () => {
    expect(() => assertLocalV2DatabasePath(LOCAL_V2_DATABASE_PATH)).not.toThrow();
    for (const path of [':memory:', '/tmp/carecart.sqlite', 'backend/data/local-v2/../testnet-smoke.sqlite'])
      expect(() => assertLocalV2DatabasePath(path)).toThrow();
  });
  it('rejects symlinks, dangling symlinks, directory links and hardlinks', () => {
    const parent = join(PROJECT_ROOT, 'backend/data/local-v2');
    mkdirSync(parent, { recursive: true });
    const directory = mkdtempSync(join(parent, 'path-test-'));
    const external = mkdtempSync(join(tmpdir(), 'carecart-v2-links-'));
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
        expect(() => assertLocalV2DatabasePath(join(directory, name))).toThrow(/links/);
    } finally {
      rmSync(directory, { recursive: true });
      rmSync(external, { recursive: true });
      try { rmdirSync(parent); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOTEMPTY') throw error;
      }
    }
  });
  it('rejects non-testnet-cctest prototype profiles', () => {
    expect(() => assertPrototypeProfile({})).not.toThrow();
    for (const environment of [{ NEAR_NETWORK: 'mainnet' }, { CARECART_PROFILE: 'local-v2' }, { CARECART_PROFILE: '' }])
      expect(() => assertPrototypeProfile(environment)).toThrow();
    expect(() => assertPrototypeProfile({ CARECART_DATABASE_PATH: join(PROJECT_ROOT, 'backend/data/local-v2/carecart.sqlite') })).toThrow();
  });
});

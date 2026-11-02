import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { startServer } from '../server';

afterEach(() => vi.unstubAllEnvs());
it('rejects prototype mainnet startup before creating or seeding any database', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'carecart-mn01-runtime-'));
  const path = join(directory, 'must-not-exist.sqlite');
  try {
    vi.stubEnv('NEAR_NETWORK', 'mainnet');
    vi.stubEnv('CARECART_DATABASE_PATH', path);
    await expect(startServer()).rejects.toThrow(/testnet-cctest only/);
    expect(existsSync(path)).toBe(false);
  } finally { rmSync(directory, { recursive: true }); }
});

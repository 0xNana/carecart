import { lstatSync, realpathSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';

export const PROJECT_ROOT = resolve(__dirname, '../../..');
export const MAINNET_DATABASE_PATH = 'backend/data/mainnet-usdc-v2/carecart.sqlite';
const MAINNET_DIRECTORY = resolve(PROJECT_ROOT, 'backend/data/mainnet-usdc-v2');

export function assertMainnetDatabasePath(path: string): void {
  const absolute = resolve(PROJECT_ROOT, path);
  const suffix = relative(MAINNET_DIRECTORY, absolute);
  if (!suffix || suffix.startsWith(`..${sep}`) || suffix === '..' || !suffix.endsWith('.sqlite'))
    throw new Error('Mainnet state requires its dedicated mainnet-usdc-v2 directory');
  // A normalized path must not hide a link back to a legacy database or directory.
  for (let cursor = absolute; ; cursor = dirname(cursor)) {
    try {
      const stat = lstatSync(cursor);
      if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink > 1))
        throw new Error('Mainnet database links are forbidden');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (dirname(cursor) === cursor) break;
  }
}

export function isMainnetDatabasePath(path: string): boolean {
  if (path.split(/[\\/]/).includes('mainnet-usdc-v2')) return true;
  try { return realpathSync(path).split(/[\\/]/).includes('mainnet-usdc-v2'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return false;
  }
}

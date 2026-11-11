import { lstatSync, realpathSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';

export const PROJECT_ROOT = resolve(__dirname, '../../..');
export const LOCAL_V2_DATABASE_PATH = 'backend/data/local-v2/carecart.sqlite';
const LOCAL_V2_DIRECTORY = resolve(PROJECT_ROOT, 'backend/data/local-v2');

export function assertLocalV2DatabasePath(path: string): void {
  const absolute = resolve(PROJECT_ROOT, path);
  const suffix = relative(LOCAL_V2_DIRECTORY, absolute);
  if (!suffix || suffix.startsWith(`..${sep}`) || suffix === '..' || !suffix.endsWith('.sqlite'))
    throw new Error('Local v2 state requires its dedicated local-v2 directory');
  // A normalized path must not hide a link back to a legacy database or directory.
  for (let cursor = absolute; ; cursor = dirname(cursor)) {
    try {
      const stat = lstatSync(cursor);
      if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink > 1))
        throw new Error('Local v2 database links are forbidden');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (dirname(cursor) === cursor) break;
  }
}

export function isLocalV2DatabasePath(path: string): boolean {
  if (path.split(/[\\/]/).includes('local-v2')) return true;
  try { return realpathSync(path).split(/[\\/]/).includes('local-v2'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return false;
  }
}

/** Run before opening a DB: environment changes cannot repurpose the CCTEST prototype. */
export function assertPrototypeProfile(environment: NodeJS.ProcessEnv = process.env): void {
  if ((environment.CARECART_PROFILE ?? 'testnet-cctest') !== 'testnet-cctest' ||
      (environment.NEAR_NETWORK ?? 'testnet') !== 'testnet' ||
      isLocalV2DatabasePath(environment.CARECART_DATABASE_PATH ?? '')) {
    throw new Error('Prototype runtime supports testnet-cctest only');
  }
}

import { resolve } from 'node:path';

import { config as loadEnv } from 'dotenv';
import Fastify from 'fastify';

import {
  closeDatabase,
  DEFAULT_DATABASE_PATH,
  openDatabase,
  type DatabaseHandle,
} from './db';
import { seedSyntheticData } from './seed';
import { registerAgentRoutes } from './routes/agent';
import { registerInventoryRoutes } from './routes/inventory';
import { registerPurchaseOrderRoutes } from './routes/purchase-orders';

loadEnv({ path: resolve(__dirname, '../../.env') });

export interface CreateServerOptions {
  database: DatabaseHandle;
  clock?: () => Date;
}

export function createServer({ database, clock = () => new Date() }: CreateServerOptions) {
  const app = Fastify({ logger: false });
  registerAgentRoutes(app, database, clock);
  registerInventoryRoutes(app, database, clock);
  registerPurchaseOrderRoutes(app, database, clock);
  return app;
}

export async function startServer(): Promise<ReturnType<typeof createServer>> {
  const databasePath = process.env.CARECART_DATABASE_PATH ?? DEFAULT_DATABASE_PATH;
  const database = openDatabase(databasePath);
  try {
    seedSyntheticData(database);
    const app = createServer({ database });
    app.addHook('onClose', async () => closeDatabase(database));

    const port = Number(process.env.PORT ?? '3001');
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
      throw new Error('PORT must be an integer between 1 and 65535');
    }
    await app.listen({ host: '127.0.0.1', port });
    console.info(`CareCart backend listening on http://127.0.0.1:${port}`);
    return app;
  } catch (error) {
    if (database.open) closeDatabase(database);
    throw error;
  }
}

if (require.main === module) {
  void startServer().catch((error: unknown) => {
    console.error('CareCart backend failed to start', error);
    process.exitCode = 1;
  });
}

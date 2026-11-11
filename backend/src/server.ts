import Fastify from 'fastify';
import { resolve } from 'node:path';

import {
  closeDatabase,
  DEFAULT_DATABASE_PATH,
  openDatabase,
  type DatabaseHandle,
} from './db';
import { seedSyntheticData } from './seed';
import { registerInventoryReadRoutes } from './routes/inventory';
import { registerDashboardRoutes } from './routes/dashboard';
import { registerIntentsRoutes } from './routes/intents';
import { assertPrototypeProfile } from './profiles/storage';
import { assertNoSigningCredentials } from './operations/local';

export interface CreateServerOptions {
  database: DatabaseHandle;
  clock?: () => Date;
}

/** Public synthetic reads and retired legacy endpoints only. No execution dependency or activation flag exists. */
export function createServer(options: CreateServerOptions) {
  if (Object.keys(options).some(key => !['database', 'clock'].includes(key)))
    throw new Error('Legacy execution dependencies are forbidden; use authenticated v2 operations');
  const { database, clock = () => new Date() } = options;
  const app = Fastify({ logger: false });
  registerDashboardRoutes(app, database, clock);
  registerInventoryReadRoutes(app, database);
  for (const route of ['/api/supplier-quotes', '/api/purchase-orders', '/api/payments', '/api/agent/tasks', '/api/agent/tick']) {
    app.post(route, async (_request, reply) => reply.code(410).header('Cache-Control', 'no-store').send({
      error: { code: 'LEGACY_EXECUTION_RETIRED', message: 'Use authenticated v2 procurement. Public legacy execution is retired.' },
    }));
  }
  registerIntentsRoutes(app);
  return app;
}

export async function startServer(): Promise<ReturnType<typeof createServer>> {
  // Never load the root .env or construct a signer from legacy environment variables.
  assertNoSigningCredentials(process.env);
  assertPrototypeProfile();
  if (process.env.CARECART_DATABASE_PATH !== undefined && resolve(process.env.CARECART_DATABASE_PATH) !== DEFAULT_DATABASE_PATH)
    throw new Error('Public synthetic demo database is fixed; financial journals cannot be selected');
  const databasePath = DEFAULT_DATABASE_PATH;
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

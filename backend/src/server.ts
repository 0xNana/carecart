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
import { registerLiveAgent, type ManualAi } from './routes/live-agent';
import { liveConfiguration, openAiTransport } from './agent/live';
import { registerInventoryRoutes } from './routes/inventory';
import { registerPurchaseOrderRoutes } from './routes/purchase-orders';
import { registerDashboardRoutes } from './routes/dashboard';
import { registerPaymentRoutes } from './routes/payments';
import { loadVaultPaymentConfiguration } from './config';
import { NearApiVaultClient } from './near/client';
import { VaultPaymentAdapter } from './payments/adapter';
import { registerIntentsRoutes } from './routes/intents';
import { DryQuotePreview, loadDryPreviewConfiguration } from './intents/preview';
import { assertPrototypeProfile } from './profiles/mainnet';

loadEnv({ path: resolve(__dirname, '../../.env') });

export interface CreateServerOptions {
  database: DatabaseHandle;
  clock?: () => Date;
  paymentAdapter?: VaultPaymentAdapter;
  dryPreview?: DryQuotePreview;
  manualAi?: ManualAi;
}

export function createServer({
  database,
  clock = () => new Date(),
  paymentAdapter,
  dryPreview,
  manualAi,
}: CreateServerOptions) {
  const app = Fastify({ logger: false });
  registerDashboardRoutes(app, database, clock);
  registerAgentRoutes(app, database, clock);
  registerLiveAgent(app, database, manualAi);
  registerInventoryRoutes(app, database, clock);
  registerPurchaseOrderRoutes(app, database, clock);
  registerPaymentRoutes(app, paymentAdapter);
  registerIntentsRoutes(app, database, clock, dryPreview);
  return app;
}

export async function startServer(): Promise<ReturnType<typeof createServer>> {
  assertPrototypeProfile();
  const databasePath = process.env.CARECART_DATABASE_PATH ?? DEFAULT_DATABASE_PATH;
  const database = openDatabase(databasePath);
  try {
    seedSyntheticData(database);
    const paymentConfiguration = loadVaultPaymentConfiguration();
    const paymentAdapter = paymentConfiguration
      ? new VaultPaymentAdapter(
          database,
          new NearApiVaultClient(paymentConfiguration),
          {
            tokenAccountId: paymentConfiguration.tokenAccountId,
            assetCode: paymentConfiguration.assetCode,
          },
        )
      : undefined;
    const dryConfiguration = loadDryPreviewConfiguration();
    const ai = liveConfiguration();
    const operatorToken = process.env.CARECART_OPERATOR_TOKEN?.trim() ?? '';
    if (ai && operatorToken.length < 32) throw new Error('Live manual AI requires a server-only operator token of at least 32 characters');
    const app = createServer({ database, paymentAdapter, dryPreview: dryConfiguration ? new DryQuotePreview(dryConfiguration) : undefined,
      manualAi: ai ? { config: ai, transport: openAiTransport(ai), operatorToken } : undefined });
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

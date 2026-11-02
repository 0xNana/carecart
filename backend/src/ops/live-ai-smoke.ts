import { chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createServer } from '../server';
import { openDatabase, closeDatabase } from '../db';
import { seedSyntheticData } from '../seed';
import { liveConfiguration, openAiTransport } from '../agent/live';

/** Human-run, forecast-only live smoke. No payment client or signer is constructed. */
async function main() {
  const config = liveConfiguration();
  if (!config) throw new Error('Explicit live AI configuration required');
  const path = 'backend/data/live-ai-smoke.sqlite';
  const database = openDatabase(path);
  chmodSync(path, 0o600);
  seedSyntheticData(database);
  const token = randomBytes(32).toString('hex');
  const app = createServer({
    database,
    manualAi: {
      config,
      operatorToken: token,
      transport: openAiTransport(config),
    },
  });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/agent/tick',
      headers: { authorization: `Bearer ${token}` },
      payload: { itemId: 'item-000001' },
    });
    const result = response.json();
    if (response.statusCode !== 200) {
      const failure = database
        .prepare(
          "SELECT result_json FROM live_ai_runs WHERE state='failed' ORDER BY started_at DESC LIMIT 1",
        )
        .get() as { result_json: string } | undefined;
      console.info(
        JSON.stringify({
          status: 'failed',
          httpStatus: response.statusCode,
          model: config.model,
          error: result.error,
          diagnostics: failure ? JSON.parse(failure.result_json) : null,
          transactionInitiated: false,
        }),
      );
      process.exitCode = 1;
      return;
    }
    console.info(
      JSON.stringify(
        { status: 'passed', ...result, transactionInitiated: false },
        null,
        2,
      ),
    );
  } finally {
    await app.close();
    closeDatabase(database);
  }
}
if (require.main === module)
  void main().catch(() => {
    console.error(
      'Live forecast smoke could not run; check local credentials/model/configuration. No payment was requested.',
    );
    process.exitCode = 1;
  });

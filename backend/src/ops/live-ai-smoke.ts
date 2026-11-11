import { chmodSync } from 'node:fs';
import { openDatabase, closeDatabase } from '../db';
import { seedSyntheticData } from '../seed';
import { liveConfiguration, openAiTransport, runLiveAgent } from '../agent/live';
import { assertNoSigningCredentials } from '../operations/local';

/** Explicit human-run, forecast-only CLI. No HTTP execution route or signer exists. */
async function main() {
  assertNoSigningCredentials(process.env);
  const config = liveConfiguration();
  if (!config) throw new Error('Explicit live AI configuration required');
  const path = 'backend/data/live-ai-smoke.sqlite';
  const database = openDatabase(path);
  try {
    chmodSync(path, 0o600);
    seedSyntheticData(database);
    const result = await runLiveAgent(database, { itemId: 'item-000001' }, config, openAiTransport(config));
    console.info(JSON.stringify({ status: 'passed', ...result, transactionInitiated: false }, null, 2));
  } finally { closeDatabase(database); }
}
if (require.main === module) void main().catch(() => {
  console.error('Live forecast smoke could not run; check explicit configuration. No payment was requested.');
  process.exitCode = 1;
});

import { privateToolModels } from './live';

/** Human-run CLI only. Token stays in the local environment and is never printed. */
async function main() {
  const [action, itemId, quoteId] = process.argv.slice(2);
  if (action === '--catalog') {
    const response = await fetch('https://cloud-api.near.ai/v1/models', {
      redirect: 'error',
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new Error('Model catalog unavailable');
    const catalog = (await response.json()) as {
      data: Parameters<typeof privateToolModels>[0];
    };
    console.info(
      JSON.stringify(
        {
          candidates: privateToolModels(catalog.data).map((m) => ({
            id: m.id,
            features: m.features ?? m.supported_features,
            providerListedPrivate: true,
            attestationVerified: false,
          })),
        },
        null,
        2,
      ),
    );
    return;
  }
  if (
    action !== '--run' ||
    !/^item-[0-9]{6}$/.test(itemId ?? '') ||
    (quoteId && !/^quote-[0-9]{6}$/.test(quoteId))
  )
    throw new Error('Use --catalog or --run item-NNNNNN [quote-NNNNNN]');
  if (
    !process.env.CARECART_OPERATOR_TOKEN ||
    process.env.CARECART_OPERATOR_TOKEN.length < 32
  )
    throw new Error('Configure the server-only operator token locally');
  const port = process.env.PORT ?? '3101';
  if (!/^[0-9]{1,5}$/.test(port) || Number(port) > 65535 || Number(port) < 1)
    throw new Error('Invalid localhost API port');
  const response = await fetch(`http://127.0.0.1:${port}/api/agent/tick`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.CARECART_OPERATOR_TOKEN}`,
    },
    body: JSON.stringify({ itemId, ...(quoteId ? { quoteId } : {}) }),
    redirect: 'error',
    signal: AbortSignal.timeout(140000),
  });
  if (!response.ok)
    throw new Error(
      `Manual AI tick failed (HTTP ${response.status}); inspect local run records, do not retry a payment`,
    );
  console.info(JSON.stringify(await response.json(), null, 2));
}
if (require.main === module)
  void main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : 'Manual AI tick failed',
    );
    process.exitCode = 1;
  });

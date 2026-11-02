import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { loadDomainRecords, type DatabaseHandle } from '../db';
import { DestinationChain, PreviewError, simulateCrossChain, type DryQuotePreview } from '../intents/preview';

export function registerIntentsRoutes(app: FastifyInstance, database: DatabaseHandle, clock: () => Date, dryPreview?: DryQuotePreview) {
  app.get('/api/intents/config', async (_request, reply) => reply.header('Cache-Control', 'no-store').send({
    mode: 'mock_simulation', settlementEnabled: false, dryQuoteAvailable: !!dryPreview,
    destinationChains: DestinationChain.options, notice: 'NEAR Intents has no testnet deployment. Testnet uses offline simulation.',
  }));
  app.post('/api/intents/preview', async (request, reply) => {
    const input = z.object({ purchaseOrderId: z.string().regex(/^po-[0-9]{6}$/), destinationChain: DestinationChain }).strict().safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Select a stored purchase order and a supported simulated destination.' } });
    const records = loadDomainRecords(database);
    const po = records.purchaseOrders.find((entry) => entry.id === input.data.purchaseOrderId);
    if (!po) return reply.code(404).send({ error: { code: 'PURCHASE_ORDER_NOT_FOUND', message: 'Purchase order was not found.' } });
    const supplier = records.suppliers.find((entry) => entry.id === po.supplierId)!;
    const preview = simulateCrossChain({ purchaseOrderId: po.id, supplierId: supplier.id, supplierName: supplier.displayName,
      amountAtomic: po.amountAtomic.toString(), assetCode: po.assetCode, destinationChain: input.data.destinationChain }, clock());
    console.info(JSON.stringify({ event: 'cross_chain_preview', mode: preview.mode, settlement: preview.settlement,
      purchaseOrderId: po.id, destinationChain: preview.destinationChain }));
    return reply.header('Cache-Control', 'no-store').send(preview);
  });
  app.post('/api/intents/dry-quote', async (request, reply) => {
    if (!z.object({}).strict().safeParse(request.body).success) return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Dry preview uses only the server-configured market route.' } });
    if (!dryPreview) return reply.code(503).send({ error: { code: 'PREVIEW_NOT_CONFIGURED', message: 'Optional dry market quotes are not configured. Use the offline simulation.' } });
    try {
      const preview = await dryPreview.preview(clock());
      console.info(JSON.stringify({ event: 'cross_chain_preview', mode: preview.mode, dry: true, settlement: preview.settlement }));
      return reply.header('Cache-Control', 'no-store').send(preview);
    } catch (cause) {
      if (!(cause instanceof PreviewError)) throw cause;
      console.info(JSON.stringify({ event: 'cross_chain_preview_failed', mode: 'oneclick_dry_preview', code: cause.code, settlement: 'not_initiated' }));
      return reply.code(502).send({ error: { code: cause.code, message: cause.message } });
    }
  });
}

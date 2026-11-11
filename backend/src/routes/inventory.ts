import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

import { loadDomainRecords, type DatabaseHandle } from '../db';
import { calculateInventoryForecast } from '../procurement/forecast';
import { createSupplierQuotes } from '../procurement/suppliers';

const ItemIdSchema = z.string().regex(/^item-[0-9]{6}$/);
const SupplierQuoteRequestSchema = z.object({ itemId: ItemIdSchema }).strict();

function validationError(reply: FastifyReply) {
  return reply.code(400).send({
    error: { code: 'VALIDATION_ERROR', message: 'Invalid request parameters or body' },
  });
}

export function registerInventoryReadRoutes(
  app: FastifyInstance,
  database: DatabaseHandle,
): void {
  app.get('/api/inventory', async (_request, reply) => {
    const { inventoryItems } = loadDomainRecords(database);
    return reply.send({
      items: inventoryItems.map((item) => ({
        id: item.id,
        name: item.name,
        unit: item.unit,
        onHand: item.onHand,
        reorderPoint: item.reorderPoint,
        isLowStock: item.onHand <= item.reorderPoint,
      })),
    });
  });

  app.get<{ Params: { itemId: string } }>('/api/inventory/:itemId/forecast', async (request, reply) => {
    const parsedItemId = ItemIdSchema.safeParse(request.params.itemId);
    if (!parsedItemId.success) return validationError(reply);

    const forecast = calculateInventoryForecast(database, parsedItemId.data);
    if (!forecast) {
      return reply.code(404).send({
        error: { code: 'ITEM_NOT_FOUND', message: 'Inventory item was not found' },
      });
    }
    return reply.send(forecast);
  });
}

/** Historical handler fixture only; not registered by the public runtime. */
export function registerInventoryRoutes(app: FastifyInstance, database: DatabaseHandle, clock: () => Date): void {
  registerInventoryReadRoutes(app, database);
  app.post('/api/supplier-quotes', async (request, reply) => {
    const parsedBody = SupplierQuoteRequestSchema.safeParse(request.body);
    if (!parsedBody.success) return validationError(reply);

    const result = createSupplierQuotes(database, parsedBody.data.itemId, clock());
    if (result.kind === 'not_found') {
      return reply.code(404).send({
        error: { code: 'ITEM_NOT_FOUND', message: 'Inventory item was not found' },
      });
    }
    if (result.kind === 'no_reorder_needed') {
      return reply.code(409).send({
        error: { code: 'NO_REORDER_NEEDED', message: 'Inventory item is above its reorder point' },
      });
    }

    return reply.code(201).send({
      quotes: result.quotes.map((quote) => ({
        quoteId: quote.id,
        supplierId: quote.supplierId,
        itemId: quote.itemId,
        quantity: quote.quantity,
        unitPriceAtomic: quote.unitPriceAtomic.toString(),
        totalAmountAtomic: quote.totalAmountAtomic.toString(),
        assetCode: quote.assetCode,
        leadTimeDays: quote.leadTimeDays,
        quotedAt: quote.quotedAt,
        expiresAt: quote.expiresAt,
      })),
    });
  });
}

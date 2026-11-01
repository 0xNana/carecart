import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

import type { DatabaseHandle } from '../db';
import { createPurchaseOrder } from '../procurement/purchase-orders';

const PurchaseOrderRequestSchema = z
  .object({
    requestId: z.string().min(8).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
    itemId: z.string().regex(/^item-[0-9]{6}$/),
    quoteId: z.string().regex(/^quote-[0-9]{6}$/),
  })
  .strict();

function validationError(reply: FastifyReply) {
  return reply.code(400).send({
    error: { code: 'VALIDATION_ERROR', message: 'Invalid purchase order request' },
  });
}

function resultError(reply: FastifyReply, kind: string) {
  const errors: Record<string, { status: number; message: string }> = {
    item_not_found: { status: 404, message: 'Inventory item was not found' },
    quote_not_found: { status: 404, message: 'Supplier quote was not found' },
    quote_item_mismatch: { status: 409, message: 'Quote does not belong to the requested item' },
    quote_expired: { status: 409, message: 'Supplier quote has expired' },
    quote_already_used: { status: 409, message: 'Supplier quote already has a purchase order' },
    idempotency_key_reused: {
      status: 409,
      message: 'Request ID was already used for a different purchase order',
    },
  };
  const error = errors[kind];
  if (!error) throw new Error(`unhandled purchase order result: ${kind}`);
  return reply.code(error.status).send({
    error: { code: kind.toUpperCase(), message: error.message },
  });
}

export function registerPurchaseOrderRoutes(
  app: FastifyInstance,
  database: DatabaseHandle,
  clock: () => Date,
): void {
  app.post('/api/purchase-orders', async (request, reply) => {
    const parsedRequest = PurchaseOrderRequestSchema.safeParse(request.body);
    if (!parsedRequest.success) return validationError(reply);

    const result = createPurchaseOrder(database, parsedRequest.data, clock());
    if (result.kind !== 'created' && result.kind !== 'replayed') {
      return resultError(reply, result.kind);
    }

    return reply.code(result.kind === 'created' ? 201 : 200).send({
      replayed: result.kind === 'replayed',
      purchaseOrder: {
        id: result.purchaseOrder.id,
        requestId: result.purchaseOrder.requestId,
        quoteId: result.purchaseOrder.quoteId,
        itemId: result.purchaseOrder.itemId,
        supplierId: result.purchaseOrder.supplierId,
        quantity: result.purchaseOrder.quantity,
        amountAtomic: result.purchaseOrder.amountAtomic.toString(),
        assetCode: result.purchaseOrder.assetCode,
        status: result.purchaseOrder.status,
        createdAt: result.purchaseOrder.createdAt,
      },
    });
  });
}

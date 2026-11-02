import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

import { PaymentAdapterError, type VaultPaymentAdapter } from '../payments/adapter';

const PaymentRequestSchema = z
  .object({ purchaseOrderId: z.string().regex(/^po-[0-9]{6}$/) })
  .strict();

export function registerPaymentRoutes(
  app: FastifyInstance,
  paymentAdapter?: VaultPaymentAdapter,
): void {
  app.post('/api/payments', async (request, reply) => {
    const parsedRequest = PaymentRequestSchema.safeParse(request.body);
    if (!parsedRequest.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid payment request' },
      });
    }
    if (!paymentAdapter) {
      return reply.code(503).send({
        error: { code: 'PAYMENTS_NOT_CONFIGURED', message: 'Vault payments are not configured' },
      });
    }

    try {
      const payment = await paymentAdapter.requestPayment(parsedRequest.data.purchaseOrderId);
      return reply.code(200).send({ payment });
    } catch (error) {
      if (!(error instanceof PaymentAdapterError)) throw error;
      const statusCode =
        error.code === 'PURCHASE_ORDER_NOT_FOUND'
          ? 404
          : error.code === 'CHAIN_OPERATION_FAILED' || error.code === 'CANONICAL_PAYMENT_MISSING'
            ? 502
            : 409;
      return reply.code(statusCode).send({
        error: { code: error.code, message: error.message },
      });
    }
  });
}

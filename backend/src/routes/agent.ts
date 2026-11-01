import type { FastifyInstance, FastifyReply } from 'fastify';

import type { DatabaseHandle } from '../db';
import { runAgentService } from '../agent/service';

const ERROR_STATUS: Record<string, number> = {
  VALIDATION_ERROR: 400,
  INVALID_SUPPLIER_MESSAGE: 400,
  UNREGISTERED_SUPPLIER_MESSAGE: 400,
  ITEM_NOT_FOUND: 404,
  QUOTE_NOT_FOUND: 404,
  QUOTE_ITEM_MISMATCH: 409,
  QUOTE_EXPIRED: 409,
  QUOTE_ALREADY_USED: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
  PROVIDER_CONFIGURATION_INVALID: 503,
  PROVIDER_ADAPTER_NOT_AVAILABLE: 503,
};

export function registerAgentRoutes(
  app: FastifyInstance,
  database: DatabaseHandle,
  clock: () => Date,
): void {
  app.post('/api/agent/tasks', async (request, reply) => {
    const result = runAgentService(database, request.body, { now: clock() });
    if (!result.ok) return sendAgentError(reply, result.error.code, result.error.message);

    return reply.send({
      mode: result.mode,
      summary: result.summary,
      forecast: result.forecast,
      purchaseOrder: result.purchaseOrder,
    });
  });
}

function sendAgentError(reply: FastifyReply, code: string, message: string) {
  const statusCode = ERROR_STATUS[code] ?? 400;
  return reply.code(statusCode).send({ error: { code, message } });
}

import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { DatabaseHandle } from '../db';
import {
  runLiveAgent,
  type AiTransport,
  type LiveAiConfiguration,
} from '../agent/live';

export interface ManualAi {
  config: LiveAiConfiguration;
  transport: AiTransport;
  operatorToken: string;
}
export function registerLiveAgent(
  app: FastifyInstance,
  database: DatabaseHandle,
  manual?: ManualAi,
) {
  if (manual)
    database.exec(`CREATE TABLE IF NOT EXISTS live_ai_runs (
    id TEXT PRIMARY KEY, model TEXT NOT NULL, state TEXT NOT NULL,
    result_json TEXT, started_at TEXT NOT NULL, completed_at TEXT)`);
  let calls: number[] = [];
  let running = false;
  app.post('/api/agent/tick', { bodyLimit: 16384 }, async (request, reply) => {
    const supplied = request.headers.authorization;
    const hash = (text: string) => createHash('sha256').update(text).digest();
    if (
      !manual ||
      manual.operatorToken.length < 32 ||
      !supplied ||
      supplied.length > 1024 ||
      !timingSafeEqual(hash(supplied), hash(`Bearer ${manual.operatorToken}`))
    ) {
      return reply.code(401).send({
        error: {
          code: 'OPERATOR_AUTH_REQUIRED',
          message:
            'Manual AI tick requires an operator token and configured provider',
        },
      });
    }
    const now = Date.now();
    calls = calls.filter((time) => now - time < 60000);
    if (running || calls.length >= 3)
      return reply.code(429).send({
        error: {
          code: 'AI_TICK_LIMIT',
          message: 'One tick at a time; at most three per minute',
        },
      });
    calls.push(now);
    running = true;
    const runId = randomUUID();
    try {
      database
        .prepare(
          'INSERT INTO live_ai_runs (id,model,state,started_at) VALUES (?,?,?,?)',
        )
        .run(
          runId,
          manual.config.model,
          'running',
          new Date(now).toISOString(),
        );
      const result = await runLiveAgent(
        database,
        request.body,
        manual.config,
        manual.transport,
      );
      database
        .prepare(
          'UPDATE live_ai_runs SET state=?,result_json=?,completed_at=? WHERE id=?',
        )
        .run(
          'completed',
          JSON.stringify(result),
          new Date().toISOString(),
          runId,
        );
      return { runId, ...result };
    } catch (cause) {
      const failure = cause as {
        status?: unknown;
        code?: unknown;
        param?: unknown;
        message?: unknown;
      } | null;
      const knownReasons = [
        'Provider supplied no verified tool result',
        'Provider tool budget exceeded',
        'Provider response is invalid',
        'Provider requested an unavailable or invalid tool',
        'Drafting requires an explicitly selected quote',
      ];
      const details = {
        httpStatus:
          typeof failure?.status === 'number' &&
          Number.isInteger(failure.status) &&
          failure.status >= 100 &&
          failure.status <= 599
            ? failure.status
            : null,
        code:
          typeof failure?.code === 'string' &&
          [
            'invalid_api_key',
            'authentication_error',
            'rate_limit_exceeded',
            'insufficient_quota',
            'model_not_found',
            'invalid_request_error',
            'unsupported_parameter',
          ].includes(failure.code)
            ? failure.code
            : null,
        parameter:
          typeof failure?.param === 'string' &&
          /^(model|max_tokens|max_completion_tokens|temperature|tool_choice|messages|tools(?:\[[0-9]+\]|\.[A-Za-z_0-9]+)*)$/.test(
            failure.param,
          )
            ? failure.param
            : null,
        reason:
          typeof failure?.message === 'string' &&
          knownReasons.includes(failure.message)
            ? failure.message
            : 'Provider or tool validation failed',
      };
      database
        .prepare(
          'UPDATE live_ai_runs SET state=?,result_json=?,completed_at=? WHERE id=?',
        )
        .run(
          'failed',
          JSON.stringify({ failure: details }),
          new Date().toISOString(),
          runId,
        );
      return reply.code(502).send({
        error: {
          code: 'LIVE_AI_FAILED',
          message:
            'Live provider or tool validation failed; no payment was requested',
        },
      });
    } finally {
      running = false;
    }
  });
}

import { z } from 'zod';

import { loadAgentProviderConfiguration } from '../config';
import { loadDomainRecords, type DatabaseHandle } from '../db';
import {
  executeAgentTool,
  RegisteredItemIdSchema,
  RegisteredQuoteIdSchema,
  type AgentToolResult,
} from './tools';

const SupplierMessageSchema = z
  .object({
    supplierId: z.string().regex(/^supplier-[0-9]{6}$/),
    text: z.string().max(2000),
  })
  .strict();

export const AgentTaskInputSchema = z
  .object({ itemId: RegisteredItemIdSchema, quoteId: RegisteredQuoteIdSchema.optional() })
  .strict();

export interface AgentRunOptions {
  now?: Date;
  /** Internal supplier content is retained as data, separate from tool input and instructions. */
  supplierMessages?: readonly unknown[];
}

export interface UntrustedSupplierMessage {
  supplierId: string;
  text: string;
  trust: 'untrusted';
}

type DraftPurchaseOrderData = Extract<
  AgentToolResult,
  { ok: true; toolName: 'draft_purchase_order' }
>['data'];

export type AgentServiceResult =
  | {
      ok: true;
      mode: 'deterministic';
      summary: string;
      forecast: Extract<AgentToolResult, { ok: true; toolName: 'get_inventory_forecast' }>['data'];
      purchaseOrder: Extract<AgentToolResult, { ok: true; toolName: 'draft_purchase_order' }>['data'] | null;
      untrustedSupplierMessages: UntrustedSupplierMessage[];
    }
  | { ok: false; error: { code: string; message: string } };

/** Summarize a forecast and, if requested, draft a PO without any provider or free-text prompt. */
export function runAgentService(
  database: DatabaseHandle,
  input: unknown,
  options: AgentRunOptions = {},
): AgentServiceResult {
  let providerMode: string;
  try {
    providerMode = loadAgentProviderConfiguration().mode;
  } catch {
    return {
      ok: false,
      error: {
        code: 'PROVIDER_CONFIGURATION_INVALID',
        message: 'Agent provider configuration is unavailable',
      },
    };
  }
  if (providerMode === 'provider') {
    return {
      ok: false,
      error: {
        code: 'PROVIDER_ADAPTER_NOT_AVAILABLE',
        message: 'Live provider execution is unavailable in this build',
      },
    };
  }

  const parsedInput = AgentTaskInputSchema.safeParse(input);
  if (!parsedInput.success) {
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid agent task arguments' } };
  }

  const parsedMessages = z
    .array(SupplierMessageSchema)
    .max(20)
    .safeParse(options.supplierMessages ?? []);
  if (!parsedMessages.success) {
    return { ok: false, error: { code: 'INVALID_SUPPLIER_MESSAGE', message: 'Supplier message context is invalid' } };
  }
  const registeredSupplierIds = new Set<string>(
    loadDomainRecords(database).suppliers.map((supplier) => supplier.id),
  );
  if (parsedMessages.data.some((message) => !registeredSupplierIds.has(message.supplierId))) {
    return {
      ok: false,
      error: {
        code: 'UNREGISTERED_SUPPLIER_MESSAGE',
        message: 'Supplier message source is not registered',
      },
    };
  }

  const forecastResult = executeAgentTool(
    database,
    'get_inventory_forecast',
    { itemId: parsedInput.data.itemId },
    options.now,
  );
  if (!forecastResult.ok) return { ok: false, error: forecastResult.error };
  if (forecastResult.toolName !== 'get_inventory_forecast') {
    return { ok: false, error: { code: 'TOOL_EXECUTION_FAILED', message: 'Forecast tool failed' } };
  }

  let purchaseOrder: DraftPurchaseOrderData | null = null;
  if (parsedInput.data.quoteId) {
    const purchaseOrderResult = executeAgentTool(
      database,
      'draft_purchase_order',
      { itemId: parsedInput.data.itemId, quoteId: parsedInput.data.quoteId },
      options.now,
    );
    if (!purchaseOrderResult.ok) return { ok: false, error: purchaseOrderResult.error };
    if (purchaseOrderResult.toolName !== 'draft_purchase_order') {
      return { ok: false, error: { code: 'TOOL_EXECUTION_FAILED', message: 'Purchase order tool failed' } };
    }
    purchaseOrder = purchaseOrderResult.data;
  }

  return {
    ok: true,
    mode: 'deterministic',
    summary: summarizeForecast(forecastResult.data),
    forecast: forecastResult.data,
    purchaseOrder,
    untrustedSupplierMessages: parsedMessages.data.map((message) => ({
      supplierId: message.supplierId,
      text: message.text,
      trust: 'untrusted',
    })),
  };
}

function summarizeForecast(
  forecast: Extract<AgentToolResult, { ok: true; toolName: 'get_inventory_forecast' }>['data'],
): string {
  const stockState = forecast.isLowStock ? 'at or below' : 'above';
  const supplierRecommendations = forecast.supplierForecasts
    .map(
      (supplier) =>
        `${supplier.supplierName}: ${supplier.recommendedQuantity} ${forecast.unit} recommended (${supplier.leadTimeDays}-day lead time)`,
    )
    .join('; ');
  const recommendation = supplierRecommendations
    ? ` Supplier forecasts: ${supplierRecommendations}.`
    : ' No registered supplier forecast is available.';

  return `${forecast.itemName}: ${forecast.onHand} ${forecast.unit} on hand, ${stockState} the reorder point of ${forecast.reorderPoint}. Observed synthetic usage: ${forecast.observedUsageUnits} units in ${forecast.usageWindowDays} days.${recommendation}`;
}

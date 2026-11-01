import { afterEach, describe, expect, it } from 'vitest';

import { closeDatabase, loadDomainRecords, openDatabase } from '../db';
import { createSupplierQuotes } from '../procurement/suppliers';
import { seedSyntheticData } from '../seed';
import { AGENT_TOOL_DEFINITIONS, executeAgentTool } from './tools';

describe('constrained agent tools', () => {
  let database: ReturnType<typeof openDatabase> | undefined;

  const createSeededDatabase = () => {
    database = openDatabase(':memory:');
    seedSyntheticData(database);
    return database;
  };

  afterEach(() => {
    if (database?.open) closeDatabase(database);
    database = undefined;
  });

  it('exposes only forecast and draft tools with strict registered-ID schemas', () => {
    expect(AGENT_TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual([
      'get_inventory_forecast',
      'draft_purchase_order',
    ]);
    expect(AGENT_TOOL_DEFINITIONS[0]?.parameters).toMatchObject({
      type: 'object',
      properties: { itemId: { type: 'string', pattern: '^item-[0-9]{6}$' } },
      required: ['itemId'],
      additionalProperties: false,
    });
    expect(AGENT_TOOL_DEFINITIONS[1]?.parameters).toMatchObject({
      type: 'object',
      properties: {
        itemId: { type: 'string', pattern: '^item-[0-9]{6}$' },
        quoteId: { type: 'string', pattern: '^quote-[0-9]{6}$' },
      },
      required: ['itemId', 'quoteId'],
      additionalProperties: false,
    });
  });

  it('validates tool arguments and does not allow hidden supplier, amount, or payment tools', () => {
    const db = createSeededDatabase();
    const before = loadDomainRecords(db).purchaseOrders.length;

    expect(
      executeAgentTool(db, 'get_inventory_forecast', {
        itemId: 'item-000001',
        supplierId: 'supplier-000002',
      }),
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(
      executeAgentTool(db, 'draft_purchase_order', {
        itemId: 'item-000001',
        quoteId: 'quote-000002',
        destinationAccountId: 'attacker.near',
        amountAtomic: '1',
      }),
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(
      executeAgentTool(db, 'draft_purchase_order', {
        itemId: 'item-999999',
        quoteId: 'quote-000002',
      }),
    ).toMatchObject({ ok: false, error: { code: 'ITEM_NOT_FOUND' } });
    expect(
      executeAgentTool(db, 'draft_purchase_order', {
        itemId: 'item-000001',
        quoteId: 'quote-999999',
      }),
    ).toMatchObject({ ok: false, error: { code: 'QUOTE_NOT_FOUND' } });
    expect(
      executeAgentTool(db, 'request_payment', { itemId: 'item-000001', quoteId: 'quote-000002' }),
    ).toMatchObject({ ok: false, error: { code: 'UNKNOWN_TOOL' } });
    expect(loadDomainRecords(db).purchaseOrders).toHaveLength(before);
  });

  it('drafts from a registered quote and derives supplier and amount from the stored row', () => {
    const db = createSeededDatabase();
    createSupplierQuotes(db, 'item-000001', new Date('2026-11-01T12:00:00.000Z'));

    const result = executeAgentTool(
      db,
      'draft_purchase_order',
      { itemId: 'item-000001', quoteId: 'quote-000003' },
      new Date('2026-11-01T12:00:00.000Z'),
    );

    expect(result).toMatchObject({
      ok: true,
      toolName: 'draft_purchase_order',
      data: {
        replayed: false,
        purchaseOrder: {
          quoteId: 'quote-000003',
          itemId: 'item-000001',
          supplierId: 'supplier-000001',
          quantity: 14,
          amountAtomic: '1680',
          assetCode: 'CCTEST',
        },
      },
    });

    const replay = executeAgentTool(
      db,
      'draft_purchase_order',
      { itemId: 'item-000001', quoteId: 'quote-000003' },
      new Date('2026-11-01T12:00:00.000Z'),
    );
    expect(replay).toMatchObject({ ok: true, data: { replayed: true } });
    expect(loadDomainRecords(db).purchaseOrders).toHaveLength(2);
  });
});

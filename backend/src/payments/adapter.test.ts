import { afterEach, describe, expect, it } from 'vitest';

import { closeDatabase, openDatabase } from '../db';
import { seedSyntheticData } from '../seed';
import {
  PaymentAdapterError,
  VaultPaymentAdapter,
  type PaymentAdapterConfiguration,
} from './adapter';
import type {
  ChainTransaction,
  VaultClient,
  VaultPaymentRecord,
  VaultPurchaseOrder,
} from '../near/client';

const configuration: PaymentAdapterConfiguration = {
  tokenAccountId: 'token.sandbox',
  assetCode: 'CCTEST',
};

const paymentRecords: Array<{
  state: VaultPaymentRecord['state'];
  reason: string | null;
  status: string;
}> = [
  { state: 'Paid', reason: null, status: 'paid' },
  { state: 'PendingApproval', reason: null, status: 'pending_approval' },
  { state: 'Blocked', reason: 'InsufficientFunds', status: 'blocked' },
  { state: 'Failed', reason: 'TransferFailed', status: 'failed' },
];

class FakeVaultClient implements VaultClient {
  canonical: VaultPurchaseOrder | null = null;
  paymentRecord: VaultPaymentRecord | null = null;
  readonly commitments: Array<Parameters<VaultClient['commitPurchaseOrder']>[0]> = [];
  readonly requests: string[] = [];

  async getPurchaseOrder(): Promise<VaultPurchaseOrder | null> {
    return this.canonical;
  }

  async getPaymentState(): Promise<VaultPaymentRecord | null> {
    return this.paymentRecord;
  }

  async commitPurchaseOrder(input: Parameters<VaultClient['commitPurchaseOrder']>[0]): Promise<ChainTransaction> {
    this.commitments.push(input);
    this.canonical = {
      po_id: input.poId,
      supplier_id: input.supplierAccountId,
      token_id: input.tokenAccountId,
      amount: input.amountAtomic,
    };
    return { transactionHash: 'commit-tx-1' };
  }

  async requestPayment(poId: string): Promise<ChainTransaction> {
    this.requests.push(poId);
    this.paymentRecord = {
      request_id: poId,
      po_id: poId,
      amount: '1200',
      state: 'Paid',
      reason: null,
      approval_reasons: [],
      human_approved: false,
      reserved_day: '0',
    };
    return { transactionHash: 'request-tx-1' };
  }
}

describe('vault payment adapter', () => {
  let database: ReturnType<typeof openDatabase> | undefined;

  afterEach(() => {
    if (database?.open) closeDatabase(database);
    database = undefined;
  });

  function setup() {
    database = openDatabase(':memory:');
    seedSyntheticData(database);
    database
      .prepare('UPDATE suppliers SET near_account_id = ? WHERE id = ?')
      .run('supplier.sandbox', 'supplier-000001');
    const client = new FakeVaultClient();
    const adapter = new VaultPaymentAdapter(
      database,
      client,
      configuration,
      () => new Date('2026-11-01T12:00:00.000Z'),
    );
    return { database, client, adapter };
  }

  it.each(paymentRecords)('persists the $state chain result and an audit event', async (expected) => {
    const { database: db, client, adapter } = setup();
    client.requestPayment = async (poId: string) => {
      client.requests.push(poId);
      client.paymentRecord = {
        request_id: poId,
        po_id: poId,
        amount: '1200',
        state: expected.state,
        reason: expected.reason,
        approval_reasons: expected.state === 'PendingApproval' ? ['PerOrderCap'] : [],
        human_approved: false,
        reserved_day: '0',
      };
      return { transactionHash: 'request-tx-1' };
    };

    const outcome = await adapter.requestPayment('po-000001');

    expect(outcome.status).toBe(expected.status);
    expect(outcome.chainState).toBe(expected.state);
    expect(client.commitments).toEqual([
      {
        poId: 'po-000001',
        supplierAccountId: 'supplier.sandbox',
        tokenAccountId: 'token.sandbox',
        amountAtomic: '1200',
      },
    ]);
    expect(client.requests).toEqual(['po-000001']);
    expect(
      db.prepare('SELECT status, request_id, request_transaction_hash FROM payments WHERE purchase_order_id = ?')
        .get('po-000001'),
    ).toEqual({
      status: expected.status,
      request_id: 'po-000001',
      request_transaction_hash: 'request-tx-1',
    });
    const event = db
      .prepare(
        `SELECT payload_json FROM audit_events
         WHERE entity_type = 'payment' AND entity_id = ? AND event_type = 'payment_status_changed'`,
      )
      .get('po-000001') as { payload_json: string };
    expect(JSON.parse(event.payload_json)).toMatchObject({
      fromStatus: 'not_requested',
      toStatus: expected.status,
      chainState: expected.state,
      reason: expected.reason,
      commitTransactionHash: 'commit-tx-1',
      requestTransactionHash: 'request-tx-1',
    });
  });

  it('sends only the canonical PO ID to payment request and does not duplicate audit on replay', async () => {
    const { database: db, client, adapter } = setup();

    await adapter.requestPayment('po-000001');
    await adapter.requestPayment('po-000001');

    expect(client.requests).toEqual(['po-000001', 'po-000001']);
    expect(client.commitments).toHaveLength(1);
    expect(
      db.prepare(
        `SELECT count(*) AS count FROM audit_events
         WHERE entity_type = 'payment' AND entity_id = ? AND event_type = 'payment_status_changed'`,
      ).get('po-000001'),
    ).toEqual({ count: 1 });
  });

  it('refuses to rebind a conflicting on-chain PO commitment', async () => {
    const { client, adapter } = setup();
    client.canonical = {
      po_id: 'po-000001',
      supplier_id: 'supplier.sandbox',
      token_id: 'token.sandbox',
      amount: '1201',
    };

    await expect(adapter.requestPayment('po-000001')).rejects.toMatchObject<Partial<PaymentAdapterError>>({
      code: 'CANONICAL_PURCHASE_ORDER_CONFLICT',
    });
    expect(client.commitments).toHaveLength(0);
    expect(client.requests).toHaveLength(0);
  });
  it('reconciles a committed PO and accepted payment when RPC responses are lost', async () => {
    const { client, adapter } = setup();
    const commit = client.commitPurchaseOrder.bind(client);
    const request = client.requestPayment.bind(client);
    client.commitPurchaseOrder = async (input) => { await commit(input); throw new Error('timeout'); };
    client.requestPayment = async (id) => { await request(id); throw new Error('timeout'); };
    expect((await adapter.requestPayment('po-000001')).status).toBe('paid');
    expect(client.commitments).toHaveLength(1);
  });

  it('reports an unconfirmed chain failure without inventing a paid or blocked outcome', async () => {
    const { database: db, client, adapter } = setup();
    client.requestPayment = async () => { throw new Error('RPC unavailable'); };
    await expect(adapter.requestPayment('po-000001')).rejects.toMatchObject({ code: 'CHAIN_OPERATION_FAILED' });
    expect(db.prepare('SELECT status FROM payments WHERE purchase_order_id = ?').pluck().get('po-000001')).toBe('not_requested');
  });

});

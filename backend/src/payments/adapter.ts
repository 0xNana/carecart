import { allocateId, type DatabaseHandle } from '../db';
import {
  formatAtomicAmount,
  parseAtomicAmount,
  type PaymentStatus,
  type PurchaseOrderId,
} from '../domain';
import type {
  VaultClient,
  VaultPaymentRecord,
  VaultPaymentState,
  VaultPurchaseOrder,
} from '../near/client';

interface PurchaseOrderRow {
  id: string;
  quote_id: string;
  supplier_id: string;
  item_id: string;
  quantity: number;
  amount_atomic: string;
  asset_code: string;
  status: 'draft' | 'committed' | 'cancelled' | 'paid';
  near_account_id: string | null;
  quote_supplier_id: string;
  quote_item_id: string;
  quote_quantity: number;
  quote_unit_price_atomic: string;
  quote_total_amount_atomic: string;
  quote_asset_code: string;
}

export interface PaymentAdapterConfiguration {
  tokenAccountId: string;
  assetCode: string;
}

export interface PaymentOutcome {
  purchaseOrderId: string;
  requestId: string;
  status: PaymentStatus;
  chainState: VaultPaymentState;
  reason: string | null;
  approvalReasons: string[];
  amountAtomic: string;
  supplierAccountId: string;
  commitTransactionHash: string | null;
  requestTransactionHash: string | null;
  updatedAt: string;
}

export type PaymentAdapterErrorCode =
  | 'PURCHASE_ORDER_NOT_FOUND'
  | 'PURCHASE_ORDER_NOT_PAYABLE'
  | 'SUPPLIER_ACCOUNT_NOT_CONFIGURED'
  | 'PURCHASE_ORDER_DATA_MISMATCH'
  | 'ASSET_NOT_CONFIGURED'
  | 'CANONICAL_PURCHASE_ORDER_CONFLICT'
  | 'CANONICAL_PAYMENT_MISSING'
  | 'CHAIN_OPERATION_FAILED';

export class PaymentAdapterError extends Error {
  constructor(
    readonly code: PaymentAdapterErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PaymentAdapterError';
  }
}

const PAYMENT_STATUS: Record<VaultPaymentState, PaymentStatus> = {
  NotRequested: 'not_requested',
  CheckingBalance: 'checking_balance',
  PendingApproval: 'pending_approval',
  Blocked: 'blocked',
  Processing: 'processing',
  Paid: 'paid',
  Failed: 'failed',
  Rejected: 'rejected',
};

/**
 * Commit a persisted PO once, then request payment with the PO ID only. The vault remains
 * authoritative for destination, token, amount, limits, pause state, and idempotency.
 */
export class VaultPaymentAdapter {
  constructor(
    private readonly database: DatabaseHandle,
    private readonly vault: VaultClient,
    private readonly configuration: PaymentAdapterConfiguration,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /** Used by the payment route and by the Sandbox fixture to prepare canonical PO records. */
  async ensurePurchaseOrderCommitted(purchaseOrderId: string): Promise<{
    purchaseOrderId: string;
    commitTransactionHash: string | null;
  }> {
    const purchaseOrder = this.loadPurchaseOrder(purchaseOrderId);
    const supplierAccountId = this.validatePurchaseOrder(purchaseOrder);
    let canonical = await this.readCanonicalPurchaseOrder(purchaseOrder.id);
    let commitTransactionHash: string | null = null;

    if (canonical && !this.matchesCanonical(canonical, purchaseOrder, supplierAccountId)) {
      throw new PaymentAdapterError(
        'CANONICAL_PURCHASE_ORDER_CONFLICT',
        'The on-chain PO commitment does not match the persisted purchase order',
      );
    }

    if (!canonical) {
      try {
        const transaction = await this.vault.commitPurchaseOrder({
          poId: purchaseOrder.id,
          supplierAccountId,
          tokenAccountId: this.configuration.tokenAccountId,
          amountAtomic: formatAtomicAmount(purchaseOrder.amountAtomic),
        });
        commitTransactionHash = transaction.transactionHash;
      } catch {
        // A timeout may follow a successful commit. Read the canonical record before deciding.
        canonical = await this.readCanonicalPurchaseOrder(purchaseOrder.id);
        if (!canonical) {
          throw new PaymentAdapterError(
            'CHAIN_OPERATION_FAILED',
            'The vault did not confirm the purchase order commitment',
          );
        }
      }

      canonical ??= await this.readCanonicalPurchaseOrder(purchaseOrder.id);
      if (!canonical || !this.matchesCanonical(canonical, purchaseOrder, supplierAccountId)) {
        throw new PaymentAdapterError(
          'CANONICAL_PURCHASE_ORDER_CONFLICT',
          'The vault did not store the expected purchase order commitment',
        );
      }
    }

    this.database
      .prepare(
        `UPDATE purchase_orders
         SET status = CASE WHEN status = 'paid' THEN status ELSE 'committed' END,
             commit_transaction_hash = COALESCE(commit_transaction_hash, ?)
         WHERE id = ?`,
      )
      .run(commitTransactionHash, purchaseOrder.id);

    const persistedHash = this.database
      .prepare('SELECT commit_transaction_hash FROM purchase_orders WHERE id = ?')
      .pluck()
      .get(purchaseOrder.id) as string | null | undefined;
    return { purchaseOrderId: purchaseOrder.id, commitTransactionHash: persistedHash ?? null };
  }

  async requestPayment(purchaseOrderId: string): Promise<PaymentOutcome> {
    const committed = await this.ensurePurchaseOrderCommitted(purchaseOrderId);
    const purchaseOrder = this.loadPurchaseOrder(purchaseOrderId);
    const supplierAccountId = this.validatePurchaseOrder(purchaseOrder);
    let requestTransactionHash: string | null = null;

    try {
      const transaction = await this.vault.requestPayment(purchaseOrder.id);
      requestTransactionHash = transaction.transactionHash;
    } catch {
      // The request can be accepted before the RPC response is lost. The state view is decisive.
      const stateAfterError = await this.readPaymentState(purchaseOrder.id);
      if (!stateAfterError || stateAfterError.state === 'NotRequested') {
        throw new PaymentAdapterError(
          'CHAIN_OPERATION_FAILED',
          'The vault did not confirm the payment request',
        );
      }
    }

    const chainRecord = await this.readPaymentState(purchaseOrder.id);
    if (!chainRecord) {
      throw new PaymentAdapterError(
        'CANONICAL_PAYMENT_MISSING',
        'The vault has no payment record for the committed purchase order',
      );
    }
    if (
      chainRecord.po_id !== purchaseOrder.id ||
      chainRecord.request_id !== purchaseOrder.id ||
      parseAtomicAmount(chainRecord.amount) !== purchaseOrder.amountAtomic
    ) {
      throw new PaymentAdapterError(
        'CANONICAL_PURCHASE_ORDER_CONFLICT',
        'The vault payment record does not match the persisted purchase order',
      );
    }

    const status = PAYMENT_STATUS[chainRecord.state];
    const updatedAt = this.clock().toISOString();
    const outcome: PaymentOutcome = {
      purchaseOrderId: purchaseOrder.id,
      requestId: purchaseOrder.id,
      status,
      chainState: chainRecord.state,
      reason: chainRecord.reason,
      approvalReasons: chainRecord.approval_reasons,
      amountAtomic: formatAtomicAmount(purchaseOrder.amountAtomic),
      supplierAccountId,
      commitTransactionHash: committed.commitTransactionHash,
      requestTransactionHash,
      updatedAt,
    };
    this.persistOutcome(outcome);
    return outcome;
  }

  private loadPurchaseOrder(purchaseOrderId: string) {
    const row = this.database
      .prepare(
        `SELECT po.id, po.quote_id, po.supplier_id, po.item_id, po.quantity,
                po.amount_atomic, po.asset_code, po.status,
                s.near_account_id,
                q.supplier_id AS quote_supplier_id,
                q.item_id AS quote_item_id,
                q.quantity AS quote_quantity,
                q.unit_price_atomic AS quote_unit_price_atomic,
                q.total_amount_atomic AS quote_total_amount_atomic,
                q.asset_code AS quote_asset_code
         FROM purchase_orders po
         JOIN suppliers s ON s.id = po.supplier_id
         JOIN quotes q ON q.id = po.quote_id
         WHERE po.id = ?`,
      )
      .get(purchaseOrderId) as PurchaseOrderRow | undefined;
    if (!row) {
      throw new PaymentAdapterError('PURCHASE_ORDER_NOT_FOUND', 'Purchase order was not found');
    }
    if (row.status === 'cancelled') {
      throw new PaymentAdapterError(
        'PURCHASE_ORDER_NOT_PAYABLE',
        'Cancelled purchase orders cannot be paid',
      );
    }
    if (!row.near_account_id?.trim()) {
      throw new PaymentAdapterError(
        'SUPPLIER_ACCOUNT_NOT_CONFIGURED',
        'The registered supplier has no configured NEAR account',
      );
    }
    return {
      ...row,
      id: row.id as PurchaseOrderId,
      amountAtomic: parseAtomicAmount(row.amount_atomic),
    };
  }

  private validatePurchaseOrder(purchaseOrder: ReturnType<VaultPaymentAdapter['loadPurchaseOrder']>) {
    if (purchaseOrder.asset_code !== this.configuration.assetCode) {
      throw new PaymentAdapterError(
        'ASSET_NOT_CONFIGURED',
        'The purchase order asset does not match the configured vault token',
      );
    }
    const unitPrice = parseAtomicAmount(purchaseOrder.quote_unit_price_atomic);
    const quoteAmount = parseAtomicAmount(purchaseOrder.quote_total_amount_atomic);
    if (
      purchaseOrder.quote_supplier_id !== purchaseOrder.supplier_id ||
      purchaseOrder.quote_item_id !== purchaseOrder.item_id ||
      purchaseOrder.quote_quantity !== purchaseOrder.quantity ||
      purchaseOrder.quote_asset_code !== purchaseOrder.asset_code ||
      unitPrice * BigInt(purchaseOrder.quantity) !== quoteAmount ||
      quoteAmount !== purchaseOrder.amountAtomic
    ) {
      throw new PaymentAdapterError(
        'PURCHASE_ORDER_DATA_MISMATCH',
        'The persisted purchase order no longer matches its stored quote',
      );
    }
    return purchaseOrder.near_account_id!.trim();
  }

  private async readCanonicalPurchaseOrder(poId: string): Promise<VaultPurchaseOrder | null> {
    try {
      return await this.vault.getPurchaseOrder(poId);
    } catch {
      throw new PaymentAdapterError(
        'CHAIN_OPERATION_FAILED',
        'The vault purchase order could not be read',
      );
    }
  }

  private async readPaymentState(poId: string): Promise<VaultPaymentRecord | null> {
    try {
      return await this.vault.getPaymentState(poId);
    } catch {
      throw new PaymentAdapterError(
        'CHAIN_OPERATION_FAILED',
        'The vault payment state could not be read',
      );
    }
  }

  private matchesCanonical(
    canonical: VaultPurchaseOrder,
    purchaseOrder: ReturnType<VaultPaymentAdapter['loadPurchaseOrder']>,
    supplierAccountId: string,
  ): boolean {
    return (
      canonical.po_id === purchaseOrder.id &&
      canonical.supplier_id === supplierAccountId &&
      canonical.token_id === this.configuration.tokenAccountId &&
      parseAtomicAmount(canonical.amount) === purchaseOrder.amountAtomic
    );
  }

  private persistOutcome(outcome: PaymentOutcome): void {
    this.database.transaction(() => {
      const previous = this.database
        .prepare('SELECT status FROM payments WHERE purchase_order_id = ?')
        .get(outcome.purchaseOrderId) as { status: PaymentStatus } | undefined;
      const paymentId = previous
        ? (this.database
            .prepare('SELECT id FROM payments WHERE purchase_order_id = ?')
            .pluck()
            .get(outcome.purchaseOrderId) as string)
        : allocateId(this.database, 'payment');

      this.database
        .prepare(
          `INSERT INTO payments
             (id, purchase_order_id, amount_atomic, asset_code, status, request_id, updated_at,
              request_transaction_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(purchase_order_id) DO UPDATE SET
             amount_atomic = excluded.amount_atomic,
             asset_code = excluded.asset_code,
             status = excluded.status,
             request_id = excluded.request_id,
             updated_at = excluded.updated_at,
             request_transaction_hash = COALESCE(excluded.request_transaction_hash,
                                                   payments.request_transaction_hash)`,
        )
        .run(
          paymentId,
          outcome.purchaseOrderId,
          outcome.amountAtomic,
          this.configuration.assetCode,
          outcome.status,
          outcome.requestId,
          outcome.updatedAt,
          outcome.requestTransactionHash,
        );

      this.database
        .prepare(
          `UPDATE purchase_orders
           SET status = CASE WHEN ? = 'paid' THEN 'paid' ELSE 'committed' END
           WHERE id = ?`,
        )
        .run(outcome.status, outcome.purchaseOrderId);

      if (previous?.status === outcome.status) return;
      this.database
        .prepare(
          `INSERT INTO audit_events
             (id, entity_type, entity_id, event_type, payload_json, occurred_at)
           VALUES (?, 'payment', ?, 'payment_status_changed', ?, ?)`,
        )
        .run(
          allocateId(this.database, 'auditEvent'),
          outcome.purchaseOrderId,
          JSON.stringify({
            purchaseOrderId: outcome.purchaseOrderId,
            requestId: outcome.requestId,
            fromStatus: previous?.status ?? null,
            toStatus: outcome.status,
            chainState: outcome.chainState,
            reason: outcome.reason,
            approvalReasons: outcome.approvalReasons,
            amountAtomic: outcome.amountAtomic,
            supplierAccountId: outcome.supplierAccountId,
            commitTransactionHash: outcome.commitTransactionHash,
            requestTransactionHash: outcome.requestTransactionHash,
          }),
          outcome.updatedAt,
        );
    }).immediate();
  }
}

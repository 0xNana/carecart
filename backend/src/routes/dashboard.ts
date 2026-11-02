import type { FastifyInstance } from 'fastify';
import { loadDomainRecords, type DatabaseHandle } from '../db';

/** Read-only judge snapshot. All quantities, identities and status flags come from the backend. */
export function registerDashboardRoutes(app: FastifyInstance, database: DatabaseHandle, clock: () => Date) {
  app.get('/api/dashboard', async (_request, reply) => {
    const records = loadDomainRecords(database);
    const now = clock();
    const usedQuotes = new Set(records.purchaseOrders.map((po) => po.quoteId));
    const paymentDetails = database.prepare(`SELECT po.id, po.commit_transaction_hash, p.request_transaction_hash,
      p.updated_at FROM purchase_orders po LEFT JOIN payments p ON p.purchase_order_id = po.id`).all() as Array<{
      id: string; commit_transaction_hash: string | null; request_transaction_hash: string | null; updated_at: string | null;
    }>;
    return reply.header('Cache-Control', 'no-store').send({
      dataOrigin: 'synthetic',
      generatedAt: now.toISOString(),
      inventory: records.inventoryItems.map((item) => ({ ...item, isLowStock: item.onHand <= item.reorderPoint })),
      suppliers: records.suppliers.map(({ id, displayName }) => ({ id, displayName })),
      quotes: records.quotes.slice(-100).reverse().map((quote) => ({
        ...quote, unitPriceAtomic: quote.unitPriceAtomic.toString(), totalAmountAtomic: quote.totalAmountAtomic.toString(),
        used: usedQuotes.has(quote.id), expired: Date.parse(quote.expiresAt) <= now.getTime(),
      })),
      purchaseOrders: records.purchaseOrders.slice(-50).reverse().map((po) => ({
        ...po, amountAtomic: po.amountAtomic.toString(),
        paymentStatus: records.payments.find((payment) => payment.purchaseOrderId === po.id)?.status ?? 'not_requested',
        commitTransactionHash: paymentDetails.find((entry) => entry.id === po.id)?.commit_transaction_hash ?? null,
        requestTransactionHash: paymentDetails.find((entry) => entry.id === po.id)?.request_transaction_hash ?? null,
        paymentUpdatedAt: paymentDetails.find((entry) => entry.id === po.id)?.updated_at ?? null,
      })),
      auditEvents: records.auditEvents.slice(-50).reverse(),
    });
  });
}

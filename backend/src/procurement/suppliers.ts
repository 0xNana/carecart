import { allocateId, loadDomainRecords, type DatabaseHandle } from '../db';
import { formatAtomicAmount, parseAtomicAmount, type InventoryItemId, type Quote } from '../domain';
import { calculateInventoryForecast } from './forecast';

export interface SimulatedSupplierQuote extends Quote {
  leadTimeDays: number;
}

export type SupplierQuoteResult =
  | { kind: 'not_found' }
  | { kind: 'no_reorder_needed' }
  | { kind: 'created'; quotes: SimulatedSupplierQuote[] };

const QUOTE_VALIDITY_DAYS = 7;

/** Persist a quote per registered supplier using only trusted catalog identity and pricing. */
export function createSupplierQuotes(
  database: DatabaseHandle,
  itemId: string,
  now = new Date(),
): SupplierQuoteResult {
  const quotedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + QUOTE_VALIDITY_DAYS * 24 * 60 * 60 * 1000).toISOString();

  return database.transaction((): SupplierQuoteResult => {
    const forecast = calculateInventoryForecast(database, itemId);
    if (!forecast) return { kind: 'not_found' };
    if (!forecast.isLowStock) return { kind: 'no_reorder_needed' };

    const quantity = Math.max(
      0,
      ...forecast.supplierForecasts.map((entry) => entry.recommendedQuantity),
    );
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      throw new Error('low-stock item has no positive registered supplier quote quantity');
    }

    const records = loadDomainRecords(database);
    const entries = records.supplierCatalogEntries
      .filter((entry) => entry.itemId === itemId)
      .sort((left, right) => left.supplierId.localeCompare(right.supplierId));
    const forecastsBySupplier = new Map(
      forecast.supplierForecasts.map((entry) => [entry.supplierId, entry]),
    );
    if (entries.length === 0) throw new Error('low-stock item has no registered supplier catalog');

    const insertQuote = database.prepare(
      `INSERT INTO quotes
         (id, supplier_id, item_id, quantity, unit_price_atomic, total_amount_atomic,
          asset_code, quoted_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const quotes: SimulatedSupplierQuote[] = [];
    for (const entry of entries) {
      const supplierForecast = forecastsBySupplier.get(entry.supplierId);
      if (!supplierForecast) throw new Error('catalog supplier is missing a forecast');
      const quoteId = allocateId(database, 'quote');
      const totalAmountAtomic = parseAtomicAmount(entry.unitPriceAtomic * BigInt(quantity));
      const quote: SimulatedSupplierQuote = {
        id: quoteId,
        supplierId: entry.supplierId,
        itemId: itemId as InventoryItemId,
        quantity,
        unitPriceAtomic: entry.unitPriceAtomic,
        totalAmountAtomic,
        assetCode: entry.assetCode,
        quotedAt,
        expiresAt,
        leadTimeDays: supplierForecast.leadTimeDays,
      };
      insertQuote.run(
        quote.id,
        quote.supplierId,
        quote.itemId,
        quote.quantity,
        formatAtomicAmount(quote.unitPriceAtomic),
        formatAtomicAmount(quote.totalAmountAtomic),
        quote.assetCode,
        quote.quotedAt,
        quote.expiresAt,
      );
      quotes.push(quote);
    }

    return { kind: 'created', quotes };
  }).immediate();
}

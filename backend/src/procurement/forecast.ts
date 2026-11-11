import { loadDomainRecords, type DatabaseHandle } from '../db';
import type { InventoryItemId, SupplierId } from '../domain';

export const USAGE_WINDOW_DAYS = 30;

/** Shared exact quantity calculation for the isolated CCTEST and native-USDC domains. */
export function forecastQuantity(onHand: number, reorderPoint: number, usageUnits: number, leadTimeDays: number) {
  if (![onHand, reorderPoint, usageUnits, leadTimeDays].every(Number.isSafeInteger) ||
      onHand < 0 || reorderPoint < 0 || usageUnits < 0 || leadTimeDays <= 0)
    throw new RangeError('forecast inputs must be non-negative safe integers with positive lead time');
  const numerator = BigInt(usageUnits) * BigInt(leadTimeDays);
  const demand = (numerator + BigInt(USAGE_WINDOW_DAYS) - 1n) / BigInt(USAGE_WINDOW_DAYS);
  const needed = BigInt(reorderPoint) + demand - BigInt(onHand);
  const recommended = needed > 0n ? needed : 0n;
  if (demand > BigInt(Number.MAX_SAFE_INTEGER) || recommended > BigInt(Number.MAX_SAFE_INTEGER))
    throw new RangeError('forecast quantity exceeds the safe integer range');
  return { leadTimeDemand: Number(demand), recommendedQuantity: Number(recommended) };
}

export interface SupplierForecast {
  supplierId: SupplierId;
  supplierName: string;
  leadTimeDays: number;
  leadTimeDemand: number;
  recommendedQuantity: number;
}

export interface InventoryForecast {
  itemId: InventoryItemId;
  itemName: string;
  unit: string;
  onHand: number;
  reorderPoint: number;
  isLowStock: boolean;
  usageWindowDays: number;
  observedUsageUnits: number;
  supplierForecasts: SupplierForecast[];
}

/**
 * Forecast from the fixed 30-day synthetic usage window and trusted supplier catalog.
 * Integer ceiling arithmetic avoids fractional stock quantities and floating-point drift.
 */
export function calculateInventoryForecast(
  database: DatabaseHandle,
  itemId: string,
): InventoryForecast | null {
  const records = loadDomainRecords(database);
  const item = records.inventoryItems.find((candidate) => candidate.id === itemId);
  if (!item) return null;

  const observedUsageUnits = records.usageRecords
    .filter((record) => record.itemId === item.id)
    .reduce((total, record) => total + record.quantity, 0);
  if (!Number.isSafeInteger(observedUsageUnits)) {
    throw new RangeError('synthetic usage total exceeds the safe integer range');
  }

  const supplierForecasts = records.supplierCatalogEntries
    .filter((entry) => entry.itemId === item.id)
    .map((entry) => {
      const supplier = records.suppliers.find((candidate) => candidate.id === entry.supplierId);
      if (!supplier) throw new Error('supplier catalog references an unregistered supplier');
      if (!Number.isSafeInteger(entry.leadTimeDays) || entry.leadTimeDays <= 0) {
        throw new RangeError('supplier lead time must be a positive safe integer');
      }
      const { leadTimeDemand, recommendedQuantity } = forecastQuantity(item.onHand, item.reorderPoint,
        observedUsageUnits, entry.leadTimeDays);
      return {
        supplierId: supplier.id,
        supplierName: supplier.displayName,
        leadTimeDays: entry.leadTimeDays,
        leadTimeDemand,
        recommendedQuantity,
      };
    })
    .sort((left, right) => left.supplierId.localeCompare(right.supplierId));

  return {
    itemId: item.id,
    itemName: item.name,
    unit: item.unit,
    onHand: item.onHand,
    reorderPoint: item.reorderPoint,
    isLowStock: item.onHand <= item.reorderPoint,
    usageWindowDays: USAGE_WINDOW_DAYS,
    observedUsageUnits,
    supplierForecasts,
  };
}

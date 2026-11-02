export interface Item { id: string; name: string; unit: string; onHand: number; reorderPoint: number; isLowStock: boolean }
export interface Quote { id: string; itemId: string; supplierId: string; quantity: number; totalAmountAtomic: string; unitPriceAtomic: string; assetCode: string; expiresAt: string; used: boolean; expired: boolean }
export interface Order { id: string; itemId: string; supplierId: string; quantity: number; amountAtomic: string; assetCode: string; status: string; paymentStatus: string; createdAt: string; commitTransactionHash: string | null; requestTransactionHash: string | null; paymentUpdatedAt: string | null }
export interface Audit { id: string; entityId: string; entityType: string; eventType: string; payload: Record<string, unknown>; occurredAt: string }
export interface Snapshot { dataOrigin: 'synthetic'; generatedAt: string; inventory: Item[]; suppliers: { id: string; displayName: string }[]; quotes: Quote[]; purchaseOrders: Order[]; auditEvents: Audit[] }
export interface Forecast { itemId: string; observedUsageUnits: number; usageWindowDays: number; supplierForecasts: { supplierId: string; leadTimeDays: number; leadTimeDemand: number; recommendedQuantity: number }[] }

export async function api<T>(path: string, body?: object, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/${path}`, { method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined, cache: 'no-store', signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'The request could not be completed. Please try again.');
  return data as T;
}
export const amount = (value: string) => BigInt(value).toLocaleString('en-US');
export const label = (value: string) => value.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
export const date = (value: string) => new Date(value).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });

export const units = (unit: string, count: number) => count === 1 ? unit : unit === 'box' ? 'boxes' : `${unit}s`;

'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Forecast, type Snapshot } from '@/lib/procurement';

export function useProcurement() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [selectedId, selectItem] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [forecastState, setForecast] = useState<{ data?: Forecast; error?: string; key: string }>({ key: '' });
  const requestIds = useRef(new Map<string, string>());
  const item = snapshot?.inventory.find((entry) => entry.id === selectedId) ?? snapshot?.inventory[0];
  const itemId = item?.id;
  const forecastKey = `${item?.id}:${snapshot?.generatedAt}`;

  const refresh = useCallback(async () => {
    setBusy('refresh'); setError(''); setNotice('');
    try { setSnapshot(await api<Snapshot>('dashboard')); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load the workspace.'); }
    finally { setBusy(''); }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    api<Snapshot>('dashboard', undefined, controller.signal).then(setSnapshot).catch((cause: Error) => {
      if (!controller.signal.aborted) setError(cause.message);
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!itemId) return;
    const controller = new AbortController();
    api<Forecast>(`inventory/${itemId}/forecast`, undefined, controller.signal)
      .then((data) => setForecast({ data, key: forecastKey }))
      .catch((cause: Error) => {
        if (!controller.signal.aborted) setForecast({ error: cause.message, key: forecastKey });
      });
    return () => controller.abort();
  }, [itemId, forecastKey]); // A refreshed snapshot also refreshes the server forecast.

  async function generateQuotes() {
    if (!item) return;
    setBusy('quotes'); setError(''); setNotice('');
    try {
      await api('supplier-quotes', { itemId: item.id });
      setNotice('New simulated quotes saved. Choose a supplier to draft a purchase order.');
      setSnapshot(await api<Snapshot>('dashboard'));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Quotes could not be generated.'); }
    finally { setBusy(''); }
  }

  async function draftOrder(quoteId: string) {
    if (!item) return;
    setBusy(quoteId); setError(''); setNotice('');
    // Preserve the same request ID on retries after an ambiguous response.
    const requestId = requestIds.current.get(quoteId) ?? crypto.randomUUID();
    requestIds.current.set(quoteId, requestId);
    try {
      const result = await api<{ purchaseOrder: { id: string }; replayed: boolean }>('purchase-orders', { requestId, itemId: item.id, quoteId });
      setNotice(`${result.purchaseOrder.id} ${result.replayed ? 'restored' : 'drafted'}. The supplier and amount come from the stored quote. No payment requested.`);
      setSnapshot(await api<Snapshot>('dashboard'));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The order could not be drafted.'); }
    finally { setBusy(''); }
  }
  return { snapshot, item, selectItem, error, busy, notice, refresh, generateQuotes, draftOrder,
    forecast: forecastState.key === forecastKey ? forecastState.data : undefined,
    forecastError: forecastState.key === forecastKey ? forecastState.error : undefined };
}

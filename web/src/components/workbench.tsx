import { amount, date, units, type Forecast, type Item, type Snapshot } from '@/lib/procurement';

interface Props { item: Item; snapshot: Snapshot; forecast?: Forecast; forecastError?: string; busy: string; generateQuotes: () => void; draftOrder: (id: string) => void; refresh: () => void }
export function Workbench({ item, snapshot, forecast, forecastError, busy, generateQuotes, draftOrder, refresh }: Props) {
  const quotes = snapshot.quotes.filter((quote) => quote.itemId === item.id);
  const supplierName = (id: string) => snapshot.suppliers.find((supplier) => supplier.id === id)?.displayName ?? id;
  return <section className="panel workbench" aria-labelledby="workbench-title">
    <div className="section-top"><div><span className="eyebrow">Reorder workspace</span><h2 id="workbench-title">{item.name.replace('Synthetic ', '')}</h2></div><span className="tag muted-tag">{item.id}</span></div>
    <div className="forecast" aria-busy={!forecast && !forecastError}>
      <div className="section-top"><h3><span className="step-number">01</span> Demand forecast</h3><span className="caption">Deterministic · backend calculated</span></div>
      {forecastError ? <div role="alert" className="inline-error">{forecastError} <button className="text-button" onClick={refresh}>Retry forecast</button></div>
        : !forecast ? <p role="status" className="loading-line">Loading demand forecast…</p> : <>
          <p className="forecast-summary"><strong>{forecast.observedUsageUnits} {units(item.unit, forecast.observedUsageUnits)}</strong> used in the {forecast.usageWindowDays}-day synthetic window.</p>
          {forecast.supplierForecasts.length === 0 ? <p className="empty">No registered supplier forecast is available for this item.</p> : <div className="forecast-grid">{forecast.supplierForecasts.map((entry) => <div key={entry.supplierId} className="forecast-supplier"><span>{supplierName(entry.supplierId).replace('Synthetic Demo Supplier ', 'Supplier ')}</span><strong>{entry.recommendedQuantity} <small>{units(item.unit, entry.recommendedQuantity)}</small></strong><span className="caption">Recommended · {entry.leadTimeDays}-day lead time</span></div>)}</div>}
        </>}
    </div>
    <div className="quotes-section">
      <div className="section-top"><h3><span className="step-number">02</span> Supplier quotes</h3><button className="button primary small" onClick={generateQuotes} disabled={!!busy || !item.isLowStock}>{busy === 'quotes' ? 'Getting quotes…' : 'Get fresh quotes'} <span aria-hidden="true">↗</span></button></div>
      <p className="caption">Simulated catalog prices. Drafts use the stored quote’s supplier, quantity and amount.</p>
      {quotes.length === 0 ? <div className="empty quote-empty"><span aria-hidden="true">≋</span><h4>No quotes yet</h4><p>Get fresh quotes to compare registered suppliers for this item.</p></div>
        : <div className="quote-list">{quotes.map((quote) => <div className="quote-row" key={quote.id}>
          <div><strong>{supplierName(quote.supplierId).replace('Synthetic Demo Supplier ', 'Supplier ')}</strong><span className="caption">{quote.quantity} {units(item.unit, quote.quantity)} · {quote.id}</span><span className="caption">Expires {date(quote.expiresAt)} UTC</span></div>
          <div className="quote-price"><strong>{amount(quote.totalAmountAtomic)}</strong><span className="caption">{quote.assetCode} atomic units</span></div>
          <button className="button small" onClick={() => draftOrder(quote.id)} disabled={!!busy || quote.used || quote.expired}>{busy === quote.id ? 'Drafting…' : quote.used ? 'Order drafted' : quote.expired ? 'Expired' : 'Draft order'}</button>
        </div>)}</div>}
    </div>
    <div className="boundary-note"><span aria-hidden="true">◇</span><p>A draft creates an auditable purchase order. The NEAR vault enforces payment policy when a payment is requested.</p></div>
  </section>;
}

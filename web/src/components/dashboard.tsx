'use client';
import Link from 'next/link';
import { useProcurement } from './use-procurement';
import { Workbench } from './workbench';
import { Records } from './records';
import { date, units } from '@/lib/procurement';
import { WalletControls } from './wallet-controls';
import { CrossChainPreview } from './cross-chain-preview';

export function Dashboard() {
  const state = useProcurement();
  const { snapshot, item, busy, error, notice } = state;
  return <div className="app-shell">
    <a className="skip-link" href="#main">Skip to workspace</a>
    <aside className="sidebar"><Link className="brand" href="/" aria-label="CareCart home"><span className="brand-mark" aria-hidden="true">c<span>+</span></span>carecart<span className="brand-dot">.</span></Link>
      <span className="sidebar-label">Procurement</span><nav aria-label="Workspace navigation"><a className="nav-link active" href="#main"><span aria-hidden="true">▦</span> Overview</a><a className="nav-link" href="#inventory"><span aria-hidden="true">▤</span> Inventory</a><a className="nav-link" href="#orders"><span aria-hidden="true">▧</span> Purchase orders</a><a className="nav-link" href="#audit"><span aria-hidden="true">◷</span> Audit trail</a></nav>
      <div className="sidebar-bottom"><span className="environment-dot"/>Local procurement demo<p>Built with synthetic healthcare supply data.</p><span className="caption">CareCart / Real-World Money</span></div>
    </aside>
    <div className="main-shell"><header className="topbar"><span>Workspace <span className="breadcrumb">/ Overview</span></span><div className="topbar-tags"><span className="tag"><span className="environment-dot"/>Synthetic data</span><span className="tag muted-tag">Testnet prototype</span></div></header>
      <main id="main" tabIndex={-1}>
        <div className="page-heading"><div><span className="eyebrow">Supply operations</span><h1>Procurement overview</h1><p>From low stock to a traceable purchase order.</p></div><button className="button" disabled={!!busy} onClick={state.refresh}><span aria-hidden="true">↻</span> {busy === 'refresh' ? 'Refreshing…' : 'Refresh data'}</button></div>
        <div className="demo-banner"><span className="banner-icon" aria-hidden="true">✳</span><div><strong>A working procurement demo, with synthetic data.</strong><p>Review stock, compare simulated quotes and draft orders. Human wallet controls use NEAR testnet and the CCTEST test token only.</p></div><span className="tag muted-tag">No live model</span></div>
        <WalletControls />
        {error && <div role="alert" className="error-banner"><strong>Something needs attention</strong><p>{error}</p><button className="button small" onClick={state.refresh} disabled={!!busy}>Try again</button></div>}
        <div role="status" aria-live="polite" className={notice ? 'notice' : 'sr-only'}>{notice}</div>
        {!snapshot ? error ? <section className="panel empty"><h2>Connect to your procurement data</h2><p>The workspace will appear when the backend is available. Use “Try again” to reconnect.</p></section> : <div role="status" aria-busy="true" aria-label="Loading procurement workspace" className="loading-workspace"><p>Loading your procurement workspace…</p><div className="skeleton"/><div className="skeleton"/></div> : <>
          <section className="metrics" aria-label="Workspace summary"><div><span className="metric-label">Inventory items</span><strong>{snapshot.inventory.length.toString().padStart(2, '0')}</strong><span className="caption">Synthetic supplies tracked</span></div><div><span className="metric-label">Reorder attention</span><strong className="attention-number">{snapshot.inventory.filter((entry) => entry.isLowStock).length.toString().padStart(2, '0')}<span className="metric-dot"/></strong><span className="caption">At or below reorder point</span></div><div><span className="metric-label">Purchase orders</span><strong>{snapshot.purchaseOrders.length.toString().padStart(2, '0')}</strong><span className="caption">Latest persisted orders</span></div><div><span className="metric-label">Registered suppliers</span><strong>{snapshot.suppliers.length.toString().padStart(2, '0')}</strong><span className="caption">Trusted catalog identities</span></div></section>
          <div className="procurement-grid"><section id="inventory" className="panel inventory-panel" aria-labelledby="inventory-title"><div className="section-top"><div><span className="eyebrow">Start here</span><h2 id="inventory-title">Inventory</h2></div><span className="tag muted-tag">{snapshot.inventory.length} items</span></div><p className="section-description">Select an item to review demand and supplier quotes.</p>
            {snapshot.inventory.length === 0 ? <p className="empty">No inventory is available. Add synthetic inventory in the backend to begin.</p> : <div className="item-list">{snapshot.inventory.map((entry) => <button key={entry.id} className={`inventory-item ${entry.id === item?.id ? 'selected' : ''}`} aria-pressed={entry.id === item?.id} onClick={() => state.selectItem(entry.id)} disabled={!!busy}><span className="item-category" aria-hidden="true">{entry.unit === 'box' ? '▥' : '⊞'}</span><span className="item-content"><strong>{entry.name.replace('Synthetic ', '')}</strong><span className={`stock-label ${entry.isLowStock ? 'stock-low' : ''}`}>{entry.isLowStock ? 'Reorder needed' : 'Stock healthy'}</span><span className="stock-count"><strong>{entry.onHand}</strong> {units(entry.unit, entry.onHand)} on hand <span> / reorder at {entry.reorderPoint}</span></span></span><span className="item-arrow" aria-hidden="true">→</span></button>)}</div>}
            <div className="inventory-note"><strong>Backend forecasts</strong><p>Recommendations use synthetic usage history and registered supplier lead times.</p></div></section>
            {item ? <Workbench item={item} snapshot={snapshot} forecast={state.forecast} forecastError={state.forecastError} busy={busy} generateQuotes={state.generateQuotes} draftOrder={state.draftOrder} refresh={state.refresh}/> : <section className="panel empty"><h2>Your reorder workspace</h2><p>Select an inventory item when one becomes available.</p></section>}
          </div><Records snapshot={snapshot}/><CrossChainPreview snapshot={snapshot}/><footer className="footer"><span>CareCart · Synthetic data only</span><span>Snapshot {date(snapshot.generatedAt)} UTC</span></footer>
        </>}
      </main>
    </div>
  </div>;
}

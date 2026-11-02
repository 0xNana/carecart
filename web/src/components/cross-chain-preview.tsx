'use client';
import { useEffect, useState } from 'react';
import { api, amount, date, type Snapshot } from '@/lib/procurement';

interface PreviewConfig { mode: 'mock_simulation'; settlementEnabled: false; dryQuoteAvailable: boolean; destinationChains: string[] }
interface MockPreview { mode: 'mock_simulation'; status: 'preview_only'; settlement: 'not_initiated'; notice: string; generatedAt: string;
  purchaseOrderId: string; supplierName: string; supplierId: string; amountAtomic: string; assetCode: string; destinationChain: string; simulatedRecipient: string; steps: string[] }
interface DryPreview { mode: 'oneclick_dry_preview'; status: 'preview_only'; settlement: 'not_initiated'; notice: string; generatedAt: string; dry: true;
  origin: { symbol: string; blockchain: string; assetId: string }; destination: { symbol: string; blockchain: string; assetId: string };
  amountInAtomic: string; amountOutAtomic: string; minAmountOutAtomic: string; recipient: string; refundTo: string; correlationId: string }
const chainName: Record<string, string> = { base: 'Base', arb: 'Arbitrum', sol: 'Solana' };
export function CrossChainPreview({ snapshot }: { snapshot: Snapshot }) {
  const [config, setConfig] = useState<PreviewConfig>();
  const [configError, setConfigError] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [chain, setChain] = useState('base');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [simulation, setSimulation] = useState<MockPreview>();
  const [dry, setDry] = useState<DryPreview>();
  const orderId = snapshot.purchaseOrders.some((entry) => entry.id === selectedId) ? selectedId : snapshot.purchaseOrders[0]?.id;
  useEffect(() => {
    const controller = new AbortController();
    api<PreviewConfig>('intents/config', undefined, controller.signal).then(setConfig).catch((cause: Error) => {
      if (!controller.signal.aborted) setConfigError(cause.message);
    });
    return () => controller.abort();
  }, []);
  async function retryConfig() {
    setConfigError('');
    try { setConfig(await api<PreviewConfig>('intents/config')); }
    catch (cause) { setConfigError(cause instanceof Error ? cause.message : 'Could not load preview options.'); }
  }
  async function run(mode: 'mock' | 'dry') {
    setBusy(mode); setError('');
    if (mode === 'mock') setSimulation(undefined); else setDry(undefined);
    try {
      if (mode === 'mock') setSimulation(await api<MockPreview>('intents/preview', { purchaseOrderId: orderId, destinationChain: chain }));
      else setDry(await api<DryPreview>('intents/dry-quote', {}));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The preview could not be generated.'); }
    finally { setBusy(''); }
  }
  return <section id="cross-chain" className="panel cross-chain-panel" aria-labelledby="cross-chain-title">
    <div className="section-top"><div><span className="eyebrow">Explore the route</span><h2 id="cross-chain-title">Cross-chain preview</h2></div><span className="tag muted-tag">Simulation only · No settlement</span></div>
    <p className="section-description">NEAR Intents has no testnet deployment. This offline adapter demonstrates a route using synthetic order data. It creates no deposit address and moves no funds.</p>
    <div className="preview-content">
      {configError && <div className="error-banner" role="alert"><p>{configError}</p><button className="button small" onClick={() => void retryConfig()}>Reload preview options</button></div>}
      {!config && !configError && <p role="status">Loading preview options…</p>}
      {snapshot.purchaseOrders.length ? <div className="preview-fields"><label>Stored purchase order<select value={orderId} disabled={!!busy} onChange={(event) => { setSelectedId(event.target.value); setSimulation(undefined); }}>
        {snapshot.purchaseOrders.map((po) => <option key={po.id} value={po.id}>{po.id} · {amount(po.amountAtomic)} {po.assetCode} atomic</option>)}</select></label><label>Simulated destination<select value={chain} disabled={!!busy} onChange={(event) => { setChain(event.target.value); setSimulation(undefined); }}>
        {(config?.destinationChains ?? ['base', 'arb', 'sol']).map((value) => <option key={value} value={value}>{chainName[value] ?? value}</option>)}</select></label></div> : <p className="empty">Draft a purchase order to explore an offline cross-chain simulation.</p>}
      <button className="button" disabled={!!busy || !orderId} onClick={() => void run('mock')}>{busy === 'mock' ? 'Simulating route…' : 'Run offline simulation'}</button>
      {error && <p role="alert" className="error-banner">{error}</p>}
      {simulation && simulation.purchaseOrderId === orderId && simulation.destinationChain === chain && <div className="preview-result" role="status"><strong>Simulation generated · Settlement not initiated</strong><p>{simulation.purchaseOrderId} · {simulation.supplierName} · {amount(simulation.amountAtomic)} {simulation.assetCode} atomic</p><p>NEAR testnet → {chainName[simulation.destinationChain]} simulation. No exchange rate or deliverable output is quoted.</p><p>Registered supplier: <span className="mono">{simulation.supplierId}</span></p><p>Placeholder destination: <span className="mono">{simulation.simulatedRecipient}</span></p><ol>{simulation.steps.map((step) => <li key={step}>{step}</li>)}</ol><p>{simulation.notice}</p><span className="caption">Preview at {date(simulation.generatedAt)} UTC</span></div>}
      <div className="dry-preview"><h3>Optional 1Click market preview</h3><p>When configured, a dry quote reads mainnet market data for a separate server-reviewed route and amount. It does not price or pay your CCTEST order.</p>
        {config?.dryQuoteAvailable ? <button className="button small" disabled={!!busy} onClick={() => void run('dry')}>{busy === 'dry' ? 'Reading dry market quote…' : 'Get dry market quote'}</button> : <p className="caption">Dry market quotes are not configured. Offline simulation remains available.</p>}
        {dry && <div className="preview-result" role="status"><strong>Dry market preview · Mainnet data only · Not a payment</strong><p>{dry.origin.symbol} on {dry.origin.blockchain} → {dry.destination.symbol} on {dry.destination.blockchain}</p><dl className="review-facts"><dt>Input atomic</dt><dd>{amount(dry.amountInAtomic)}</dd><dt>Estimated output atomic</dt><dd>{amount(dry.amountOutAtomic)}</dd><dt>Minimum output atomic</dt><dd>{amount(dry.minAmountOutAtomic)}</dd><dt>Configured recipient</dt><dd>{dry.recipient}</dd><dt>Configured refund</dt><dd>{dry.refundTo}</dd></dl><p>{dry.notice}</p><span className="caption">Quote {dry.correlationId} · {date(dry.generatedAt)} UTC · Estimates can change; request a fresh preview.</span></div>}
      </div>
    </div>
  </section>;
}

'use client';
import { useState } from 'react';
import { api, amount, date, label, type Order } from '@/lib/procurement';
import { transactionUrl, type CanonicalPayment } from '@/lib/near';
import { useNear } from '@/providers/near-provider';

export function PaymentStatus({ order }: { order: Order }) {
  const near = useNear();
  const [saved, setRecord] = useState<{ data: CanonicalPayment; revision: number }>();
  const record = saved?.revision === near.revision ? saved.data : undefined;
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [checkedAt, setCheckedAt] = useState('');
  async function check() {
    setBusy(true); setError(''); setRecord(undefined);
    try { setRecord({ data: await api<CanonicalPayment>(`vault/payments/${order.id}`), revision: near.revision }); setCheckedAt(new Date().toISOString()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not read payment status.'); }
    finally { setBusy(false); }
  }
  return <div className="payment-status"><span className="caption">Recorded: {label(order.paymentStatus)}</span>
    {order.paymentUpdatedAt && <span className="caption">{date(order.paymentUpdatedAt)} UTC</span>}
    {[['PO commitment', order.commitTransactionHash], ['Payment request', order.requestTransactionHash]].map(([title, hash]) => {
      const url = hash && transactionUrl(hash);
      return url ? <a key={title} className="text-link caption" href={url} target="_blank" rel="noreferrer">{title} ↗</a> : null;
    })}
    <button className="button small" disabled={busy || near.loading || near.vault?.deployment !== 'ready'} onClick={() => void check()}>{busy ? 'Reading…' : 'Check on-chain status'}</button>
    {near.vault?.deployment === 'not_deployed' && <span className="caption">Awaiting testnet deployment</span>}
    {error && <p role="alert" className="payment-error">{error}</p>}
    {record && <div className="canonical-payment" role="status"><strong>On-chain: {record.payment?.state.replace(/([a-z])([A-Z])/g, '$1 $2') ?? 'Not committed'}</strong>
      {record.purchaseOrder && <><span className="caption">{amount(record.purchaseOrder.amount)} CCTEST atomic</span><span className="caption">Payee: {record.purchaseOrder.supplier_id}</span></>}
      {record.payment?.reason && <span className="caption">Reason: {record.payment.reason}</span>}
      {!!record.payment?.approval_reasons.length && <span className="caption">Approval reasons: {record.payment.approval_reasons.join(', ')}</span>}
      <span className="caption">Checked {date(checkedAt)} UTC</span>
      {record.payment?.state === 'PendingApproval' && <>{near.vault?.paused && <span className="caption">Resume the vault before approval.</span>}<div className="wallet-actions"><button className="button small" disabled={!near.canAdmin || busy || near.vault?.paused} onClick={() => near.prepare({ method: 'approve_payment', args: { po_id: order.id } }, record)}>Review approval</button><button className="button small" disabled={!near.canAdmin || busy} onClick={() => near.prepare({ method: 'reject_payment', args: { po_id: order.id } }, record)}>Review rejection</button></div></>}
    </div>}
  </div>;
}

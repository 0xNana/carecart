'use client';
import { useEffect, useRef } from 'react';
import { useNear } from '@/providers/near-provider';
import { amount } from '@/lib/procurement';

export function TransactionReview() {
  const { review, walletBusy, cancel, submit } = useNear();
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (review) { dialog.current?.showModal(); cancelButton.current?.focus(); }
    else dialog.current?.close();
  }, [review]);
  return <dialog ref={dialog} className="transaction-review" aria-labelledby="review-title" onCancel={(event) => { event.preventDefault(); cancel(); }}>
    {review && <><span className="eyebrow">Human authorization · NEAR testnet</span><h2 id="review-title">Review wallet transaction</h2>
      <p>Check these details before continuing. Your wallet will ask you to authorize the transaction. Test assets only.</p>
      <dl className="review-facts"><dt>Signing account</dt><dd>{review.transaction.signerId}</dd><dt>Contract</dt><dd>{review.transaction.receiverId}</dd><dt>Action</dt><dd className="mono">{review.action.method}</dd><dt>Attached NEAR</dt><dd>0 test NEAR</dd><dt>Gas limit</dt><dd>100 TGas · gas fees apply</dd></dl>
      {review.payment?.purchaseOrder && <div className="review-payment"><strong>{review.payment.purchaseOrder.po_id} · {amount(review.payment.purchaseOrder.amount)} CCTEST atomic units</strong><p>Payee: {review.payment.purchaseOrder.supplier_id}</p><p>Token: {review.payment.purchaseOrder.token_id}</p><p>Approval reasons: {review.payment.payment?.approval_reasons.join(', ')}</p></div>}
      {review.action.method === 'set_paused' && <p><strong>{review.action.args.paused ? 'Pause vault payments.' : 'Resume vault payments.'}</strong></p>}
      {review.action.method === 'set_policy' && <p>The token stays fixed. These limits govern automatic payments; exceeding them requires human approval. The balance cap is the cumulative spending budget.</p>}
      <details open><summary>Exact contract arguments</summary><pre>{JSON.stringify(review.action.args, null, 2)}</pre></details>
      <div className="wallet-actions"><button ref={cancelButton} className="button" onClick={cancel} disabled={walletBusy}>Cancel</button><button className="button primary" onClick={() => { dialog.current?.close(); void submit(); }} disabled={walletBusy}>Continue to testnet wallet</button></div>
    </>}
  </dialog>;
}

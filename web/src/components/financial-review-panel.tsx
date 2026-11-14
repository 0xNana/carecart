"use client";
import {
  confirmedSupplierPayment,
  paymentStage,
} from "../lib/payment-presentation";
import { identityRequest } from "../lib/identity-client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { OperatorClient } from "../lib/operator-client";
import type { FinancialReview } from "../lib/financial-review";
import { exactTokenAmount as usdc } from "../lib/funding";
import {
  actionError,
  displayTime,
  statusLabel,
  testnetTransactionUrl,
} from "../lib/product-copy";
import styles from "./financial-review-panel.module.css";

export function FinancialReviewPanel({
  client,
  caseId,
  revision,
  operator,
  onRefresh,
}: {
  client: OperatorClient;
  caseId: string;
  revision: number;
  operator: boolean;
  onRefresh: () => Promise<void>;
}) {
  const submitting = useRef(false);
  const [review, setReview] = useState<FinancialReview | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [confirmedFor, setConfirmedFor] = useState(""),
    [message, setMessage] = useState("");
  const confirmationKey = review
    ? JSON.stringify([
        caseId,
        review.revision,
        review.canonicalHash,
        review.requiredAuthority,
      ])
    : "";
  const confirmed = !!confirmationKey && confirmedFor === confirmationKey;
  const refresh = useCallback(async () => {
    try {
      setReview(await client.financialReview(caseId));
      setError("");
    } catch (e) {
      setReview(null);
      setError(e instanceof Error ? e.message : "Financial review unavailable");
    }
  }, [client, caseId]);
  useEffect(() => {
    let active = true;
    client
      .financialReview(caseId)
      .then((r) => {
        if (active) {
          setReview(r);
          setError("");
        }
      })
      .catch((e) => {
        if (active) {
          setReview(null);
          setError(
            e instanceof Error ? e.message : "Financial review unavailable",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [client, caseId, revision]);
  async function action(work: () => Promise<unknown>) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setConfirmedFor("");
    setMessage("");
    setError("");
    try {
      await work();
      await refresh();
      await onRefresh();
      setMessage("Purchase update saved. Check the status below.");
    } catch (e) {
      await refresh();
      await onRefresh();
      setError(
        actionError(
          e,
          "This purchase could not be updated. Refresh and check its status before trying again.",
        ),
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  const [wallets, setWallets] = useState<{ id: string; accountId: string }[]>(
      [],
    ),
    [walletBindingId, setWalletBindingId] = useState("");
  useEffect(() => {
    let active = true;
    if (review?.execution === "public-rpc")
      void client
        .session()
        .then((s) => {
          if (!s.clinicId) throw new Error("Clinic required");
          return identityRequest("clinics/" + s.clinicId + "/wallet-bindings");
        })
        .then((d) => {
          if (active) {
            const current = (
              d.bindings as { id: string; accountId: string; status: string }[]
            ).filter(
              (b) =>
                b.status === "Verified" && b.accountId === review.controller,
            );
            setWallets(current);
            setWalletBindingId(current.length === 1 ? current[0].id : "");
          }
        })
        .catch(() => {
          if (active) {
            setWallets([]);
            setWalletBindingId("");
          }
        });
    return () => {
      active = false;
    };
  }, [client, review?.execution, review?.controller]);
  const role =
    review?.requiredAuthority === "committer"
      ? "committer"
      : review?.requiredAuthority === "requester"
        ? "requester"
        : null;
  const moneyLabel = review?.quote.asset === "CCUSD" ? "CCUSD" : "demo credits";
  const environment =
    review?.execution === "public-rpc"
      ? "Demo purchase · no real money is involved."
      : review?.execution === "sandbox-rpc"
        ? "Preview only · no payment will be sent."
        : review?.execution === "mocked-rpc"
          ? "Simulation only · no payment will be sent."
          : "Payment actions are unavailable here.";
  const nativeReceipt = review ? confirmedSupplierPayment(review) : undefined;
  const stage = review ? paymentStage(review) : null;
  const transactionUrl = nativeReceipt
    ? "https://testnet.nearblocks.io/txns/" + nativeReceipt.transactionHash
    : review?.operations
        .map((o) =>
          testnetTransactionUrl(
            review.execution,
            review.canonical.profile,
            o.evidence,
          ),
        )
        .filter(Boolean)
        .at(-1);
  const confirmLabel =
    role === "committer" ? "Confirm order details" : "Confirm payment request";
  return (
    <section className={styles.panel} aria-label="Purchase review">
      <header className={styles.heading}>
        <h2>Review purchase</h2>
        {stage && (
          <span className={styles.stage} data-state={stage}>
            {stage}
          </span>
        )}
      </header>
      {error && (
        <p className={styles.error} role="alert">
          {actionError(
            new Error(error),
            "Purchase details are unavailable. Refresh before taking action.",
          )}
        </p>
      )}
      {!review && !error && <p role="status">Loading purchase details…</p>}
      {review && (
        <>
          <div className={styles.amount}>
            <strong>
              {usdc(review.canonical.amount)} <span>{moneyLabel}</span>
            </strong>
            <p>{environment}</p>
          </div>
          <dl className={styles.facts}>
            <div>
              <dt>Supplier</dt>
              <dd>
                {review.quote.supplierId.replace(
                  /^Synthetic Demo Supplier /i,
                  "Supplier ",
                )}
              </dd>
            </div>
            <div>
              <dt>Purchase</dt>
              <dd>
                {review.quote.quantity} units ×{" "}
                {usdc(review.quote.unitPriceAtomic)} {moneyLabel}
              </dd>
            </div>
            <div>
              <dt>Next step</dt>
              <dd>
                {nativeReceipt
                  ? "Payment confirmed"
                  : statusLabel(review.nextAction)}
              </dd>
            </div>
          </dl>
          {nativeReceipt && (
            <div className={styles.confirmed}>
              <strong>Supplier payment confirmed independently.</strong>
              <a
                href={transactionUrl ?? undefined}
                target="_blank"
                rel="noreferrer"
              >
                View supplier transfer ↗
              </a>
            </div>
          )}
          {review.policy.blocks.length > 0 && (
            <p className={styles.error} role="status">
              On hold: {review.policy.blocks.map(statusLabel).join(", ")}.
            </p>
          )}
          {(review.policy.humanRequired ||
            review.approvalStatus === "PendingApproval") &&
            review.execution === "public-rpc" && (
              <p className={styles.notice}>
                Clinic approval is required. Your approval wallet must be
                verified in Settings.
              </p>
            )}
          {role && (
            <div className={styles.action}>
              <h3>{confirmLabel}</h3>
              <p>
                Check the supplier, amount and delivery details before
                continuing.
              </p>
              {review.execution === "public-rpc" && (
                <label className={styles.walletLabel}>
                  Clinic approval wallet
                  <select
                    value={walletBindingId}
                    onChange={(e) => setWalletBindingId(e.target.value)}
                  >
                    <option value="">
                      Choose a wallet verified in Settings
                    </option>
                    {wallets.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.accountId}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className={styles.consent}>
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) =>
                    setConfirmedFor(e.target.checked ? confirmationKey : "")
                  }
                  disabled={
                    !operator ||
                    busy ||
                    review.execution === "disabled" ||
                    !!review.policy.blocks.length
                  }
                />
                <span>
                  I checked the supplier, amount and delivery details.
                </span>
              </label>
              <button
                className={styles.primary}
                disabled={
                  !operator ||
                  busy ||
                  !confirmed ||
                  review.execution === "disabled" ||
                  !!review.policy.blocks.length ||
                  review.authorizations.some((a) => a.role === role) ||
                  (review.execution === "public-rpc" && !walletBindingId)
                }
                onClick={() =>
                  void action(() =>
                    client.authorizeFinancial(
                      caseId,
                      role,
                      review.revision,
                      review.canonicalHash,
                      walletBindingId || undefined,
                    ),
                  )
                }
              >
                {review.execution === "disabled"
                  ? "Action unavailable"
                  : busy
                    ? "Saving…"
                    : confirmLabel}
              </button>
            </div>
          )}
          {!operator && (
            <p className={styles.notice}>Your access is view only.</p>
          )}
          <details className={styles.disclosure}>
            <summary>Order and payment details</summary>
            <dl className={styles.facts}>
              <div>
                <dt>Order reference</dt>
                <dd>{review.canonical.po_id}</dd>
              </div>
              <div>
                <dt>Supplier account</dt>
                <dd>{review.canonical.supplier}</dd>
              </div>
              <div>
                <dt>Offer expires</dt>
                <dd>
                  {displayTime(review.quote.expiresAt)} ·{" "}
                  {review.quoteExpired ? "Expired" : "Available"}
                </dd>
              </div>
              <div>
                <dt>Payment status</dt>
                <dd>
                  {statusLabel(review.approvalStatus)} ·{" "}
                  {statusLabel(review.state)}
                </dd>
              </div>
              <div>
                <dt>Limits</dt>
                <dd>
                  {review.policy.blocks.length
                    ? "Purchase is on hold"
                    : review.policy.observed
                      ? "Within current limits"
                      : "Not independently checked"}
                </dd>
              </div>
              <div>
                <dt>Payment receipt</dt>
                <dd>
                  {nativeReceipt
                    ? "Supplier transfer independently confirmed"
                    : "No independently confirmed supplier transfer"}
                </dd>
              </div>
              <div>
                <dt>Latest transaction</dt>
                <dd>
                  {transactionUrl ? (
                    <a
                      href={transactionUrl ?? undefined}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View record ↗
                    </a>
                  ) : (
                    "No transaction recorded"
                  )}
                </dd>
              </div>
            </dl>
          </details>
          <details className={styles.disclosure}>
            <summary>Spending limits</summary>
            <dl className={styles.facts}>
              {Object.entries(review.policy.limits).map(([key, value]) => (
                <div key={key}>
                  <dt>
                    {(
                      {
                        auto_per_po_limit: "Automatic order limit",
                        hard_payout_limit: "Maximum payment",
                        daily_dispatch_limit: "Daily payment limit",
                        accepted_deposit_ceiling: "Maximum balance",
                      } as Record<string, string>
                    )[key] ?? key}
                  </dt>
                  <dd>
                    {usdc(value)} {moneyLabel}
                  </dd>
                </div>
              ))}
            </dl>
          </details>
          <section className={styles.activity} aria-label="Purchase activity">
            <h3>Purchase activity</h3>
            {!review.authorizations.length && (
              <p className={styles.notice}>No confirmations yet.</p>
            )}
            {review.authorizations.map((a) => (
              <article key={a.id} className={styles.activityItem}>
                <div>
                  <strong>
                    {a.role === "committer"
                      ? "Order confirmation"
                      : "Payment request"}
                  </strong>
                  <span>{statusLabel(a.state)}</span>
                </div>
                {a.error && (
                  <p role="status">
                    This step needs attention. Refresh its status before trying
                    again.
                  </p>
                )}
                {review.execution === "mocked-rpc" &&
                  a.state === "Authorized" && (
                    <button
                      className={styles.secondary}
                      disabled={!operator || busy}
                      onClick={() =>
                        void action(() => client.simulateFinancial(a.id))
                      }
                    >
                      Complete demo payment
                    </button>
                  )}
                {["sandbox-rpc", "public-rpc"].includes(review.execution) &&
                  a.state === "Authorized" && (
                    <p>
                      You can leave this page while the request is processed.
                    </p>
                  )}
                {["Executing", "RequiresReconciliation"].includes(a.state) && (
                  <p>
                    Still processing. Check its status before repeating any
                    action.
                  </p>
                )}
                {a.state !== "Authorized" && (
                  <button
                    className={styles.secondary}
                    disabled={!operator || busy}
                    onClick={() =>
                      void action(() => client.reconcileFinancial(a.id))
                    }
                  >
                    Refresh status
                  </button>
                )}
                <details>
                  <summary>Activity record</summary>
                  <p>Expires {displayTime(a.expiresAt)}</p>
                  <pre>{JSON.stringify(a.events, null, 2)}</pre>
                </details>
              </article>
            ))}
          </section>
          <details className={styles.disclosure}>
            <summary>Payment records</summary>
            {review.operations.length ? (
              <ul>
                {review.operations.map((o) => {
                  const url = testnetTransactionUrl(
                    review.execution,
                    review.canonical.profile,
                    o.evidence,
                  );
                  return (
                    <li key={o.operation_key}>
                      <strong>{statusLabel(o.state)}</strong>
                      {url && (
                        <p>
                          <a href={url} target="_blank" rel="noreferrer">
                            View payment record ↗
                          </a>
                        </p>
                      )}
                      <details>
                        <summary>Record details</summary>
                        <pre>{o.evidence ?? "No payment details saved"}</pre>
                      </details>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p>No payment records yet.</p>
            )}
            <p>
              {nativeReceipt
                ? "Supplier payment confirmed independently."
                : review.settlement
                  ? "Receipt details are available in the order history."
                  : "No supplier receipt has been recorded yet."}{" "}
              Delivery is tracked separately.
            </p>
          </details>
          <div className={styles.footer}>
            <p>Record delivered supplies in Inventory.</p>
            <button
              className={styles.secondary}
              disabled={busy}
              onClick={() => void refresh()}
            >
              Refresh purchase status
            </button>
          </div>
        </>
      )}
      <p role="status" aria-live="polite">
        {busy ? "Saving your update…" : message}
      </p>
    </section>
  );
}

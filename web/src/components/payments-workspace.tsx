"use client";

import { useEffect, useRef, useState } from "react";
import type { OperatorClient, OperatorSession } from "@/lib/operator-client";
import type { WorkspaceCase } from "@/lib/workflow";
import { exactTokenAmount } from "@/lib/funding";
import {
  paymentActivity,
  paymentActivityState,
  paymentSupplier,
  type PaymentFilter,
} from "@/lib/payment-activity";
import { PaymentAccountPanel } from "./payment-account-panel";
import { AutomaticPurchasingPanel } from "./automatic-purchasing-panel";
import { ApplicationCase } from "./application-case";
import { ApplicationLink as Link } from "./application-link";
import { actionError } from "@/lib/product-copy";
import styles from "./payments-workspace.module.css";

export function PaymentsWorkspace({
  client,
  session,
  cases,
  loading,
  refreshing,
  error,
  canFund,
  canManage,
  onRefresh,
  pageNavigation,
}: {
  client: OperatorClient;
  session: OperatorSession | null;
  cases: WorkspaceCase[];
  loading: boolean;
  refreshing: boolean;
  error: string;
  canFund: boolean;
  canManage: boolean;
  onRefresh: () => Promise<void>;
  pageNavigation: React.ReactNode;
}) {
  const [filter, setFilter] = useState<PaymentFilter>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null),
    trigger = useRef<HTMLButtonElement | null>(null);
  const entries = paymentActivity(cases, "all", "");
  const visible = paymentActivity(cases, filter, search);
  const asset =
    session?.deployment === "public-testnet" ||
    session?.deployment === "testnet-preparation"
      ? "CCUSD"
      : "demo credits";
  const filters: { value: PaymentFilter; label: string }[] = [
    { value: "all", label: "All activity" },
    { value: "attention", label: "Needs attention" },
    { value: "processing", label: "Processing" },
    { value: "recorded", label: "Receipts" },
  ];
  useEffect(() => {
    if (selected && dialog.current && !dialog.current.open)
      dialog.current.showModal();
  }, [selected]);
  function closeReview() {
    dialog.current?.close();
    setSelected(null);
    requestAnimationFrame(() => trigger.current?.focus());
  }
  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <h1>Payments</h1>
          <p>Fund purchases and keep track of supplier payments.</p>
        </div>
        <button
          type="button"
          className={styles.secondary}
          disabled={loading || refreshing}
          onClick={() => void onRefresh()}
        >
          {refreshing ? "Refreshing…" : "Refresh activity"}
        </button>
      </header>
      {loading && !session && (
        <div className={styles.loading} role="status" aria-busy="true">
          Loading your payment workspace…
        </div>
      )}
      {session?.deployment === "public-testnet" && (
        <>
          <PaymentAccountPanel client={client} canFund={canFund} />
          <AutomaticPurchasingPanel client={client} canManage={canManage} />
        </>
      )}
      {session && session.deployment !== "public-testnet" && (
        <div className={styles.previewNotice}>
          <span aria-hidden="true">◌</span>
          <p>
            This workspace shows demo purchases. Adding funds is available in a
            connected payment account.
          </p>
        </div>
      )}
      <section
        className={styles.activity}
        aria-labelledby="payment-activity-title"
      >
        <div className={styles.activityHeading}>
          <div>
            <h2 id="payment-activity-title">Payment activity</h2>
            <p>Open a purchase for its receipt and next step.</p>
          </div>
          {!!entries.length && (
            <span className={styles.count}>{entries.length} on this page</span>
          )}
        </div>
        <div className={styles.toolbar}>
          <div
            className={styles.filters}
            role="group"
            aria-label="Filter payments"
          >
            {filters.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={filter === option.value}
                onClick={() => setFilter(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <label className={styles.search}>
            <span className={styles.srOnly}>Search payments</span>
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              aria-hidden="true"
            >
              <circle cx="10" cy="10" r="6" />
              <path d="m15 15 5 5" />
            </svg>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search purchases"
            />
          </label>
        </div>
        {error ? (
          <div className={styles.error} role="alert">
            <p>
              {actionError(
                new Error(error),
                "Payment activity is unavailable. Try refreshing.",
              )}
            </p>
            <button
              type="button"
              className={styles.secondary}
              onClick={() => void onRefresh()}
            >
              Try again
            </button>
          </div>
        ) : loading ? (
          <p className={styles.loading} role="status" aria-busy="true">
            Loading payment activity…
          </p>
        ) : visible.length ? (
          <>
            <div className={styles.columnHeadings} aria-hidden="true">
              <span>Purchase</span>
              <span>Amount</span>
              <span>Status</span>
              <span />
            </div>
            <ul className={styles.list} aria-label="Payment activity">
              {visible.map((entry) => {
                const status = paymentActivityState(entry);
                return (
                  <li key={entry.caseId} className={styles.row}>
                    <div className={styles.purchase}>
                      <strong>{entry.item?.name ?? entry.itemId}</strong>
                      <span title={paymentSupplier(entry)}>
                        {paymentSupplier(entry)}
                      </span>
                      {entry.poId && (
                        <small title={entry.poId}>
                          Order · {entry.poId.slice(-8)}
                        </small>
                      )}
                    </div>
                    <span className={styles.amount}>
                      {entry.selection ? (
                        <>
                          {exactTokenAmount(entry.selection.amount)}{" "}
                          <small>{asset}</small>
                        </>
                      ) : (
                        "Not estimated"
                      )}
                    </span>
                    <span className={styles.status} data-group={status.group}>
                      {status.label}
                    </span>
                    <button
                      type="button"
                      className={styles.reviewButton}
                      onClick={(event) => {
                        trigger.current = event.currentTarget;
                        setSelected(entry.caseId);
                      }}
                    >
                      View payment <span aria-hidden="true">↗</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <div className={styles.empty}>
            <span className={styles.emptyIcon} aria-hidden="true">
              ↗
            </span>
            <h3>
              {entries.length
                ? "No matching purchases"
                : "No payment activity yet"}
            </h3>
            <p>
              {entries.length
                ? "Try a different status or search term."
                : "Purchases appear here once an order is prepared."}
            </p>
            {entries.length ? (
              <button
                type="button"
                className={styles.secondary}
                onClick={() => {
                  setFilter("all");
                  setSearch("");
                }}
              >
                Clear filters
              </button>
            ) : (
              <Link className={styles.secondary} href="/app/replenishment">
                View replenishment
              </Link>
            )}
          </div>
        )}
        {pageNavigation}
      </section>
      <p className={styles.footnote}>
        Supplier payment and delivery are tracked separately. Record received
        supplies in Inventory.
      </p>
      <dialog
        ref={dialog}
        className={styles.reviewDialog}
        aria-label="Payment details"
        onCancel={(event) => {
          event.preventDefault();
          closeReview();
        }}
        onClose={() => {
          setSelected(null);
          requestAnimationFrame(() => trigger.current?.focus());
        }}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const nodes = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              'a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),summary,[tabindex="0"]',
            ),
          ).filter(
            (node) =>
              node.getClientRects().length &&
              (!node.closest("details:not([open])") ||
                node.tagName === "SUMMARY"),
          );
          const first = nodes[0],
            last = nodes.at(-1);
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        {selected && (
          <ApplicationCase
            key={selected}
            caseId={selected}
            view="payment"
            onClose={closeReview}
          />
        )}
      </dialog>
    </div>
  );
}

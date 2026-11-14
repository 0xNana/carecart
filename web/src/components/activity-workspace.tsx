"use client";
import { useEffect, useRef, useState } from "react";
import type { StockDashboard } from "@/lib/inventory";
import {
  clinicActivity,
  filterClinicActivity,
  type ActivityCategory,
  type ClinicActivity,
} from "@/lib/clinic-activity";
import { displayTime, statusLabel } from "@/lib/product-copy";
import { ApplicationLink as Link } from "./application-link";
import styles from "./activity-workspace.module.css";

export function ActivityWorkspace({
  data,
  error,
  refresh,
  refreshing,
}: {
  data: StockDashboard | null;
  error: string;
  refresh: () => Promise<void>;
  refreshing: boolean;
}) {
  const [category, setCategory] = useState<ActivityCategory>("all"),
    [query, setQuery] = useState(""),
    [limit, setLimit] = useState(20),
    [selected, setSelected] = useState<ClinicActivity | null>(null);
  const dialog = useRef<HTMLDialogElement>(null),
    trigger = useRef<HTMLButtonElement | null>(null);
  const rows = data ? clinicActivity(data) : [],
    filtered = filterClinicActivity(rows, category, query),
    visible = filtered.slice(0, limit);
  const groups = new Map<string, ClinicActivity[]>();
  for (const row of visible) {
    const label = row.timestamp
      ? new Date(row.timestamp).toLocaleDateString(undefined, {
          year: "numeric",
          month: "long",
          day: "numeric",
        })
      : "Date not recorded";
    groups.set(label, [...(groups.get(label) ?? []), row]);
  }
  useEffect(() => {
    if (selected && dialog.current && !dialog.current.open)
      dialog.current.showModal();
  }, [selected]);
  function closeRecord() {
    dialog.current?.close();
    setSelected(null);
    requestAnimationFrame(() => trigger.current?.focus());
  }
  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <h1>Activity</h1>
          <p>Stock updates and monitoring, in one place.</p>
        </div>
        <button
          className={styles.secondary}
          type="button"
          disabled={refreshing}
          onClick={() => void refresh()}
        >
          {refreshing ? "Refreshing…" : "Refresh activity"}
        </button>
      </header>
      <section className={styles.feed} aria-label="Clinic activity">
        <div className={styles.toolbar}>
          <div
            className={styles.filters}
            role="group"
            aria-label="Filter clinic activity"
          >
            {(
              [
                { value: "all", label: "All activity" },
                { value: "stock", label: "Stock updates" },
                { value: "monitoring", label: "Monitoring" },
              ] as const
            ).map((option) => (
              <button
                type="button"
                key={option.value}
                aria-pressed={category === option.value}
                onClick={() => {
                  setCategory(option.value);
                  setLimit(20);
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
          <label className={styles.search}>
            <span className={styles.srOnly}>Search activity</span>
            <input
              type="search"
              placeholder="Search activity"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setLimit(20);
              }}
            />
          </label>
        </div>
        {data && (
          <div className={styles.feedMeta}>
            <span>{filtered.length} records in this view</span>
            <span>
              Monitoring:{" "}
              {data.config.monitoring
                ? statusLabel(data.workerHealth?.status ?? "Not observed")
                : "Off"}
            </span>
          </div>
        )}
        {error ? (
          <div className={styles.empty} role="alert">
            <h2>Activity could not be loaded</h2>
            <p>{error}</p>
            <button
              className={styles.secondary}
              type="button"
              onClick={() => void refresh()}
            >
              Try again
            </button>
          </div>
        ) : !data ? (
          <div className={styles.empty} role="status" aria-busy="true">
            Loading clinic activity…
          </div>
        ) : !visible.length ? (
          <div className={styles.empty}>
            <span className={styles.emptyIcon} aria-hidden="true">
              ↗
            </span>
            <h2>{rows.length ? "No matching activity" : "No activity yet"}</h2>
            <p>
              {rows.length
                ? "Try a different filter or search term."
                : "Receipts, stock usage and monitoring checks will appear here."}
            </p>
            {rows.length ? (
              <button
                className={styles.secondary}
                type="button"
                onClick={() => {
                  setCategory("all");
                  setQuery("");
                  setLimit(20);
                }}
              >
                Clear filters
              </button>
            ) : (
              <Link className={styles.secondary} href="/app/inventory">
                Open Inventory
              </Link>
            )}
          </div>
        ) : (
          <div className={styles.groups}>
            {[...groups].map(([label, records]) => (
              <section key={label} className={styles.group}>
                <h2>{label}</h2>
                <ol>
                  {records.map((row) => (
                    <li key={row.id} className={styles.row}>
                      <span
                        className={styles.eventIcon}
                        data-attention={row.attention}
                        aria-hidden="true"
                      >
                        {row.attention
                          ? "!"
                          : row.category === "stock"
                            ? "↗"
                            : "◷"}
                      </span>
                      <div className={styles.eventCopy}>
                        <strong>{row.title}</strong>
                        <span>{row.subject}</span>
                        <small>{row.description}</small>
                      </div>
                      <div className={styles.eventAction}>
                        <time
                          dateTime={row.timestamp}
                          title={displayTime(row.timestamp)}
                        >
                          {row.timestamp
                            ? new Date(row.timestamp).toLocaleTimeString(
                                undefined,
                                { hour: "2-digit", minute: "2-digit" },
                              )
                            : "Not recorded"}
                        </time>
                        <button
                          type="button"
                          onClick={(event) => {
                            trigger.current = event.currentTarget;
                            setSelected(row);
                          }}
                          aria-label={`View ${row.title.toLowerCase()} record for ${row.subject}`}
                        >
                          View record <span aria-hidden="true">↗</span>
                        </button>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
        )}
        {filtered.length > visible.length && (
          <div className={styles.loadMore}>
            <button
              className={styles.secondary}
              type="button"
              onClick={() => setLimit((value) => value + 20)}
            >
              Load more activity
            </button>
            <span>
              Showing {visible.length} of {filtered.length}
            </span>
          </div>
        )}
      </section>
      {data?.readAt && (
        <p className={styles.footnote}>Updated {displayTime(data.readAt)}.</p>
      )}
      <dialog
        ref={dialog}
        className={styles.dialog}
        aria-labelledby="activity-record-title"
        onCancel={(event) => {
          event.preventDefault();
          closeRecord();
        }}
        onClose={() => {
          setSelected(null);
          requestAnimationFrame(() => trigger.current?.focus());
        }}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const close =
            event.currentTarget.querySelector<HTMLButtonElement>("button");
          if (close) {
            event.preventDefault();
            close.focus();
          }
        }}
      >
        {selected && (
          <>
            <header>
              <div>
                <span>
                  {selected.category === "stock"
                    ? "Stock record"
                    : "Monitoring record"}
                </span>
                <h2 id="activity-record-title">{selected.title}</h2>
              </div>
              <button
                type="button"
                aria-label="Close activity record"
                onClick={closeRecord}
              >
                ×
              </button>
            </header>
            <p className={styles.recordTime}>
              {displayTime(selected.timestamp)}
            </p>
            <dl>
              {selected.fields.map((field) => (
                <div key={field.label}>
                  <dt>{field.label}</dt>
                  <dd>{field.value}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </dialog>
    </div>
  );
}

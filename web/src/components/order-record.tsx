import type { WorkspaceCase } from "../lib/workflow";
import { usdc } from "../lib/workflow";
import { displayTime, statusLabel } from "../lib/product-copy";
import styles from "./application-view.module.css";

/** A read-only view of the persisted case; it does not calculate or authorize orders. */
export function OrderRecord({ record }: { record: WorkspaceCase }) {
  const selected = record.quotes.find(
    (q) => q.id === record.selection?.quoteId,
  );
  const unit =
    record.evidenceKind === "public-rpc" ||
    record.evidenceKind === "sandbox-rpc"
      ? "CCUSD"
      : "demo credits";
  const name =
    record.item?.name.replace(/\s*\(synthetic\)$/i, "") ?? record.itemId;
  return (
    <section className={styles.orderRecord} aria-label="Replenishment details">
      <header>
        <div>
          <p className={styles.eyebrow}>REPLENISHMENT</p>
          <h3>{name}</h3>
        </div>
        <span className={styles.recordStatus}>{statusLabel(record.state)}</span>
      </header>
      <p className={styles.recordExplanation}>
        {record.item
          ? `${record.item.onHand} on hand against a reorder threshold of ${record.item.reorderPoint}.`
          : "A stock check started this replenishment request."}{" "}
        {selected
          ? `The saved order requests ${selected.quantity} units from the selected supplier.`
          : "Supplier selection and order quantity are pending."}
      </p>
      <dl className={styles.recordFacts}>
        <div>
          <dt>Order quantity</dt>
          <dd>{selected ? `${selected.quantity} units` : "Not selected"}</dd>
        </div>
        <div>
          <dt>Estimated cost</dt>
          <dd>
            {record.selection
              ? `${usdc(record.selection.amount)} ${unit}`
              : "Not estimated"}
          </dd>
        </div>
        <div className={styles.recordOrder}>
          <dt>Purchase order</dt>
          <dd>{record.poId ?? "Not prepared"}</dd>
        </div>
        <div>
          <dt>Next action</dt>
          <dd>{statusLabel(record.nextAction)}</dd>
        </div>
      </dl>
      <h4>Supplier comparison</h4>
      {record.quotes.length ? (
        <div
          className={styles.tableWrap}
          role="region"
          aria-label="Supplier comparison"
          tabIndex={0}
        >
          <table>
            <thead>
              <tr>
                <th scope="col">Supplier</th>
                <th scope="col">Quantity</th>
                <th scope="col">Order cost</th>
                <th scope="col">Offer</th>
              </tr>
            </thead>
            <tbody>
              {record.quotes.map((q) => (
                <tr
                  key={q.id}
                  data-selected={q.id === selected?.id || undefined}
                >
                  <td>
                    {q.supplierId.replace(
                      /^Synthetic Demo Supplier /i,
                      "Supplier ",
                    )}
                  </td>
                  <td>{q.quantity} units</td>
                  <td>
                    {usdc(q.amountAtomic)} {unit}
                  </td>
                  <td>
                    {q.id === selected?.id
                      ? "Selected quote"
                      : "Compared offer"}
                    <small>Expires {displayTime(q.expiresAt)}</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>No supplier offers saved yet.</p>
      )}
      <details>
        <summary>Purchase order and forecast details</summary>
        <dl className={styles.facts}>
          <dt>Purchase order</dt>
          <dd>{record.poId ?? "Not prepared"}</dd>
          <dt>Selected supplier account</dt>
          <dd>{selected?.supplierAccount ?? "Not selected"}</dd>
          <dt>Selection rule</dt>
          <dd>
            {record.selection?.policy
              ? statusLabel(record.selection.policy)
              : "Not selected"}
          </dd>
        </dl>
        {record.forecasts.map((f) => (
          <p key={f.supplierId}>
            {f.supplierId}: {f.recommendedQuantity} units suggested ·{" "}
            {f.leadTimeDays} day lead time · {f.leadTimeDemand} units expected
            use.
          </p>
        ))}
      </details>
      <h4>Request timeline</h4>
      {record.timeline.length ? (
        <ol className={styles.recordTimeline}>
          {record.timeline.slice(-5).map((event, i) => (
            <li key={event.evidenceReference + "-" + i}>
              <div>
                <strong>{statusLabel(event.eventType)}</strong>
                <time dateTime={event.timestamp}>
                  {displayTime(event.timestamp)}
                </time>
              </div>
              <p>{statusLabel(event.resultingState)}</p>
              <details>
                <summary>Event details</summary>
                <p>
                  {event.actor} · {event.evidenceReference}
                  {event.operationId ? " · " + event.operationId : ""}
                </p>
              </details>
            </li>
          ))}
        </ol>
      ) : (
        <p>No events recorded yet.</p>
      )}
    </section>
  );
}

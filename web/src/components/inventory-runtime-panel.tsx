"use client";
import { ApplicationLink as Link } from "./application-link";
import { useCallback, useEffect, useState } from "react";
import type { OperatorClient, OperatorSession } from "../lib/operator-client";
import type { StockDashboard } from "../lib/inventory";
import type { ClinicContext } from "../lib/identity-backend";
import { ActivityWorkspace } from "./activity-workspace";
import { SettingsWorkspace } from "./settings-workspace";
import {
  actionError,
  displayTime,
  statusLabel,
  unitLabel,
} from "../lib/product-copy";
import { InventoryOperations } from "./inventory-operations";
import { ClinicOverview } from "./clinic-overview";
import styles from "./application-view.module.css";

type Section = "overview" | "inventory" | "activity" | "settings";
const titles = {
  overview: "Overview",
  inventory: "Inventory",
  activity: "Activity",
  settings: "Settings",
};
const descriptions = {
  overview: "Supplies, replenishment and items needing your attention.",
  inventory: "Record stock received, issued, consumed or adjusted.",
  activity: "Recent stock activity and monitoring checks.",
  settings: "Manage clinic access, stock monitoring and payment configuration.",
};
/** Polling reads projections only. Scheduling remains in the independent backend worker. */
export function InventoryRuntimePanel({
  client,
  operator,
  section,
  onChanged,
  onFailure,
  canManageAutonomy = true,
  publicPayments = false,
  session = null,
  clinic,
}: {
  client: OperatorClient;
  operator: boolean;
  section: Section;
  onChanged: () => Promise<void>;
  onFailure: (cause: unknown) => void;
  canManageAutonomy?: boolean;
  publicPayments?: boolean;
  session?: OperatorSession | null;
  clinic?: ClinicContext;
}) {
  const [data, setData] = useState<StockDashboard | null>(null),
    [error, setError] = useState(""),
    [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setData(await client.stock());
      setError("");
    } catch (e) {
      setData(null);
      setError(
        actionError(e, "Stock records are unavailable. Refresh to try again."),
      );
      onFailure(e);
    } finally {
      setRefreshing(false);
    }
  }, [client, onFailure]);
  useEffect(() => {
    let active = true;
    const load = async () => {
      if (active) await refresh();
    };
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [refresh]);
  if (section === "activity")
    return (
      <ActivityWorkspace
        data={data}
        error={error}
        refresh={refresh}
        refreshing={refreshing}
      />
    );
  if (section === "settings")
    return (
      <SettingsWorkspace
        data={data}
        error={error}
        client={client}
        operator={operator}
        refresh={refresh}
        refreshing={refreshing}
        publicPayments={publicPayments}
        session={session}
        clinic={clinic}
      />
    );
  return (
    <div className={styles.page + " " + styles.inventoryRuntime}>
      <header className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>CLINIC OPERATIONS</p>
          <h1>{titles[section]}</h1>
          <p>{descriptions[section]}</p>
        </div>
        <button
          className={styles.refreshButton}
          disabled={refreshing}
          onClick={() => void refresh()}
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </header>
      {data?.tenant?.syntheticDemo || (data && !data.tenant) ? (
        <p className={styles.demoNotice}>
          Sample supply data and example supplier offers.
        </p>
      ) : null}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">Loading stock records…</p>}
      {data && (
        <>
          {section === "overview" && (
            <>
              <ClinicOverview data={data} canRecord={operator} />
              <RecentStockActivity data={data} />
            </>
          )}
          {section === "inventory" && (
            <div className={styles.caseEvidence}>
              <InventoryOperations
                layout="workspace"
                publicPayments={publicPayments}
                client={client}
                operator={operator}
                canManageAutonomy={canManageAutonomy}
                onChanged={onChanged}
                onFailure={onFailure}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
function RecentStockActivity({ data }: { data: StockDashboard }) {
  const activity = data.items
    .flatMap((item) =>
      item.movements.map((m) => ({
        ...m,
        name: item.name,
        baseUnit: item.baseUnit,
      })),
    )
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, 5);
  return (
    <section className={styles.panel}>
      <h2>Recent stock activity</h2>
      {!activity.length && (
        <p>No stock activity yet. Record a receipt or usage in Inventory.</p>
      )}
      <ol className={styles.timeline}>
        {activity.map((m) => (
          <li key={m.id}>
            <div>
              <strong>
                {statusLabel(m.kind)} · {m.name}
              </strong>
              <p>
                {m.baseQuantity} {unitLabel(m.baseUnit, m.baseQuantity)}
              </p>
              <time dateTime={m.timestamp}>{displayTime(m.timestamp)}</time>
            </div>
          </li>
        ))}
      </ol>
      <Link className={styles.inlineLink} href="/app/activity">
        View Activity →
      </Link>
    </section>
  );
}

"use client";
import { useRef, useState } from "react";
import type { OperatorClient, OperatorSession } from "@/lib/operator-client";
import type { StockDashboard, AutonomyConfig } from "@/lib/inventory";
import type { ClinicContext } from "@/lib/identity-backend";
import { actionError, displayTime, statusLabel } from "@/lib/product-copy";
import { ClinicAccess } from "./clinic-access";
import { ClinicWalletBindings } from "./clinic-wallet-bindings";
import { ApplicationLink as Link } from "./application-link";
import { WorkspaceTabs } from "./workspace-tabs";
import styles from "./settings-workspace.module.css";

type Section = "clinic" | "monitoring" | "team" | "payments" | "connections";
const sections: { value: Section; label: string }[] = [
  { value: "clinic", label: "Clinic" },
  { value: "monitoring", label: "Monitoring" },
  { value: "team", label: "Team" },
  { value: "payments", label: "Payment setup" },
  { value: "connections", label: "Connections" },
];
export function SettingsWorkspace({
  data,
  error,
  client,
  operator,
  refresh,
  refreshing,
  publicPayments,
  session,
  clinic,
}: {
  data: StockDashboard | null;
  error: string;
  client: OperatorClient;
  operator: boolean;
  refresh: () => Promise<void>;
  refreshing: boolean;
  publicPayments: boolean;
  session?: OperatorSession | null;
  clinic?: ClinicContext;
}) {
  const [section, setSection] = useState<Section>("clinic"),
    [visited, setVisited] = useState<Section[]>(["clinic"]);
  const choose = (value: Section) => {
    setSection(value);
    setVisited((previous) =>
      previous.includes(value) ? previous : [...previous, value],
    );
  };
  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <h1>Settings</h1>
        <p>Your clinic, team and purchasing preferences.</p>
      </header>
      <WorkspaceTabs
        label="Settings sections"
        options={sections}
        value={section}
        onChange={choose}
      >
        <div hidden={section !== "clinic"} className={styles.panel}>
          <div className={styles.panelHeading}>
            <div>
              <h2>Clinic details</h2>
              <p>The workspace your team shares.</p>
            </div>
            <span className={styles.role}>
              {clinic?.role ?? (operator ? "Clinic staff" : "Viewer")}
            </span>
          </div>
          <dl className={styles.facts}>
            <div>
              <dt>Clinic name</dt>
              <dd>{clinic?.name ?? "CareCart clinic"}</dd>
            </div>
            <div>
              <dt>Country</dt>
              <dd>{clinic?.country ?? "Not set"}</dd>
            </div>
            <div>
              <dt>Time zone</dt>
              <dd>{clinic?.timezone ?? "Not set"}</dd>
            </div>
          </dl>
          {clinic && (
            <p className={styles.hint}>
              Use the clinic selector in the sidebar to switch workspaces.
            </p>
          )}
        </div>
        {visited.includes("monitoring") && (
          <div hidden={section !== "monitoring"}>
            {data ? (
              <MonitoringSettings
                data={data}
                client={client}
                operator={operator}
                refresh={refresh}
              />
            ) : (
              <div className={styles.panel}>
                <h2>Stock monitoring</h2>
                <p className={styles.notice} role={error ? "alert" : "status"}>
                  {error || "Loading monitoring settings…"}
                </p>
                <button
                  className={styles.secondary}
                  type="button"
                  disabled={refreshing}
                  onClick={() => void refresh()}
                >
                  Refresh monitoring
                </button>
              </div>
            )}
          </div>
        )}
        {visited.includes("team") && (
          <div hidden={section !== "team"} className={styles.identityPanel}>
            {clinic ? (
              <ClinicAccess clinic={clinic} showWalletBindings={false} />
            ) : (
              <div className={styles.panel}>
                <h2>Team access</h2>
                <p className={styles.notice}>
                  Team management is available in a connected clinic workspace.
                </p>
              </div>
            )}
          </div>
        )}
        {visited.includes("payments") && (
          <div hidden={section !== "payments"} className={styles.stack}>
            <section className={styles.panel}>
              <div className={styles.panelHeading}>
                <div>
                  <h2>Payment account</h2>
                  <p>Funding and purchasing rules live together in Payments.</p>
                </div>
              </div>
              <p className={styles.notice}>
                {publicPayments
                  ? "Your clinic uses CCUSD for test purchases. It has no cash value."
                  : "This workspace uses demo purchases. A connected payment account is required to add funds."}
              </p>
              <Link className={styles.secondary} href="/app/payments">
                Open Payments <span aria-hidden="true">↗</span>
              </Link>
            </section>
            {clinic &&
            ["Clinic Admin", "Finance Officer"].includes(clinic.role) ? (
              <section className={styles.panel + " " + styles.walletPanel}>
                <ClinicWalletBindings clinicId={clinic.id} />
              </section>
            ) : (
              <section className={styles.panel}>
                <h2>Payment wallet</h2>
                <p className={styles.notice}>
                  Your clinic administrator or finance lead manages the payment
                  wallet.
                </p>
              </section>
            )}
          </div>
        )}
        {visited.includes("connections") && (
          <div hidden={section !== "connections"}>
            <Connections
              client={client}
              operator={
                !!session &&
                session.role === "operator" &&
                (!session.permissions ||
                  session.permissions.includes("procurement"))
              }
              session={session}
              refresh={refresh}
            />
          </div>
        )}
      </WorkspaceTabs>
    </div>
  );
}
function MonitoringSettings({
  data,
  client,
  operator,
  refresh,
}: {
  data: StockDashboard;
  client: OperatorClient;
  operator: boolean;
  refresh: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<AutonomyConfig | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const submitting = useRef(false),
    config = draft ?? data.config;
  async function save() {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await client.configureAutonomy({ ...config, financialExecution: false });
      setDraft(null);
      setMessage("Monitoring settings saved.");
      await refresh();
    } catch (cause) {
      setError(
        actionError(
          cause,
          "Monitoring settings could not be saved. Try again.",
        ),
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  const controls = [
    {
      key: "monitoring",
      label: "Monitor stock",
      description: "Check supply levels in the background.",
    },
    {
      key: "automaticCases",
      label: "Create replenishment requests",
      description: "Start a request when supplies need restocking.",
    },
    {
      key: "automaticPreparation",
      label: "Prepare purchase orders",
      description: "Compare offers and prepare the selected order.",
    },
  ] as const;
  return (
    <section className={styles.panel}>
      <div className={styles.panelHeading}>
        <div>
          <h2>Stock monitoring</h2>
          <p>Control how CareCart watches and replenishes your supplies.</p>
        </div>
        <span className={styles.role}>
          {data.config.monitoring
            ? statusLabel(data.workerHealth?.status ?? "Not observed")
            : "Off"}
        </span>
      </div>
      <p className={styles.hint}>
        Last successful check:{" "}
        {displayTime(data.workerHealth?.lastSuccessfulEvaluation)}
      </p>
      {!operator && (
        <p className={styles.notice}>
          Your clinic administrator manages these settings.
        </p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <fieldset className={styles.controls} disabled={!operator || busy}>
          <legend className={styles.srOnly}>Automatic replenishment</legend>
          {controls.map((control) => (
            <label className={styles.toggleRow} key={control.key}>
              <span>
                <strong>{control.label}</strong>
                <span>{control.description}</span>
              </span>
              <input
                type="checkbox"
                checked={config[control.key]}
                onChange={(event) => {
                  setDraft({ ...config, [control.key]: event.target.checked });
                  setMessage("");
                }}
              />
            </label>
          ))}
          <details className={styles.advanced}>
            <summary>Check timing</summary>
            <div className={styles.timingFields}>
              {(
                [
                  "intervalSeconds",
                  "maxInventoryAgeSeconds",
                  "maxCatalogAgeSeconds",
                ] as const
              ).map((key, index) => (
                <label key={key}>
                  {
                    [
                      "Check every (seconds)",
                      "Stock record age limit (seconds)",
                      "Supplier offer age limit (seconds)",
                    ][index]
                  }
                  <input
                    type="number"
                    min={index ? 60 : 1}
                    max={index ? 31536000 : 86400}
                    step="1"
                    required
                    value={config[key] ?? (index === 1 ? 604800 : 86400)}
                    onChange={(event) =>
                      setDraft({ ...config, [key]: Number(event.target.value) })
                    }
                  />
                </label>
              ))}
            </div>
          </details>
        </fieldset>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className={styles.success} role="status">
            {message}
          </p>
        )}
        <div className={styles.saveBar}>
          <span>
            {draft
              ? "You have unsaved changes."
              : "Your current monitoring preferences."}
          </span>
          <div>
            <button
              className={styles.secondary}
              type="button"
              disabled={!draft || busy}
              onClick={() => {
                setDraft(null);
                setMessage("");
              }}
            >
              Discard changes
            </button>
            <button
              className={styles.primary}
              type="submit"
              disabled={!operator || busy || !draft}
            >
              {busy ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      </form>
      <details className={styles.advanced}>
        <summary>Scheduled checks</summary>
        <ul className={styles.jobs}>
          {data.jobs.map((job) => (
            <li key={job.productId}>
              <strong>
                {data.items.find((item) => item.id === job.productId)?.name ??
                  job.productId}
              </strong>
              <span>Next check: {displayTime(job.nextDue)}</span>
              {(job.failures ?? 0) > 0 && (
                <span>
                  {job.failures} failed checks
                  {(job.failures ?? 0) >= 3 ? " · needs attention" : ""}
                </span>
              )}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
function Connections({
  client,
  operator,
  session,
  refresh,
}: {
  client: OperatorClient;
  operator: boolean;
  session?: OperatorSession | null;
  refresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  async function refreshOffers() {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await client.refreshCatalog();
      setMessage("Supplier offers refreshed.");
      await refresh();
    } catch (cause) {
      setError(
        actionError(
          cause,
          "Supplier offers could not be refreshed. Try again.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={styles.stack}>
      <section className={styles.panel}>
        <div className={styles.panelHeading}>
          <div>
            <h2>Supplier offers</h2>
            <p>Refresh the saved offers used to compare purchases.</p>
          </div>
        </div>
        <button
          className={styles.secondary}
          type="button"
          disabled={!operator || busy}
          onClick={() => void refreshOffers()}
        >
          {busy ? "Refreshing…" : "Refresh offers"}
        </button>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className={styles.success} role="status">
            {message}
          </p>
        )}
        <p className={styles.hint}>
          Sample supplier offers are used for this workspace.
        </p>
      </section>
      <section className={styles.panel}>
        <div className={styles.panelHeading}>
          <div>
            <h2>Purchase planning</h2>
            <p>Review supply needs and compare offers before ordering.</p>
          </div>
          <span className={styles.role}>
            {session?.providerAvailable ? "Available" : "Not connected"}
          </span>
        </div>
        <p className={styles.notice}>
          {session?.providerAvailable
            ? "AI assistance is available when you open a replenishment request."
            : "Standard stock and price checks are available. AI assistance has not been connected."}
        </p>
        <Link className={styles.secondary} href="/app/replenishment">
          Open replenishment <span aria-hidden="true">↗</span>
        </Link>
      </section>
    </div>
  );
}

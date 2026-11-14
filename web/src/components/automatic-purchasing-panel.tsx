"use client";
import { useEffect, useRef, useState } from "react";
import type { OperatorClient, SupplierCatalog } from "@/lib/operator-client";
import { identityRequest } from "@/lib/identity-client";
import {
  parseTokenInput,
  exactTokenAmount as tokenAmount,
} from "@/lib/funding";
import styles from "./automatic-purchasing-panel.module.css";

import {
  parseAutomaticPurchasingSnapshot,
  automaticPurchasingError,
  type AutomaticPurchasingSnapshot as Snapshot,
} from "@/lib/automatic-purchasing";

export function AutomaticPurchasingPanel({
  client,
  canManage,
}: {
  client: OperatorClient;
  canManage: boolean;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [catalog, setCatalog] = useState<SupplierCatalog | null>(null),
    [items, setItems] = useState<{ id: string; name: string }[]>([]);
  const [wallets, setWallets] = useState<{ id: string; accountId: string }[]>(
      [],
    ),
    [wallet, setWallet] = useState(""),
    [suppliers, setSuppliers] = useState<string[]>([]),
    [skus, setSkus] = useState<string[]>([]),
    [amount, setAmount] = useState("1"),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false),
    [policyRead, setPolicyRead] = useState(0),
    [setupRead, setSetupRead] = useState(0);
  const [policyFailure, setPolicyFailure] = useState<ReturnType<
      typeof automaticPurchasingError
    > | null>(null),
    [policyLoading, setPolicyLoading] = useState(true),
    [setupError, setSetupError] = useState(""),
    [setupLoading, setSetupLoading] = useState(false),
    [setupReady, setSetupReady] = useState(false);
  const submitting = useRef(false);
  // The policy is independent of optional supplier, inventory and wallet reads.
  useEffect(() => {
    let active = true;
    setPolicyLoading(true);
    setPolicyFailure(null);
    client
      .automaticPurchasing()
      .then((raw) => {
        const policy = parseAutomaticPurchasingSnapshot(raw);
        if (!active) return;
        setSnapshot(policy);
        if (policy.policy) {
          setSuppliers(policy.policy.suppliers);
          setSkus(policy.policy.itemIds);
          const value = BigInt(policy.policy.maxAutomaticAmount);
          setAmount(
            (value / BigInt(1000000)).toString() +
              "." +
              (value % BigInt(1000000)).toString().padStart(6, "0"),
          );
        }
      })
      .catch((cause) => {
        if (active) {
          setSnapshot(null);
          setPolicyFailure(automaticPurchasingError(cause));
        }
      })
      .finally(() => {
        if (active) setPolicyLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, policyRead]);
  useEffect(() => {
    if (!expanded || !canManage) return;
    let active = true;
    setSetupLoading(true);
    setSetupReady(false);
    setSetupError("");
    setWallets([]);
    setWallet("");
    void (async () => {
      const [offers, inventory, session] = await Promise.allSettled([
        client.catalog(),
        client.inventory(),
        client.session(),
      ]);
      if (!active) return;
      setCatalog(offers.status === "fulfilled" ? offers.value : null);
      setItems(inventory.status === "fulfilled" ? inventory.value : []);
      const messages: string[] = [];
      if (offers.status === "rejected")
        messages.push("Supplier offers could not be loaded.");
      if (inventory.status === "rejected")
        messages.push("Your supply list could not be loaded.");
      let walletReady = false;
      if (session.status === "fulfilled" && session.value.clinicId) {
        const id = session.value.clinicId;
        const [proofs, treasuries] = await Promise.allSettled([
          identityRequest(`clinics/${id}/wallet-bindings`),
          identityRequest(`clinics/${id}/treasuries`),
        ]);
        if (!active) return;
        if (
          proofs.status === "fulfilled" &&
          treasuries.status === "fulfilled"
        ) {
          const controller = (
            treasuries.value.configurations as {
              environment: string;
              status: string;
              controller: string;
            }[]
          ).find(
            (c) => c.environment === "near-testnet" && c.status === "Active",
          )?.controller;
          const available = (
            proofs.value.bindings as {
              id: string;
              accountId: string;
              status: string;
            }[]
          ).filter(
            (b) => b.status === "Verified" && b.accountId === controller,
          );
          setWallets(available);
          setWallet(available.length === 1 ? available[0].id : "");
          walletReady = true;
        } else
          messages.push(
            "Wallet setup could not be loaded. Your purchasing rules are unchanged.",
          );
      } else messages.push("Clinic wallet setup could not be loaded.");
      if (active) {
        setSetupError(messages.join(" "));
        setSetupReady(
          offers.status === "fulfilled" &&
            inventory.status === "fulfilled" &&
            walletReady,
        );
      }
    })()
      .catch(() => {
        if (active)
          setSetupError(
            "Purchasing options could not be loaded. Your existing rules are unchanged.",
          );
      })
      .finally(() => {
        if (active) setSetupLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, canManage, expanded, setupRead]);
  const atomic = parseTokenInput(amount),
    valid =
      !!snapshot &&
      !policyLoading &&
      setupReady &&
      !setupLoading &&
      !!atomic &&
      BigInt(atomic) <= BigInt(10000000) &&
      suppliers.length > 0 &&
      skus.length > 0 &&
      !!wallet &&
      consent;
  const toggle = (values: string[], value: string) =>
    values.includes(value)
      ? values.filter((v) => v !== value)
      : [...values, value];
  async function save(pause = false) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const result = pause
        ? await client.pauseAutomaticPurchasing()
        : await client.setAutomaticPurchasing(
            {
              expectedVersion: snapshot?.version ?? 0,
              enabled: true,
              suppliers,
              itemIds: skus,
              maxAutomaticAmount: atomic,
              walletBindingId: wallet,
            },
            wallet,
          );
      setSnapshot(parseAutomaticPurchasingSnapshot(result));
      setConsent(false);
    } catch {
      setError(
        "The policy could not be saved. Refresh settings and check your clinic role and verified wallet.",
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <section
      className={styles.panel}
      aria-labelledby="automatic-purchasing-title"
    >
      <details
        className={styles.disclosure}
        onToggle={(event) => setExpanded(event.currentTarget.open)}
      >
        <summary>
          <span className={styles.icon} aria-hidden="true">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            >
              <path d="m13 2-9 12h7l-1 8 10-13h-8l1-7Z" />
            </svg>
          </span>
          <span className={styles.summaryText}>
            <strong id="automatic-purchasing-title">
              Automatic purchasing
            </strong>
            <span>
              {snapshot?.enabled && snapshot.policy
                ? `Up to ${tokenAmount(snapshot.policy.maxAutomaticAmount)} CCUSD per order`
                : "Choose which purchases CareCart can make for you."}
            </span>
          </span>
          <span
            className={styles.status}
            data-enabled={snapshot?.enabled ?? false}
          >
            {policyLoading
              ? "Loading…"
              : snapshot
                ? snapshot.enabled
                  ? "On"
                  : "Off"
                : (policyFailure?.status ?? "Unavailable")}
          </span>
          <span className={styles.chevron} aria-hidden="true">
            ⌄
          </span>
        </summary>
        <div className={styles.content}>
          <p>
            CareCart can buy approved items from your chosen suppliers within
            your limits. Other orders stay for review.
          </p>
          {policyFailure && (
            <div className={styles.error} role="alert">
              <p>{policyFailure.message}</p>
              <button
                className={styles.secondary}
                type="button"
                disabled={policyLoading}
                onClick={() => setPolicyRead((value) => value + 1)}
              >
                Retry purchasing rules
              </button>
            </div>
          )}
          {setupError && (
            <div className={styles.notice} role="status">
              <p>{setupError}</p>
              <button
                className={styles.secondary}
                type="button"
                disabled={setupLoading}
                onClick={() => setSetupRead((value) => value + 1)}
              >
                Retry setup options
              </button>
            </div>
          )}
          {setupLoading && (
            <p className={styles.notice} role="status" aria-busy="true">
              Loading your supplies, suppliers and wallet…
            </p>
          )}
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          {snapshot?.enabled && snapshot.policy && (
            <div className={styles.activePolicy}>
              <p>
                Authorized until{" "}
                <time dateTime={snapshot.policy.expiresAt}>
                  {new Date(snapshot.policy.expiresAt).toLocaleString()}
                </time>
                .
              </p>
              {canManage && (
                <button
                  type="button"
                  className={styles.secondary}
                  disabled={busy || policyLoading}
                  onClick={() => void save(true)}
                >
                  Pause purchasing
                </button>
              )}
            </div>
          )}
          {canManage && snapshot && !policyLoading && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (valid) void save();
              }}
            >
              <div className={styles.choices}>
                <fieldset disabled={busy || setupLoading || !snapshot}>
                  <legend>Items to purchase</legend>
                  <div className={styles.options}>
                    {items.map((item) => (
                      <label key={item.id}>
                        <input
                          type="checkbox"
                          checked={skus.includes(item.id)}
                          onChange={() => setSkus(toggle(skus, item.id))}
                        />
                        <span>{item.name}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <fieldset disabled={busy || setupLoading || !snapshot}>
                  <legend>Approved suppliers</legend>
                  <div className={styles.options}>
                    {catalog?.suppliers?.map((supplier) => (
                      <label key={supplier.id}>
                        <input
                          type="checkbox"
                          checked={suppliers.includes(supplier.account)}
                          onChange={() =>
                            setSuppliers(toggle(suppliers, supplier.account))
                          }
                        />
                        <span>{supplier.account}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>
              <div className={styles.fields}>
                <label>
                  Limit per order <span>CCUSD · maximum 10</span>
                  <input
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </label>
                <label>
                  Clinic approval wallet
                  <select
                    value={wallet}
                    onChange={(e) => setWallet(e.target.value)}
                  >
                    <option value="">Choose a verified wallet</option>
                    {wallets.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.accountId}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {!wallets.length && (
                <p className={styles.notice}>
                  Verify your clinic control wallet in Settings to enable
                  automatic purchasing.
                </p>
              )}
              <label className={styles.consent}>
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                <span>
                  I authorize these purchases within this limit for up to 24
                  hours, or until my wallet verification expires.
                </span>
              </label>
              <div className={styles.formFooter}>
                <p>CCUSD is a test token with no cash value.</p>
                <button
                  className={styles.primary}
                  type="submit"
                  disabled={busy || !valid || !snapshot}
                >
                  {busy
                    ? "Saving…"
                    : snapshot?.enabled
                      ? "Update purchasing rules"
                      : "Enable purchasing"}
                </button>
              </div>
            </form>
          )}
          {!canManage && (
            <p className={styles.notice}>
              Your clinic administrator manages purchasing rules.
            </p>
          )}
          <details className={styles.limits}>
            <summary>Payment limits</summary>
            <p>
              Each order and the daily total are capped at 25 CCUSD. Available
              funds and the pause control also apply. Delivery is recorded
              separately.
            </p>
          </details>
        </div>
      </details>
    </section>
  );
}

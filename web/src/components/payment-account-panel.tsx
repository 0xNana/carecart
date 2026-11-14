"use client";
import { useCallback, useEffect, useRef, useState, useId } from "react";
import type { NearConnector, NearWalletBase } from "@hot-labs/near-connect";
import type { OperatorClient } from "@/lib/operator-client";
import type { FundingSnapshot } from "@/lib/funding";
import {
  nearAmount,
  parseTokenInput,
  exactTokenAmount as tokenAmount,
} from "@/lib/funding";
import styles from "./payment-account-panel.module.css";

type Phase =
  | "amount"
  | "review"
  | "signing"
  | "checking"
  | "complete"
  | "uncertain"
  | "failed";
type WalletConnection = { connector: NearConnector; wallet: NearWalletBase };
function exactTokenInput(value: string) {
  const amount = BigInt(value),
    whole = amount / BigInt(1_000_000),
    fraction = (amount % BigInt(1_000_000))
      .toString()
      .padStart(6, "0")
      .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
function transactionDetails(value: unknown) {
  const result =
    value && typeof value === "object"
      ? (value as { transaction?: { hash?: unknown }; status?: unknown })
      : {};
  const hash =
    typeof result.transaction?.hash === "string" &&
    /^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(result.transaction.hash)
      ? result.transaction.hash
      : null;
  const status =
    result.status && typeof result.status === "object"
      ? (result.status as Record<string, unknown>)
      : {};
  return { hash, failed: Object.hasOwn(status, "Failure") };
}

export function PaymentAccountPanel({
  client,
  canFund,
}: {
  client: OperatorClient;
  canFund: boolean;
}) {
  const [depositOpen, setDepositOpen] = useState(false);
  const depositDialog = useRef<HTMLDialogElement>(null),
    depositTrigger = useRef<HTMLButtonElement>(null);
  const depositId = useId();
  const [snapshot, setSnapshot] = useState<FundingSnapshot | null>(null),
    [loadError, setLoadError] = useState(""),
    [amount, setAmount] = useState("1");
  const [phase, setPhase] = useState<Phase>("amount"),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [txHash, setTxHash] = useState<string | null>(null);
  const wallet = useRef<WalletConnection | null>(null),
    baseline = useRef<string | null>(null),
    treasuryBaseline = useRef<string | null>(null),
    expectedAmount = useRef<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const next = await client.funding();
      setSnapshot(next);
      setLoadError("");
      return next;
    } catch {
      setLoadError("Balance unavailable. Try refreshing.");
      return null;
    }
  }, [client]);
  useEffect(() => {
    if (!canFund) return;
    const initial = window.setTimeout(() => void refresh(), 0),
      timer = window.setInterval(() => void refresh(), 30000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [refresh, canFund]);

  useEffect(() => {
    if (depositOpen && depositDialog.current && !depositDialog.current.open)
      depositDialog.current.showModal();
  }, [depositOpen]);
  function closeDeposit() {
    depositDialog.current?.close();
    setDepositOpen(false);
    requestAnimationFrame(() => depositTrigger.current?.focus());
  }

  if (!canFund)
    return (
      <section className={styles.panel} aria-labelledby="payment-account-title">
        <div className={styles.heading}>
          <div>
            <p className={styles.eyebrow}>PAYMENT ACCOUNT</p>
            <h2 id="payment-account-title">Access required</h2>
          </div>
        </div>
        <p className={styles.copy}>
          Ask your clinic administrator or finance lead to view the balance or
          add funds.
        </p>
      </section>
    );

  const treasury = BigInt(snapshot?.balances.treasuryToken ?? "0"),
    accounted = BigInt(snapshot?.balances.accounted ?? "0"),
    ceiling = BigInt(snapshot?.policy.acceptedDepositCeiling ?? "0");
  const remaining = ceiling > accounted ? ceiling - accounted : BigInt(0),
    maxDeposit = remaining < treasury ? remaining : treasury;
  const parsedAmount = parseTokenInput(amount),
    amountBig = parsedAmount ? BigInt(parsedAmount) : BigInt(0);
  const amountProblem = !parsedAmount
    ? "Enter a positive amount with up to six decimal places."
    : amountBig > treasury
      ? "The clinic treasury does not have enough CCUSD."
      : amountBig > remaining
        ? "This amount is above the account limit."
        : "";
  const unavailable =
    !snapshot ||
    !!loadError ||
    snapshot.policy.paused ||
    maxDeposit === BigInt(0);
  const submitDeposit = async () => {
    if (!snapshot || !canFund || !parsedAmount || amountProblem || unavailable)
      return;
    const depositAmount = parsedAmount;
    let signatureRequested = false;
    setBusy(true);
    setMessage("Opening the clinic wallet…");
    setTxHash(null);
    baseline.current = snapshot.balances.accounted;
    treasuryBaseline.current = snapshot.balances.treasuryToken;
    expectedAmount.current = depositAmount;
    setPhase("signing");
    try {
      let connection = wallet.current;
      if (!connection) {
        const { NearConnector } = await import("@hot-labs/near-connect");
        const connector = new NearConnector({
          network: "testnet",
          autoConnect: false,
          features: {
            signInWithoutAddKey: true,
            signAndSendTransaction: true,
            testnet: true,
          },
        });
        await connector.whenManifestLoaded;
        const connected = await connector.connect();
        connection = { connector, wallet: connected };
        wallet.current = connection;
      }
      if (
        connection.connector.network !== "testnet" ||
        !connection.wallet.manifest.features.signAndSendTransaction
      )
        throw new Error("Choose a wallet that can approve payments.");
      const accounts = await connection.wallet.getAccounts({
        network: "testnet",
      });
      if (
        !accounts.some(
          (entry) => entry.accountId === snapshot.accounts.treasury,
        )
      )
        throw new Error(
          `Connect the treasury account ${snapshot.accounts.treasury} in your wallet.`,
        );
      setMessage(
        "Review the token transfer in your wallet. No deposit is sent until you approve it.",
      );
      signatureRequested = true;
      const result = await connection.wallet.signAndSendTransaction({
        network: "testnet",
        signerId: snapshot.accounts.treasury,
        receiverId: snapshot.accounts.token,
        actions: [
          {
            type: "FunctionCall",
            params: {
              methodName: "ft_transfer_call",
              args: {
                receiver_id: snapshot.accounts.vault,
                amount: depositAmount,
                msg: "deposit",
              },
              gas: "120000000000000",
              deposit: "1",
            },
          },
        ],
      });
      const details = transactionDetails(result);
      setTxHash(details.hash);
      if (details.failed) {
        setPhase("failed");
        setMessage("The transfer was declined. No funds were added.");
        return;
      }
      setPhase("checking");
      setMessage("Checking the updated payment balance…");
      const next = await refresh();
      if (
        next &&
        BigInt(next.balances.accounted) >=
          BigInt(snapshot.balances.accounted) + BigInt(depositAmount) &&
        BigInt(next.balances.treasuryToken) <=
          BigInt(snapshot.balances.treasuryToken) - BigInt(depositAmount)
      ) {
        setPhase("complete");
        setMessage(
          `${tokenAmount(depositAmount)} CCUSD are now available in your payment account.`,
        );
      } else {
        setPhase("uncertain");
        setMessage(
          "Your wallet submitted the transfer, but the balance has not updated yet. Check the status before trying again.",
        );
      }
    } catch (cause) {
      if (signatureRequested) {
        setPhase("uncertain");
        setMessage(
          "Your wallet did not confirm this transfer. Check wallet activity and refresh your balance before trying again.",
        );
      } else {
        setPhase("review");
        setMessage(
          cause instanceof Error &&
            cause.message.startsWith("Connect the treasury")
            ? `Your wallet needs to include the clinic funding account (${snapshot.accounts.treasury}). Choose the right wallet and try again.`
            : "Could not open the clinic wallet. Try again.",
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const checkAgain = async () => {
    setBusy(true);
    const next = await refresh();
    if (
      next &&
      baseline.current &&
      treasuryBaseline.current &&
      expectedAmount.current &&
      BigInt(next.balances.accounted) >=
        BigInt(baseline.current) + BigInt(expectedAmount.current) &&
      BigInt(next.balances.treasuryToken) <=
        BigInt(treasuryBaseline.current) - BigInt(expectedAmount.current)
    ) {
      setPhase("complete");
      setMessage(
        `${tokenAmount(expectedAmount.current)} CCUSD are now available in your payment account.`,
      );
    }
    setBusy(false);
  };
  const startAnother = () => {
    setPhase("amount");
    setAmount("1");
    setMessage("");
    setTxHash(null);
    baseline.current = null;
    treasuryBaseline.current = null;
    expectedAmount.current = null;
  };
  const suggestions = ["0.5", "1", "5"]
    .map((v) => ({ label: v, atomic: parseTokenInput(v)! }))
    .filter((v) => BigInt(v.atomic) <= maxDeposit);

  return (
    <section className={styles.panel} aria-labelledby="payment-account-title">
      <div className={styles.heading}>
        <div>
          <h2 id="payment-account-title">Payment account</h2>
          <p>Available for purchases within your clinic’s spending rules.</p>
        </div>
        <button
          ref={depositTrigger}
          className={styles.primary}
          type="button"
          disabled={!snapshot}
          onClick={() => setDepositOpen(true)}
        >
          {phase === "amount" ? "Add funds" : "View deposit"}{" "}
          <span aria-hidden="true">↗</span>
        </button>
      </div>
      {loadError && (
        <p className={styles.error} role="alert">
          {loadError}{" "}
          <button type="button" onClick={() => void refresh()}>
            Refresh balances
          </button>
        </p>
      )}
      {snapshot && (
        <>
          <div className={styles.balanceCard}>
            <span>Available for purchases</span>
            <strong>
              {tokenAmount(snapshot.balances.spendable)} <small>CCUSD</small>
            </strong>
            <span className={styles.balanceCaption}>
              CCUSD is a test token with no cash value.
            </span>
          </div>
          <div className={styles.metrics} aria-label="Payment account balances">
            <div>
              <span>Set aside</span>
              <strong>
                {tokenAmount(
                  (
                    BigInt(snapshot.balances.reservedPayment) +
                    BigInt(snapshot.balances.reservedWithdrawal)
                  ).toString(),
                )}{" "}
                <small>CCUSD</small>
              </strong>
              <small>Reserved for payments and withdrawals</small>
            </div>
            <div>
              <span>Total balance</span>
              <strong>
                {tokenAmount(snapshot.balances.accounted)} <small>CCUSD</small>
              </strong>
              <small>Available and reserved funds</small>
            </div>
          </div>
          <details className={styles.detailRow}>
            <summary>Account details</summary>
            <dl>
              <div>
                <dt>Payment account</dt>
                <dd>{snapshot.accounts.vault}</dd>
              </div>
              <div>
                <dt>Funding wallet</dt>
                <dd>{snapshot.accounts.treasury}</dd>
              </div>
              <div>
                <dt>Available in funding wallet</dt>
                <dd>{tokenAmount(snapshot.balances.treasuryToken)} CCUSD</dd>
              </div>
              <div>
                <dt>Remaining deposit limit</dt>
                <dd>{tokenAmount(remaining.toString())} CCUSD</dd>
              </div>
              <div>
                <dt>Transfer fee balance</dt>
                <dd>{nearAmount(snapshot.balances.treasuryNearYocto)} NEAR</dd>
              </div>
            </dl>
          </details>
          {snapshot.policy.paused && (
            <p className={styles.error} role="status">
              Adding funds is temporarily paused.
            </p>
          )}
          <dialog
            ref={depositDialog}
            id={depositId}
            className={styles.depositDialog}
            aria-labelledby={depositId + "-title"}
            onCancel={(event) => {
              event.preventDefault();
              closeDeposit();
            }}
            onClose={() => {
              setDepositOpen(false);
              requestAnimationFrame(() => depositTrigger.current?.focus());
            }}
            onKeyDown={(event) => {
              if (event.key !== "Tab") return;
              const nodes = Array.from(
                event.currentTarget.querySelectorAll<HTMLElement>(
                  "button:not(:disabled),input:not(:disabled),a[href],summary",
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
            <div className={styles.dialogHeading}>
              <div>
                <p className={styles.eyebrow}>Payment account</p>
                <h2 id={depositId + "-title"}>Add funds</h2>
              </div>
              <button
                type="button"
                onClick={closeDeposit}
                aria-label="Close deposit"
              >
                ×
              </button>
            </div>
            <ol className={styles.steps} aria-label="Deposit progress">
              <li aria-current={phase === "amount" ? "step" : undefined}>
                1 · Amount
              </li>
              <li aria-current={phase === "review" ? "step" : undefined}>
                2 · Review
              </li>
              <li
                aria-current={
                  !["amount", "review"].includes(phase) ? "step" : undefined
                }
              >
                3 · Confirm
              </li>
            </ol>
            {loadError && (
              <div className={styles.error} role="alert">
                <p>Refresh your balance before continuing.</p>
                <button type="button" onClick={() => void refresh()}>
                  Refresh balance
                </button>
              </div>
            )}
            {phase === "amount" && (
              <div className={styles.depositFlow}>
                <h3>Choose an amount</h3>
                <p>Transfer CCUSD from your clinic funding wallet.</p>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!amountProblem && !unavailable) setPhase("review");
                  }}
                >
                  <label htmlFor={depositId + "-amount"}>Amount</label>
                  <div className={styles.amountField}>
                    <input
                      id={depositId + "-amount"}
                      inputMode="decimal"
                      autoComplete="off"
                      maxLength={32}
                      value={amount}
                      onChange={(event) => setAmount(event.target.value)}
                      aria-describedby="deposit-help deposit-error"
                      aria-invalid={!!amountProblem}
                    />
                    <span>CCUSD</span>
                  </div>
                  <div
                    className={styles.suggestions}
                    role="group"
                    aria-label="Suggested amounts"
                  >
                    {suggestions.map((option) => (
                      <button
                        type="button"
                        key={option.label}
                        onClick={() => setAmount(option.label)}
                      >
                        {option.label}
                      </button>
                    ))}
                    {maxDeposit > BigInt(0) && (
                      <button
                        type="button"
                        onClick={() =>
                          setAmount(exactTokenInput(maxDeposit.toString()))
                        }
                      >
                        Max
                      </button>
                    )}
                  </div>
                  <p id="deposit-help" className={styles.hint}>
                    You can add up to {tokenAmount(maxDeposit.toString())} based
                    on available funds and account limits.
                  </p>
                  {amountProblem && (
                    <p id="deposit-error" className={styles.error} role="alert">
                      {amountProblem}
                    </p>
                  )}
                  {!amountProblem && (
                    <span id="deposit-error" className={styles.visuallyHidden}>
                      Amount is within the available balance and account limit.
                    </span>
                  )}
                  <button
                    className={styles.primary}
                    disabled={busy || unavailable || !!amountProblem}
                  >
                    Review deposit
                  </button>
                </form>
              </div>
            )}
            {phase === "review" && (
              <div className={styles.depositFlow}>
                <h3>Review deposit</h3>
                <p>
                  Make sure these details are correct before opening your
                  wallet.
                </p>
                <dl className={styles.review}>
                  <div>
                    <dt>You add</dt>
                    <dd>{tokenAmount(parsedAmount ?? "0")} CCUSD</dd>
                  </div>
                  <div>
                    <dt>From</dt>
                    <dd>Clinic treasury</dd>
                  </div>
                  <div>
                    <dt>To</dt>
                    <dd>Your payment account</dd>
                  </div>
                  <div>
                    <dt>Transfer fee</dt>
                    <dd>Paid by the clinic</dd>
                  </div>
                </dl>
                <p className={styles.hint}>
                  Your wallet will ask you to approve this transfer. It adds
                  funds to your balance; it does not pay a supplier.
                </p>
                {message && (
                  <p role="status" aria-live="polite">
                    {message}
                  </p>
                )}
                {(amountProblem || unavailable) && (
                  <p className={styles.error} role="alert">
                    {loadError
                      ? "Refresh your balance before continuing."
                      : snapshot.policy.paused
                        ? "Adding funds is temporarily paused."
                        : amountProblem ||
                          "No funds are available to add right now."}
                  </p>
                )}
                <div className={styles.actions}>
                  <button type="button" onClick={() => setPhase("amount")}>
                    Edit amount
                  </button>
                  <button
                    className={styles.primary}
                    type="button"
                    disabled={busy || !!amountProblem || unavailable}
                    onClick={() => void submitDeposit()}
                  >
                    {busy ? "Opening wallet…" : "Continue to wallet"}
                  </button>
                </div>
              </div>
            )}
            {[
              "signing",
              "checking",
              "complete",
              "uncertain",
              "failed",
            ].includes(phase) && (
              <div className={styles.depositFlow}>
                <h3>
                  {phase === "signing"
                    ? "Approve in your wallet"
                    : phase === "checking"
                      ? "Confirming deposit"
                      : phase === "complete"
                        ? "Deposit complete"
                        : phase === "failed"
                          ? "Deposit declined"
                          : "Check deposit status"}
                </h3>
                <p role="status" aria-live="polite">
                  {busy && phase === "signing"
                    ? "Waiting for your clinic wallet…"
                    : message}
                </p>
                {txHash && (
                  <details className={styles.transaction}>
                    <summary>Transfer record</summary>
                    <p>
                      <code>{txHash}</code>
                    </p>
                    <a
                      href={`https://testnet.nearblocks.io/txns/${encodeURIComponent(txHash)}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View transfer details
                    </a>
                  </details>
                )}
                {phase === "complete" && (
                  <button
                    type="button"
                    className={styles.primary}
                    onClick={startAnother}
                  >
                    Make another deposit
                  </button>
                )}
                {phase === "failed" && (
                  <button
                    type="button"
                    className={styles.primary}
                    onClick={startAnother}
                  >
                    Try another deposit
                  </button>
                )}
                {phase === "uncertain" && (
                  <button
                    type="button"
                    onClick={() => void checkAgain()}
                    disabled={busy}
                  >
                    {busy ? "Refreshing…" : "Refresh and check balance"}
                  </button>
                )}
              </div>
            )}
          </dialog>
          <p className={styles.footnote}>
            Updated{" "}
            <time dateTime={snapshot.observedAt}>
              {new Date(snapshot.observedAt).toLocaleTimeString()}
            </time>
            .
          </p>
        </>
      )}
      {!snapshot && !loadError && (
        <p role="status" aria-busy="true" className={styles.loading}>
          Loading your balance…
        </p>
      )}
    </section>
  );
}

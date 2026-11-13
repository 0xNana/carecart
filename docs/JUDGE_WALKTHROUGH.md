# Judge walkthrough

This walkthrough runs CareCart from an isolated local snapshot with synthetic clinic data. It needs no hosted identity, AI key, wallet, testnet funds or public transaction. It shows the actual application and worker, but its procurement and payment records are demo data.

## 1. Start and verify CareCart

From the repository root:

```bash
nvm use
npm ci --prefix backend
npm ci --prefix web
bash scripts/verify-phase2.sh
```

Expected: backend and web checks pass, and the production build completes. The last line prints the temporary snapshot path. The script creates a source-only snapshot under `/tmp`; it does not read `.env`, local databases or credentials.

## 2. Open the application demo

Copy the exact snapshot path printed above into this command:

```bash
node scripts/mvp-browser-acceptance.mjs /tmp/carecart-phase2-verify.REPLACE_WITH_PRINTED_SUFFIX
```

Expected: Chromium opens the built app in headless mode, the runner exercises the application at desktop and mobile widths, and the final JSON report says `"status": "passed"`. The report lists screenshot files and the per-step inventory balance.

For an owner-recorded video, start a local screen recorder and add `--headed` to the same command. Visible mode pauses at each main step for about seven seconds; set `CARECART_DEMO_PAUSE_MS` between `2000` and `15000` milliseconds to adjust narration time. The runner still uses synthetic data and makes no payment.

If Chromium is installed somewhere other than `/snap/bin/chromium`, set its path for this command:

```bash
CARECART_CHROMIUM_BIN=/path/to/chromium node scripts/mvp-browser-acceptance.mjs /tmp/carecart-phase2-verify.REPLACE_WITH_PRINTED_SUFFIX
```

Replace both example paths with local paths. The runner starts and stops its own local API, web app, worker and temporary workspace.

## 3. Record consumption

The browser runner opens the real stock form and records a clinic's consumption event. Expected: on-hand stock decreases by the recorded quantity and the event appears in stock activity.

The same run records receiving, dispensing and a stock adjustment so the full stock ledger is exercised.

## 4. Observe automatic replenishment

The runner enables background monitoring for its temporary clinic, then waits for the worker to process the shortage. Expected: the worker creates one replenishment request and one canonical purchase order using the configured synthetic supplier offer.

No person has to trigger the monitoring run. A clinic approver is still required before a purchase or payment request can proceed.

## 5. Inspect the payment boundary

Expected in the browser report: payment state remains `Unobserved`; payment execution spies remain zero. The demo does not send money. The app and vault have separate controls for authorizing payment, and the inventory worker cannot authorize or sign a payment.

Run the backend suite for role, policy, replay and failure-path coverage:

```bash
npm test --prefix backend
```

Run the vault and its actual local NEAR Sandbox flows:

```bash
cargo test --manifest-path contracts/Cargo.toml --locked --workspace
```

Expected: only local synthetic accounts and fixture tokens are used. Sandbox execution is a genuine local contract run; it is not public testnet evidence and does not move real funds.

## 6. Record delivery once

The browser runner records the purchase-order delivery in the inventory ledger, stops the worker, starts it again and checks the records. Expected: physical on-hand stock increases once, the same purchase order remains linked, and the worker restart does not create a duplicate order.

## Evidence labels and limitations

- **Public testnet:** no complete supplier-payment receipt is attached to this release. A testnet profile is configuration, not proof that the transaction occurred.
- **Local NEAR Sandbox:** actual contract execution in an isolated local chain; useful for policy verification, not a public transaction.
- **Browser runner:** real CareCart UI and worker with synthetic local records; payment is deliberately unobserved and no financial call is made.

Do not describe the browser or Sandbox run as a completed public payment. CCUSD is a test asset, not Circle USDC. The current app flow asks for per-order clinic authorization, so do not claim unattended autonomous purchasing.

## Troubleshooting

- If `nvm use` selects the wrong Node version, install and select Node 24.21.0 from `.nvmrc` before installing dependencies.
- If the browser runner cannot find Chromium, set `CARECART_CHROMIUM_BIN` to the installed executable.
- If a local dependency install fails, use the npm version declared in `backend/package.json` and `web/package.json` (12.2.1) and retry `npm ci`.
- The Sandbox suite may need to download its pinned local node on first use and bind loopback RPC ports. This is local setup only; it does not require a public NEAR transaction.
- For any failed run, retain the JSON report and the specific verifier log path printed by the script. Do not use an old temporary snapshot after changing source; rerun `scripts/verify-phase2.sh` and use its newly printed path.

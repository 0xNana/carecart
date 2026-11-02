# CareCart web workspace

The dashboard displays synthetic inventory, forecasts, quotes, purchase orders and audit details from the backend. Testnet wallet actions require explicit human transaction review. Cross-chain output is preview/simulation only.

Follow the root [fresh-checkout judge guide](../README.md#1-prepare-a-fresh-checkout) for the verified install, build, public configuration and two-terminal startup sequence. It uses backend port 3101, web port 3102 and a new ignored `backend/data/judge.sqlite`; no credentials, account creation or public signing are needed. Follow its numbered UI steps and run `node scripts/judge-local.mjs http://127.0.0.1:3101` from the repository root for an API outcome report.

For development, `npm run dev --prefix web -- --webpack` uses the normal Next.js port unless overridden. Set the server-only `CARECART_API_URL` in `web/.env.local` to your backend origin. The default is `http://127.0.0.1:3001`. Restart the web server after changing it. Webpack is the verified production build path; type checking remains enabled. The proxy allows only dashboard/forecast reads, quote/PO mutations and preview routes, checks POST origins, and returns a readable error when the backend is unavailable.

See [CC-13 verification evidence](../docs/judge-verification.md) for the clean-clone results. UI lint is `npm run lint --prefix web`; six wallet/RPC test cases can be run with `node --experimental-strip-types web/tests/wallet.test.mts` from the root. Four proxy-body tests run with `node --experimental-strip-types web/tests/proxy-body.test.mts`. See [CC-14 release checks](../docs/security-release.md) for HTTP limits, headers and dependency dispositions. Keep keys and provider credentials out of web configuration.

## Testnet wallet controls

The web server uses only `https://test.rpc.fastnear.com` and verifies its reported chain ID. Public settings in `web/.env.local` may override these human-selected defaults:

```dotenv
CARECART_VAULT_ID=vault.carecart.testnet
CARECART_TEST_TOKEN_ID=token.carecart.testnet
CARECART_ADMIN_ID=admin.carecart.testnet
```

These are public IDs; deployed hashes and live CCTEST metadata are recorded in the [deployment evidence](../docs/testnet-deployment.md). All must be named `.testnet` accounts. Never copy backend private keys or the root `.env` into the web project. The token must report `CCTEST` with zero decimals, matching the in-repo test token. Amounts are whole atomic units and have no monetary value.

The vault panel reads the deployed admin, policy, pause state, token balance, spending/reservations and PO storage reserve. An empty code hash shows “Awaiting deployment” and disables contract actions. RPC failures or admin/token mismatches also disable controls. Both contracts are deployed/verified. The approved initial setup was paused; the latest human-requested resume is [verified active](../docs/testnet-resume-verification.json), with 10000 CCTEST and 0.09748 test NEAR remaining commitment storage reserve. The admin matches the configuration. An already-open page needs Refresh vault after external CLI transactions. No live PO payment or browser-wallet signature has been exercised.

Click **Connect testnet wallet** to select a testnet wallet containing `admin.carecart.testnet`. Connection requests neither a function-call access key nor message signing. No wallet opens automatically on page load. The configured admin can review pause/resume and policy changes. Each purchase order can read its canonical payment state; pending records offer wallet-reviewed approval/rejection. Review shows signer, contract, method, arguments, gas, deposit, and canonical payee/token/amount. **Cancel** or Escape closes review without signing. **Continue to testnet wallet** is the only signing trigger; it rechecks network, deployed configuration, connected account, and pending payment. Approval is disabled while paused. The contract remains the final authority.

The `/api/vault` and `/api/vault/payments/:poId` routes are read-only. Admin methods and backend payment submission are not proxied to the browser. Payment rows distinguish recorded backend status from a fresh chain query; stored public transaction hashes link only to the testnet explorer. Wallet success is not treated as payment settlement: refresh canonical status. Redirects and failed receipts never report a confirmed payment.

Run `npm test --prefix web` for wallet/RPC safety checks. An isolated temporary fake-wallet app exercises review/cancel, focus, policy validation, pause-state refresh, rejection, and canonical payment review without public signing. The real wallet picker and undeployed state were checked using public read-only testnet data. The approved CLI deployment/setup is verified. Live browser-wallet ownership and signing still require explicit human action/authorization; the app is not allowed to sign automatically.

## Cross-chain previews

CC-12 adds a panel below the persisted records. Choose a stored PO and Base, Arbitrum or Solana, then run the offline simulation. The backend resolves the supplier and amount; the result always says simulation and settlement not initiated. It changes no payment state. Optional 1Click dry quotes use a separately reviewed server route/amount, resolve current supported assets, and show mainnet market data independently of CCTEST orders. They are disabled by default. No wallet action, deposit address, swap or settlement is exposed. See [configuration and verification](../docs/cross-chain-preview.md).

## Wallet handoff recovery

The review dialog now closes after explicit Continue, before NEAR Connect can open its own overlay. Bounded preflight waits never fall through to signing; unanswered signatures stay tracked without automatic retry, while vault refresh remains available. Nine wallet/RPC cases and offline browser overlay/late-response checks pass. Close the old wallet prompt before reloading or switching to CLI; a timeout does not cancel a transaction. See [root cause, evidence and exact CLI fallback](../docs/wallet-recovery.md).

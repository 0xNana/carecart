> Historical prototype guide archived during consolidation on 2026-11-07. Original relative links below refer to the repository root. Current scope and verification are in the root README and docs/carecart-mvp-scope.md; old completion counts and activation instructions are not current acceptance.

# CareCart

**Primary implementation authority:** [mainnet-todo.md](mainnet-todo.md). MN-00 design sign-off is approved; mainnet implementation/release gates remain open. [DESIGN.md](DESIGN.md), [implementation.md](implementation.md) and [todo.md](todo.md) are completed historical records. The runtime/judge instructions below still describe the verified testnet prototype.

MN-01 local profile/amount implementation and read-only asset evidence: [mainnet profile guide](docs/mainnet-profile.md). Live 1Click support and owner-account registrations remain unverified; the mainnet candidate cannot enable this testnet server.

MN-03/MN-04 role and commitment changes are prepared with [owner-run verification commands](docs/mainnet-roles-commitments.md); full test/Sandbox results are pending.

MN-05 signed-quote/approval checks are prepared with [trust assumptions and owner-run tests](docs/mainnet-signed-quotes.md). Live provider compatibility and wallet integration remain gated.

CareCart is a procurement prototype for the NEAR Hackathon Real-World Money track. Synthetic inventory flows through a deterministic forecast, simulated supplier quotes, a stored purchase order, and a NEAR policy vault. Supplier and payment authority are enforced in the backend and contract.

## What can be verified now

| Path | Current behavior |
| --- | --- |
| Dashboard and backend | Synthetic inventory, forecasts, quotes, idempotent PO drafting and audit records. Default judge/dashboard flow calls no live LLM. An opt-in authenticated manual AI adapter is implemented; live compatibility remains pending. |
| Contract/payment adapter | Real contract execution in disposable local NEAR Sandbox: paid, pending approval, blocked, failed, replay and restricted-key cases. |
| Testnet wallet UI | Testnet-only NEAR Connect, transaction review, policy/pause controls and canonical payment reads. Vault and CCTEST token are deployed/verified on testnet; the vault is active with 10000 CCTEST after the approved resume. Browser-wallet signing and live PO payments remain unverified. |
| Cross-chain panel | Offline route simulation. Optional 1Click market quotes are dry-only and disabled by default. Neither path deposits funds or settles a payment. |
| Safety-vault v2 and settlement modules | Separate, undeployed hard-limit/guardian/treasury contract, signed Base quote/recovery modules and local tests. These do not change the current CCTEST wallet ABI or enable real settlement in the panel. |

All inventory, usage, suppliers and prices are synthetic. No patient or real supplier data, TEE/private-inference claim, or deployed mainnet payment service is included. The completed legacy documents preserve the original proposal and testnet evidence. The accepted mainnet requirements and ongoing work are consolidated in [mainnet-todo.md](mainnet-todo.md).

Current gap implementation, local AI setup and remaining public verification are recorded in [todo-testnet-gap.md](todo-testnet-gap.md) and the [gap operator guide](docs/testnet-gap-implementation.md). Keep the defaults below for the reproducible synthetic judge path.

## 1. Prepare a fresh checkout

Run from the repository root on Linux. The verified environment is Node **24.21.0**, npm **12.2.1**, Rust **1.93.0**, and cargo-near **0.22.0**. Node is pinned in `.nvmrc`; Rust and the Wasm target are pinned in `rust-toolchain.toml`. Rust/cargo-near are needed only for the local contract checks in step 5. Git, curl and a browser are also needed. Initial package installation and the first Sandbox binary download need internet access; Sandbox needs local loopback sockets.

With nvm already installed:

```sh
nvm install
nvm use
node --version
npm --version
npm ci --prefix backend --no-audit --no-fund
npm ci --prefix web --no-audit --no-fund
cp .env.example .env
```

See Node `v24.21.0`, npm `12.2.1`, and successful installs from the committed lockfiles. Both projects keep `ignore-scripts=true`; the pinned Linux native packages load without enabling install scripts. The install commands skip the audit request; this does not mean dependencies are security-cleared. CC-14 audit results and dated deferrals are in the [security release report](docs/security-release.md).

On a fresh checkout, `.env.example` has empty backend signing keys, no live provider model, and `ONECLICK_PREVIEW_ENABLED=false`. Keep those defaults for this guide. No account creation, wallet connection, private key or funded public account is needed. Do not copy an existing credential-bearing environment into this judge run.

The guide uses ports **3101** and **3102** to avoid the app's normal development ports. Create the web server's public configuration separately:

```sh
cat > web/.env.local <<'ENV'
CARECART_API_URL=http://127.0.0.1:3101
CARECART_VAULT_ID=vault.carecart.testnet
CARECART_TEST_TOKEN_ID=token.carecart.testnet
CARECART_ADMIN_ID=admin.carecart.testnet
ENV
npm run build --prefix web -- --webpack
```

See a successful production build including `/`, `/api/[...path]`, `/api/vault` and `/api/vault/payments/[poId]`. The web file contains public IDs only. A planned ID is not evidence of deployment. Webpack is the verified build path; normal type checking remains enabled.

## 2. Start the synthetic app

In terminal A, from the repository root:

```sh
PORT=3101 CARECART_DATABASE_PATH="$PWD/backend/data/judge.sqlite" npm start --prefix backend
```

See `CareCart backend listening on http://127.0.0.1:3101`. On first start it creates and seeds the ignored `backend/data/judge.sqlite`; subsequent starts preserve it. No existing workspace database is needed.

In terminal B, from the same root:

```sh
npm start --prefix web -- --hostname 127.0.0.1 --port 3102
```

See Next.js ready on [http://127.0.0.1:3102](http://127.0.0.1:3102). Keep both terminals running. If either port is occupied, choose another loopback port and update the matching backend command, `CARECART_API_URL`, web port and URLs together; restart the web server after changing its configuration.

## 3. Follow the UI: do X, see Y

1. Open [the dashboard](http://127.0.0.1:3102). See **Synthetic data**, the procurement overview, two inventory items, two registered suppliers and an initially seeded PO with payment **Not requested**.
2. Select **nitrile examination gloves**. See **4 boxes** on hand, reorder point **12**, **27 boxes** in the fixed 30-day synthetic usage window, and recommendations of **11** for Alpha / **14** for Beta. This fixture window is fixed, not a claim about recent real-world usage.
3. Click **Get fresh quotes**. See new seven-day simulated quotes: **14 boxes**, **1,680 CCTEST atomic** for Alpha and **1,890** for Beta. Older seeded quotes may have expired; use a fresh quote. CCTEST is the zero-decimal test token, not fiat or USDC.
4. Click **Draft order** for the fresh Alpha quote. See a PO in **Purchase orders** with the stored supplier, quantity **14**, amount **1,680**, and payment **Not requested**. Drafting does not pay. IDs depend on earlier actions, so use the returned ID rather than assuming a number.
5. Expand that order's **Purchase order created** audit entry. See the persisted quote, supplier, item and request IDs. Click **Refresh data**; the same PO remains and its quote says **Order drafted**.
6. Inspect **Testnet vault & wallet**. With public RPC access and the deployed account configuration, see **Active** after the approved resume, **10000 CCTEST**, the 2000 / 5000 / 10000 automatic-payment thresholds and the 0.1 test NEAR PO storage reserve. Signing controls require the connected admin; approval stays disabled while paused. Without RPC access, see a readable error and **Refresh vault**; the local procurement/preview path still works. This is not a paid or approved result. Do not connect or sign to complete this guide. Live wallet verification remains separate approved follow-up work.
7. Scroll to **Cross-chain preview**, choose the stored PO and Base, Arbitrum or Solana, then click **Run offline simulation**. See **Simulation generated · Settlement not initiated**, the same registered supplier/amount, and a `simulation:...` placeholder destination. See **Dry market quotes are not configured**. No exchange rate, deposit address or deliverable cross-chain payment is produced.

## 4. Verify the HTTP path and payee boundary

With terminal A still running:

```sh
node scripts/judge-local.mjs http://127.0.0.1:3101
```

See a JSON report with `result: "passed"`, the 27-unit usage forecast, a dynamically selected fresh Alpha quote and PO, `replayed: true` for its retry, a rejected payee/amount override (`400 VALIDATION_ERROR`), deterministic agent mode, a preview-only cross-chain result and an unchanged payment/audit state after preview. Refresh the dashboard to inspect that PO and audit entry. Each script run creates fresh synthetic quotes and one PO; it never submits a payment, opens a wallet or contacts 1Click.

To see the read APIs directly:

```sh
curl --fail-with-body -sS http://127.0.0.1:3101/api/inventory
curl --fail-with-body -sS http://127.0.0.1:3101/api/inventory/item-000001/forecast
```

See two synthetic items and the same backend forecast as the UI. The quote API accepts an item ID; the PO API accepts request/item/quote IDs only. Supplier and amount are derived from stored records.

Run the actual adversarial supplier-message check:

```sh
npm test --prefix backend -- src/agent/service.test.ts -t 'registered payee'
```

See the test pass after a supplier message asks to redirect a drafted PO to `attacker.near`. The stored PO keeps Alpha and **1,680** atomic units. Supplier messages enter through an internal agent interface; this test is not an HTTP message-injection endpoint or a live LLM demonstration.

## 5. See real policy results in local Sandbox

Use rustup to install Rust if it is not already present. If the pinned toolchain/target are missing, run `rustup toolchain install 1.93.0 --target wasm32-unknown-unknown`; if cargo-near is missing, run `cargo install cargo-near --version 0.22.0 --locked`. Then, from the repository root:

```sh
rustup show active-toolchain
cargo near --version
cargo test --manifest-path contracts/Cargo.toml --workspace --locked -- --nocapture
```

The root toolchain file selects Rust `1.93.0` and `wasm32-unknown-unknown`; the Sandbox test uses `cargo near` to build both contracts. Keep Node on PATH and the backend dependencies installed. The first run downloads the pinned Sandbox node binary. Restricted runners must permit loopback RPC sockets; a clean compilation may take several minutes.

See the original **21 policy tests**, **9 payment tests** and **1 Sandbox integration test**, plus **13 safety-vault unit tests** and **1 separate safety Sandbox test**, pass. The original Sandbox exercises inventory → forecast → quotes → PO → the real backend HTTP payment adapter. The new Sandbox uses a six-decimal CCUSD mock and verifies guardian/treasury accounting and Base mock dispatch only. Look for:

```text
Backend Sandbox adapter: paid, pending, blocked, failed, restricted keys, hashes and replay audits passed
```

These are actual local contract outcomes, not public-network settlements or UI simulations. The test verifies transaction hashes, persisted outcomes, audit-once replay, reservations/callbacks, approval/rejection and restricted keys. The agent cannot invoke admin approval, policy or pause methods. No supplied account, public wallet, public deployment or real funds are used.

Negative test cases may print expected panic diagnostics under `--nocapture`; use the final passing test summaries and adapter marker above to assess the run.

The CC-09 adapter commits immutable PO details once, requests by PO ID only, checks chain/key permissions before signing, and reconciles ambiguous RPC responses. Full-access keys never belong in backend configuration. Public testnet deployment, token metadata, role grants and storage funding are verified. The restricted backend keys and supplier mappings are now configured in a separate local testnet profile; browser-wallet signing and PO payment still require explicit human review. See [live testnet setup](docs/testnet-live-setup.md). See [account status](docs/testnet-accounts.md) and [wallet controls](web/README.md#testnet-wallet-controls). No public deployment commands are part of this judge guide.

## 6. Run the remaining checks

```sh
npm test --prefix backend
npm run typecheck --prefix backend
node --experimental-strip-types web/tests/wallet.test.mts
node --experimental-strip-types web/tests/proxy-body.test.mts
npm run lint --prefix web
node scripts/security-check.mjs
```

See **64 backend tests**, successful backend type checking, **six wallet/RPC cases**, **four proxy-body cases**, clean lint and a passing redacted source/history guard. The production build was checked in step 1. The contract suite in step 5 covers the local policy result required by the judge path; the public read-only vault API now reports deployed/active after the approved resume. Earlier CC-13 screenshots show its historical pre-deployment state.

CC-14 also verifies native npm/RustSec audits and registry signatures. Backend and production web npm audits have zero advisories; full web lint and Rust test dependencies have documented deferrals, so their native audit commands still exit nonzero. The unmaintained default Wasm allocator was removed using the SDK's supported feature flag. Recheck deferrals by 2026-11-09 or before deployment/public release. This is a local prototype check, not a zero-advisory or production-hosting approval; see [evidence, limits and rerun commands](docs/security-release.md).

Stop the two servers with Ctrl-C. The ignored judge database can be kept to inspect persistence. To start a new synthetic run without deleting an existing database, choose a different `CARECART_DATABASE_PATH` filename and restart terminal A.

See [CC-13 verification evidence](docs/judge-verification.md), [preview behavior/configuration](docs/cross-chain-preview.md), [implementation status](implementation.md), and the ordered [TODO](todo.md). Future mainnet cross-chain settlement is planned separately and is not an implemented feature of this runbook.

## Deployment review and engineering handoff

CC-15 provides a [testnet-only deployment review package](docs/testnet-deployment.md): current artifact hashes, public preflight, exact proposed CLI commands and staged read-only verification. The helper cannot sign or broadcast. After explicit approval, both contracts and all twelve setup transactions succeeded; [public receipts and verified paused state](docs/testnet-deployment-receipts.json) are recorded. Live browser-wallet and PO payment checks remain pending.

Read the [handoff](docs/handoff.md) and [mainnet backlog/reconciliation](mainnet-todo.md) before starting the approved mainnet implementation. The prototype's cumulative `balance_cap` and overridable automatic caps differ from the approved mainnet accepted-deposit accounting and immutable hard limits. Treasury recovery and real cross-chain settlement still need implementation. This judge guide remains synthetic and testnet-only; no environment change enables mainnet.

The local testnet backend is configured in ignored owner-only `.env.testnet`; the normal judge guide stays credential-free. See [wallet connection and exact pending payment test](docs/testnet-live-setup.md). Preparation has not resumed the vault or submitted a payment.

The admin policy transaction supplied by the human updated policy only. A separate [verified resume](docs/testnet-resume-verification.json) now sets `paused=false`; click **Refresh vault** on an already-open page. No PO was paid by resuming.

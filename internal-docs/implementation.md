# CareCart prototype implementation — COMPLETED / ARCHIVED

**Document status: COMPLETED / CLOSED — historical record, 2026-11-02 (UTC).**

**Current primary authority:** [mainnet-todo.md](mainnet-todo.md), aligned with the [approved MN-00 record](CareCart-MN-00-APPROVED-2026-11-02.md). Use that document for ongoing requirements, work order, decisions and release gates. This file is retained for history/evidence; closing it does not certify unimplemented functionality, unanswered operational inputs or unperformed tests. Historical unchecked items are carried forward in the primary document rather than silently marked verified.

## Historical implementation and evidence

**Status:** Setup and CC-01 through CC-14 are implemented, with CC-14 dependency deferrals recorded in [security release evidence](docs/security-release.md). A clean local clone of the current source snapshot passes the numbered judge guide; evidence and expected API output are in `docs/judge-verification.md`. CC-11 browser-wallet signing and live PO payment verification remain pending; the human-approved CC-15 contract deployment/setup is now complete. The locked contract workspace tests, local Sandbox payment lifecycle, both contract Wasm builds, and backend endpoint, procurement, deterministic agent, and payment adapter tests pass. The Sandbox lifecycle also exercises the TypeScript payment client and HTTP route with restricted keys. Human-created testnet accounts and authorized key cleanup are recorded in `docs/testnet-accounts.md`; both contract deployments and all twelve approved testnet setup transactions have FINAL successful receipts; no live app PO payment has occurred. The historical prototype made no live LLM call. MN-00 now selects NEAR AI Cloud; actual live model/credentials/compatibility remain MN-08 verification work.

**Handoff:** CC-15 review tooling and its concrete proposal are implemented; the setup approved by the human and executed through the CLI is verified with exact byte hashes, live CCTEST metadata and a paused/funded vault. See [deployment review](docs/testnet-deployment.md). CC-16 engineering handoff and [mainnet-todo.md](mainnet-todo.md) are prepared; MN-00 reconciliation is approved and incorporated in the primary mainnet checklist; actual submission/publication remains open in MN-13.

**Local testnet readiness:** Restricted backend keys are configured/verified in owner-only ignored `.env.testnet`; an isolated supplier-mapped database is configured on backend:3101/web:3102. The formerly prepared 1680 CCTEST PO was committed/requested while paused and is Blocked/Paused. A later approved CLI resume succeeded; no successful public PO transfer is established; see [commands and review](docs/testnet-live-setup.md).

**Latest public state:** The human-supplied `set_policy` transaction succeeded; a separately requested `set_paused(false)` transaction now has FINAL success. The vault and both UI read APIs report Active / 10000 CCTEST. The previous PO is Blocked/Paused and no successful PO payment is claimed. See [resume verification](docs/testnet-resume-verification.json).

**Date:** 2026-11-02 (UTC)
**Historical prototype track:** Real-World Money (`realworld`). Current approved mainnet tracks are recorded in the primary document, subject to organizer validation.

## Objective

Build a reproducible, testnet-first procurement prototype for healthcare supplies. CareCart should turn synthetic stock levels into a forecast, supplier quote comparison, purchase order, and policy-checked payment request. A NEAR contract is the final authority for which suppliers can be paid and under what limits. The AI can propose a purchase order; it cannot choose an arbitrary account, token, route, or amount.

The problem is routine procurement work: teams manually notice low stock, gather quotes, and prepare purchase orders. Automating those steps is useful only if payment authority stays bounded and visible. The prototype must show the full path from low stock to a recorded payment outcome without using real healthcare or vendor data.

## Scope and assumptions

- Build for the `realworld` track. The human may select additional submission tracks later; this spec does not add them.
- Use synthetic inventory, usage history, supplier quotes, and supplier identities only.
- Target NEAR testnet first. The current `DESIGN.md` describes a mainnet target; this spec supersedes that target for the initial implementation.
- Use a test-only NEP-141 token for local/sandbox contract tests and the testnet prototype. Its address must come from a human-approved deployment result; do not copy the mainnet USDC address into testnet configuration.
- NEAR Intents has no testnet deployment. Cross-chain behavior on testnet will use a mock adapter. An optional 1Click quote preview may use `dry: true`; that response has no deposit address and does not initiate a swap. Actual Intents settlement is out of the first testnet scope.
- The human plans a later mainnet deployment for cross-chain payments. CC-12 remains preview-only; actual mainnet settlement requires separate implementation and a reviewed deployment.
- No TEE or privacy claim is part of this track or the first prototype. The design's attestation screens and claims remain out of scope unless separately implemented and verified.
- Account IDs, test token IDs, vault IDs, API keys, and model names must come from the human or verified deployment/API output. Do not invent placeholders as if they were live values.
- The PO commitment boundary is defined: the vault admin grants a dedicated committer role; that role stores each PO ID with its supplier account, token contract, and smallest-unit amount exactly once. Future payment requests accept only the ID and resolve details from the vault. The agent receives no PO-commit permission and cannot rebind a committed ID.
- `per_order_cap` limits automatic payment per PO, `daily_cap` limits automatic payment per UTC day, and `balance_cap` is the cumulative spending budget for the configured token. Exceeding a cap routes an otherwise valid, funded request to human approval. A pause, missing PO, disallowed supplier, duplicate request ID, invalid PO, or insufficient token balance is blocked.

## Product behavior

1. A deterministic stock monitor finds items at or below their reorder point.
2. A deterministic forecaster proposes a quantity using synthetic usage and supplier lead time.
3. The CC-06 supplier simulator returns catalog-backed synthetic quotes. If a later integration accepts free-form supplier messages, keep their contents as untrusted data and do not let them alter system instructions or registered identities.
4. The backend accepts an idempotency key, item ID, and quote ID, then creates a draft purchase order from the stored quote. The request cannot supply an amount or destination.
5. The deterministic agent service summarizes forecasts and can call only the registered forecast and draft-PO tools. Tool arguments contain item and quote IDs; the backend resolves all other PO fields.
6. The payment adapter checks the PO and submits only its ID to the vault. The vault enforces the supplier allowlist, pause state, per-order limit, daily cap, balance cap, and idempotency.
7. In-policy same-chain payments may proceed automatically on the test token. Over-policy requests become `Pending`; invalid suppliers, paused payments, invalid amounts, and insufficient funds become `Blocked`. A human wallet controls approval and policy changes.
8. The UI shows the inventory, forecast, quote, PO, payment status, policy, pause state, and audit events. Cross-chain testnet requests are visibly marked as simulated/preview only.

## Architecture and project structure

| Path | Responsibility |
| --- | --- |
| `contracts/Cargo.toml` | Cargo workspace for the vault and test token contract, with a shared lockfile and build output |
| `contracts/carecart-vault/` | Rust NEAR policy vault and contract unit tests |
| `contracts/test-ft/` | Test-only fungible token fixture; never used as a production token |
| `backend/src/domain.ts` | Typed procurement records and branded, registry-issued identifiers |
| `backend/src/db.ts` | Versioned SQLite migrations, exact amount persistence, ID allocation, and typed record reads; default file is ignored `backend/data/carecart.sqlite` |
| `backend/src/seed.ts` | Deterministic synthetic inventory, suppliers, lead times, catalog prices, usage, quotes, PO, payment, and audit records |
| `backend/src/procurement/forecast.ts` | Integer-only stock demand and supplier lead-time forecasts |
| `backend/src/procurement/suppliers.ts` | Persisted simulated quotes from the trusted synthetic supplier catalog |
| `backend/src/procurement/purchase-orders.ts` | Purchase-order creation from persisted quotes with replay protection and audit events |
| `backend/src/agent/tools.ts` | Fixed tool definitions and strict registered-ID argument validation |
| `backend/src/agent/service.ts` | Deterministic forecast summary, PO drafting, and separately tagged supplier message data |
| `backend/src/config.ts` | Server-side provider gate and testnet payment configuration |
| `backend/src/routes/` and `backend/src/server.ts` | Loopback API for inventory, forecasts, quotes, purchase orders, deterministic agent tasks, and payments |
| `web/` | Next.js admin and judge UI with NEAR Connect on testnet |
| `data/` | Deterministic synthetic items, suppliers, and usage history |
| `scripts/` | Local setup, seed, build, and deployment helpers; deployment commands default to testnet |
| `README.md` | Judge-facing product explanation and numbered, reproducible “do X, see Y” steps |

The web app is a responsive synthetic-data procurement dashboard with inventory, backend forecasts, quote generation, idempotent PO drafting, and persisted audit details. An allowlisted same-origin proxy exposes procurement APIs without wallet or payment actions. CC-12 adds an offline PO route simulator and a separately configured dry-only 1Click market preview. Both report settlement not initiated; no deposit/signing path is present. Separate read-only testnet RPC routes verify vault configuration and expose canonical payment state. NEAR Connect requests no sign-in key; human admin controls require explicit transaction review and revalidation before wallet signing. Undeployed or mismatched contracts disable controls. Live browser-wallet signing remains unverified after the approved CLI deployment. The backend exposes inventory and forecast reads, persisted simulated quotes, idempotent draft purchase-order creation, a deterministic agent task endpoint, and an ID-only payment endpoint. The payment adapter persists chain outcomes, audit events, and transaction hashes. The agent tool set contains only forecast lookup and draft-PO creation; strict schemas accept registered IDs and reject extra fields. Supplier messages are tagged separately and are not included in tool arguments or dynamic instructions. Provider configuration stays server-side and environment values cannot enable a provider while CC-00 is pending. The vault stores policy, admin-controlled supplier/committer/requester roles, immutable PO commitments, and auditable payment state. Payment requests resolve the payee/token/amount from a PO ID, check token balance and current policy, reserve capacity before the NEP-141 transfer, and settle through private callbacks. A local-only test token and Sandbox integration test exercise the cross-contract flow. The vault and CCTEST contracts are now deployed and verified on testnet; see [receipts](docs/testnet-deployment-receipts.json).

For the on-chain boundary, an administrator grants the PO committer role to a dedicated backend account. `commit_purchase_order` records the PO ID, allowlisted supplier, configured token, and integer amount exactly once. Future payment calls accept the ID only. Keep the committer key separate from the agent's future function-call key; the latter should be scoped to `request_payment`.

### Workspace decision

- Use a Cargo workspace under `contracts/`: the vault and test-only NEP-141 token are separate Rust crates and share one lockfile and target directory.
- Keep `backend/` and `web/` as separate npm projects with independent lockfiles. They do not currently share TypeScript code, so a root npm workspace would add coordination without a shared package.
- NEAR skills are installed in the project workspace under `.agents/skills/` and pinned by `skills-lock.json`.

## Verified network values, addresses, endpoints, and versions

### NEAR testnet

- Set `NEAR_NETWORK=testnet`.
- Use `https://test.rpc.fastnear.com` for the public testnet RPC. NEAR's API library examples and RPC-provider page list this endpoint.
- NEAR testnet is the intended environment for account, mock-token, and contract development. Testnet state and assets are separate from mainnet.
- Do not use a guessed testnet token address. Use the mock token's address from the deployment output, or read the metadata of a documented test token before configuring it.

### NEAR Intents and 1Click

The official Intents FAQ says there is no testnet deployment and none is planned. For later integration, the official 1Click docs identify these production API endpoints:

| Operation | Endpoint | Use in this spec |
| --- | --- | --- |
| List supported token asset IDs | `GET https://1click.chaindefuser.com/v0/tokens` | Resolve supported assets from the live list; do not guess an `assetId` from a contract address. |
| Request a quote | `POST https://1click.chaindefuser.com/v0/quote` | Preview only with `dry: true`. A dry response does not contain a deposit address and does not initiate a swap. |
| Read execution status | `GET https://1click.chaindefuser.com/v0/status?depositAddress=…` | Only relevant after a real deposit. Include `depositMemo` when the quote response supplies one. |

The JWT from the partner dashboard is optional. The current Intents authentication page accepts it in `X-API-Key` or `Authorization: Bearer` and documents a 0.25% unauthenticated fee for non-`ANY_INPUT` quotes. `HACKATHON.md` Q-006 says 0.2%; that fee figure conflicts, so do not put a fee estimate in the product until the partner schedule is checked. Keep any JWT in `.env`.

### Token address

Circle's current address table lists native USDC on NEAR mainnet at:

`17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1`

This is a mainnet contract address only. The first testnet configuration must use the test token's deployment result instead. The `assetId` used by 1Click must be resolved from `/v0/tokens` and matched to the verified token contract; do not assume a string format.

### SDKs and runtimes

Versions checked on 2026-11-01:

| Component | Version | Basis |
| --- | --- | --- |
| `near-sdk` | `5.29.1` | Paired with `near-contract-standards` `5.29.1` in the official NEAR SDK release series. Prefer this matched pair over the just-released `5.30.0` until a matching standards release is available. |
| `near-contract-standards` | `5.29.1` | Official NEAR SDK release series. |
| `near-sandbox` | `0.3.15` | Current crate API used by NEAR's integration-test documentation. |
| `near-api-js` | `7.3.1` | Current npm release; use for backend account/RPC calls. |
| `@hot-labs/near-connect` | `0.11.4` | Current npm release; use for browser wallet connection. |
| `@defuse-protocol/one-click-sdk-typescript` | `0.1.26` | Current npm release; it meets the official quote-signature verifier requirement of `0.1.24` or later. Keep it optional until the 1Click adapter is added. |
| Node.js | `24.21.0` in this workspace; `22.22.2` minimum | NEAR's API-library docs specify this minimum; `.nvmrc` pins the installed workspace version. |
| near-cli-rs / cargo-near | `0.30.1` / `0.22.0` | Installed locally; CLI version check used an isolated config under `/tmp` so the read-only home config was not changed. |
| Fastify / better-sqlite3 / dotenv / Zod / OpenAI | `5.12.7` / `13.0.3` / `18.0.9` / `4.6.7` / `7.47.0` | Exact backend package versions are recorded in `backend/package-lock.json`. |
| Next.js / React / web TypeScript | `16.4.3` / `19.3.0` / `5.9.3` | Exact web package versions are recorded in `web/package-lock.json`; backend TypeScript is `7.0.2`. |

## Setup state and dependency commands

The workspace has been initialized. Rust `1.93.0` and the `wasm32-unknown-unknown` target are pinned in the root `rust-toolchain.toml`; Node `24.21.0` is pinned in `.nvmrc`. The NEAR CLI and build tool are installed. The `.agents/skills/` directory contains the workspace-local NEAR skills and `skills-lock.json` records their source revisions.

### NEAR agent skills

```sh
npx skills add near/agent-skills
```

### NEAR contract dependencies

The pinned toolchain and target are already installed. For a fresh checkout, restore the locked crate dependencies with:

```sh
cargo fetch --manifest-path contracts/Cargo.toml --locked
```

The contract SDK, standards package, sandbox crate, and CLI build dependency are pinned in the workspace lockfile. Rust and NEAR CLI installation is only needed on a different machine that does not already have those tools. The first Sandbox run downloads the pinned `near-sandbox` node binary (2.13.3) if it is not already cached.

### JavaScript packages

Both Node projects use npm and commit exact lockfiles. Restore them from a fresh checkout with:

```sh
npm ci --prefix backend
npm ci --prefix web
```

The optional 1Click SDK is already present in the backend dependency lock for dry-quote preview work only. NEAR Connect is already installed in the web project.

Both projects pin `ignore-scripts=true`. CC-13 restored both lockfiles in a clean Linux clone without copied node_modules; native SQLite/esbuild packages loaded, 64 backend tests and the production web build passed without enabling install scripts. The first registry install encountered a transient ECONNRESET; retrying the same locked install succeeded. Other platforms have not been verified.

CC-14 triaged the 16 moderate web development-tree entries as one minimatch advisory; backend and web production npm audits report zero. Four Rust vulnerability entries and twelve warnings remain in local unit-test dependencies. Both contracts disable the unmaintained SDK allocator and use the standard Wasm allocator. See [dispositions, verification limits and recheck deadline](docs/security-release.md); no forced upgrades or advisory suppressions were used.

Setup checks completed: locked Rust crates fetched; the workspace passed `cargo check --target wasm32-unknown-unknown --workspace --locked` and `cargo near build non-reproducible-wasm --manifest-path contracts/carecart-vault/Cargo.toml --locked`. The focused CC-01 policy suite now passes, and the wasm workspace check passes after CC-02. Both npm dependency trees resolved and the web starter passed `npm run build -- --webpack`. The default Turbopack build is blocked in this execution environment because it cannot bind its internal local socket. No transaction or deployment was run.

## Configuration and key handling

The application should load local configuration from `.env`; root `.gitignore` excludes `.env` and `.env.*`, while allowing the committed `.env.example` with empty secret values. For the CC-13 judge run, the example was copied to an ignored `.env` in a disposable clone, with empty signing/provider credentials and dry quotes disabled. The separate web file held public configuration only. Never log private keys or tokens.

Initial configuration names:

| Variable | Initial value or rule |
| --- | --- |
| `NEAR_NETWORK` | `testnet` |
| `NEAR_RPC_URL` | `https://test.rpc.fastnear.com` |
| `VAULT_ID` | Human-approved testnet deployment output; unset until deployed |
| `TEST_TOKEN_ID` | Human-approved testnet mock-token deployment output; unset until deployed |
| `PO_COMMITTER_ACCOUNT_ID` | Human-approved dedicated testnet committer account |
| `PO_COMMITTER_PRIVATE_KEY` | Function-call key scoped to the vault and only `commit_purchase_order`; local `.env` only |
| `VAULT_ASSET_CODE` | `CCTEST`, matching the synthetic quote and PO asset |
| `AGENT_ACCOUNT_ID` | Human-provided testnet account; do not invent |
| `AGENT_FC_PRIVATE_KEY` | Testnet function-call key only, limited to vault request methods; local `.env` only |
| `OPENAI_BASE_URL` | `https://cloud-api.near.ai/v1` if NEAR AI Cloud is selected |
| `OPENAI_API_KEY` | Human-created NEAR AI Cloud key, local `.env` only |
| `OPENAI_MODEL` | Select from the documented models endpoint at implementation time; do not hardcode an unverified model |
| `ONECLICK_BASE_URL` | `https://1click.chaindefuser.com`, quote preview only |
| `ONECLICK_JWT` | Optional partner JWT; local `.env` only |

The admin and deployer full-access keys remain in the user's wallet or CLI keychain. They must not be put in the backend environment. Both backend signing keys must be function-call keys scoped to exactly their respective vault method. The admin funds `fund_commit_storage` from a human-controlled wallet; zero-deposit commitments consume that on-chain reserve. The client verifies RPC chain ID and access-key permissions before every signed call and waits for final execution. The approved public deployment used fresh initialization with the reserve field. Old local fixtures still require fresh initialization.

## Code and data conventions

- TypeScript uses strict types, explicit input validation at API boundaries, and named domain types for item, supplier, quote, purchase order, and payment status.
- Rust methods validate authorization and policy inside the contract. Reserve funds before cross-contract transfers and settle state in a private callback.
- Amounts use integer smallest units at external boundaries. The backend uses `bigint` and stores canonical base-10 integer text in SQLite, avoiding JavaScript floating-point rounding and SQLite's signed 64-bit integer limit.
- IDs and supplier destinations come from persisted registries, not model-generated strings.
- Supplier messages are untrusted input. Keep them in a separately tagged data field; do not place them in fixed instructions, tool arguments, policy, or permission configuration.
- Live provider and model configuration remains disabled until the human resolves CC-00. Credentials and the chosen model stay in backend environment configuration.
- Synthetic data is deterministic from a fixed seed. Do not import real patient or hospital records.

## Verification strategy

The auction tests have been replaced with focused policy and payment tests. CC-01 through CC-04 verification passes with synthetic accounts and smallest-unit integer amounts. The workspace test suite includes the Sandbox integration test using the test-only NEP-141 token for deposit/balance, auto-pay, pending approval, blocked supplier/funds, duplicate requests, failed transfers, and callback privacy. `cargo check --target wasm32-unknown-unknown --manifest-path contracts/Cargo.toml --workspace --locked` and `cargo near build non-reproducible-wasm` for both contracts pass. Sandbox tests need permission to bind local loopback RPC sockets in restricted environments.

CC-13/14 completed the fresh local snapshot judge-flow and source/history secret checks. The approved staged CC-15 deployment is verified. Remaining public verification is the separately reviewed browser-wallet and live PO payment path. Known audit findings and signature-check limitations are documented, not suppressed.

For any testnet transaction or deployment, stop for explicit human confirmation before signing. Never run a mainnet transaction or deploy as part of test verification without explicit confirmation.

## Hackathon rules and confirmation boundary

The hackathon runs from **2026-11-01 00:00 UTC** through **2026-11-14 23:59 UTC**. Judging starts **2026-11-16 00:00 UTC**; results are due by **2026-11-18 23:59 UTC**. The repository must be public by the deadline, and the final entry requires a public demo post on X and the submission form/API. The README must tell an AI judge what the product is, the problem it solves, and numbered “do X, see Y” steps. Keep it factual and update the steps as the app becomes runnable.

The following rules are reproduced from `HACKATHON.md`'s “Never without the human's explicit confirmation” section and govern this project:

- Send the submission. Print the full JSON payload first and wait for a yes. A second submission of the same repository is rejected, so there is one attempt per project.
- Post anything on X or another network on their behalf.
- Make the repository public, push, or force-push.
- Sign transactions, spend tokens or deploy to mainnet.
- Commit secrets. Keys belong in environment variables, never in the repository.

Final submission endpoint: `POST https://nearhackathon.com/api/applications`. The request uses exactly `requestId`, `projectName`, `leadName`, `email`, `size`, `tracks`, `nearAddress`, `projectUrl`, `demoUrl`, `idea`, and `consent`. The `requestId` is generated once and reused on retries. The human supplies every field, including the mainnet payout account and consent, reviews the complete JSON payload, and explicitly confirms before it is sent. Do not create or send a payload now.

## Success criteria

- A fresh clone can follow the final README to start the testnet prototype and see each result described by the steps.
- A low-stock scenario produces a persisted forecast, supplier quotes, and a purchase order whose price and payee are derived from stored data.
- The test vault blocks an unknown supplier and enforces pause, balance, per-order, and daily limits even if backend checks are bypassed.
- The agent can request only the contract methods granted to its function-call key; human policy and approval actions require a human-controlled wallet.
- Testnet UI and logs identify the network and test token. No mainnet address or real-value token is used as a testnet asset.
- Cross-chain testnet screens clearly say preview/simulation. No copy implies a dry quote is a completed payment.
- No keys, API tokens, personal submission fields, or real supplier data are committed.

## Open questions for review

This historical question list is closed. Testnet accounts, CCTEST deployment, vault roles, restricted backend configuration and CLI resume have recorded evidence. A blocked PO is not a successful public payment. MN-00 selects NEAR AI Cloud, manual Run tick, MIT and the three planned tracks. Live model/credentials/testing, actual license-file publication inputs, mainnet identities/custody/budgets and all exact actions remain tracked only in [mainnet-todo.md](mainnet-todo.md) MN-08–MN-13/G0B. No pending question here creates a second active backlog.

## Sources checked

- [NEAR HACKATHON instructions](https://nearhackathon.com/HACKATHON.md) — tracks, schedule, human decisions, confirmation rules, submission API, and Intents testnet FAQ.
- [NEAR docs index](https://docs.near.org/llms.txt) and [NEAR Intents docs index](https://docs.near-intents.org/llms.txt) — used to select the specific pages below.
- [NEAR networks](https://docs.near.org/protocol/network/networks), [RPC providers](https://docs.near.org/api/rpc/providers), [API libraries](https://docs.near.org/tools/near-api), [Rust SDK](https://docs.near.org/tools/sdk), [integration testing](https://docs.near.org/smart-contracts/testing/integration-test), [access keys](https://docs.near.org/protocol/accounts-contracts/access-keys), and [one-yocto security](https://docs.near.org/smart-contracts/security/one_yocto).
- NEAR Intents [FAQs](https://docs.near-intents.org/resources/faqs), [1Click SDK](https://docs.near-intents.org/integration/distribution-channels/1click-api/sdk), [quote request](https://docs.near-intents.org/api-reference/oneclick/request-a-swap-quote), [status](https://docs.near-intents.org/api-reference/oneclick/check-swap-execution-status), [authentication](https://docs.near-intents.org/integration/distribution-channels/1click-api/authentication), and [quote signature verification](https://docs.near-intents.org/integration/distribution-channels/1click-api/verify-quote-signature).
- [Circle USDC contract addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses), NEAR SDK [release series](https://github.com/near/near-sdk-rs/releases), and package references for [`near-api-js`](https://www.npmjs.com/package/near-api-js), [`near-connect`](https://www.npmjs.com/package/@hot-labs/near-connect), [`one-click-sdk-typescript`](https://www.npmjs.com/package/@defuse-protocol/one-click-sdk-typescript), and [`near-sandbox`](https://docs.rs/near-sandbox).
- [NEAR AI Cloud OpenAI compatibility](https://docs.near.ai/cloud/guides/openai-compatibility). Model attestations are excluded from scope; the [attestation requirements](https://docs.near.ai/cloud/verification/cloud-api/model-attestations) call for verifying the report before making an attestation claim.

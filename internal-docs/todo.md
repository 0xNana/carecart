# CareCart testnet TODO — COMPLETED / ARCHIVED

**Document status: COMPLETED / CLOSED — historical record, 2026-11-02 (UTC).**

**Current primary authority:** [mainnet-todo.md](mainnet-todo.md), aligned with the [approved MN-00 record](CareCart-MN-00-APPROVED-2026-11-02.md). Use that document for ongoing requirements, work order, decisions and release gates. This file is retained for history/evidence; closing it does not certify unimplemented functionality, unanswered operational inputs or unperformed tests. Historical unchecked items are carried forward in the primary document rather than silently marked verified.

## Closeout and transfer — COMPLETE

- [x] Prototype/design evidence preserved; deployed testnet artifacts, blocked request, wallet recovery and approved CLI resume remain accurately distinguished.
- [x] Approved MN-00 decisions incorporated in the primary `mainnet-todo.md`; G0A complete.
- [x] DESIGN, implementation and this TODO closed as historical records.
- [x] Remaining provider/model, public successful-payment/wallet verification, security rechecks, mainnet engineering, operational identities/budgets and publication/submission work transferred to the primary checklist.

Unchecked criteria below do not remain live work in this document and are not certified by closure. See the primary document's **Current implementation baseline and carried-forward work** table for their destinations. G0B and G1–G5 remain open. No account/key change, mainnet operation or publication is authorized by this closeout.

## Archived CC-series tasks and evidence

**Objective:** Deliver the testnet-first CareCart procurement prototype described in [implementation.md](implementation.md) for the NEAR Hackathon `realworld` track.

This is the closed CC-series/testnet work record. The prior task order and checkboxes are retained below as historical evidence. MN-00 reconciliation is complete; ongoing tasks, gaps, decisions and execution gates are consolidated in [mainnet-todo.md](mainnet-todo.md). Do not use this file or `tasks/plan.md` as a competing live plan.

## Audit snapshot (2026-11-01)

The initial source audit identified CC-09 gaps in network verification, signing-key permissions, storage funding, and backend Sandbox coverage. Those gaps are now resolved and verified. CC-09 verification used local Sandbox only. Later human-created testnet accounts and authorized key cleanup are recorded in `docs/testnet-accounts.md`; both contracts are now deployed by the human-approved CC-15 setup. Public PO payment remains unverified.

- **Resolved — RPC network:** the client checks the RPC-reported chain ID before every signed call. Mainnet responses are rejected even if configuration says testnet.
- **Resolved — committer key:** the human-controlled admin funds `fund_commit_storage`; zero-deposit backend commitments consume that reserve. Both backend signers must be function-call keys restricted on chain to their single vault method. Full-access keys are rejected by the client.
- **Resolved — integration:** the contract Sandbox lifecycle invokes the real TypeScript client, adapter, and payment HTTP route, including inventory → forecast → quotes → PO → payment. It verifies paid, pending approval, blocked, failed, transaction hashes, persisted audit events, and replay behavior.
- **Resolved — documentation:** README, implementation status, and the procurement checkpoint now reflect payment integration and forecasts computed from persisted usage/catalog data.
- **Remaining source document:** `HACKATHON.md` is absent from this checkout. The repository confirmation rules below remain explicit; check the organizer's current rules before CC-16.

## Completed setup

- [x] Install and lock the NEAR agent skills in `.agents/skills/`.
- [x] Pin the Rust, Node, npm, Cargo, and JavaScript dependency versions; fetch the locked Rust crates.
- [x] Set up the Cargo workspace, independent backend/web npm projects, `.env.example`, and secret ignores.
- [x] Confirm the contract wasm build and the web starter build with Next Webpack mode.
- [x] Remove generated automatic deployment workflows and fold the contract scaffold into the root Git repository.

## Human decisions

### CC-00: Confirm deployment and release inputs

**Description:** Resolve the human-owned choices in `implementation.md` before their dependent integrations. Local development can proceed with synthetic data and mocks.

**Acceptance criteria:**
- [x] Human supplied the testnet admin/deployer accounts and selected the in-repo CCTEST token; approved deployment/metadata evidence is recorded.
- [ ] Historical combined criterion transferred to MN-08: NEAR AI Cloud is now selected by MN-00; actual live model selection/tool compatibility remains unverified.
- [x] Human selected MIT in the approved MN-00 record. Adding the license file and publication review remain MN-09/13 work.

**Verification:** Record only approved, non-secret decisions in project docs; keep account keys and API credentials in local `.env` or the wallet/CLI keychain.

**Dependencies:** None; blocks only the related provider, release, and deployment work.

**Files likely touched:** `implementation.md`, `.env.example`, `LICENSE`.

**Estimated scope:** Small.

### CC-00A: Define the on-chain purchase-order commitment boundary

**Description:** Resolve how the vault can receive only a PO ID yet enforce the canonical supplier, token, and amount associated with that PO.

**Acceptance criteria:**
- [x] Define `commit_purchase_order`, which records a PO ID with supplier, token, and smallest-unit amount in contract state.
- [x] Grant commitment permission through the admin-controlled committer role; reject duplicate IDs so the agent cannot rebind payment details.
- [x] Define the call boundary: a dedicated backend committer records the PO; the future agent key is limited to request-by-ID.

**Verification:** Review the proposed call sequence and contract method inputs; do not sign or send a transaction.

**Dependencies:** None; must be resolved before CC-01 and CC-03.

**Files likely touched:** `implementation.md`, `tasks/plan.md`.

**Estimated scope:** Small.

## Phase 1: NEAR policy vault

### CC-01: Specify vault policy invariants in tests

**Description:** Replace the auction example's test expectations with tests for the CareCart vault's access control and policy decisions.

**Acceptance criteria:**
- [x] Cover admin roles, supplier allowlist, pause state, per-order/daily/balance caps, and pending approvals.
- [x] Cover duplicate request IDs and rejected or insufficient-funds requests.
- [x] Cover immutable PO ID commitments, authorized committers, and rejection of missing or rebound PO IDs; use synthetic accounts and smallest-unit integer amounts.

**Verification:** `cargo test --manifest-path contracts/Cargo.toml -p carecart-vault --test policy --locked` first failed against the auction scaffold because the vault API was absent; after implementation, all 19 focused policy cases passed.

**Dependencies:** CC-00A.

**Files likely touched:** `contracts/carecart-vault/src/lib.rs`, `contracts/carecart-vault/tests/`.

**Estimated scope:** Medium.

### CC-02: Implement vault configuration and policy views

**Description:** Replace the generated auction state with initialized vault state, admin-controlled policy, supplier allowlist, pause controls, and read-only views.

**Acceptance criteria:**
- [x] Only the configured admin can change policy, supplier allowlist, and pause state.
- [x] Views expose the active policy and payment state without private keys or secrets.
- [x] An authorized role can commit immutable PO ID/supplier/token/amount records; invalid configuration and conflicting rebinds are rejected inside the contract.

**Verification:** CC-01's 19 focused Rust tests pass; `cargo check --target wasm32-unknown-unknown --manifest-path contracts/Cargo.toml --workspace --locked` passes.

**Dependencies:** CC-01.

**Files likely touched:** `contracts/carecart-vault/src/lib.rs`, `contracts/carecart-vault/tests/`.

**Estimated scope:** Medium.

### CC-03: Implement guarded payment requests and settlement callbacks

**Description:** Add idempotent payment requests that resolve the payee and amount from the committed on-chain PO record and reserve policy capacity before the NEP-141 transfer.

**Acceptance criteria:**
- [x] An ID-only request resolves a committed PO and the contract independently enforces supplier, token, pause, caps, balance, and idempotency; missing or rebound POs are rejected.
- [x] Auto-pay, pending approval, and blocked outcomes are recorded with auditable status.
- [x] Transfer callbacks are private, handle success/failure, and never unwrap promise results.

**Verification:** `cargo test --manifest-path contracts/Cargo.toml -p carecart-vault --test payment --locked` passes focused tests for success, blocked/insufficient-funds and admin rejection, repeated IDs, pending approval, and callback success/failure.

**Dependencies:** CC-02.

**Files likely touched:** `contracts/carecart-vault/src/lib.rs`, `contracts/carecart-vault/tests/`.

**Estimated scope:** Medium.

### CC-04: Add the test token and sandbox integration coverage

**Description:** Provide a test-only NEP-141 token fixture and exercise the vault's real cross-contract payment path in NEAR Sandbox.

**Acceptance criteria:**
- [x] The token is clearly test-only and is never configured with a mainnet asset address.
- [x] Sandbox scenarios cover deposit/balance, paid, pending, blocked, and failed transfer outcomes.
- [x] The contract workspace builds and tests using its lockfile.

**Verification:** `cargo test --manifest-path contracts/Cargo.toml --workspace --locked`, `cargo check --target wasm32-unknown-unknown --manifest-path contracts/Cargo.toml --workspace --locked`, `cargo near build non-reproducible-wasm --manifest-path contracts/carecart-vault/Cargo.toml --locked`, and the same `cargo near build` command for `contracts/test-ft/Cargo.toml` all pass. The full test suite includes the local Sandbox lifecycle test.

**Dependencies:** CC-03.

**Files likely touched:** `contracts/Cargo.toml`, `contracts/Cargo.lock`, `contracts/test-ft/`, `contracts/carecart-vault/tests/`.

**Estimated scope:** Medium.

### Checkpoint: Vault

- [x] Focused contract tests cover policy, payment, and callback invariants.
- [x] Test-token integration passes in Sandbox.
- [x] Wasm builds succeed using local verification commands without public-network contract deployment or signing.

## Phase 2: Backend procurement flow

### CC-05: Define backend domain, storage, and synthetic seed data

**Description:** Add typed inventory, supplier, usage, quote, purchase-order, payment, and audit records with deterministic synthetic seed data.

**Acceptance criteria:**
- [x] Seed data is deterministic and contains no patient, hospital, or real supplier records.
- [x] Amounts are represented as bigint smallest units and persisted as canonical decimal integer text; IDs are allocated from a backend-owned registry.
- [x] Database schema and migrations initialize an empty local SQLite database.

**Verification:** `npm test --prefix backend` passes 7 focused cases for fresh-database migration, repeat migration, registry ID allocation, deterministic/idempotent synthetic seeding, and exact large integer amount round-trips. `npm run typecheck --prefix backend` passes.

**Dependencies:** None; can proceed alongside Phase 1.

**Files likely touched:** `backend/src/domain.ts`, `backend/src/db.ts`, `backend/src/seed.ts`, backend tests, package scripts, and TypeScript config.

**Estimated scope:** Medium.

### CC-06: Deliver inventory, forecast, and supplier quote endpoints

**Description:** Build the first backend vertical slice from low stock through a deterministic forecast and simulated supplier quotes.

**Acceptance criteria:**
- [x] Inventory reads show which items are at/below reorder points.
- [x] Forecast quantities use integer arithmetic over the fixed synthetic usage window and registered supplier lead times.
- [x] Quotes persist from trusted catalog identities/prices; the strict quote request rejects caller-supplied supplier text, IDs, and prices without changing records.

**Verification:** `npm test --prefix backend` and `npm run typecheck --prefix backend` pass. Endpoint tests use the fixed synthetic seed and clock; tests cover inventory flags, forecast quantities, quote persistence, rejected injected fields, and no-reorder requests.

**Dependencies:** CC-05.

**Files touched:** `backend/src/server.ts`, `backend/src/routes/inventory.ts`, `backend/src/procurement/forecast.ts`, `backend/src/procurement/suppliers.ts`, `backend/src/domain.ts`, `backend/src/db.ts`, `backend/src/seed.ts`, and backend tests/docs.

**Estimated scope:** Medium.

### CC-07: Create purchase orders from persisted quotes

**Description:** Add purchase-order creation that accepts trusted item/quote IDs and derives quantity, amount, and supplier destination from stored records.

**Acceptance criteria:**
- [x] Requests accept only a request ID, registered item ID, and quote ID; destination, token, route, amount, and quantity fields are rejected.
- [x] Duplicate request IDs replay the same purchase order, and creation writes one audit event.
- [x] Unknown, mismatched, expired, and already-used quote IDs return structured errors.

**Verification:** `npm test --prefix backend` passes 20 focused cases; purchase-order endpoint cases verify quote-derived quantity/amount/supplier, request replay, audit-once behavior, strict input validation, and structured invalid, mismatched, expired, and used quote errors. `npm run typecheck --prefix backend` passes.

**Dependencies:** CC-06.

**Files touched:** `backend/src/routes/purchase-orders.ts`, `backend/src/procurement/purchase-orders.ts`, `backend/src/db.ts`, `backend/src/domain.ts`, `backend/src/server.ts`, and backend tests/docs.

**Estimated scope:** Medium.

### CC-08: Add constrained agent tools

**Description:** Let an agent summarize forecasts and draft purchase orders using narrow, schema-validated tools backed by the records above.

**Acceptance criteria:**
- [x] Tool definitions accept only registered item/quote IDs, validate them against the registry, and expose no payee, destination, token, route, or amount argument.
- [x] Supplier message context is size-limited, checked against the registered supplier identity, and tagged as untrusted data outside instructions and tool arguments.
- [x] Provider selection remains disabled while CC-00 is pending; environment values cannot enable a live provider, and approved credentials/model settings are read only by backend configuration.

**Verification:** `npm test --prefix backend` passes 31 cases; tests cover strict tool schemas, adversarial supplier content, deterministic forecast summaries and PO drafting without a provider, and the CC-00 configuration gate. `npm run typecheck --prefix backend` passes.

**Dependencies:** CC-07; CC-00 for live LLM configuration.

**Files touched:** `backend/src/agent/tools.ts`, `backend/src/agent/service.ts`, `backend/src/config.ts`, `backend/src/routes/agent.ts`, server registration, and backend tests/docs.

**Estimated scope:** Medium.

### CC-09: Connect the backend payment adapter to the vault

**Description:** Commit the PO through the authorized on-chain method, then submit only its ID to the payment request and store the resulting payment/audit status.

**Acceptance criteria:**
- [x] The contract resolves the payee from its canonical PO record and remains authoritative for every limit.
- [x] Payment records distinguish `Paid`, `Pending`, and `Blocked`, including chain failure.
- [x] No signer key or secret is placed in frontend configuration or logs.
- [x] The admin funds an on-chain PO storage reserve; the backend committer uses a zero-deposit function-call key limited to `commit_purchase_order`. Full-access keys stay in the human wallet/CLI keychain.
- [x] The backend verifies the RPC reports the NEAR testnet chain ID before it makes any signed call.

**Verification:** `npm test --prefix backend` passes all 52 cases; `npm run typecheck --prefix backend` passes. Backend tests cover status mapping, audit-once replay, canonical commitment conflicts, lost-response reconciliation, unconfirmed RPC failures, strict request validation, configuration, key permissions, network checks, and v3 → v4 database migration. An isolated mutation test confirms the signing tests reject an inverted network guard. `cargo test --manifest-path contracts/Cargo.toml --workspace --locked` passes 21 policy tests, 8 payment tests, and the expanded local Sandbox lifecycle, which invokes the actual backend HTTP flow using restricted function-call keys. The workspace Wasm check and vault `cargo near build non-reproducible-wasm --locked` also pass. No testnet/mainnet signing occurred.

**Dependencies:** CC-03, CC-04, CC-07.

**Files touched:** backend NEAR client, payment adapter/route and tests, server/configuration, database migration/tests, contract storage reserve and tests, `.env.example`, and project documentation.

**Estimated scope:** Medium.

### Checkpoint: Procurement flow

- [x] Low stock yields a deterministic forecast from stored usage/catalog data, persisted quotes, and a PO whose amount and supplier are derived from stored data.
- [x] Agent input cannot alter the payee or bypass vault policy.
- [x] Local end-to-end backend flow works with synthetic data and the mock token.

## Phase 3: Judge-facing web app

### CC-10: Replace the Next.js starter with the procurement dashboard

**Description:** Show inventory, low-stock forecasts, supplier quotes, drafted purchase orders, and audit details using backend data.

**Acceptance criteria:**
- [x] The default screen explains the product state and uses synthetic data only.
- [x] Loading, empty, and error states are accessible and understandable.
- [x] UI actions call backend APIs; no policy decision is made only in the browser.

**Verification:** Production Webpack build and ESLint pass. All 54 backend tests and backend typecheck pass. Browser inspection verified loading, backend-unavailable/retry recovery, empty inventory/orders/audit, item selection by keyboard, empty quotes, fresh quote generation, quote-derived PO drafting, and audit disclosure. Layouts checked at 320, 390, 768, 1024, and 1440 pixels with no page overflow. The final browser console is clean. Local HTTP probes confirm payment proxy access returns 404, foreign-origin mutations return 403, and caller-supplied amount fields return 400.

**Dependencies:** CC-06, CC-07.

**Files touched:** web page/layout/styles, procurement components and data client, allowlisted Next.js API proxy, backend dashboard snapshot route/tests, server registration, and project docs.

**Estimated scope:** Medium.

### CC-11: Add testnet wallet, policy controls, and payment status

**Account setup (2026-11-02):** All ten `carecart.testnet` accounts are verified on testnet; the admin is `admin.carecart.testnet`, the vault deployment account is `vault.carecart.testnet`, and the deployed CCTEST token account is `token.carecart.testnet`. The admin now has one Ed25519 full-access key plus its original ML-DSA-65 recovery key; three duplicate Ed25519 keys were removed in a human-authorized transaction signed by the retained key. Separate Ed25519 backend keys are verified: committer permits only `commit_purchase_order`, agent only `request_payment`, both targeting the vault with 0.25 test NEAR gas allowances. The installed backend SDK passes a local ML-DSA-65 signing self-test. Both contracts and all twelve approved CLI deployment/setup transactions are verified on testnet. Browser-wallet signing and live PO payments remain unverified; the two restricted backend keys are configured only in ignored owner-only `.env.testnet`; no public PO payment has run. See [account details](docs/testnet-accounts.md).

**Description:** Connect the human wallet to testnet for policy/approval actions and display vault status, pause state, and network clearly.

**Acceptance criteria:**
- [x] The UI is fixed to testnet and clearly labels the test token/network.
- [x] Human approval, policy changes, and pause controls require wallet actions; the agent cannot invoke them.
- [x] No signing action occurs without an explicit human-initiated action and review of the transaction.

**Verification:** Six wallet/RPC safety tests, 55 backend tests, backend typecheck, 30 Rust policy/payment tests, web lint, and the production Webpack build pass. The Rust regression test confirms even the authorized payment agent cannot approve/reject payments, edit policy, or pause the vault. Browser checks cover the real testnet wallet picker and undeployed state; an isolated temporary fake-wallet app covers review/cancel, keyboard focus, invalid policy input, pause refresh, rejection, and canonical payment review without public signing. CC-15 CLI deployment/setup is now verified. Browser-wallet signing and live PO payment paths remain separately authorized follow-up verification.

**Status:** Implementation complete; CC-15 deployment/setup is verified, but live browser-wallet signing and PO payment smoke verification remain pending. No browser-wallet transaction was signed.

**Dependencies:** CC-02, CC-09, CC-10, CC-00 for account configuration.

**Files touched:** NEAR provider, wallet/policy controls, transaction review, payment status, read-only vault routes/client, dashboard payment hashes, wallet/RPC and contract authorization tests, environment example, and docs.

**Estimated scope:** Medium.

**Wallet recovery (2026-11-02):** Reproduced/fixed the native review dialog blocking the wallet overlay. Preflight deadlines prevent late signing; unresolved signature responses remain tracked without retry and read-only refresh stays available. Nine wallet/RPC tests, lint/build and an offline browser regression pass. Real-wallet signing is still unverified; [CLI fallback and evidence](docs/wallet-recovery.md).

**Human admin policy and resume (2026-11-02):** Supplied transaction `27t4btiaCUHzKhvm1taXVCSbmBUJtoBp4i5JFp1qmbYG` has FINAL success for `set_policy`, which leaves pause unchanged. The human separately requested resume; `DfKGXzjhZ3h8eMSAKcf5EcJwTbX1ac1gqWjeXBPUJq5f` has FINAL success for `set_paused(false)`. Canonical RPC and both app APIs now show Active / 10000 CCTEST. Existing `po-000002` remains Blocked/Paused. [Evidence](docs/testnet-resume-verification.json).

### CC-12: Add cross-chain preview-only state

**Description:** Clearly distinguish simulated cross-chain behavior from a real settlement; optionally show a dry 1Click quote when configured.

**Acceptance criteria:**
- [x] Testnet uses a mock adapter because NEAR Intents has no testnet deployment.
- [x] Any 1Click preview uses `dry: true`, resolves supported assets from the live token list, and never displays a deposit address as a completed payment.
- [x] UI and logs say preview/simulation; no cross-chain deposit or settlement is initiated.

**Verification:** Backend tests cover offline simulation, unchanged persisted state, strict request schemas, supported-token resolution and documented dry quote response fixtures, including wet quotes/deposit fields and mismatched recipient/amount rejection. Backend typecheck, web tests/lint and the production build pass. Browser checks verify Base/Solana simulations, preserved registered payee/amount, readable status, and 320/768/1024/1440 layouts. HTTP probes verify 400/403/404/503 boundary responses. The optional live dry quote remains disabled/unverified because a reviewed mainnet route and addresses have not been supplied; no transaction or settlement is initiated. See [preview details](docs/cross-chain-preview.md).

**Future intent:** The human plans mainnet cross-chain payments after this preview. Mainnet settlement and deployment remain separate work; CC-12 does not enable them.

**Dependencies:** CC-09, CC-10; 1Click configuration is optional.

**Files touched:** preview adapter/tests, preview routes/tests, server setup, agent supplier-message regression test, cross-chain UI, proxy allowlist, styles, environment example, and docs.

**Estimated scope:** Medium.

### Checkpoint: Judge flow

- [x] A judge can follow low stock → forecast → quotes → PO → policy result.
- [x] A payee-manipulation message cannot change the registered supplier.
- [x] Cross-chain UI is visibly a preview/simulation and never claims settlement.

CC-13 verifies the local judge path through the numbered README, HTTP script and actual Sandbox policy results. The full live browser path to a public-network policy result still awaits the live human-wallet and prepared PO payment test; the restricted-key backend and supplier-mapped isolated database are ready; CC-15 deployment is complete and the read-only vault API reports ready/paused.

## Phase 4: Release readiness

### CC-13: Verify a fresh-clone judge path and update documentation

**Description:** Replace scaffold-only README instructions with reproducible steps that tell an AI judge exactly what to run and what to see.

**Acceptance criteria:**
- [x] A fresh clone can follow the README using only synthetic data and approved testnet configuration.
- [x] Each numbered “do X, see Y” step matches the current app and identifies preview-only features.
- [x] README and implementation status accurately describe the verified CC-09 payment adapter.
- [x] No marketing claims, TEE claims, or mainnet instructions are presented as implemented functionality.

**Verification:** Followed the README from a clean local Git clone of the current source snapshot with independent npm installs, fresh Cargo build output, example-only configuration and a new synthetic database. Verified browser quote/draft/audit/persistence/preview states, two successful HTTP judge-script runs, 64 backend tests/typecheck, six wallet/RPC tests, web lint/build, and the full local Rust suite (21 policy, 9 payment, 1 Sandbox). Captured API, policy and UI evidence in [judge verification](docs/judge-verification.md). Fixed SQLite journal ignores and a stale preview after selected-PO changes. No public signing or deployment occurred. The source changes remain uncommitted in the shared workspace; remote-clone reproduction requires a release revision containing them.

**Dependencies:** CC-04, CC-09, CC-10, CC-11, CC-12.

**Files touched:** root/web README, implementation and plan/TODO status, HTTP judge script, verification report/API/policy/screenshots, SQLite companion-file ignores, and the selected-PO preview display guard.

**Estimated scope:** Small.

### CC-14: Run security, dependency, and release checks

**Description:** Resolve the pending web audit report and verify secrets, lockfiles, access boundaries, and testnet-only defaults before release.

**Acceptance criteria:**
- [x] Web `npm audit` advisories are triaged and documented; no forced upgrade is used without review.
- [x] `.env` remains ignored, secret values are absent from tracked files, and full-access keys never enter application env.
- [x] A database with existing procurement records migrates from schema version 3 to version 4 without data loss; covered by the backend migration test.
- [x] Contract and app checks pass from a fresh clone; all sample auction code and automatic deployment workflows are gone.

**Verification (2026-11-02):** Fresh snapshot clone passed 64 backend tests, six wallet/RPC and four proxy-body tests, web lint/build, 21 policy + nine payment + one Sandbox test, and locked Wasm checks/builds. Secret/source/history scan and HTTP boundary checks pass. Dependency findings are triaged with explicit deferrals; native audits are not clean. The standard Wasm allocator replaces unmaintained `wee_alloc`. See [security evidence](docs/security-release.md).

**Dependencies:** CC-13.

**Files likely touched:** `backend/package-lock.json`, `web/package-lock.json`, `.gitignore`, `implementation.md`.

**Estimated scope:** Medium.

### CC-15: Deploy to testnet only after explicit confirmation

**Status (2026-11-02):** Human-approved deployment/setup is complete: both contracts and all twelve reviewed transactions have FINAL success with zero failed receipts. Live token metadata, exact hashes, registered storage, roles, balances and paused state are verified. Browser-wallet signing and live app PO payments remain separate follow-up work; no full live app smoke claim is made.

**Description:** Prepare a reviewable deployment plan using the human-provided accounts and test-only token artifact; pause before signing or broadcasting. Deploy/verify the mock token before approving any vault setup that depends on its metadata.

**Acceptance criteria:**
- [x] Network, supplied accounts, exact artifact hashes, proposed token metadata, gas/deposits and intended state changes are shown in the [review package](docs/testnet-deployment.md) and [captured proposal](docs/testnet-deployment-plan.json). Live metadata was verified after token deployment and before vault setup.
- [x] Read-only preflight, staged post-deployment verifiers and seven offline safety tests are implemented; the public preflight passes without signing.
- [x] Continued only after explicit human approval of the exact reviewed testnet deployment/setup. All twelve final receipts and staged verification are in [deployment evidence](docs/testnet-deployment.md).
- [x] No mainnet deployment, real-value token, or key in the repository is used.
- [x] Configure/verify only the two restricted backend keys in ignored owner-only `.env.testnet`; prepare an isolated supplier-mapped database and fresh PO. [Readiness and commands](docs/testnet-live-setup.md). No new public transaction was sent.
- [ ] After separately approved app actions, verify the live human-wallet resume and exact prepared PO payment, then canonical views/metadata/balances and the README flow.

**Verification:** `bash scripts/build-testnet.sh`; `bash scripts/deploy-testnet.sh --artifacts artifacts/testnet`; both `scripts/*testnet*.test.mjs` test files. The helper prints commands only and cannot sign or broadcast. Approved execution is recorded in `docs/testnet-deployment-receipts.json`; `--verify-token` and `--verify` both passed against live testnet. The app vault API on ports 3002/3102 reports ready/paused, 10000 CCTEST and zero spent/reserved. No further transactions were performed.

**Dependencies:** CC-00 account configuration, CC-04, CC-14. Provider selection remains unresolved and is unnecessary for this deterministic deployment proposal.

**Files:** `scripts/build-testnet.sh`, `scripts/deploy-testnet.sh`, `scripts/deploy-testnet.mjs`, `scripts/testnet-plan.mjs`, `scripts/testnet-source.mjs`, deployment docs/evidence. Artifacts are ignored.

### CC-16: Prepare engineering handoff and submission for human review

**Status (2026-11-02):** Engineering handoff and DESIGN conflict review prepared. MN-00 reconciliation is approved. Remaining submission inputs/actions are transferred to MN-13; this legacy handoff task is closed. No submission, push or publication has occurred; approved testnet transactions are recorded separately.

**Description:** Hand over the verified testnet prototype and explicit gaps against DESIGN before starting a separately scoped mainnet implementation. Preserve the organizer submission review as a later gate; do not send, post, publish or push anything.

**Acceptance criteria:**
- [x] [Handoff](docs/handoff.md) identifies verified checks, uncommitted state, deployment status, credentials boundary, remaining human inputs and next steps.
- [x] [mainnet-todo.md](mainnet-todo.md) maps DESIGN requirements to the actual prototype, records the accepted R-01–R-13 resolutions and orders independently verifiable mainnet tasks. No mainnet implementation is represented as complete.
- [x] Human approved MN-00 reconciliation in `CareCart-MN-00-APPROVED-2026-11-02.md`; accepted decisions are incorporated in the primary `mainnet-todo.md`. Testnet defaults remain enforced.
- [x] CC-15 public contract/setup receipts and live read-only state are recorded; browser-wallet signing and live PO payments are explicitly pending in the handoff.
- [ ] Verify current organizer fields/track IDs/consent. Every submission field is supplied by the human; print the exact complete JSON payload and wait for an explicit yes before the one allowed submission.
- [ ] The human publishes any X/network post and explicitly confirms any repository-public or push action.
- [ ] No secrets are committed; consent uses the exact current organizer wording. License, release revision, demo/video/post/repository links and feature claims are reviewed.

**Verification:** Review R-01–R-13, release evidence and the full worktree before engineering handoff. Later review the exact human-supplied submission payload, fields, current rules, consent and repository state before any external action. No valid-looking placeholder submission is generated.

**Dependencies:** CC-13, CC-14; live testnet evidence depends on CC-15. Mainnet implementation depends on MN-00 acceptance, not merely completion of this document.

**Files:** `docs/handoff.md`, `mainnet-todo.md`, `DESIGN.md` status note, `README.md`, `implementation.md`; submission draft only after required fields are supplied.

## Human confirmation rules

Follow these repository confirmation rules. `HACKATHON.md` is not present in this checkout, so check the organizer's current rules before CC-16:

- Send the submission. Print the full JSON payload first and wait for a yes. A second submission of the same repository is rejected, so there is one attempt per project.
- Post anything on X or another network on their behalf.
- Make the repository public, push, or force-push.
- Sign transactions, spend tokens or deploy to mainnet.
- Commit secrets. Keys belong in environment variables, never in the repository.

The project spec also requires explicit human confirmation before signing or broadcasting any testnet transaction. Mainnet planning is recorded separately in `mainnet-todo.md`; mainnet implementation/transactions require their own reviewed scope and explicit transaction approvals.

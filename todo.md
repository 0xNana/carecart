# CareCart TODO

**Objective:** Deliver the testnet-first CareCart procurement prototype described in [implementation.md](implementation.md) for the NEAR Hackathon `realworld` track.

Work in dependency order. Keep each task small, verify it before moving on, and stop at each checkpoint if a security invariant fails. Detailed architecture, risks, and open decisions are in [tasks/plan.md](tasks/plan.md).

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
- [ ] Human supplies the testnet admin/deployer account and chooses the test token source before testnet deployment.
- [ ] Human chooses whether to use NEAR AI Cloud and supplies a model selected from its live model list before LLM integration.
- [ ] Human selects a license before public release.

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
- [x] Wasm builds succeed; no testnet/mainnet deployment or signing has occurred.

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
- [ ] Requests cannot supply an arbitrary destination account, token, route, or total.
- [ ] Duplicate requests are idempotent and produce an auditable purchase order.
- [ ] Invalid or stale quote IDs are rejected with a structured error.

**Verification:** Test amount derivation, supplier selection, invalid IDs, and duplicate requests.

**Dependencies:** CC-06.

**Files likely touched:** `backend/src/routes/purchase-orders.ts`, `backend/src/procurement/purchase-orders.ts`, `backend/src/db.ts`.

**Estimated scope:** Medium.

### CC-08: Add constrained agent tools

**Description:** Let an agent summarize forecasts and draft purchase orders using narrow, schema-validated tools backed by the records above.

**Acceptance criteria:**
- [ ] Tool arguments contain registered IDs only; the model cannot select a payee or payment amount.
- [ ] Supplier messages are treated as untrusted data and cannot change policy or tool permissions.
- [ ] Provider/model configuration is gated on CC-00 and stays server-side.

**Verification:** Test strict argument validation, adversarial supplier text, and no-provider deterministic behavior.

**Dependencies:** CC-07; CC-00 for live LLM configuration.

**Files likely touched:** `backend/src/agent/tools.ts`, `backend/src/agent/service.ts`, `backend/src/config.ts`.

**Estimated scope:** Medium.

### CC-09: Connect the backend payment adapter to the vault

**Description:** Commit the PO through the authorized on-chain method, then submit only its ID to the payment request and store the resulting payment/audit status.

**Acceptance criteria:**
- [ ] The contract resolves the payee from its canonical PO record and remains authoritative for every limit.
- [ ] Payment records distinguish `Paid`, `Pending`, and `Blocked`, including chain failure.
- [ ] No full-access key or secret is placed in frontend configuration or logs.

**Verification:** Run adapter tests against Sandbox and inspect audit records for each outcome.

**Dependencies:** CC-03, CC-04, CC-07.

**Files likely touched:** `backend/src/near/client.ts`, `backend/src/payments/adapter.ts`, `backend/src/routes/payments.ts`.

**Estimated scope:** Medium.

### Checkpoint: Procurement flow

- [ ] Low stock yields a stored forecast, quotes, and a PO whose amount and supplier are derived from stored data.
- [ ] Agent input cannot alter the payee or bypass vault policy.
- [ ] Local end-to-end backend flow works with synthetic data and the mock token.

## Phase 3: Judge-facing web app

### CC-10: Replace the Next.js starter with the procurement dashboard

**Description:** Show inventory, low-stock forecasts, supplier quotes, drafted purchase orders, and audit details using backend data.

**Acceptance criteria:**
- [ ] The default screen explains the product state and uses synthetic data only.
- [ ] Loading, empty, and error states are accessible and understandable.
- [ ] UI actions call backend APIs; no policy decision is made only in the browser.

**Verification:** Build the app and manually inspect desktop and mobile layouts.

**Dependencies:** CC-06, CC-07.

**Files likely touched:** `web/src/app/page.tsx`, `web/src/app/globals.css`, `web/src/components/`.

**Estimated scope:** Medium.

### CC-11: Add testnet wallet, policy controls, and payment status

**Description:** Connect the human wallet to testnet for policy/approval actions and display vault status, pause state, and network clearly.

**Acceptance criteria:**
- [ ] The UI is fixed to testnet and clearly labels the test token/network.
- [ ] Human approval, policy changes, and pause controls require wallet actions; the agent cannot invoke them.
- [ ] No signing action occurs without an explicit human-initiated action and review of the transaction.

**Verification:** Use a testnet wallet only after the human has supplied the account and explicitly approved any transaction.

**Dependencies:** CC-02, CC-09, CC-10, CC-00 for account configuration.

**Files likely touched:** `web/src/providers/near-provider.tsx`, `web/src/components/wallet-controls.tsx`, `web/src/components/payment-status.tsx`, `.env.example`.

**Estimated scope:** Medium.

### CC-12: Add cross-chain preview-only state

**Description:** Clearly distinguish simulated cross-chain behavior from a real settlement; optionally show a dry 1Click quote when configured.

**Acceptance criteria:**
- [ ] Testnet uses a mock adapter because NEAR Intents has no testnet deployment.
- [ ] Any 1Click preview uses `dry: true`, resolves supported assets from the live token list, and never displays a deposit address as a completed payment.
- [ ] UI and logs say preview/simulation; no cross-chain deposit or settlement is initiated.

**Verification:** Test mock flows without network and validate the optional dry quote response against the documented API schema.

**Dependencies:** CC-09, CC-10; 1Click configuration is optional.

**Files likely touched:** `backend/src/intents/preview.ts`, `backend/src/routes/intents.ts`, `web/src/components/cross-chain-preview.tsx`.

**Estimated scope:** Medium.

### Checkpoint: Judge flow

- [ ] A judge can follow low stock → forecast → quotes → PO → policy result.
- [ ] A payee-manipulation message cannot change the registered supplier.
- [ ] Cross-chain UI is visibly a preview/simulation and never claims settlement.

## Phase 4: Release readiness

### CC-13: Verify a fresh-clone judge path and update documentation

**Description:** Replace scaffold-only README instructions with reproducible steps that tell an AI judge exactly what to run and what to see.

**Acceptance criteria:**
- [ ] A fresh clone can follow the README using only synthetic data and approved testnet configuration.
- [ ] Each numbered “do X, see Y” step matches the current app and identifies preview-only features.
- [ ] No marketing claims, TEE claims, or mainnet instructions are presented as implemented functionality.

**Verification:** Follow the README from a clean checkout and capture expected UI/API outcomes.

**Dependencies:** CC-04, CC-09, CC-10, CC-11, CC-12.

**Files likely touched:** `README.md`, `implementation.md`, `web/README.md`.

**Estimated scope:** Small.

### CC-14: Run security, dependency, and release checks

**Description:** Resolve the pending web audit report and verify secrets, lockfiles, access boundaries, and testnet-only defaults before release.

**Acceptance criteria:**
- [ ] Web `npm audit` advisories are triaged and documented; no forced upgrade is used without review.
- [ ] `.env` remains ignored, secret values are absent from tracked files, and full-access keys never enter application env.
- [ ] Contract and app checks pass from a fresh clone; all sample auction code and automatic deployment workflows are gone.

**Verification:** Run Rust tests/build, backend tests, web build/lint, secret scan, and fresh-clone setup review.

**Dependencies:** CC-13.

**Files likely touched:** `backend/package-lock.json`, `web/package-lock.json`, `.gitignore`, `implementation.md`.

**Estimated scope:** Medium.

### CC-15: Deploy to testnet only after explicit confirmation

**Description:** Prepare a reviewable deployment plan using the human-provided account and verified test-token address; pause before signing or broadcasting.

**Acceptance criteria:**
- [ ] Network, account, contract artifact hash, token metadata, and intended state changes are shown to the human before any transaction.
- [ ] Continue only after explicit confirmation for the specific testnet transaction/deployment.
- [ ] No mainnet deployment, real-value token, or key in the repository is used.

**Verification:** After approval only, verify deployed contract views and repeat the README flow with test assets.

**Dependencies:** CC-00, CC-04, CC-14.

**Files likely touched:** `scripts/deploy-testnet.sh`, `.env.example`, `README.md`.

**Estimated scope:** Small.

### CC-16: Prepare the hackathon submission for human review

**Description:** Assemble the organizer's exact submission fields and demo information without sending, posting, publishing, or pushing anything.

**Acceptance criteria:**
- [ ] Every submission field is supplied by the human; print the full JSON payload and wait for an explicit yes before the one allowed submission.
- [ ] The human publishes any X/network post and explicitly confirms any repository-public or push action.
- [ ] No secrets are committed; consent uses the exact organizer wording.

**Verification:** Review payload fields, track IDs, demo link, consent, and repository state with the human before any external action.

**Dependencies:** CC-13, CC-14, CC-15.

**Files likely touched:** `README.md`, submission draft kept outside committed secrets/config.

**Estimated scope:** Small.

## Human confirmation rules

Follow the `HACKATHON.md` “Never without the human's explicit confirmation” list exactly:

- Send the submission. Print the full JSON payload first and wait for a yes. A second submission of the same repository is rejected, so there is one attempt per project.
- Post anything on X or another network on their behalf.
- Make the repository public, push, or force-push.
- Sign transactions, spend tokens or deploy to mainnet.
- Commit secrets. Keys belong in environment variables, never in the repository.

The project spec also requires explicit human confirmation before signing or broadcasting any testnet transaction. No mainnet work is in scope.

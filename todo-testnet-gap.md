# CareCart testnet gaps and pre-funding verification

**Status:** ACTIVE execution checklist, 2026-11-02. **Primary authority:** [mainnet-todo.md](mainnet-todo.md) and its incorporated MN-00 decisions. This file tracks the requested gap closure; it does not reopen the archived `todo.md` or replace the primary requirements.

Keep the deployed CCTEST prototype, keys and database intact. Implement the approved stronger controls in a separate versioned vault/profile and prove them locally with a mock FT before proposing another deployment. No migration, account/key change, public transaction, real-fund deposit or settlement is authorized by this checklist alone.

| Gap | Required completion evidence | Status / mainnet mapping |
| --- | --- | --- |
| TG-01 Successful public testnet PO | Fresh canonical PO → restricted commitment/request → Paid, final receipts, exact balance changes, persisted audit/UI. Do not replay `po-000002` (Blocked/Paused). | Pending exact smoke approval; MN-04/07/11. |
| TG-02 Human approval/rejection | Separate above-auto-threshold POs become pending; actual human wallet approval/rejection, hard-limit/pause rechecks and canonical results. | Pending public verification; MN-03/07/11. |
| TG-03 Wallet recovery | Explicit review; usable wallet overlay; bounded preflight; ambiguous responses tracked without retry; actual chosen wallet/transport recorded. | Offline fix/tests already pass; actual transport smoke pending. MN-07. |
| TG-04 Live AI | NEAR AI Cloud adapter; live model-list validation, bounded tool loop, registered-ID schemas, untrusted text containment, authenticated manual invocation, real response evidence or explicit failure. | Local adapter/CLI/auth/rate/error/audit tests pass. First candidate `z-ai/glm-5.3-flash`; user configured `NEAR_CLOUD_API_KEY` in `.env`. Credential-source fix resolves the old 401; the explicit `.env` smoke now returns HTTP 402. Cloud credits/billing and successful tool trace pending. `teeVerified: false`. MN-08/09. |
| TG-05 Guardian and admin authority | Independent pause-only guardian; admin-only resume/policy/roles/approval/withdrawal; one-yocto protection; agent/committer zero-deposit separation. | Implemented in separate v2; unit and real Wasm/Sandbox checks pass. Guardian name selected: `guardian.carecart.testnet`; read-only preflight confirms it is absent. Public account/custody/deployment and wallet UI integration pending. MN-03/07. |
| TG-06 Hard limits and accepted deposits | Six-decimal 10 USDC auto limit; immutable 25 payout / 25 UTC-day / 50 accepted-balance maxima; initial accepted ceiling 5. Approval cannot bypass hard limits; partial refunds, forced-transfer quarantine, original-day reservations/late callbacks. | Implemented in v2; boundary/invariant units and six-decimal mock-FT Sandbox pass. Public verification and complete mainnet fixture/UI work remain open. MN-01/02. |
| TG-07 Treasury withdrawal | Fixed treasury only; pause + withdraw unreserved accounted funds; withdrawal reservations, definitive failure rollback, repeated exit and in-flight reconciliation. | Implemented in v2; failed/late/in-flight reservation units and real Sandbox exit pass. Public/wallet drill pending. MN-03/07. |
| TG-08 Real cross-chain implementation | Separate signed 1Click adapter, exact cryptographic verification, immutable PO/route/quote attempts, Base-only route, human approval, registration-before-transfer, durable dispatched/settled/refunded distinction and restart recovery. | Local adapter/journal/restricted client/review/recovery CLI implemented. Crypto/receipt/restart fixtures and local Wasm registration→Dispatched pass. Versioned wallet integration, live API compatibility and TG-09 remain pending. MN-04/05/06/07. |
| TG-09 Actual external cross-chain settlement | Approved exact NEAR mainnet USDC → Base transaction; final source, independent Base receipt or treasury refund, fees/expiry evidence. | Cannot run on NEAR Intents testnet; remains separately approved G4 mainnet smoke. No simulated receipt can close this row. |
| TG-10 Deployment/profile compatibility | Separate token/chain/decimal/vault/DB manifest; old CCTEST profile unchanged; versioned fresh-init artifact and ABI; no unreviewed upgrade of deployed vault. | v2 manifest validation/client guards and isolated DB implemented/tested; separate host Wasm+ABI built. No actual profile/account/deployment approved. Old deployment plan source fingerprint is stale for new builds. MN-01/09/10. |
| TG-11 Release/judge evidence | Dependency deferrals rechecked, secrets absent, native checks/builds, fresh judge steps and accurate UI/events/receipts. | MN-09/12; do not equate passing tests with a clean dependency audit. |

## Execution order

1. Separate versioned safety vault/profile; TG-05–07 with unit/invariant and Sandbox mock-FT coverage.
2. Live provider adapter/tool validation and TG-04 tests; no live inference without selected model and local credentials.
3. TG-08 signed-quote/dispatch/recovery implementation and fixtures; keep all existing preview routes dry-only.
4. Integrate versioned backend/admin ABI and profile tests, then build/scan/review artifacts.
5. Present exact testnet deployment and TG-01/02/03 public transactions for separate approval. Retain old public records.
6. Resolve remaining identities/custody/budgets and G1/G2; only then propose G3/G4 mainnet smoke. No real settlement claim until TG-09 evidence exists.

Completion checkboxes will be marked only for observed implementation/test results. Source decisions, mocked responses and local Sandbox execution do not certify live AI, wallet ownership or external settlement.

## Local completion evidence

- [x] Separate fresh-init safety vault and six-decimal CCUSD mock initializer; existing CCTEST initializer/profile retained.
- [x] 13 safety unit tests and local Wasm/FT Sandbox lifecycle, including registration-before-transfer for a Base mock.
- [x] Safety-vault Clippy with `-D warnings`; separate locked host Wasm+ABI build.
- [x] Manual AI implementation, catalog/capability checks, auth/rate/error/tool boundary tests and durable run records; default judge route remains deterministic.
- [x] Signed quote validation, isolated durable journal, independent receipt verifiers and v2 restricted-client/recovery code with fixtures.
- [ ] Successful live AI response/tool trace after Cloud billing/credits are resolved; `.env` and `NEAR_CLOUD_API_KEY` are now honored, and the observed inference response is HTTP 402.
- [ ] Separate public v2 profile/guardian/token/vault deployment, complete wallet integration and approved payment/exit drills.
- [ ] Independently verified real external settlement or treasury refund under G4.

See [implementation, reproducible local commands and exact limitations](docs/testnet-gap-implementation.md). G1 and all operational/release gates remain open; this checklist does not mark the overall testnet/mainnet gap closure complete.

The [v2 deployment draft](docs/testnet-safety-deployment-plan.json) proposes new vault/token accounts and records the selected guardian, exact local artifacts, init args and budget gaps. Current sponsor funds are insufficient for that proposal; no account creation, key change, top-up or transaction has run.

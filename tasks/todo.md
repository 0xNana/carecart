# CareCart active delivery tasks

## Current — Phase 2 Dashboard and Playground

- [x] Verify scoped-cookie/session helper and viewer API permissions in focused tests; server-side unauthenticated redirect observed. Authenticated browser acceptance remains below.
- [x] Implement an isolated consumption-to-canonical-PO Playground scenario using the existing runtime; reset preserves operational records.
- [x] Connect replenishment detail, payment evidence and P3B review to `/app`.
- [x] Complete Overview payment/delivery evidence boundaries and case-read time; clear failed data-source reads and fail closed on authentication/profile failures. Four new regression tests; 22 focused tests, types and targeted lint pass.
- [x] Verify testnet fails closed on configuration/RPC failure, network isolation, production route navigation and landing compatibility. Live testnet configuration remains unverified.
- [ ] Finish final tablet/menu and inventory-table browser acceptance with final desktop/mobile screenshots. Browser approval review is currently blocked by a usage limit; manual checks are documented in `docs/phase2-application.md`.
- [ ] Record focused tests and owner-run full build/browser evidence, including remaining P4A dashboard integration.

This owner brief prohibits deployment, publication, commits, contract-policy changes and mainnet transactions. Mainnet launch is queued. Earlier task sections are retained below as historical work; use current verification records when assessing their old blockers.

Owner sequence (2026-11-03): **P1 procurement integration → P2 durable case orchestration/operator experience → P3 live AI/human wallet → P4 approved economic execution**. EIR capability registry and specialized agents are deferred beyond this milestone. [Plan and acceptance boundaries](plan.md).

## P1 — One functioning procurement system

- [x] **P1-01:** Match the supplied report to all eleven source files and classify the evidence. [Recorded comparison](../docs/p1-source-verification-2026-11-03.json).
- [ ] **P1-02:** Demonstrate standalone worker processes using disposable state and no operational credentials; verify event/select/inspect/reopen/replay and role-boundary behavior. Do not label mocked transport as receipts.
- [ ] **P1-03:** Design and test the explicit local Sandbox identity/transport binding while preserving production mainnet fail-closed checks; no chain/token relabeling.
- [ ] **P1-04:** Exercise one combined event → canonical PO → separate commit/request → real local receipts → persisted outcome flow, including balance verification and replay/recovery.
- [ ] **P1-05 checkpoint:** Review owner-run process/Sandbox output for the exact source fingerprint. Retain event/PO/hash/receipt/balance evidence. Close P1 only when combined integration is demonstrated.

**Already implemented, with scope limits:** trusted catalog, exact forecasting/selection, durable canonical POs, separate-role bridge and read-only positive-evidence reconciliation. The supplied report records 220 backend tests / 33 safety units plus typecheck/clippy/lint/helper checks. Receipt execution remains blocked/unperformed and standalone CLI invocation remains unverified.

## P2 — Durable case orchestration and operator experience

- [ ] After P1 acceptance, specify the minimal durable case lifecycle over the existing procurement/operation/settlement records and required operator actions.
- [ ] Implement and verify restart/inspection/review handling without automatic retries or a second payment authority.

## P3 — Live AI and human-wallet integration

- [ ] Bind ID-only live tools to the same case/PO lifecycle, with verified provider evidence and restricted capabilities.
- [ ] Bind human approval to the reviewed canonical route/quote/commitment with immediate wallet revalidation and correct one-yocto ABI.

## P4 — Approved economic execution

- [ ] Reconcile release/custody/profile/budget gates and prepare the exact reviewed action package.
- [ ] Execute only specifically approved deployment/setup/smoke operations; independently verify receipts, balances and destination/refund evidence.

## Deferred evolution

EIR capability registry, specialized agents, generic agent routing/orchestration and expanded settlement destinations are not tasks for this milestone.

## Consolidation scope lock — owner review 2026-11-10

- [x] Re-audit dirty/untracked source, routes, schemas, dependencies, workers, profiles and public ABI without deleting owner work.
- [x] Preserve the shared inventory ledger/P1/P2/finance/Supabase boundaries and historical migrations.
- [x] Reproduce and fix canonical supplier mismatch on physical receipt; verify rollback and valid receipt behavior.
- [x] Run backend/web/types/lint/webpack, all nine process suites, vault units and three genuine local Sandbox tests.
- [x] Preserve an owner-runnable local synthetic browser acceptance harness and retain actual browser evidence separately from hosted Supabase acceptance.
- [x] Refresh all four requested reports with explicit deletion/consolidation scope and conditional financial/public verdicts.
- [ ] Resolve economic-invoice splitting, custody/upgrade and exposure acceptance before certifying non-overridable public protection.
- [ ] Complete one genuine tenant-authorized Sandbox finance loop, plus real hosted Supabase/wallet acceptance.
- [ ] Deliver native mainnet USDC and public Base/Arbitrum/Solana settlement evidence under separately authorized future execution. No activation is authorized by this checklist.

## Current active scope — testnet-only MVP, 2026-11-10

Earlier mainnet delivery tasks above are deferred by the latest owner brief.

- [x] Preserve dirty tree/data and audit existing v2 versus legacy testnet semantics.
- [x] Reuse the ledger/monitor/P1/P2 for explicit CCUSD testnet preparation in isolated state.
- [x] Keep public signing/financial bindings disabled and reject mainnet fallback.
- [x] Prepare the paused fresh-vault/token/role/resource proposal and four requested reports.
- [x] Inspect effective `.env` public configuration without revealing/reviving secrets; record missing role keys.
- [x] Finish and record regression/process checks, genuine local Sandbox acceptance and testnet-preparation browser acceptance.
- [ ] Owner reviews/provisions actual public keys, custody and exact paused setup package; no public actions before exact authorization.

## Approved-plan preflight — 2026-11-10

- [x] Record approval as account-set/paused-plan preparation only; preserve the public transaction hold.
- [x] Build fresh vault/token artifacts into a new review directory; retain original artifacts/demo.
- [x] Verify required fresh ABI exports and run finalized credential-free testnet account/key/protocol/gas reads.
- [x] Prepare the exact staged account/create/deploy/init/setup package and updated resource estimate.
- [ ] Resolve parent shortfall (5.4100449058375 test NEAR plus creation gas), actual custody/public keys and changed release acceptance.
- [ ] Obtain exact stage-specific public-operation authorization before signing or submitting anything. Unpause/payment/agent-key activation remain outside the staged setup proposal.

- [x] Funding recheck: finalized block 277056403 confirms parent funding is sufficient for 7.0441 test NEAR in fresh account balances, with remaining gas headroom.
- [ ] Obtain exact Stage A authorization for six account creations and their human-controlled keychain keys; deployment/setup/signing enablement/payment approvals remain separate.

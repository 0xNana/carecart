# CareCart delivery plan — P1 → P2 → P3 → P4

## Active scope — Phase 2 application, 2026-11-03

2026-11-06 repeated brief: retain the implemented routes and finish the Overview's saved payment/delivery evidence and read-time labels. Correct failed-refresh handling so unavailable inventory, run and catalog reads cannot retain stale successful values; fail closed on expired sessions or cross-profile responses. Verify in focused tests and preserve owner-run full builds/services. No continuous P4A Dashboard rollout is included.

The latest owner brief takes priority over live-launch execution: implement and verify the authenticated `/app` Dashboard and isolated Playground, preserving `/operations` and the completed landing page. No deployment, commit, policy change or mainnet transaction is authorized in this phase. Mainnet/Fly.io work is queued; the owner selected carecart.xyz and Fly.io, with Supabase optional.

Preserve the existing uncommitted implementation and complete it in thin slices:

1. Verify server-side access through existing opaque sessions and scoped cookies; retain role, CSRF, nonce and local-only service checks.
2. Replace placeholder Playground preparation with an authenticated isolated synthetic scenario using existing inventory/procurement/workflow code. Consumption, supplier selection and canonical PO must be actual local records. Reset cannot affect Dashboard or testnet state.
3. Reuse detailed replenishment evidence and P3B wallet review in the new screens. Label catalog snapshots and unavailable monitoring honestly. Full P4A Dashboard monitoring remains the next milestone.
4. Verify testnet-only wallet configuration, accessible navigation and the landing CTA; retain the public synthetic demo.
5. Run short focused checks locally. Full suites, builds and persistent services remain owner-run. Record actual outcomes and blockers separately.

Acceptance requires all requested routes, server-side protection, read-only viewers, simulation without any signing/public-chain transport, and preserved procurement/wallet security. Desktop/mobile screenshots and full webpack evidence remain required; unexecuted checks stay open.

The older phase plan below is historical context. Its old integration blockers are superseded by the source-bound P4A verification records in `docs/`.

**Current scope, supplied by the owner on 2026-11-03:** Integrate the procurement workflow first; then durable case orchestration and operator experience; then live AI and human-wallet integration; then separately approved economic execution. EIR's capability registry and specialized agents are the next architectural evolution and are outside this milestone.

P1's goal is to make CareCart one functioning system rather than several independently tested systems. Current domain integration is implemented, but the worker-process and real-receipt evidence gaps remain open. Do not start P2/P3 implementation or use available mainnet funds as evidence that P1 is complete.

The active task list is [tasks/todo.md](todo.md). The former closed prototype plan is preserved byte-for-byte in [internal-docs/prototype-plan.md](../internal-docs/prototype-plan.md). The relocated [mainnet requirements](../internal-docs/mainnet-todo.md) continue to define technical invariants and exact economic-action gates; this owner-supplied phase order governs execution priority. Existing P0/P1 edits and the documentation relocation are preserved.

## Delivery sequence

| Phase | Deliverable | Exit evidence |
| --- | --- | --- |
| **P1 — Procurement integration** | One trusted inventory-event → forecast/quotes → deterministic selection → durable canonical PO → separate committer → ID-only requester → contract receipt → persisted outcome path. | Standalone workers and the combined local receipt trace run successfully; repeat/restart cannot create another obligation or blind resend. |
| **P2 — Case orchestration and operator experience** | Durable case lifecycle over the existing domain/journals, clear work queue, review/action states and evidence inspection. | The operator can follow/reopen a case and distinguish pending, approved, ambiguous, rejected, dispatched and settled evidence without unsafe resets. |
| **P3 — Live AI and human wallet** | ID-based model tools and the reviewed human-wallet approval flow connected to the same case/PO/attempt identity. | Genuine provider/tool-call evidence and explicit wallet review with immediate revalidation; correct one-yocto ABI and no expanded signing authority. |
| **P4 — Approved economic execution** | Reviewed release/config/custody/budgets, deployment/setup and individually approved tiny real-value operations. | Exact approved transactions, finalized receipts, balances and independent destination/refund evidence; safe final paused/recovery state. |

The phases are cumulative. P2 reuses P1's canonical terms and existing OperationJournal/SettlementJournal rather than inventing another source of truth. P3 binds into that case lifecycle. P4 activates the reviewed implementation; it does not substitute real money for missing integration evidence. Prior approved account/key setup remains recorded, but authorizes no additional economic execution.

## P1 current implementation and evidence

All eleven files match the supplied report fingerprint `5e05cfda808039008a49cdda2e88ca3d0fc4027db44b4e2586ff955fcda148cc`. [Source/evidence review](../docs/p1-source-verification-2026-11-03.json), [implementation boundary](../docs/p1-procurement-v2.md).

The report records 220 backend tests, 33 v2 safety unit tests, typechecking, clippy, web lint and deployment-helper logic checks passing. These are reported executions, not long commands rerun in this review. Real SQLite persistence/reopen and canonical reconstruction are covered. RPC/transaction transport in bridge tests is mocked; `Dispatching` in a fixture is not settlement. The standalone CLI is typechecked but its process invocation was not demonstrated. Sandbox socket creation was blocked before receipt execution.

The existing Rust `safety_vault_real_receipts` suite directly constructs POs/calls the contract. It does **not** execute `V2ProcurementStore`, `executeProcurementRole` or `ops/procurement-v2.ts`. Its eventual success is necessary contract evidence, not sufficient proof of the combined P1 path.

## P1 completion work

### P1-01 — Bind the supplied report to the current source

Completed for this review: compare all eleven hashes; identify domain, mocked-transport, process and receipt evidence separately. No operational values or source files are changed.

### P1-02 — Exercise the standalone procurement worker boundary

Use disposable profile-bound SQLite and an independently supplied synthetic trusted catalog. Exercise event/select/inspect, persistence across independent process invocations and a repeat of the same inventory event. For role-worker process tests, any RPC/signing fixture must be explicit and must not load real keys or reach public endpoints. This is process evidence, not real receipt evidence.

Acceptance: the process output and reopened database agree on one PO/hash; role environments remain separate and fail closed on invalid/overlapping credentials; errors and ambiguous results cannot trigger a new automatic send.

Likely scope: a dedicated worker-process harness/test plus the existing CLI entrypoint if a small testability change is necessary (2–3 files). Do not broaden the public API or register new model tools.

### P1-03 — Establish a truthful local Sandbox binding

Design a test-only connection between the real procurement spine and the local Sandbox before writing a combined receipt test. Current procurement/store/client validation binds mainnet identity, native-USDC terms and HTTPS; Sandbox uses a local chain and mock token. Resolve that environment boundary explicitly. Do not weaken production profile/key/token checks, relabel a local chain as mainnet, silently rewrite canonical terms or claim mock tokens are real USDC.

Acceptance: the fixture binds actual local chain/RPC/token identities, refuses external endpoints and operational credentials, and preserves the same canonical PO meaning across domain/worker/contract observations. Production mainnet isolation regressions continue to pass. Any fixture-only behavior stays unreachable from the operational CLI/public server.

Estimated scope: small dedicated fixture binding and its boundary tests (2–3 files), followed by the trace in P1-04. Detailed adapter/interface design is the first task here; no bypass is approved by this plan.

### P1-04 — Run one combined procurement-to-receipt trace

Exercise a synthetic low-stock event through the real store, canonical terms, separate committer/requester worker invocations, real local contract execution and finalized receipts. Persist the resulting observations under the same event/PO identity. Verify actual mock-token balance movement and final contract status rather than trusting cached status or a successful send response.

Acceptance: a successful tiny local payment has one immutable PO and independently observed receipts/balance changes; repeat/reopen does not create another obligation/send; an ambiguous response stays frozen until positive canonical evidence reconciles it without resending. Include the existing security rejection coverage in the acceptance evidence without conflating unit cases with combined receipt cases.

Likely scope: the dedicated local receipt harness and one bridge integration fixture/test (2–4 files), plus evidence documentation. The owner runs the long Sandbox/process checks in a socket-capable terminal and shares output.

### P1-05 — Acceptance checkpoint

Record the exact tested source fingerprint, commands/results, event ID, PO ID/hash, worker roles, actual local transaction/receipt references, persisted final observation, token balances and replay/recovery result. Keep blocked/unexecuted checks open. A passing contract-only Sandbox test or mocked bridge suite alone does not close this checkpoint.

## Verification ownership and available commands

All long tests/builds remain owner-run. No long suite was run for this planning update. Existing commands, useful as supporting checks, are:

```sh
nvm use
npm run typecheck --prefix backend
npm test --prefix backend
cargo test --locked --manifest-path contracts/Cargo.toml -p carecart-safety-vault --test safety
cargo test --locked --manifest-path contracts/Cargo.toml -p carecart-safety-vault --test sandbox -- --nocapture
```

These commands do not yet exercise the missing combined P1 process/receipt harness. Add and document that focused invocation when the harness exists. Do not present a proposed/new test command as something that already ran.

## Boundaries throughout this milestone

- Existing CCTEST configuration/state and deployed legacy contracts stay isolated; no migration or reinterpretation.
- Canonical integer amounts, supplier/token/route/invoice commitments, disjoint restricted credentials, finite allowances and private callback/reservation semantics remain mandatory.
- Missing contract effects or callbacks never justify clearing an uncertain operation or blindly retrying. Confirmation of a source operation is not cross-chain settlement.
- Browser signing, live AI tools and Base execution remain their later phase deliverables; P1 may persist their identifiers/terms but does not activate them.
- No EIR capability registry, agent marketplace, specialized-agent framework or generic orchestration engine is introduced into P1.
- No dependency upgrade, key/secret export, account mutation, transfer, deployment, funding, public endpoint, push or publication is part of this plan.

## Risks and decisions

| Risk | Required handling |
| --- | --- |
| Passing isolated suites is mistaken for one system | Require the combined P1 trace with durable IDs and real local receipts. |
| Sandbox identity needs are used to relax mainnet checks | Separate fixture binding; prove loopback/local chain/token boundaries and retain production mismatch tests. |
| Socket/process restrictions block this agent runtime | Leave receipt/process evidence open and delegate long runs to the owner's capable terminal. |
| Database integrity hashes are mistaken for authentication | Keep trusted catalogs/config outside database/model control and disclose the combined-compromise boundary. |
| Mainnet account funding causes premature execution | Preserve the owner's phase order and exact action approvals; P4 remains later. |
| Concurrent work is overwritten | Preserve current P0/P1 source and internal-docs relocation; coordinate shared-file changes before implementation. |

## Consolidation scope-lock owner review — 2026-11-10

The latest pasted owner brief governs this review: preserve existing P0–P4 and identity, consolidate the five domains, verify local execution and stop before commit/deploy/funding/policy/public transactions. The [current consolidation report](../docs/carecart-consolidation-report.md#current-owner-review--2026-11-10) records the receipt supplier fix, reproducible synthetic browser script, exact verification and unresolved financial acceptance. Existing historical task sections remain intact; locally passing proofs do not close public activation tasks.

## Testnet-only MVP preparation — 2026-11-10

The latest owner brief supersedes the mainnet delivery target for the active MVP. Keep historical mainnet code/evidence deferred. Implement an explicit pinned six-decimal CCUSD testnet profile, reuse the existing ledger/P1/P2 spine for isolated testnet preparation, retain a hard public-signing stop, align visible testnet labels, research current Intents test environments, and prepare exact fresh-vault activation/demo packages. Verify focused slices, then all existing suites. No public deployment, funding, signing, transaction, policy change, commit or publication is authorized. Owner approval comes only after the concrete package and blockers are reviewable.

The owner selected **review of the proposed fresh v2 accounts**, not deployment approval, and directed inspection of `.env`. Effective duplicate-last-wins parsing leaves restricted role keys/accounts empty; mainnet-specific credentials remain unused. Complete verification/documents, then stop with these key/custody blockers and exact paused setup proposal for owner review.

## Approved testnet plan — preflight only, 2026-11-10

Owner reply `APPROVED` accepts the proposed fresh v2 accounts and paused setup plan for next-stage preparation, matching the explicit preceding approval question. It does not authorize public deployment, funding, key installation, signing, unpause or payments. Complete credential-free finalized testnet reads, a fresh source/artifact comparison and a concrete staged setup package. Record unresolved custody/public-key/resource prerequisites. Do not source `.env` or revive overridden keys.

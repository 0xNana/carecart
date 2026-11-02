# CareCart mainnet — primary implementation authority

**Status:** ACTIVE PRIMARY DOCUMENT — MN-00 / G0A **COMPLETE**, approved 2026-11-02 (UTC). MN-01 local profile/amount work is implemented; live 1Click asset verification and G0B account-registration checks remain open. MN-02–MN-13 implementation, operational readiness and release gates remain open. Do not enable mainnet by changing an environment variable in the testnet prototype.

**Current local work:** MN-03/MN-04 and MN-05 local implementation/regressions are present. On 2026-11-02 the owner reported all delegated backend typecheck/tests and safety-vault unit/Sandbox commands passed. This is owner-reported validation, without captured logs or test counts; see [verification record](docs/mainnet-owner-verification-2026-11-02.md). Operational identities, funding, live verification and release gates remain open.

## Authority and approval boundary

This is the primary document for current scope, requirements, task order, acceptance criteria and release gates. It incorporates the accepted decisions in [CareCart-MN-00-APPROVED-2026-11-02.md](CareCart-MN-00-APPROVED-2026-11-02.md). That file is retained unchanged as the approval evidence. Future approved changes must be reflected here; unresolved discrepancies must be recorded explicitly.

[DESIGN.md](DESIGN.md), [implementation.md](implementation.md), [todo.md](todo.md) and [tasks/plan.md](tasks/plan.md) are **COMPLETED / CLOSED historical records**, superseded for ongoing work by this document. Their closure records the handoff, not proof that every historical proposal or unchecked test was implemented. The README remains the runnable product/judge guide; dated evidence remains evidence of the checks actually performed. No old checklist completion establishes mainnet readiness.

**2026-11-02 local implementation update:** [todo-testnet-gap.md](todo-testnet-gap.md) tracks the active gap work and [its operator/evidence guide](docs/testnet-gap-implementation.md) records the separate safety-vault v2, authenticated manual AI adapter, signed Base quote/journal/receipt implementation and local tests. The existing deployed CCTEST vault/UI retain their original ABI. Checked implementation items below mean local code/test completion only; all operational and release gates remain open, including live AI compatibility, versioned wallet integration, public deployment/smokes and actual external settlement.

**Approved now:** implementation planning, local code/tests, separate configuration profiles, and non-transactional verification in dependency order. **Separately gated:** operational account/control proof, wallet custody, keys, exact real-fund budgets, account/key changes, wallet signing, deployment/funding/payments, public API exposure, repository/social publication and organizer submission. G0A approval is design acceptance only; G0B and the relevant exact-action approvals remain open.

**Source wording conflict:** the approval record's final label “Explicitly authorized” is followed by “Each requires a specific subsequent approval.” This contradicts its own “Never infer approval,” invariant 10, G0B and next-work paragraph. This primary document preserves those explicit separate-action gates; it does not interpret the label as blanket transaction/publication permission. The source file is not rewritten.

**Approval source SHA-256:** `f01011a00daf2791a8fd7f2bcc6ebb0803bed1e2ff840999a78d5772d58d0de9`.

## Approved launch scope and deferrals

- NEAR mainnet native Circle USDC, six decimals; separate testnet/CCTEST profile and database remain intact.
- Synthetic hospital procurement; deterministic forecasts; live NEAR AI Cloud assistance for PO drafting using a live-listed, tested tool-capable model. A manual **Run tick** starts the flow. Deterministic fallback is visibly labeled; it is not presented as live LLM autonomy.
- Immutable canonical PO commitments, independent committer/requester credentials, automatic ID-only same-chain payment requests within policy, and human-reviewed **Base USDC only** settlement through a new 1Click adapter.
- Pause-only guardian, fixed treasury recovery, authenticated/rate-limited manual-tick/payment APIs, honest source/destination transaction evidence and retained/disclosed cold upgrade authority during judging.
- MIT license selected. Planned tracks: Real-World Money, Autonomous Business, AI Security & Defense, subject to current organizer validation. Privacy track requires separately proven privacy functionality.
- Deferred: Arbitrum/Solana settlement, unattended scheduling, full TEE/DCAP/privacy claims, elaborate analytics, streaming agent console and the full 25-item dataset. Initial mainnet fixture: **5–8 items / 3 synthetic suppliers**.

## Approved policy and amount semantics

All USDC amounts below use six-decimal integer atomic units. These values are scope/policy choices, **not funding authorization**.

| Field / invariant | Approved USDC | Atomic units | Enforcement |
| --- | ---: | ---: | --- |
| `auto_per_po_limit` | 10 | `10000000` | Above this threshold requires approval; agent cannot override it. |
| `hard_payout_limit` | 25 | `25000000` | Current hard per-PO dispatch limit; approval does not bypass it. |
| `daily_dispatch_limit` | 25 | `25000000` | Combined same-chain/cross-chain UTC dispatch budget, including reservations and approved payments. |
| Initial `accepted_deposit_ceiling` | 5 | `5000000` | Accounted treasury deposit ceiling; raise only after reviewed smoke tests and exact approval. |
| `ABSOLUTE_PAYOUT_MAX` | 25 | `25000000` | Immutable deployment-time maximum under the deployed code. |
| `ABSOLUTE_DAILY_MAX` | 25 | `25000000` | Immutable deployment-time maximum under the deployed code. |
| `ABSOLUTE_ACCEPTED_BALANCE_MAX` | 50 | `50000000` | Immutable ceiling on the accepted/accounted balance policy, not a guarantee against forced plain FT transfers. |

Admin may lower current hard limits or raise them only within the immutable maxima. Retained deployer authority can still replace code; disclose that custody trust. `balance_cap` is not reused: its prototype cumulative-spend meaning is different. A lifetime spending budget is not required for the MVP and must be explicitly specified if later added. Repeated legitimate deposit/withdraw/payment cycles are not capped at 50 USDC of lifetime throughput.

A 5 USDC initial budget supports a 1 USDC first payment, not the old 6.20/11.80 USDC examples. Increasing the accepted ceiling/funding for larger demos requires a new exact review. Use 4 USDC to an unknown supplier to isolate allowlist rejection; a separate 40 USDC allowlisted attempt tests the 25 USDC hard payout bound, without dispatching it.

## Accepted reconciliation — R-01–R-13

All decisions below are accepted at G0A. Their implementation and verification are still pending; decision acceptance is not an implementation checkbox.

| ID | Approved decision | Verification / gate |
|---|---|---|
| R-01 | Retain immutable testnet/CCTEST profile and database. Add a separate, fail-closed mainnet profile using native Circle NEAR USDC, six decimals. Bind chain, RPC identity, token, vault, treasury, roles, DB, and explorer in a reviewed manifest. | Official Circle candidate: `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1`. Independently check live `ft_metadata`, network identity, supported 1Click asset and token storage registration before funding. Never migrate CCTEST payment records. |
| R-02 | Auto same-chain threshold **10 USDC per committed PO**; hard payout **25 USDC per PO**; hard combined daily dispatch budget **25 USDC UTC**. Admin approval bypasses *only* auto threshold, not hard limits. Initial accepted deposit ceiling **5 USDC**, raised only after reviewed smoke tests; absolute configured ceiling **50 USDC**. | Test 10, 10.000001, 25, 25.000001, midnight, overlapping pending approvals, and callback failures. If policy is mutable, distinguish the *current* hard policy from an immutable contract-level upper bound; see below. |
| R-03 | Rename `balance_cap` to avoid semantic reuse. `accepted_deposit_ceiling` bounds accounted deposits; `auto_per_po_limit`, `daily_dispatch_limit`, `hard_payout_limit` are distinct. Accept only treasury-originated `ft_transfer_call` deposits from the canonical token with exact message, returning unused amount. Never credit unsolicited plain `ft_transfer` to spendable balance. | Reconcile `ft_balance_of` against accounted balance; quarantine the difference in bookkeeping, disclose that direct transfers can exceed the displayed *accepted* cap. Reject/refund wrong token, sender, message; test partial refund and unsolicited transfer. |
| R-04 | Include a **pause-only guardian** with independent identity. Admin and guardian `pause` require caller authorization plus one yocto; admin privileged mutations/approval/withdrawal require one yocto. Agent/committer entrypoints use zero deposit and strict predecessor + FC-key restrictions. | Wallet ABI integration, one-yocto rejection tests, guardian cannot unpause/approve/withdraw; storage funding is handled separately where necessary. |
| R-05 | Fixed **treasury-only** withdrawal; `withdraw_all` first pauses, then withdraws only **unreserved, accounted** funds. In-flight transfers are never clawed back. Reconcile callbacks and permit subsequent exit after in-flight operations finish. | Test success/failure callbacks, paused approvals, reserved balances, treasury mismatch, repeat exit and restoration of failed-withdrawal reservations. |
| R-06 | Preserve **separate committer and requester keys** and **immutable PO fields**. Agent tool `submit_payment(po_id)` may automatically request an in-policy, committed **same-chain** PO; it cannot choose payee, amount, chain, route, or quote. Cross-chain preparation uses reviewed, immutable PO + route + quote commitments and is always pending human approval. | Injection and duplicate-ID tests. A compromised backend with access to both keys remains a trust boundary: isolate processes/credentials and validate commitments independently of LLM text. |
| R-07 | Implement a **new** 1Click settlement adapter, not a `dry:false` switch on the testnet preview adapter. **Base USDC only** for judged MVP; Arbitrum/Solana after Base receipt/refund tests pass. | One separately approved small-value NEAR-to-Base transaction, verified on both explorers. |
| R-08 | Use SDK-supported **cryptographic** 1Click signature verification of the exact signed payload, and pin/review the signer trust source. Persist canonical signed bytes, verified request/response, quote ID/hash, deposit address, expiry, min output, fees, destination chain/asset/recipient, and treasury refund. Bind immutable quote/route identity to committed PO; revalidate immediately before human signing and before dispatch. | Tampered signature, stale quote, changed recipient/refund, route version change, hash mismatch and review-to-sign substitution all fail before transfer. Vault **cannot independently prove ultimate destination recipient**; this remains a human-review + 1Click trust assumption. |
| R-09 | Keep distinct statuses: Draft, Committed, PendingApproval, Approved, Registering, Dispatching, Dispatched, Settled, Refunded, Expired, Failed, Blocked (or map these to explicit state/substate fields). `Dispatched` means successful source-chain transfer only. `Settled` requires independent destination receipt evidence; `Refunded` requires treasury refund evidence. | Durable state machine, restart-safe reconciliation, no blind retry of ambiguous transfers, source/destination links. Onchain cannot assert cross-chain settlement unless a verified oracle/proof is implemented; destination settlement can be labeled as backend-verified. |
| R-10 | **Manual `Run tick` first**. Use NEAR AI Cloud with an available, tested model supporting the required tools, selected from current provider listing; do not pin an untested model name. Disable TEE/privacy badge and claims until evidence is collected and checked. Scheduled unattended operation deferred. | End-to-end tool-call trace and a real provider response; clear failure or explicitly labeled deterministic fallback if credentials/provider unavailable. |
| R-11 | Keep proven Rust/SDK/Node pins pending compatibility and security checks. Create new six-decimal mainnet fixtures and prices/quantities sized for 1–5 USDC smoke payments and a later 6.20 USDC PO; retain CCTEST fixtures unchanged. Start with 5–8 items/3 suppliers; expand only if the complete payment flow is stable. | Clean build, tests, audited dependency exceptions, `1 USDC = 1_000_000` atomic units, no floats for transfers, no CCTEST-to-USDC migration. |
| R-12 | Mainnet roles must be supplied and control-proven by owner. Admin and treasury wallet-held; deployer FAK offline/cold during hackathon; agent/committer FC keys restricted and not colocated with admin FAK. Retain controlled upgrade path during judged period, publicly disclose it, then review shutdown/key policy after event. Authenticated, rate-limited manual-tick/payment API only. | Wallet/hardware compatibility **tested** rather than assumed; key/secret scan, exact release WASM hash, exit drill, deployment and account ownership approvals. No immutability/audit/hardware claims without evidence. |
| R-13 | Use the **MIT** license for the planned repository. Primary submission tracks: **Real-World Money**, **Autonomous Business**, **AI Security & Defense**. Privacy track only with proven privacy implementation. Public repo + public X demo post + one final submission after exact payload approval. | Verify current organizer form/rules, deadline and one-submission policy before action; README/video claims trace to actual test receipts and public transaction evidence. |

## Current implementation baseline and carried-forward work

The completed prototype has testnet-only CCTEST/zero-decimal configuration, immutable ID-only same-chain payments, separate restricted keys, automatic-payment caps with admin override, actual FT balance queries, synthetic procurement, wallet review UI and preview-only cross-chain behavior. It does **not** implement the approved mainnet hard limits, treasury-only accepted-deposit accounting, guardian, emergency withdrawal or real cross-chain settlement.

Dated testnet evidence: [deployment/setup](docs/testnet-deployment.md), [restricted backend readiness](docs/testnet-backend-readiness.json), [wallet UI recovery](docs/wallet-recovery.md), [resume verification](docs/testnet-resume-verification.json), [judge checks](docs/judge-verification.md) and [security dispositions](docs/security-release.md). The latest recorded testnet state is Active / 10000 CCTEST after an approved CLI resume. `po-000002` is committed/requested and Blocked/Paused from its earlier attempt; preserve its records. No successful public PO payment, mainnet payout or real cross-chain settlement is certified by MN-00. A user-supplied successful admin policy transaction is recorded; the transaction alone does not establish which wallet transport was used.

| Closed source / unfinished historical item | Live tracking in this primary document |
| --- | --- |
| CC-00 provider/model and license | NEAR AI Cloud and MIT selected; live model/credentials/compatibility in MN-08; add license file and validate publication in MN-09/13. |
| CC-11/15 browser signing and successful public PO smoke | Historical limits retained. Carry wallet recovery into MN-07; mainnet local/smoke verification in G1–G4 and MN-11. Testnet UI completion is not asserted. |
| CC-14 dependency exceptions and build evidence | Recheck/update in MN-09; old reports are dated, not an ongoing security clearance. |
| CC-16 submission/post/publication | MN-12/13 and G5. Nothing is submitted/published by closing the old TODO. |
| DESIGN caps, deposits, guardian, treasury, routes and settlement | Corrected requirements below and MN-01–MN-07; existing tests cannot certify absent features. |

## Contract invariants — required before live funds

1. **Only approved roles can initiate state changes.** `committer` can commit a validated canonical PO; `agent` can request a committed PO by ID; neither can administer the vault. Admin has separate full-access wallet confirmation; guardian can only pause.
2. **Committed PO is immutable:** chain/profile, PO ID, supplier ID, token ID, amount (atomic), destination type, recipient/route version and invoice digest are bound; attempts to reuse the ID with different fields fail. The same exact request is idempotent. Quote refresh creates a new *attempt* ID referencing the same PO, never silently mutates it.
3. **Only allowlisted suppliers/routes are payable.** Reject unknown or inactive supplier and revoked/changed route; no free-form recipient from LLM or supplier message. Route index alone is insufficient if indices can shift: use immutable route ID + version/hash.
4. **Current hard policy is enforced at *every* dispatch, including admin approvals.** `amount > hard_payout_limit` is blocked. Exceeding auto threshold creates PendingApproval. Daily-cap exhaustion waits until capacity exists, never allows an override by approval. Funds insufficiency is blocked/held, never dispatched.
5. **Approved defense requirement:** immutable deployment-time maximums `ABSOLUTE_PAYOUT_MAX=25`, `ABSOLUTE_DAILY_MAX=25`, `ABSOLUTE_ACCEPTED_BALANCE_MAX=50` USDC; admin may set *lower* current limits and raise them only up to these immutable ceilings. This prevents an admin policy update from silently redefining the advertised absolute maxima, though a retained deployer key can still upgrade the code and is an explicitly disclosed trusted authority.
6. **No double spend:** reserve balance and applicable daily capacity atomically before asynchronous transfer; count all in-flight dispatches against their original UTC-day bucket. Release reservations only on definitive failure. A callback after midnight must not corrupt the new day's budget. On ambiguous outcome, freeze/reconcile instead of assuming failure or retrying.
7. **Funds accounting:** `spendable = accounted_accepted_balance - reserved_payment - reserved_withdrawal`, checked for underflow. Never use unsolicited token balances as spendable. `accepted_deposit_ceiling` is an accounting limit, not an absolute token-balance guarantee; repeated deposits over time may exceed 50 USDC cumulative throughput.
8. **Pause and exit:** pause stops new payment dispatch/approval and any new auto-pay. Emergency exit transfers only unreserved accepted funds to fixed treasury, subject to the same callback/recovery discipline. Pending transfers may still settle after pause.
9. **Cross-chain:** never auto-approved; source NEP-141 success is `Dispatched`, not `Settled`. Signature verification and quote/route validation are required offchain, and the user must explicitly review and sign. 1Click and UI are trusted for recipient verification; contract cannot independently authenticate the final Base recipient.
10. **No implicit authorization:** `MN-00` agreement approves *design choices only*. Every wallet/account, key, funding, deploy, mainnet smoke payment, public publication and final submission needs separate exact human approval.

## Applied corrections to the archived design

- Replace “hard total balance cap / holdings cap” with **hard cap on accepted/accounted deposits**, and show `actual_onchain_balance` separately. Do not claim that unsolicited NEP-141 transfers are preventable.
- Replace `balance_cap`/cumulative spend semantics with separate field names; decide explicitly whether a lifetime budget is needed (not required for MVP).
- `5 USDC` is the **initial vault budget/accepted ceiling**, not enough to demonstrate the design's **6.20 USDC** gloves PO or **11.80 USDC** Base PO. Start with a **1 USDC** PO and separately approve an increase before larger demo POs. The `50 USDC` is a later maximum ceiling, not the initial funded balance.
- Replace the 40 USDC rogue demo if claiming `Blocked(UnknownSupplier)`: **40 USDC also exceeds the 25 USDC hard payout max**, so reason depends on check order. Use **4 USDC to rogue** to isolate allowlist rejection; optionally a separate **40 USDC to an allowlisted supplier** to demonstrate the hard payout ceiling. Because the real agent takes only PO ID, simulate a compromised committer/backend in the second attack and label that threat model honestly.
- Rewrite the agent-to-vault API from free-form `request_payment(po_id, supplier_id, amount, memo)` to the immutable-PO/ID-only interface. Rewrite cross-chain request so quote and route are committed against the PO without arbitrary LLM fields.
- Replace `PaymentStatus::Paid` after a cross-chain NEAR callback with `Dispatched`; show external destination `Settled` only after independent status/receipt verification. `Expired` applies before dispatch, not retroactively to already-sent funds.
- Clarify that `withdraw_all` means **all unreserved accounted funds**, and may require a second exit after in-flight transfers finish.
- Clarify 1Click signature semantics: SDK `verifyQuoteSignature()` checks the deterministic signed payload; hashing arbitrary JSON independently is not equivalent to verifying the 1Click signature.
- Remove unverified “TEE-signed per PO”, “hardware-backed”, “fully autonomous scheduled”, “fully audited”, “immutable contract” and fixed fee/latency claims until demonstrated. Mark optional features as deferred rather than built.
- If the deployer FAK is retained, the vault is **upgradeable** and its immutable-by-current-code invariants depend on trusted upgrade custody. Disclose this explicitly.

## Release gates

| Gate | Status | Evidence needed |
| --- | --- | --- |
| G0A — Design sign-off | **COMPLETE — 2026-11-02** | Supplied approval record; all R-01–R-13, policy maxima, scope, MIT and planned tracks incorporated here. |
| G0B — Operational identity and action authorization | **OPEN** | Owner-supplied identities/control, destinations, custody, operator/hosting and exact real-fund budget. Specific account/key/wallet/deploy/funding/publication/submission actions remain separately approved. |
| G1 — Local safety | **OPEN** | Auth, hard limits, accepted/refunded/forced deposits, immutable PO/route, reservations/withdrawals, UTC rollover/late callbacks, failures, quote tampering and injection tests; property/invariant cases and Sandbox mock FT. |
| G2 — Release | **OPEN** | Isolated profile/manifest, independently verified chain/token/decimals/storage/assets, six-decimal conversions, dependency/secret scan, exact release Wasm, wallet ABI and UX. No live funds yet. |
| G3 — Tiny same-chain smoke | **OPEN / EXACT APPROVAL REQUIRED** | At most approved initial 5 USDC; 1 USDC auto-payment, distinct pending/approval within hard limits, unknown-supplier block, guardian pause, treasury exit and reconciliation. Larger auto-threshold examples need separately approved cap/funding increases. |
| G4 — Base smoke | **OPEN / EXACT APPROVAL REQUIRED** | Exact Base recipient, signed quote, deposit, fees, refund and expiry reviewed; source dispatch plus independently verified Base receipt or treasury refund; no blind retry. |
| G5 — Judge-ready / submission | **OPEN** | Reproducible public guide, actual deployment/tool-call evidence, honest two-minute demo, explorer links and trust limits; publication and exact final payload separately approved. |

## Ordered implementation tasks

### MN-00 — Reconciliation and design sign-off — COMPLETE

- [x] Incorporate the supplied approval record's R-01–R-13, policy, invariants, corrections, scope, gates and deferrals.
- [x] Accept Base-first settlement, guardian, separate committer/requester, ID-only same-chain agent requests, manual NEAR AI Cloud operation and verified-only claims.
- [x] Record MIT and the three planned tracks; keep live organizer validation and publication pending.
- [x] Close/supersede the prior design/prototype documents and make this the primary authority.

**Verification:** Source digest and decision coverage checked; legacy documents point here. **G0A is complete; G0B remains open.** Operational identities and exact action approvals were not part of design sign-off.

### MN-01 — Isolate profiles, assets, state and exact amounts

- [x] Keep testnet/CCTEST configuration and database unchanged; add a separate fail-closed mainnet manifest binding chain/RPC identity, token/decimals, vault, treasury, roles, database and explorers. **Local candidate manifest and v2 loader; deployment identities remain null until G0B. Prototype startup rejects mainnet before touching SQLite.**
- [ ] Independently verify the native Circle NEAR USDC candidate `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1` against current official registry and live `ft_metadata`, chain, supported 1Click asset and token storage. It is not an approved/funded deployment value yet. **Circle, live mainnet/metadata (six decimals), and storage bounds verified on 2026-11-02. Live 1Click listing unavailable (HTTP 521/403); actual account registrations await G0B. See [evidence and rerun instructions](docs/mainnet-profile.md).**
- [x] Implement integer six-decimal conversions and new 1–5 USDC smoke fixtures, then a reviewed 6.20 USDC scenario. Start at 5–8 synthetic items / 3 suppliers. Never migrate or reinterpret CCTEST payment records. **Six local synthetic items / three suppliers, exact draft amounts; 6.20 arithmetic reviewed locally and marked for later ceiling/funding approval. No execution authorization.**
- [x] Verify wrong-network/token/decimals/profile combinations fail before signing; keep current pins until compatibility/security checks justify changes. **Local client/manifest regression tests; package/lock/toolchain pins unchanged.**

**Verify:** Profile isolation and amount boundary tests pass: **151 tests / 26 files**, backend typecheck and emitted TypeScript build pass in an isolated clean locked install with Node 24.21.0 / npm 12.2.1. [Local evidence](docs/mainnet-local-verification-2026-11-02.json) and external checks are tracked in [the MN-01 guide](docs/mainnet-profile.md). **MN-01 remains open for outstanding external verification.** **Depends:** MN-00. Names/control are supplied through G0B before operational use.

### MN-02 — Implement hard policy, treasury deposits and accounting

- [x] Replace prototype cap meanings with the approved fields, current limits and immutable 25/25/50 USDC maxima. Approval bypasses only the 10 USDC auto threshold; daily exhaustion waits for capacity. **Local separate v2 contract.**
- [x] Start accepted-deposit ceiling at 5 USDC. Accept only canonical token + treasury + exact deposit message via `ft_transfer_call`; return unused/excess amounts. Reject/refund wrong token, sender or message. **Local unit/Sandbox evidence.**
- [x] Track accepted/accounted funds separately from actual `ft_balance_of`; quarantine unsolicited plain transfers without increasing spendable funds. Do not promise an absolute holdings cap or impose an unapproved lifetime budget. **Local contract and Sandbox balance reconciliation; UI remains MN-07.**
- [x] Reserve payment/withdrawal balances and daily capacity atomically; count combined routes and in-flight dispatches in their original UTC-day buckets. Definitive failure releases once; ambiguous outcomes freeze/reconcile. **Local unit/journal/Sandbox evidence.**
- [ ] Test exact 10, 10.000001, 25, 25.000001 USDC, overflow, overlapping approvals, partial refunds, unsolicited deposits, midnight and callbacks after midnight.

**Verify:** Unit/property/invariant cases and Sandbox prove limits under admin approval and no double spend. **Depends:** MN-01. **Gate:** G1.

### MN-03 — Complete admin/guardian, treasury recovery and events

**Local implementation update:** Human/backend rotation, bounded views, semantic events and regression cases are implemented locally. The owner reports backend and unit/Sandbox checks passed; raw output was not supplied. Live role/custody and release verification remain open. See [MN-03/MN-04 implementation and verification commands](docs/mainnet-roles-commitments.md).

- [x] Add independent pause-only guardian. Require authorized predecessor + one yocto for admin privileged mutations/approval/withdrawals and admin/guardian pause. Keep zero-deposit agent/committer entrypoints with separate storage provisioning. **Local v2; public guardian identity/custody still pending.**
- [x] Implement fixed-treasury withdrawal and `withdraw_all`: pause first, transfer only unreserved accounted funds, reserve withdrawals, handle failures and subsequent exit after in-flight operations settle. Never claw back dispatched transfers. **Local unit/Sandbox evidence.**
- [x] Implement role rotation/revocation, bounded state views and NEP-297 deposit/refund, policy, roles, pause, approval, dispatch/failure and withdrawal events for audit reconciliation. **Prepared: paused two-step admin transfer, guardian rotation, atomic backend rotation/revocation, fixed treasury, bounded lookups and semantic events. Refund-request events do not assert receipt settlement. Local checks passed according to the owner.**
- [x] Test non-admin/FC-key rejection, missing yocto, guardian cannot unpause/approve/withdraw, treasury mismatch, concurrent reserves, failed/repeated exits and restored failed-withdrawal reservations. **Unit/Sandbox regressions added, including an actual local FC key and all private callbacks; owner reports the local suites passed.**

**Verify:** Auth, callback privacy and emergency exit drills pass in Sandbox. **Depends:** MN-02. **Gate:** G1.

### MN-04 — Preserve canonical PO and route commitments

**Local implementation update:** All four implementation areas below are prepared; the owner reports local backend and unit/Sandbox checks passed. Actual custody/OS isolation and live release verification remain open. The v2 contract state/Base destination ABI changes require fresh Sandbox artifacts, not an automatic migration or deployment. [Implementation, trust boundaries and commands](docs/mainnet-roles-commitments.md).

- [x] Bind profile/chain, PO ID, supplier, token, atomic amount, destination type, immutable route ID + version/hash and invoice digest at commitment. Identical requests are idempotent; conflicting reuse fails. **Prepared: strict canonical schema, onchain Base route hash, shared hash vector and immutable-field regressions; local checks passed according to the owner.**
- [ ] Keep separate committer/requester processes and credentials; document compromise of both as a trust boundary. Validate commitments independently of LLM/supplier text. **Prepared: isolated per-invocation workers, single-role credentials, trusted supplier/route validation and documented host-compromise boundary. Actual custody/OS isolation remains G0B.**
- [x] Require exact-method restricted FC keys, zero deposit, allowance checks and verified chain before every backend signature; no admin/recovery keys in app, web or CI. **Prepared: live profile/role/key checks and regression cases for FullAccess, wrong/duplicate methods, revoked roles and mismatched treasury; local checks passed according to the owner.**
- [x] Define quote-refresh attempt IDs referencing an immutable PO, and durable database/contract reconciliation across lost responses/crashes; never silently mutate PO/route identity or blindly retry an ambiguous transfer. **Prepared: immutable cross-attempt PO binding and persistent Sending/Ambiguous/Confirmed operation journal; canonical observations reconcile without fabricating transaction hashes. Local checks passed according to the owner.**

**Verify:** Injection, changed fields, duplicate IDs, route changes, wrong permissions and lost-RPC regressions. **Depends:** MN-01/02/03. **Gate:** G1.

### MN-05 — Implement signed quotes and Base route approval

**Local implementation update:** Separate adapter, pinned SDK verification/evidence, full canonical quote-field checks, unsigned review summary and final review-artifact revalidation are prepared. Base approvals additionally bind the complete onchain commitment/attempt/native budget through `expected_commitment_hash`; this fresh v2 ABI requires rebuilt artifacts and updated wallet integration. Short TypeScript typechecking and Rust formatting/parsing pass; the owner reports full backend/unit/Sandbox checks passed, without captured output/counts. [MN-05 implementation, trust limits and test commands](docs/mainnet-signed-quotes.md). No live provider quote, wallet signing or deposit was performed.

- [ ] Build a new real-settlement adapter, retaining preview code and testnet mocks unchanged. Resolve live native NEAR USDC → Base USDC assets from supported listings.
- [x] Use SDK-supported cryptographic verification of the exact deterministic signed payload; pin/review its signer trust source. Persist canonical signed bytes and verified request/response, quote ID/hash, deposit address, expiry, min output, fees, destination chain/asset/recipient and treasury refund. **Prepared: SDK 0.1.26 root pin, exact signed-byte/signer persistence and metadata substitution regressions. Provider correlation ID is informational; cryptographic identity is separate. Runtime local checks passed according to the owner.**
- [ ] Commit quote/route identity immutably against the PO. Reject unknown/inactive/changed routes, invalid deposit addresses and expired approvals; cross-chain always stays pending human approval.
- [ ] Revalidate before human signing and dispatch. Test signature tampering, recipient/refund substitution, expiry, changed route version/hash and review-to-sign races. Hashing arbitrary JSON is not signature verification. **Prepared: complete onchain commitment comparison, signed minimum-output/deadline checks, fee/loss bounds, fresh unsigned review and exact artifact revalidation; wallet wiring remains MN-07. Local checks passed according to the owner; live wallet integration remains open.**

**Verify:** Deterministic fixtures fail closed without a deposit; trust limitations explicit. **Depends:** MN-03/04. **Gates:** G1/G2 before G4.

### MN-06 — Implement dispatch, settlement and refund recovery

- [ ] Register the reviewed deposit address on the canonical token using live storage bounds and an explicitly reviewed NEAR budget; transfer only after successful registration and human approval.
- [ ] Represent Draft, Committed, PendingApproval, Approved, Registering, Dispatching, Dispatched, Settled, Refunded, Expired, Failed and Blocked as statuses or explicit substates. Expiry applies before dispatch, not retroactively to sent funds.
- [ ] Source transfer success means Dispatched. Independently verify destination receipt before Settled and treasury receipt before Refunded; label external verification as backend-verified, not a contract-proven oracle result.
- [ ] Reconcile polling, timeouts, restarts and ambiguous transfers durably; never send twice. Test registration/transfer/callback failure, expired approval, duplicate updates, refund and lost-RPC cases.

**Verify:** Offline/Sandbox state machine and reconciliation pass; no live execution before exact approval. **Depends:** MN-05. **Gate:** G4 for actual Base smoke. Arbitrum/Solana deferred until Base receipt/refund tests pass and scope is revisited.

### MN-07 — Update human wallet ABI and mainnet UI

- [ ] Show profile/network, six-decimal native USDC, actual versus accounted/spendable funds, auto versus hard limits, treasury/guardian and honest status/explorer links.
- [ ] Implement agreed one-yocto ABI and complete quote review (recipient/route, chain/asset, input, fees, min output, expiry, refund and quote identity), with immediate revalidation before explicit signing.
- [ ] Carry forward the native-modal handoff fix and bounded waits; observe unresolved wallet responses without automatic retry. Never sign on mount, connection, quote refresh or an agent call.
- [ ] Verify desktop/mobile and keyboard/focus, loading/error, wrong account/network, cancel/redirect/failure, quote changes and actual chosen wallet/hardware compatibility.

**Verify:** Wallet/UI regression cases first with local fixtures; later human wallet tests only after specific approval. **Depends:** MN-03/05/06. **Gates:** G1/G2/G0B.

### MN-08 — Implement manual live AI and ID-only same-chain requests

- [ ] Use NEAR AI Cloud as selected provider. Choose the actual model from the current live listing and test tool-call compatibility before pinning; owner supplies credentials locally.
- [ ] Add manual Run tick and narrow `submit_payment(po_id)` for an independently committed same-chain PO. The agent cannot choose payee, amount, chain, route or quote, or approve/edit policy/withdraw/pause.
- [ ] Preserve registered-ID schemas, trusted supplier resolution and untrusted-message boundaries. Produce a real provider/tool-call trace or clearly label deterministic fallback; do not claim fallback as LLM autonomy.
- [ ] Keep unattended scheduling and TEE/DCAP/privacy badges/claims deferred. Test missing credentials, provider failures and injection scenarios.

**Verify:** Local orchestration and real provider compatibility evidence under approved configuration; no live account/payment side effects without exact approval. **Depends:** MN-04 and approved manual scope. **Gates:** G1/G2; provider/model operational choice remains open.

### MN-09 — Release security, license and reproducible artifacts

- [ ] Recheck CC-14 npm/Rust advisory deferrals, compatible fixes, secret/history scan and existing wallet safety regressions. Preserve explicit dispositions; no forced incompatible overrides or suppressed audit findings.
- [ ] Prove clean-clone tests and reproducible release hashes in the pinned build environment; verify deployed bytes separately. Add CI quality gates without automatic deployment.
- [ ] Implement authenticated, authorized and rate-limited manual-tick/payment APIs, TLS/headers, request limits and operational audit/event reconciliation before public exposure.
- [ ] Add the approved MIT license using the confirmed copyright identity; retain only approved third-party notices. Define fresh mainnet state or a separately reviewed/tested vault migration; SQLite migration is not contract-state migration.

**Verify:** Mainnet-local safety suites, release security review, locked dependencies, license and exact artifact/revision evidence. **Depends:** MN-02–08. **Gates:** G1/G2.

### MN-10 — Operational identities, custody and exact transaction package

- [ ] Owner supplies/control-proves mainnet parent/vault/admin/treasury/committer/agent/guardian/suppliers and Base destination/refund account. Proposed historical names are not proof of availability or ownership.
- [ ] Confirm actual wallet provider/hardware support, admin/treasury wallet custody, offline/cold deployer recovery, isolated FC-key processes, operator/hosting/domain/auth and shutdown arrangements.
- [ ] Retain/disclose controlled upgrade authority during judging; review later key/shutdown policy separately. Never automatically delete recovery/deployer keys.
- [ ] Obtain exact owner-approved NEAR storage/gas and USDC-at-risk budgets. Prepare exact accounts/artifacts/init/policy/registration/funding/payment/fee packages for separate approval; keep initial accepted ceiling at 5 USDC unless a later reviewed increase is approved.

**Verify:** Read-only availability/control evidence and complete human-reviewable package; no creation/signing/funding/public exposure implied. **Depends:** MN-03/09. **Gate:** G0B remains open until actual evidence/approvals exist.

### MN-11 — Execute separately approved same-chain and Base smoke

- [ ] After exact approval: deploy/init/register/fund only reviewed identities/artifacts; verify final receipts, code, metadata, policy and balances. Stop on mismatch; no automatic resend.
- [ ] Within the approved initial 5 USDC budget, demonstrate 1 USDC automatic same-chain payment. Demonstrate a distinct pending→approval path within hard limits; an above-10 USDC example needs separately approved ceiling/funding increases. A small Base PO is always pending regardless of amount.
- [ ] Verify 4 USDC unknown-supplier rejection and, optionally, a separate 40 USDC allowlisted hard-limit rejection. Label compromised-committer/backend scenarios honestly; the real agent accepts only PO ID.
- [ ] Prove guardian pause, fixed-treasury unreserved emergency exit and post-callback reconciliation. Separately approve one Base payout with exact signed quote, route, refund, fees/expiry; verify both-chain receipt or treasury refund.

**Verify:** G3/G4 receipts, balances/reservations, costs, source/destination evidence and human-selected final paused/withdrawn state. **Depends:** MN-10 and exact action approvals. No live action is complete merely because this task exists.

### MN-12 — Judge guide, honest claims and demo evidence

- [ ] Update README, status and two-minute video from actual verified results, using the approved small-scale sequence below. Keep synthetic identities and upgrade/1Click trust assumptions explicit.
- [ ] Show actual live model/tool-call evidence or labeled fallback. No unverified TEE, hardware custody, full audit, immutability, scheduled autonomy, fixed fee/latency or settlement claims.
- [ ] Provide fresh-clone numbered judge steps and verified mainnet/source/destination links; recheck current official rules, token/model listings and costs instead of copying historical labels.

**Verify:** Each feature/claim maps to observed evidence; account ownership, successful payment and mainnet readiness are not inferred from MN-00. **Depends:** MN-11. **Gate:** G5.

### MN-13 — Human publication/submission and post-demo exit

- [ ] Validate current organizer form, deadline, track IDs, single-versus-multiple-track rules, exact consent and one-repository submission policy. Planned tracks are Real-World Money, Autonomous Business, AI Security & Defense; Privacy only if proven.
- [ ] Collect all human submission fields/links, release revision, MIT copyright identity, public repo and human X demo post. Print exact complete payload and await explicit approval; publication/push/social post/submission are separate actions.
- [ ] Agree final paused/withdrawn state and upgrade/recovery key policy after the event; execute only specifically approved operations. Closing the old CC-16 record performs no submission.

**Verify:** Human-reviewed factual payload, consent, publication approvals and actual shutdown receipts where authorized. **Depends:** MN-12, G0B and G5.

## Approved small-scale demo sequence

1. Show synthetic stock low → deterministic forecast → live LLM drafts a canonical PO → independent committer writes immutable PO → agent calls `submit_payment(po_id)` → a **1 USDC** same-chain transfer, explorer evidence.
2. Show a second committed PO above the 10 USDC *auto* threshold (only after increasing available vault funding by explicit approval), pending human approval; or show a smaller Base PO that is pending because **all cross-chain payouts require human approval**.
3. Show signed 1Click Base quote, reviewed route/recipient/refund, wallet approval, NEAR `Dispatched` and verified Base `Settled` or `Refunded`.
4. Show **4 USDC unknown supplier** rejection and, separately if useful, **40 USDC allowlisted supplier** hard-limit rejection; show why the real agent cannot directly specify a rogue recipient.
5. Show guardian pause, unreserved treasury-only emergency withdrawal, and a concise limitations/upgrade-trust disclosure.

## Open operational inputs — G0B remains open

**Current parent selection:** The owner replaced the Ledger-based `carecart.near` plan with **`carecartxyz.near`** to avoid the Ledger workflow. Public existence/control, wallet app and CLI signing access for the new parent remain unverified. Proposed children now use `*.carecartxyz.near`; prior Ledger/Meteor details are not carried over as custody evidence. [G0B roster](docs/mainnet-identities.md) and [creation plan](docs/mainnet-account-creation-plan.md) track the change. No account creation, key change or funding is authorized merely by selecting this name.

**Receiver identities supplied:** Base `0x52F016116508986c6ef2419266075cD7C4C01434`; Solana `Hxt3bDQ7Ag8ZASUxAFFrK2sbTHpRGTY6zsbshLg5D3JT`. The owner reports local private-key storage in ignored `.env` (confirmed ignored/untracked, mode 0600). The local EVM key derives the supplied Base address; no private values were printed and no signing/transfer occurred. Control of the current NEAR parent, remaining identity/custody inputs and Solana key matching remain unverified. Base remains the approved cross-chain launch destination; recording Solana does not expand settlement scope or authorize signing/transfers. Receiving-wallet private keys are unnecessary in the backend-loaded `.env`; their custody separation remains to be settled with the owner.

NEAR AI Cloud is already selected at G0A. The open AI input below means the actual tested model, credentials and provider compatibility; it does not reopen the selected provider or authorize API use with unspecified credentials.

- **Account names/control:** mainnet parent, vault, admin, treasury, committer, requester/agent, guardian, synthetic supplier accounts, Base destination, refund account. Proposed names in DESIGN are not proof of availability or ownership.
- **Wallet custody:** actual wallet provider and tested hardware support, deployer FAK storage and recovery arrangement.
- **Money:** owner-approved NEAR for storage/gas, maximum USDC at risk, smoke payment amounts, when/if accepted cap rises above 5 USDC.
- **AI:** chosen live provider/model after tool-call compatibility test, API credentials, deterministic fallback labeling.
- **Ops:** public hosting domain, authentication and operator identity for manual-tick/payment APIs.
- **Publication:** MIT is accepted and planned tracks are Real-World Money, Autonomous Business and AI Security & Defense, subject to current organizer rules; exact repo/X/form content, any required single-track choice and shutdown state still require review and separate approval.

## Next work

1. Review owner-run **MN-03/MN-04** unit/backend/Sandbox outputs for the prepared local changes. Finish **MN-01** live 1Click asset verification and, once G0B supplies identities, account-registration checks before operational release. MN-02's remaining verification also stays open; local source work does not bypass dependency or release gates.
2. Implement MN-05–MN-09 under the approved trust boundaries and G1/G2 checks. Keep preview adapters and testnet evidence intact.
3. Resolve MN-10/G0B with the owner before any operational account, wallet/key, budget, real-fund, deployment or public action. MN-11 and publication/submission remain separately approved execution gates.

No mainnet implementation, account ownership, live provider/model compatibility, custody, real-fund budget or submission is certified by the approval record. This documentation handoff changes no runtime configuration, key, contract or deployment.

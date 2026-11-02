# CareCart — MN-00 Mainnet Reconciliation Decision Record

**Status: APPROVED — MN-00 design sign-off | 2026-11-02 (UTC)**

**Approval record:** The project owner explicitly accepted the recommended R-01–R-13 reconciliation and launch scope in this conversation on 2026-11-02. This records design-level acceptance only. It does **not** certify implementation, test results, account ownership, live provider compatibility, wallet custody, real-fund budget, or organizer submission. No signature artifact, wallet signature, or transaction authorization is implied.

**Decision authority:** For mainnet implementation, this signed-off decision record governs when it conflicts with the older target statements in `DESIGN.md`. `mainnet-todo.md` remains the implementation checklist and must be brought into alignment. Preserve the testnet prototype and its evidence without reinterpreting it as mainnet validation.

**Sources:** `DESIGN.md` (mainnet target), `mainnet-todo.md` (implementation gap/backlog). `implementation.md`, `todo.md`, `docs/handoff.md`, and CC-15 are referenced by the backlog but were not supplied for independent code verification. Therefore no current implementation, test, account ownership, or deployment claim is certified by this record.

## Outcome and launch scope

**Approved launch scope:** NEAR mainnet native Circle USDC; synthetic hospital procurement; deterministic stock forecast; live LLM-assisted PO drafting where available; immutable PO commitments; automatic ID-only *same-chain* requests; human-reviewed *Base* USDC payout through 1Click; onchain security rejection and emergency exit; verified source and destination transaction evidence.

**Approved deferrals:** Arbitrum and Solana settlement, scheduled unattended runs, full TEE/DCAP attestation claims, elaborate analytics, streaming agent console, full 25-item dataset if it delays the end-to-end flow. A deterministic fallback may support the demo, but must not be represented as LLM autonomy.

**Never infer approval:** no accounts/keys, mainnet transaction, wallet connection, deposit, API publishing, repository publishing, or hackathon submission is authorized by this document.

## Approved reconciliation decisions (R-01–R-13)

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

## Contract invariants — implement before live funds

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

## Critical corrections to DESIGN.md before implementation

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

## Implementation and release gates

**G0A — Design sign-off: COMPLETE (2026-11-02).** Owner accepted R-01–R-13, Base-first settlement, guardian, manual AI operation, ID-only same-chain requests, 10/25/25 USDC policy, initial 5 USDC accepted-deposit ceiling, 50 USDC absolute ceiling, MIT license and planned track focus. **This is a scope/policy decision, not a deposit or spending approval.**

**G0B — Operational identity and transaction authorization: OPEN.** Owner must separately identify and verify wallets/treasury/guardian/committer/agent, NEAR and Base destinations, custody/recovery, hosting/operator, exact real-fund budget and any intended onchain actions. No account creation, deployment, funding, signing or publication until the relevant exact action is approved.

**G1 — Local safety:** all auth, limits, accepted-deposit/refund, forced-transfer, PO idempotency, route-change, reserve/withdraw, day-rollover/late-callback, transfer failure, quote tampering and injection tests pass. Include property/invariant tests and Sandbox with mock FT.

**G2 — Release:** isolated mainnet manifest, verified token metadata and chain, native six-decimal conversions, dependency/secret scan, verified release WASM, wallet ABI and admin UX; no live funds yet.

**G3 — Separately approved tiny NEAR smoke:** owner inspects exact account/amount/tx package. Fund no more than approved initial 5 USDC. Prove a 1 USDC auto payment, a distinct pending→approved payment within cap, blocked unknown supplier, guardian pause, treasury-only withdrawal and accounting reconciliation. Stop on mismatch.

**G4 — Separately approved Base smoke:** owner approves the exact Base destination, signed quote, source deposit, fees, refund address and expiry. Verify the onchain NEAR dispatch, 1Click status and Base receipt (or verified treasury refund). Never blindly retry an ambiguous deposit.

**G5 — Judge-ready:** public reproducible README, working deployment, 2-minute honest demo, mainnet explorer links, known trust limitations, live tool-call evidence, no fake TEE or settlement claim. Submit only after owner reviews exact public payload.

## Demo sequence that remains accurate at small scale

1. Show synthetic stock low → deterministic forecast → live LLM drafts a canonical PO → independent committer writes immutable PO → agent calls `submit_payment(po_id)` → a **1 USDC** same-chain transfer, explorer evidence.
2. Show a second committed PO above the 10 USDC *auto* threshold (only after increasing available vault funding by explicit approval), pending human approval; or show a smaller Base PO that is pending because **all cross-chain payouts require human approval**.
3. Show signed 1Click Base quote, reviewed route/recipient/refund, wallet approval, NEAR `Dispatched` and verified Base `Settled` or `Refunded`.
4. Show **4 USDC unknown supplier** rejection and, separately if useful, **40 USDC allowlisted supplier** hard-limit rejection; show why the real agent cannot directly specify a rogue recipient.
5. Show guardian pause, unreserved treasury-only emergency withdrawal, and a concise limitations/upgrade-trust disclosure.

## Open owner-specific choices (do not invent)

- **Account names/control:** mainnet parent, vault, admin, treasury, committer, requester/agent, guardian, synthetic supplier accounts, Base destination, refund account. Proposed names in DESIGN are not proof of availability or ownership.
- **Wallet custody:** actual wallet provider and tested hardware support, deployer FAK storage and recovery arrangement.
- **Money:** owner-approved NEAR for storage/gas, maximum USDC at risk, smoke payment amounts, when/if accepted cap rises above 5 USDC.
- **AI:** chosen live provider/model after tool-call compatibility test, API credentials, deterministic fallback labeling.
- **Ops:** public hosting domain, authentication and operator identity for manual-tick/payment APIs.
- **Publication:** MIT is accepted and planned tracks are Real-World Money, Autonomous Business and AI Security & Defense, subject to current organizer rules; exact repo/X/form content, any required single-track choice and shutdown state still require review and separate approval.

## Reference checks (2026-11-02; recheck before signing)

- Circle native USDC NEAR contract registry: https://developers.circle.com/stablecoins/usdc-contract-addresses
- NEAR Intents 1Click signed-quote guide (SDK `verifyQuoteSignature()`, SDK >= 0.1.24): https://docs.near-intents.org/integration/distribution-channels/1click-api/verify-quote-signature
- NEAR Intents FAQ (no testnet deployment): https://docs.near-intents.org/resources/faqs
- NEAR 1-yocto security pattern: https://docs.near.org/smart-contracts/security/one_yocto
- NEAR function-call key restrictions: https://docs.near.org/protocol/accounts-contracts/access-keys
- Hackathon site (deadline, public repo + X demo + one submission): https://nearhackathon.com

**Final MN-00 status: APPROVED FOR IMPLEMENTATION PLANNING — 2026-11-02 (UTC).**

**Next permitted work:** MN-01–MN-04 implementation, local testing, configuration isolation, and non-transactional verification in dependency order. Continue MN-05–MN-09 only under the approved trust boundaries and test gates. **MN-10 identities/custody and MN-11 mainnet actions remain separately gated.**

**Explicitly  authorized:** creating or controlling accounts on the owner's behalf, wallet connection/signing, mainnet deployment, real USDC or NEAR transfers, public API exposure, publishing the repository/post, or final hackathon submission. Each requires a specific subsequent approval.

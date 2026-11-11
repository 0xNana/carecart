# Implementation Plan: CareCart — COMPLETED / ARCHIVED

**Status:** Closed historical prototype plan, 2026-11-02. [mainnet-todo.md](../mainnet-todo.md) is the primary implementation authority; MN-00/G0A is approved from the supplied decision record. Historical task/decision statements below do not override it. Unverified work is carried forward there, not certified here.

## Overview

Build a reproducible, testnet-first procurement prototype for the NEAR Hackathon `realworld` track. Synthetic inventory flows through a deterministic forecast, supplier quotes, purchase order, and a policy-checked payment request. The NEAR vault—not the agent or backend—enforces payment policy.

The web app now provides the responsive CC-10 procurement dashboard, including inventory, backend forecasts, quote generation, PO drafting, and expandable audit details through an allowlisted server proxy. The backend now has typed domain records, versioned SQLite migrations, registry-based IDs, deterministic synthetic fixtures, inventory and forecast reads, simulated quotes, idempotent purchase-order creation, and a deterministic agent task service and guarded ID-only payment adapter. Agent tools accept strict registered-ID arguments and cannot set supplier, amount, payment, or policy fields. Supplier messages remain separate untrusted data. Provider settings are server-side and disabled while CC-00 is pending. The vault has policy configuration, supplier/committer/requester roles, immutable PO commitments, guarded payment requests, capacity reservations, private settlement callbacks, and payment views. The test-only token, Sandbox lifecycle test, workspace tests, WASM check, both contract artifact builds, and CC-05 through CC-09 backend tests pass; the Sandbox lifecycle also exercises the backend HTTP payment route using restricted keys. The closed `todo.md` preserves the historical CC-series tasks; `mainnet-todo.md` owns ongoing work.

CC-12 adds an offline cross-chain simulator and optional dry-only market quotes without deposit or settlement operations. Future mainnet settlement remains separate work.

CC-11 adds testnet-only wallet controls, read-only vault/payment views, and explicit transaction review. Local fake-wallet checks and automated safety tests pass; the approved CC-15 CLI deployment is verified; live browser-wallet signing remains unverified. Public account and key setup is recorded in `docs/testnet-accounts.md`.

CC-13 verifies the numbered README path from a clean clone of the current source snapshot: independent installs/build output, a fresh synthetic database, browser/API outcomes, and the full local Sandbox payment path. Evidence is in `docs/judge-verification.md`; the later approved CC-15 deployment is recorded separately in `docs/testnet-deployment.md`.

## Architecture decisions

- Rust contracts share the `contracts/` Cargo workspace and lockfile. The test-only NEP-141 token is a separate member crate.
- `backend/` and `web/` remain separate npm projects because they do not share TypeScript packages.
- Inventory, suppliers, quotes, and usage data use deterministic synthetic fixtures only. Atomic amounts are `bigint` in the domain and canonical decimal text in SQLite; never convert them to floating-point values.
- NEAR testnet is the first deployment target. The test token address must come from a verified deployment/metadata result.
- NEAR Intents has no testnet deployment; use a mock adapter and optionally `dry: true` 1Click quote previews. Do not imply or initiate cross-chain settlement.
- Agent tools accept registered IDs and schema-validated arguments. The backend resolves payment amount/payee from stored purchase-order data; the vault independently enforces policy.
- Supplier messages are kept as untrusted data and cannot alter the fixed tool registry or instructions. Live provider use requires the unresolved CC-00 human choice and selected model.
- PO commitment boundary (resolved in CC-00A): the admin grants a dedicated committer role. That role writes `po_id -> supplier_id/token_id/amount` once; a payment request accepts only the ID. The agent cannot commit or rebind the record. Both backend keys are function-call keys restricted to their single vault method. A human-controlled admin funds the contract PO storage reserve so backend commitments attach zero deposit. The client checks the actual RPC chain ID and key permission before signing.
- Policy decision semantics: valid, funded requests inside per-order, UTC-day, and cumulative token spending caps are eligible for automatic payment. Cap excess routes to human approval. Paused, missing, unlisted, invalid, and insufficient-fund requests are blocked. Request state is keyed by the immutable PO ID, which also provides idempotency. Capacity is reserved before transfer and settled/released in a private callback.
- Do not claim TEE/privacy properties unless implemented and verified. They are outside the first scope.
- `.env` stays local and ignored. Full-access keys remain in the human wallet/CLI keychain; no key or API secret goes in frontend configuration or source control.

## Dependency order

```text
PO commitment boundary → vault invariants → policy/payment callbacks → test token/Sandbox
                                                ↓
Synthetic domain/storage → forecast and quotes → PO → constrained agent
                                                ↓
                                backend payment adapter
                                                ↓
                        dashboard → wallet/policy UI
                                                ↓
            preview-only cross-chain → judge flow → release review
                                                ↓
                 human-approved testnet deployment → submission review
```

The backend's deterministic local flow can proceed while human deployment details remain unanswered. The human supplied the reviewed deployment approval; both testnet contracts and all setup transactions are verified. Remaining live wallet/payment tests need their own explicit review/authorization.

## Checkpoints

1. **Vault:** policy/payment tests, the NEP-141 Sandbox flow, workspace WASM check, and both contract artifact builds pass.
2. **Procurement:** CC-05 domain/storage/seed through CC-09 payment integration are implemented and tested. CC-00 still blocks live LLM configuration.
3. **Judge flow:** README steps work from a fresh clone; payment statuses are visible; cross-chain display is preview-only.
4. **Release:** dependency advisories are triaged, secrets are absent, and testnet actions have human approval before signing.

## Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Generated auction code is mistaken for the CareCart vault | Unsafe or misleading behavior | The generated auction state has been replaced by the policy vault and focused Rust tests. |
| An authorized committer changes a PO after approval | The backend could redirect a later payment | The contract accepts each PO ID exactly once and derives future transfer fields from that record. |
| Agent invents a supplier, amount, or destination | Unauthorized payment | Accept only registered IDs; derive fields from stored records; enforce policy again in the contract. |
| Transfer promise fails after state changes | Incorrect payment status or lost capacity | Reserve state first, use private callbacks, handle every result, and test failure paths. |
| Testnet token/account details are guessed | Wrong asset or unauthorized action | Obtain values from the human or verified metadata; stop before deployment until approved. |
| NEAR Intents is mistaken for testnet settlement | False payment claim | Use a mock adapter and dry quote only; label every result preview/simulation. |
| Dependency advisories remain in local lint/test tooling | Deferred supply-chain exposure | CC-14 records the minimatch and Rust test-tree findings in `docs/security-release.md`; recheck by Nov 9 or before CC-15/public release. Standard Wasm allocator removes wee_alloc. |
| Submission or public-release action consumes the one attempt or publishes without review | Irreversible hackathon outcome | Print the full payload, wait for explicit yes, and require separate confirmation for posting/publication/push. |

## Open decisions

- Testnet namespace/account selection is resolved: `carecart.testnet`, with human admin `admin.carecart.testnet`; live browser-wallet ownership remains to be verified.
- Testnet demo token source is resolved: in-repo CCTEST deployed/metadata verified at `token.carecart.testnet`.
- Whether to use NEAR AI Cloud and which live-listed model to select.
- Repository license before public release.
- The selected `committer.carecart.testnet` and `agent.carecart.testnet` have restricted keys; their vault roles are now granted by FINAL successful setup transactions; backend keys are now configured only in ignored owner-only `.env.testnet`, with an isolated supplier-mapped database. Browser-wallet signing and the prepared PO payment remain pending.

The task list is in the root [`todo.md`](../todo.md), as requested.

CC-14 checks passed from a fresh local snapshot clone. Dependency audits retain documented findings; see `docs/security-release.md`. No public deployment or signing occurred.

CC-15 review tooling is implemented in `scripts/deploy-testnet*` with exact hashes/commands in `docs/testnet-deployment.md`. The human-approved twelve testnet setup transactions completed with FINAL success and the vault remains paused. Live browser-wallet and PO payment verification remains pending. CC-16 engineering handoff is `docs/handoff.md`; proposed mainnet decisions/tasks are in `mainnet-todo.md`. The approved primary `mainnet-todo.md` supersedes the archived DESIGN and this plan. Keep prototype evidence/defaults intact while implementing its accepted requirements.

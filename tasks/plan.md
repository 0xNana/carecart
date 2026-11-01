# Implementation Plan: CareCart

## Overview

Build a reproducible, testnet-first procurement prototype for the NEAR Hackathon `realworld` track. Synthetic inventory flows through a deterministic forecast, supplier quotes, purchase order, and a policy-checked payment request. The NEAR vault—not the agent or backend—enforces payment policy.

The web app is still a Next.js starter. The backend has typed domain records, a versioned SQLite schema, registry-based IDs, and deterministic synthetic seed data, but no API yet. The vault has policy configuration, supplier/committer/requester roles, immutable PO commitments, guarded payment requests, capacity reservations, private settlement callbacks, and payment views. The test-only token, Sandbox lifecycle test, workspace tests, WASM check, both contract artifact builds, and CC-05 backend tests pass. `todo.md` is the ordered task list for the remaining work.

## Architecture decisions

- Rust contracts share the `contracts/` Cargo workspace and lockfile. The test-only NEP-141 token is a separate member crate.
- `backend/` and `web/` remain separate npm projects because they do not share TypeScript packages.
- Inventory, suppliers, quotes, and usage data use deterministic synthetic fixtures only. Atomic amounts are `bigint` in the domain and canonical decimal text in SQLite; never convert them to floating-point values.
- NEAR testnet is the first deployment target. The test token address must come from a verified deployment/metadata result.
- NEAR Intents has no testnet deployment; use a mock adapter and optionally `dry: true` 1Click quote previews. Do not imply or initiate cross-chain settlement.
- Agent tools accept registered IDs and schema-validated arguments. The backend resolves payment amount/payee from stored purchase-order data; the vault independently enforces policy.
- PO commitment boundary (resolved in CC-00A): the admin grants a dedicated committer role. That role writes `po_id -> supplier_id/token_id/amount` once; a payment request accepts only the ID. The agent cannot commit or rebind the record. Keep the backend committer key separate from the request-only function-call key.
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

The backend's deterministic local flow can proceed while human deployment details remain unanswered. The deployment task is blocked until account, token, and explicit transaction approval are supplied.

## Checkpoints

1. **Vault:** policy/payment tests, the NEP-141 Sandbox flow, workspace WASM check, and both contract artifact builds pass.
2. **Procurement:** CC-05 domain/storage/seed is implemented and tested. The later endpoint, forecast, quote, and PO slices remain to be built and verified.
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
| Web dependency tree has reported moderate advisories | Unreviewed supply-chain exposure | Re-run `npm audit`, inspect fix availability, and document any deferral before release; never force upgrades blindly. |
| Submission or public-release action consumes the one attempt or publishes without review | Irreversible hackathon outcome | Print the full payload, wait for explicit yes, and require separate confirmation for posting/publication/push. |

## Open decisions

- Human-owned testnet admin/deployment account.
- Testnet demo token source: in-repo mock NEP-141 deployment or a verified testnet token.
- Whether to use NEAR AI Cloud and which live-listed model to select.
- Repository license before public release.
- Which human-owned testnet account should receive the committer role during the approved deployment setup.

The task list is in the root [`todo.md`](../todo.md), as requested.

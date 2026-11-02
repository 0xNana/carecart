# CareCart handoff — 2026-11-02

> **Current testnet state (2026-11-02 10:01 UTC):** Payment processing is **Active** (`is_paused=false`) after the human-requested [resume transaction](https://testnet.nearblocks.io/txns/DfKGXzjhZ3h8eMSAKcf5EcJwTbX1ac1gqWjeXBPUJq5f), with FINAL success and zero failed receipts. Vault balance remains 10000 CCTEST. The earlier `po-000002` stays Blocked/Paused; resume does not retry it. Refresh vault to replace an older UI snapshot. [Verification](testnet-resume-verification.json).

Start with [mainnet-todo.md](../mainnet-todo.md), the primary implementation authority. [MN-00 approval](../CareCart-MN-00-APPROVED-2026-11-02.md) is incorporated there: G0A is complete; operational identities/action authorization G0B and implementation/release G1–G5 remain open. DESIGN, implementation, TODO and the old task plan are completed historical records. Their closure does not certify unimplemented work or pending test evidence.

## What is verified

CC-01–CC-14 local implementation and evidence: immutable PO commitments; separate restricted committer/requester keys; testnet chain checks before backend signing; contract policy/reservation/callback paths; deterministic procurement and adversarial supplier-message handling; accessible wallet transaction review; clearly simulated cross-chain output; optional disabled dry-only market quotes; fresh-clone judge path and security review.

Current checks: 64 backend tests, six wallet/RPC cases, four body-limit cases, 21 Rust policy + nine payment + one Sandbox integration test, lint/typecheck/build/Wasm checks. Sandbox exercises the real TypeScript payment route and both contracts. [Judge evidence](judge-verification.md) and [CC-14 evidence/known dependency deferrals](security-release.md) describe the limits. Three deployment-plan safety cases run with `node scripts/testnet-plan.test.mjs`; four CLI preflight cases run with `node scripts/deploy-testnet.test.mjs`.

Both testnet contracts and the twelve approved setup transactions now have verified FINAL success; see [deployment receipts](testnet-deployment-receipts.json) and [canonical paused state](testnet-deployment-verification.json). No live app PO payment, browser-connected-admin ownership proof, real cross-chain quote/deposit/settlement, live inference or TEE verification is established. CC-11's live transaction path remains pending. Existing account creation and key-cleanup receipts are distinct from a contract deployment.

## CC-15 starting point

The human selected `carecart.testnet`; [ten public accounts and key history](testnet-accounts.md) are recorded. The admin is `admin.carecart.testnet`. The vault/token accounts are `vault.carecart.testnet` and `token.carecart.testnet`. No further account creation or duplicate-key cleanup is needed. Never export their full-access/recovery keys into the app.

[Deployment package](testnet-deployment.md): pinned-toolchain artifacts, source digests, public RPC preflight, exact proposed commands, deposits and paused end state. The helper has no signing/broadcast capability. The captured [plan](testnet-deployment-plan.json) is a dated proposal, not authorization or deployed evidence. Contract byte/source changes require a new plan and review. Recheck dependency deferrals before execution. The human explicitly approved the reviewed deployment/setup, which completed after staged metadata verification. The later approved CLI resume is recorded at the top of this handoff. A successful public PO transfer/browser transport remains unverified; do not replay the blocked PO or change testnet pause state as part of mainnet documentation work. Current implementation work starts at MN-01 in the primary checklist.

Public receipts are populated only from actual final execution. Canonical views and both local app read-only vault APIs agree on deployed/paused state and 10000 CCTEST. The two restricted keys and trusted supplier mappings are now configured in the isolated local testnet profile; [readiness evidence and commands](testnet-live-setup.md) describe it. Resume and each live browser-wallet/payment action remain separately reviewed human steps. No bulk “run all” or automatic resend after a timeout.

## Worktree and environment

This handoff includes earlier uncommitted CC-09–CC-14 changes and current CC-15/docs work; it is not a published remote commit. Preserve the shared tree. Before release, review `git status --short` / `git diff`, run checks from a clean snapshot, agree a license and obtain any required commit/push/publication approval. The CC-13/14 clone evidence describes a local source snapshot, not the remote HEAD. Runtime databases, `.env*`, `artifacts/`, `node_modules/` and `.next/` are ignored.

Use Node 24.21.0 / npm 12.2.1 and pinned Rust 1.93.0 / near-sdk 5.29.1. Both npm projects block lifecycle scripts. Follow [README](../README.md) for the no-credential judge flow. The clean verification clones used existing compiler/package caches; their temporary paths are evidence, not dependencies for the next engineer.

The current judge web preview on 3102 uses the configured root backend on 3101 and the isolated `testnet-smoke.sqlite`, preserving the earlier judge clone database. The prepared 1680 CCTEST PO is now committed/requested and Blocked/Paused; no successful public PO transfer is recorded. Keep the direct backend on loopback. It is not an authenticated public payment service. Web configuration contains public IDs only. Provider selection/model and license remain human decisions; model credentials cannot bypass the current provider gate.

## CC-16 review package

CC-16 now includes this engineering handoff and mainnet reconciliation, alongside its original human submission review. These documents are ready to review; the submission is not ready to send.

Missing inputs: current organizer rules/API and track IDs; exact consent wording; human identity/contact and submitting wallet; approved repository URL/visibility/license/release revision; actual demo/video/post links; evidence-backed feature claims. `HACKATHON.md` is absent. Dates, fees, names and track IDs in older planning documents are not current organizer verification.

Do not invent a valid-looking JSON payload for missing fields. Once every field is supplied and validated, print the exact complete payload without credentials and obtain an explicit yes before the one allowed repository submission under the existing repository rule. Separately obtain approval for any push/publication, and leave social posting to the human unless specifically authorized. No payload has been submitted and no public action is authorized by this handoff.

## Wallet UI recovery

A reported endless wallet wait exposed the native review dialog blocking the connector body overlay. The fixed UI closes review only on explicit Continue, adds bounded preflight waits and tracks ambiguous signature results without retry. Nine wallet/RPC tests, production build/lint and an offline browser overlay/rejection regression pass. See `docs/wallet-recovery.md` for evidence and the human-run CLI fallback. No public signing occurred during debugging; a CLI success must not be relabeled as verified browser signing.

A later canonical check found `po-000002` committed/requested while paused: `Blocked` / `Paused`, vault balance unchanged at 10000 CCTEST. Backend restricted-key signing is therefore observed for a blocked request; browser admin signing and successful public payment remain unverified. Preserve the records; after confirmed resume create a fresh reviewed PO. The old test command is now historical. See `docs/wallet-recovery.md`.

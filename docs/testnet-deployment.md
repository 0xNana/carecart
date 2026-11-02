# CC-15 testnet deployment review

> **Current testnet state (2026-11-02 10:01 UTC):** Payment processing is **Active** (`is_paused=false`) after the human-requested [resume transaction](https://testnet.nearblocks.io/txns/DfKGXzjhZ3h8eMSAKcf5EcJwTbX1ac1gqWjeXBPUJq5f), with FINAL success and zero failed receipts. Vault balance remains 10000 CCTEST. The earlier `po-000002` stays Blocked/Paused; resume does not retry it. Refresh vault to replace an older UI snapshot. [Verification](testnet-resume-verification.json).

**Status, 2026-11-02:** The human explicitly approved deploying all reviewed testnet contracts/setup. All twelve proposal transactions executed with FINAL success and zero failed receipts. The token was verified before deploying the vault. Exact artifacts and call arguments match the review. The vault is **paused**, holding **10000 CCTEST**; treasury holds **990000 CCTEST**. No mainnet or real-value token is involved.

Public evidence: [all twelve transaction receipts](testnet-deployment-receipts.json), [stage-A token verification](testnet-token-verification.json), [final paused setup verification](testnet-deployment-verification.json), and [judge app read-only vault response](testnet-ui-vault-verification.json). Token deploy: [DAs3mg…NUZe](https://testnet.nearblocks.io/txns/DAs3mgFUkK8Z3j7NfJnTQGEGkefVdNsNpz9aQRgCNUZe). Vault deploy: [AEUWf7…P11F](https://testnet.nearblocks.io/txns/AEUWf7ircqdMiKKAxvoGck9i42UmLmtUFbGxs2nyP11F).

The commands below are retained as the approved execution record. **Do not rerun them**: fresh initialization and storage-reserve funding are not a safe bulk replay. The later [local restricted-key backend setup](testnet-live-setup.md) is complete; live browser-wallet ownership, PO payments and cross-chain settlement remain unverified/unperformed. The helper remains read-only. All twelve transactions together reported `5182442216969900000000` yoctoNEAR in transaction/receipt `tokens_burnt` (0.0051824422169699 test NEAR); code/state storage and attached/refunded deposits are separate. Admin setup used its retained Ed25519 key; token/vault deployment and treasury funding used their existing ML-DSA-65 CLI keys. No key was exported to application configuration.

The [captured proposal](testnet-deployment-plan.json) contains every exact command, source-file digest, artifact hash, account balance/code hash, argument, gas and deposit. It was read from `https://test.rpc.fastnear.com` at 08:40 UTC with chain ID `testnet`. Both deployment accounts had empty code hashes; all nine operational accounts existed, and exact-method funded Ed25519 committer/requester keys were present. This is a point-in-time preflight, not wallet ownership proof or permission to deploy. Recheck before execution.

## Artifacts and proposed state

Built with pinned Rust 1.93.0, near-sdk 5.29.1, standard Wasm allocator, cargo-near 0.22.0, locked dependencies and normal wasm-opt processing. These are local `non-reproducible-wasm` builds; container reproducibility is not claimed. Generated artifacts stay in ignored `artifacts/testnet/`.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `carecart_test_ft.wasm` | 163728 | `5bfac537f638170e019c6eff5c57da2845b732a8acd5d27ff37c618a8af7a7db` |
| `carecart_vault.wasm` | 190863 | `658eb04175d1b5245e0e22e418c563688e44bcd0cb44ac482808dbea8d92c5bc` |

The manifest also records Base58 code hashes for RPC comparison. Its source sidecar detects stale contract inputs, not cryptographic build provenance. Rebuilding with different inputs/tools/paths can produce different bytes; any hash change requires a fresh package and approval. Never deploy a stale manifest against a new binary.

- Network: **NEAR testnet only**. Accounts: `token.carecart.testnet`, `vault.carecart.testnet`, human `admin.carecart.testnet`, treasury `treasury.carecart.testnet`.
- Token proposal: in-repo test-only NEP-141 fixture, name `CareCart Local Test Token`, symbol **CCTEST**, decimals **0**, initial supply **1000000**, owned/held initially by treasury. It is valueless synthetic data, not USDC. Metadata is source-derived until stage A verifies the deployed token.
- Vault initialization: admin above; token above; `per_order_cap=2000`, `daily_cap=5000`, `balance_cap=10000` whole CCTEST units. These are proposed demo values for human review, not a policy the human has already selected.
- Current semantics: all three caps are **automatic-payment thresholds**, `balance_cap` is cumulative spending, and human approval can override cap excess. No hard holdings limit, guardian or treasury withdrawal exists. This test-only fixture must not be funded with real-value assets. See [mainnet reconciliation R-02–R-05](../mainnet-todo.md).
- Setup grants only Alpha/Beta suppliers, dedicated committer and dedicated requester; rogue stays unlisted. Prefund PO storage with **0.1 test NEAR**, register vault/Alpha/Beta on the mock token, then fund vault with **10000 CCTEST**, leaving **990000 CCTEST** at treasury.
- Final state: **paused**. No PO commitment, payment, resume, wallet signature, backend credential export or cross-chain action is included.

## Build and read-only review

From the repository root with pinned tools available:

```sh
bash scripts/build-testnet.sh
bash scripts/deploy-testnet.sh --artifacts artifacts/testnet > /tmp/carecart-testnet-review.json
node scripts/testnet-plan.test.mjs
node scripts/deploy-testnet.test.mjs
```

The deployment helper cannot sign, access a keychain or broadcast: it reads local Wasm/source files and public RPC, then prints JSON. It rejects a non-testnet RPC, missing accounts, stale source digests, absent/excessively privileged backend key permissions, and invalid Wasm. An existing deployment or insufficient proposed funding emits blockers and exit code 2; RPC/schema failures exit 1. No RPC fallback bypasses these checks. Do not execute generated commands when blockers exist. Fresh initialization only; upgrades/state migration are deliberately not automated.

Seven offline tests cover artifact integrity, shell quoting, exact permissions, no payment/admin approval methods, wrong-chain/RPC failure, stale source, existing deployment, funding and staged read-only verification. They use mocked public responses and synthetic artifacts, not keys or public transactions. Bash syntax checks pass. The actual read-only preflight and both staged post-deployment verifiers passed. The CLI connection was pinned to the reviewed testnet RPC in an isolated temporary config; global CLI settings were not changed.

## Stage A — review only the test token deployment

This is proposed transaction **1**. Signer/receiver: `token.carecart.testnet`. Action: deploy the token artifact above and call `new` with treasury owner and 1000000 CCTEST. Attached deposit **0 NEAR**, prepaid gas **100 Tgas**. Code/state storage is staked from the token account's existing **2.5 test NEAR**, in addition to transaction gas. Do not export its full-access key into application env; the CLI keychain performs any approved signing.

```sh
near contract deploy token.carecart.testnet use-file '/home/nana/projects/carecart/artifacts/testnet/carecart_test_ft.wasm' with-init-call new json-args '{"owner_id":"treasury.carecart.testnet","total_supply":"1000000"}' prepaid-gas '100 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-keychain send
```

**Executed after the human explicitly approved all reviewed testnet deployment/setup transactions. Do not rerun.** The NEAR CLI skill also requires showing complete transaction commands for approval: [SKILL.md](../.agents/skills/near-cli-rs/SKILL.md), “show it to the user for approval, then execute it.” The repository [CC-15](../todo.md#cc-15-deploy-to-testnet-only-after-explicit-confirmation) requires “Continue only after explicit confirmation for the specific testnet transaction/deployment.” The human supplied that approval on 2026-11-02; it covered the reviewed deployment/setup, not future wallet/payment actions.

After approval and confirmed final success, record the public transaction hash and verify without signing:

```sh
bash scripts/deploy-testnet.sh --verify-token --artifacts artifacts/testnet
```

This checks token byte hash, CCTEST metadata/decimals, supply, treasury's initial 1000000 CCTEST and live storage bounds (no more than the reviewed 0.01 NEAR per registration). A mismatch stops the next stage. A timeout is not proof the deployment failed: inspect final state/receipt before any retry. The fresh-init planner will report an already deployed token afterward; use the staged verifier, not a blind replay of the plan.

## Stage B — separate vault/setup review

Stage A verified metadata before the human-approved captured proposal steps **2–12** were executed as the exact reviewed batch. Review the current balances and token-state evidence again. The proposed changes are:

| Steps | Signer | Change | Attached deposit / prepaid gas |
| --- | --- | --- | --- |
| 2 | vault | Deploy exact vault hash and initialize admin/policy | 0 NEAR / 100 Tgas; code storage from vault balance |
| 3 | admin | `set_paused(true)` | 0 / 100 Tgas |
| 4–5 | admin | Allow Alpha and Beta | 0.01 NEAR each / 100 Tgas each |
| 6–7 | admin | Grant committer and requester vault roles | 0.01 NEAR each / 100 Tgas each |
| 8 | admin | `fund_commit_storage` | 0.1 NEAR / 100 Tgas |
| 9–11 | admin | Token storage registration for vault/Alpha/Beta | 0.01 NEAR each / 100 Tgas each |
| 12 | treasury | Token `ft_transfer` of 10000 CCTEST to vault | 1 yoctoNEAR / 100 Tgas |

All twelve transactions together attach **0.17 test NEAR + 1 yoctoNEAR**, with storage excess refunded by the applicable contract. Gas is additional: 100 Tgas prepaid per transaction, 1200 Tgas across the proposal; cost depends on network gas price. Code storage is separate, charged to token/vault accounts. Public preflight balances were token/vault 2.5 each, admin about 1.49974356 and treasury 0.5 test NEAR. Its conservative code/state/gas funding checks passed; these are estimates, not guaranteed future fees.

Before any approved command, inspect `near config show-connections` and confirm the CLI's `testnet` connection uses the reviewed testnet endpoint and reported chain ID. The helper's fixed public RPC does not prove that a separately configured CLI connection is correct. Stop on a mismatch; do not silently rewrite global CLI settings. After each approved action, wait for final receipts and stop on any failure. Do not loop or re-send the whole batch. Save public transaction hashes and actual deposits/gas costs in a deployment receipt record; no hashes are invented here. Then run:

```sh
bash scripts/deploy-testnet.sh --verify --artifacts artifacts/testnet
```

The initial-state verifier checks deployed byte hashes, live token metadata/supply/storage, treasury/vault balances, admin/policy, paused state, storage reserve, Alpha/Beta versus rogue and committer role. There is currently no public requester-role view: check the `set_payment_requester` final receipt and later authorized test before claiming that permission verified. The verifier is intentionally exact for the untouched paused setup; later payments/reserve consumption make its initial-balance assertions inapplicable.

## Subsequent live app verification is separately approved work

- [x] Record actual stage A/B hashes, FINAL receipts and read-only evidence. Both contracts and all setup steps are deployed/verified; the vault remains paused.
- [ ] Human connects a testnet wallet containing the supplied admin account; verify ownership and chosen wallet's support without importing keys into the app.
- [x] Configure **only verified restricted** backend keys securely in ignored owner-only `.env.testnet`, with deployment-derived IDs; key possession/live permissions verified. See [readiness](testnet-backend-readiness.json). Never read/export a human full-access/recovery key. Do not put key material in commands, logs, web config or handoff files.
- [x] Create the separate `backend/data/testnet-smoke.sqlite` synthetic demo database and trusted Alpha/Beta account mappings (`supplier-000001` → Alpha, `supplier-000002` → Beta); inspect actual registry rows before mapping. Never rewrite a supplier used in a committed PO or reuse historical fixture payments as public receipts.
- [ ] Separately review resume, PO commitment/payment requests, pending → approve/reject, pause and policy actions. Each public signing action requires exact review/approval; no browser auto-signing or agent administration.
- [ ] Repeat README outcomes; verify canonical on-chain status and token balances. Offline quote/PO/preview results are not live payment proof. Keep cross-chain dry/simulated and live providers disabled.
- [ ] Update README, account/deployment record and CC-15 checkboxes only from observed results; return the vault to the human-approved paused state.

Re-run/accept the documented [CC-14 dependency dispositions](security-release.md) before any execution. Full web development-tree npm and Cargo audits retain findings; there is no clean-audit claim. Public hosting, mainnet custody, hard caps/withdrawal and real settlement require the separate [mainnet backlog](../mainnet-todo.md), beginning with reconciliation approval.

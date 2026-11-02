# Testnet gap implementation and remaining verification

Dated 2026-11-02 UTC. [mainnet-todo.md](../mainnet-todo.md) remains primary; [todo-testnet-gap.md](../todo-testnet-gap.md) is the execution checklist. These local changes do not authorize funding or public transactions. The [v2 deployment draft](testnet-safety-deployment-plan.json) and [read-only public preflight](testnet-safety-preflight.json) are review material, not an executable approval package.

## Delivered locally

| Capability | Implementation | Verification boundary |
| --- | --- | --- |
| Manual live AI | `backend/src/agent/live.ts`, authenticated `/api/agent/tick`, `agent/tick.ts` CLI; live catalog check, bounded tool conversation, registered quote/item IDs, failure handling and `live_ai_runs` evidence. | Provider fixtures pass. User confirmed local credentials. Fixed the credential-variable mismatch; the `.env`-only live forecast smoke now receives HTTP 402 Payment Required. Cloud account credits/billing and a successful tool trace remain pending. No payment/admin tool is exposed to this LLM path. |
| Guardian, policy and treasury | Separate `contracts/carecart-safety-vault` fresh-init ABI; one-yocto human controls, independent pause-only guardian, immutable hard maxima, treasury deposits, reservations, fixed-treasury withdrawal. | 13 unit tests plus a real local Wasm/FT Sandbox lifecycle. No public deployment. |
| Base settlement implementation | Separate signed quote adapter, SDK signature verification with pinned signer, immutable attempt journal, restricted v2 client, unsigned approval review, receipt recovery and manual operational CLI. | Cryptographic/API/receipt fixtures and local registration-before-transfer Sandbox. No actual external swap or settlement. |
| Profile isolation | `near/safety-profile.ts`, dedicated v2 journal DB, final RPC network/code/role/token reads, exact distinct public keys, finite reviewed gas allowances and restricted methods. | Local tests. No operational mainnet manifest, key setup or account ownership proof. |

The old CCTEST contracts, `.env.testnet` restricted keys, database and wallet app retain their old ABI. The new client does not auto-load those credentials. A six-decimal CCUSD initializer was added only to the test-only FT source; the old CCTEST initializer remains zero-decimal. Never reinterpret old PO amounts as USDC.

## Live AI setup and smoke

The user selected NEAR AI Cloud and prefers a Confidential/Private TEE model with both `tools` and `structured_outputs`. The final provider choice remains NEAR Cloud only; the OpenAI SDK supplies the compatible transport, not an OpenAI inference fallback. The public catalog was checked on 2026-11-02. Candidates include `z-ai/glm-5.3-flash` and `Qwen/Qwen3.8-27B`. Use the first for the initial compatibility smoke. Discovery rechecks capabilities on every run; absence or mismatch fails closed. Catalog ownership alone is insufficient: when the API omits privacy metadata, only the exact IDs independently reviewed on the provider's Private TEE catalog are eligible.

The provider's [GLM model page](https://near.ai/models/z-ai/glm-5.3-flash) labels it Private TEE. That label is not CareCart verification. The current adapter uses the [OpenAI-compatible HTTPS API](https://docs.near.ai/cloud/guides/openai-compatibility); it returns `teeVerified: false`. It does not implement E2EE, DCAP, GPU attestation, response-signature binding or a privacy badge. Those claims remain deferred in the primary document.

The user configured the key as `NEAR_CLOUD_API_KEY` and explicitly selected `.env`. The live adapter uses `NEAR_CLOUD_API_KEY` only; an unrelated `OPENAI_API_KEY` is never sent to the Cloud gateway. Earlier legacy-key attempts returned HTTP 401; the corrected `.env`-only request returns HTTP 402 Payment Required. Public catalog access is not proof of valid inference credentials or available credits. Cloud billing/credits must be checked before another smoke. Both local env files have owner-only mode 0600. Do not put it in chat, web env, screenshots, git or a command-line argument. For live AI, use the ignored, mode-0600 `.env` selected by the owner; keep backend testnet signing keys in their existing separate `.env.testnet`:

```dotenv
CARECART_AI_MODE=near-ai-cloud
NEAR_CLOUD_BASE_URL=https://cloud-api.near.ai/v1
NEAR_CLOUD_MODEL=z-ai/glm-5.3-flash
NEAR_CLOUD_API_KEY=<locally configured secret>
CARECART_OPERATOR_TOKEN=<independent random secret of at least 32 characters>
```

Keep existing testnet account settings. Do not overwrite the whole file from an example. Generate the operator secret locally, for example with `openssl rand -hex 32`; never copy it to the web app.

Once Cloud billing is ready and the human confirms the live smoke, restart the backend with the explicit `.env` environment. Do not start a second instance over an occupied port:

```sh
PORT=3101 node --env-file=.env backend/node_modules/tsx/dist/cli.mjs backend/src/server.ts
```

In another terminal at the repository root:

```sh
node backend/node_modules/tsx/dist/cli.mjs backend/src/agent/tick.ts --catalog
PORT=3101 node --env-file=.env backend/node_modules/tsx/dist/cli.mjs backend/src/agent/tick.ts --run item-000001
```

Alternatively, a human can run the isolated forecast-only smoke without restarting the app:

```sh
CARECART_AI_MODE=near-ai-cloud NEAR_CLOUD_MODEL=z-ai/glm-5.3-flash node --env-file=.env backend/node_modules/tsx/dist/cli.mjs backend/src/ops/live-ai-smoke.ts
```

It uses a separate ignored mode-0600 synthetic SQLite file and a memory-only operator token, constructs no payment client, and binds no HTTP port. Without a selected quote, only the forecast tool is offered and drafting is rejected. Provider failures persist only allowlisted diagnostic fields; no raw SDK error or credential is printed. The observed attempts and HTTP 402 are recorded in [live smoke evidence](live-ai-smoke.json).

The first catalog command reads the public catalog only. The second is a human-initiated provider call through the authenticated localhost API. It should return `mode: near-ai-cloud`, model/response IDs, at least one validated forecast tool result, `runId`, `teeVerified: false` and `paymentRequested: false`. Check the matching `live_ai_runs` record. Failure returns a generic error and records `failed`; no silent deterministic fallback is presented as live AI. Limit: one tick in flight, three invocations/minute, four provider rounds, no SDK automatic retries.

A third CLI argument can select a **fresh persisted quote ID** for PO drafting. Create it through the ordinary synthetic quote flow first; an expired/already-used quote must fail. The model cannot set an amount/payee or invoke approval, policy, pause, withdrawal or cross-chain payment. The dashboard's original `/api/agent/tasks` path remains deterministic and does not call the provider. Restarted/abandoned `running` records are not proof of a completed provider run.

## Safety-vault artifact and local tests

Build from the repository root:

```sh
bash scripts/build-safety-vault.sh
cargo test --manifest-path contracts/Cargo.toml --locked -p carecart-safety-vault
cargo clippy --manifest-path contracts/Cargo.toml --locked -p carecart-safety-vault --all-targets -- -D warnings
npm run typecheck --prefix backend
npm test --prefix backend
```

The build writes only `artifacts/safety-v2/`. Observed host-toolchain artifact:

- Wasm SHA-256: `8941a8b857425c451f990aecd326a05337a59ae51680a63f4fc7dd1a30c21de4`.
- NEAR code hash: `AEnvafihMffsUr4TvgW6TVsrGyPfe7gffG5JajSsQpqH`.
- Size: 260935 bytes; ABI `carecart_safety_vault_abi.json`.
- Six-decimal mock FT SHA-256: `a8c92ed85916b72e18ddc508104c329372e63980fb05fe451655146574b5fb17`; code hash `CMsRPVVf3k29dhxik2UNkJz9hgNhJsdM1uZ7DiMqbymp`, 165857 bytes. It is initialized through `new_test_usdc`, not the CCTEST initializer.
- Pinned Rust 1.93.0 / SDK 5.29.1. This is a locked **host build**, not independently reproduced container evidence.

The Sandbox proves partial deposit refund, forced-transfer quarantine, Paid-once behavior, private callbacks, one-yocto enforcement, guardian restrictions and fixed-treasury exit. Its Base mock separately reaches PendingApproval → registration → transfer → **Dispatched**, with the exact mock deposit balance. This is not a testnet Intents deployment or a Base receipt.

The boundary grid includes 10, 10.000001, 25, 25.000001 and `u128::MAX`, failed callback restoration, original-day reservations, expired quotes and duplicate callbacks. Full external and public wallet cases remain open.

## Signed quote and recovery implementation

`intents/settlement.ts` is independent of `intents/preview.ts`. Existing browser routes remain mock/dry-only. Real settlement is **Base native USDC only**; it resolves exact canonical contracts and six decimals from the live token list. No symbol-only selection or synthesized asset IDs.

The adapter uses SDK 0.1.26 `verifyQuoteSignature()` and `quoteHash()` according to [1Click signature documentation](https://docs.near-intents.org/integration/distribution-channels/1click-api/verify-quote-signature). The source-pinned manager key is `ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc`. There is no production env override. Fixture tests sign with an ephemeral test trust root; those signatures cannot pass the production adapter. Persisted signed bytes are the SDK's UTF-8 Base58 digest message, alongside the full verified request/response and review digest. Unsigned/unreviewed optional request fields are rejected.

Exact recipient, treasury refund, token/amount, fee ceiling, quote expiry, deposit account, route/version and canonical PO are checked. The reviewed commitment hash is bound into the one-yocto approval call. Live asset and signature checks repeat before quote commitment and unsigned approval review; the contract repeats pause/policy/route/expiry checks before transfer. The maximum registration budget is 0.01 NEAR, separate from token funds; the operator must first inspect live canonical-token storage bounds and explicitly review the exact budget.

`intents/journal.ts` uses a separate SQLite WAL/FULL journal bound to a profile fingerprint. One active attempt per PO, immutable review bytes, source reconciliation, append-only event records, terminal idempotence and unique receipt proofs survive restart. An RPC timeout leaves reservations/state in place. Source status must come from the pinned-code v2 vault; no blind resend is attempted.

The `observe` operation independently reads the final human approval transaction, checks its admin/vault identity, single one-yocto approval action and exact PO/quote arguments, and proves the canonical-token transfer from vault to the quoted deposit account. Its immutable source hash/receipt evidence is persisted across restart. Destination/refund settlement cannot be marked verified without that source evidence.

Provider status is checked against the exact stored quote using the [documented execution schema](https://docs.near-intents.org/api-reference/oneclick/check-swap-execution-status). Provider `SUCCESS` alone stays Dispatched. `intents/receipts.ts` requires independent Base chain ID 8453, successful receipt in a finalized canonical block and a native-USDC Transfer to the registered recipient meeting minimum output. Treasury refunds require a FINAL successful NEAR receipt with canonical-token NEP-141 transfer events from Intents/the deposit account to the fixed treasury. Receipt amounts and partial refunds are recorded; a short refund is not labeled full. Unsupported/missing/multi-transaction proofs remain unresolved rather than being guessed. RPCs and 1Click remain explicit trust boundaries; this is not an onchain cross-chain oracle.

The manual `backend/src/ops/settlement.ts` entry point supports prepare/commit/request/review/observe/recover. It is not a public API and is not called by the browser or AI. It requires a reviewed **mainnet** v2 manifest (no account IDs have been supplied/approved), separate DB, approved order/attempt and optional API configuration. A wet quote prepares an address only; it is not a deposit or payment. A public token-list compatibility probe on 2026-11-02 returned HTTP 521; live API compatibility remains unverified and fails closed. Writes additionally require the exact review hash and explicit approved write mode. Commit and request invocations load only their separate restricted role credential. Human approval is returned as unsigned review JSON and must be revalidated immediately before an explicit wallet action. No admin/recovery credential is loaded by this code.

Do not run a real settlement preparation/commitment/deposit until the primary document's relevant operational approvals are complete. The CLI is implementation for later approved operations, not mainnet funding instructions. The new unsigned review still needs integration into the versioned wallet UI and live transport verification (MN-07).

## Remaining gates and compatibility

- Live inference/tool compatibility: the credential source is fixed and `.env` was explicitly tested, but inference returns HTTP 402. Waiting for the owner to check Cloud credits/billing; no successful provider/tool trace is claimed.
- Public safety deployment: the public preflight confirms the proposed guardian/vault/token accounts do not exist. The sponsor has about 1.636 test NEAR, below the proposed 8.2 test NEAR account-transfer budget plus fees; no top-up has been authorized. The user selected `guardian.carecart.testnet` as guardian (name only; creation and separate-key custody are unverified). Needs exact new account/token identities, role custody/control proof, artifact/init/storage budget review and approved transactions. The old deployed vault cannot be upgraded in place using this ABI.
- Public Paid/pending/approval/rejection and guardian/treasury drills: still pending. Preserve the old permanently Blocked/Paused `po-000002`.
- Wallet UI: still the old testnet ABI. Integrate v2 profiles, balances, guardian/treasury and complete quote review after the deployment/profile decision; do not point it at v2 through an env-only switch.
- Mainnet: G0B/G1/G2 and exact funding/transaction gates remain open. Actual Intents settlement cannot be proven on NEAR testnet; one separately approved tiny mainnet → Base receipt/refund drill is G4.
- Existing dependency exceptions and cold-deployer trust remain disclosed. This work is not an external audit, hardware-backed custody proof or release approval.
- Adding the workspace member and test-only initializer changes the old deployment package's source fingerprint. Its historical receipts are still valid evidence; its old plan must not be reused as approval for any newly built artifact. The new build script deliberately does not rewrite it.

## Verification record

The dated [local verification record](testnet-gap-verification.json) captures observed checks and artifact identities. Source/history scans are heuristic, and existing dependency exceptions remain open. A signature-check mutation was deliberately inverted: real crypto tests failed, the source was restored, and the restored suite passed. This is a targeted review check, not an external audit or a project-wide mutation score.

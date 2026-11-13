# Testnet purchasing activation and authority

CareCart's MVP uses NEAR testnet and CCUSD, a six-decimal test token with no cash value. No mainnet fallback exists. The inventory worker and the LLM hold no signing key; the internal automatic evaluator, committer, requester and observer are separate capabilities.

## Verified release

- Source: `52060a1626c02f9d8b93538110715f01937e31cb`; current vault Rust source and Cargo.lock are identical.
- Build: Rust `1.93.0`, cargo-near `0.22.0`, locked release build, `wasm32-unknown-unknown`, the workspace release flags and cargo-near's ABI embedding/wasm-opt postprocessing.
- Command: `bash scripts/reproduce-deployed-vault.sh`. It archives the exact revision into a temporary directory and checks the expected digest and public RPC code bytes.
- SHA-256 hex: `979c178881f12ce6694ea804d9374af3606b55dbb0b8074434e791d5c9b0b71e`.
- NEAR Base58 code hash: `BCpcRunpuzhjrshyq1yrKtsmABrAAPy6ZFmMrUvUUqK3`.
- [Vault](https://testnet.nearblocks.io/address/safety-v2.carecart.testnet), [token](https://testnet.nearblocks.io/address/token-v2.carecart.testnet), [source/RPC evidence](evidence/testnet/vault-source-verification.json).

The earlier mismatching artifact came from a later package manifest and Rust 1.96 container build. The archived historical source was rebuilt from scratch and matched the deployed WASM exactly; no redeployment or contract policy change was needed.

## Normal clinic standing consent

An authenticated Clinic Admin with the verified clinic control wallet uses **Payments → Automatic purchasing** to choose approved items, suppliers and an automatic amount no greater than 10 CCUSD. The consent expires within 24 hours or sooner when wallet verification expires. Policy versions are append-only. Disabling the policy, changing its version, revoking the treasury or wallet, or removing the administrator's role invalidates queued automatic work. A logged-out interactive session does not revoke explicitly recorded standing consent; the policy pause control does.

The deterministic evaluator checks canonical terms, fresh supplier quotes, item/supplier scope, treasury identity, current balance, onchain pause and limits before recording an authorization. Each signer consumes a fresh nonserializable permit for one clinic, PO, role and operation. An uncertain send is held for reconciliation and never automatically resent. Contract callbacks and independently fetched final receipts establish payment; an RPC submission alone does not.

Defaults remain disabled. The inventory configuration's `financialExecution: false` continues to mean that the inventory monitor itself has no spending capability. Automatic financial consent is the separately audited policy above, not a global boolean or a model tool.

## Completed bounded sprint

The owner explicitly approved the existing vault/token, restricted committer/requester, approved supplier, one canonical glove PO, at most 3 CCUSD of payout, and one duplicate request. No deployment, funding, onchain policy change or administrative signature was approved or performed.

`testnet-sprint.ts` uses that narrowly fixed host control-plane grant for the explicitly synthetic clinic. It binds the resulting canonical PO and hash, only gloves, only `medsupply-a.carecart.testnet`, and a one-hour expiry. It cannot be renewed for a second order. The grant is unavailable through HTTP or model tools. Host operators are a trusted authority able to alter local configuration; this is disclosed rather than represented as a cryptographic clinic-user signature.

The actual payout was 1.5 CCUSD. Both role authorizations and final receipt observation are recorded in [the headless trace](evidence/testnet/headless-sprint.json), and [public payment evidence](evidence/testnet/autonomous-payment.json) independently verifies the transfer. The duplicate request produced no extra transfer. Inventory stayed at 26 until the separate synthetic 30-unit receipt, then became 56 exactly once. The sprint grant is now disabled. Do not rerun the preparation or duplicate test: they preserve attempt markers and require reconciliation after interruption.

## Processes and protected environments

Use Node 24.21.0. The key-free environment is `backend/.env.identity`. The two signing environments are `backend/.env.testnet-committer` and `backend/.env.testnet-requester`, each mode `600`, containing only its own signing key plus the needed non-secret settings. API, web, inventory and observer environments must never contain either key. Never paste keys into chat, logs or Git.

The existing local launcher starts the API, inventory monitor, internal authorization evaluator, two separate signers, observer and production web:

```bash
nvm use
bash scripts/verify-phase2.sh
bash scripts/serve-testnet-payments.sh /tmp/carecart-phase2-verify.REPLACE_WITH_PRINTED_SUFFIX
```

The evaluator is the key-free process `src/ops/testnet-payment-worker.ts authorize REGISTRY ACTIVATION`. It reads configured policy; it has no signing method. The existing `committer`, `requester` and `observe` modes handle execution and reconciliation. Starting them with the completed one-order policy does not authorize another purchase. Any further public transaction needs its own approved scope or a valid clinic policy authorized by the owner.

## Financial defense and remaining authority

| Scenario | Evidence |
| --- | --- |
| Eligible supplier payout | Public testnet final receipts and exact historical token balance deltas. |
| Unknown supplier | Vault unit test `four_usdc_unknown_supplier_is_blocked_with_sufficient_initial_funds_and_no_limit_excess`. This specific assertion is a contract unit test, not a new public rejection. |
| Immutable hard payout/daily cap | Vault boundary and approval tests. Admin approval cannot bypass the deployed code's hard caps. |
| Human approval | Genuine local Sandbox admin approval and over-automatic-threshold tests. Public tenant admin-wallet handoff remains disabled; such app orders stay held. |
| Emergency pause | Vault tests and genuine local Sandbox pause behavior; no public pause transaction was performed in this sprint. |
| Duplicate payout | [Public duplicate request](https://testnet.nearblocks.io/txns/CHQWp7kA7veiBmryrRzBvHHE775n9A6XTdQLuSEACDGH): final success, no transfer event, supplier balance unchanged. |

The policy thresholds remain 10 CCUSD automatic, 25 CCUSD hard per order, 25 CCUSD per UTC day and the existing 5 CCUSD accepted deposit ceiling. CCUSD is not Circle USDC.

The admin can manage allowed suppliers, roles and bounded policy, approve eligible held orders, recover funds to the fixed treasury, and rotate human authorities. The guardian can pause only. The treasury is the only accepted deposit sender and recovery recipient. The committer/requester function-call keys each target their one allowed method on the vault with finite gas allowance; the restricted agents hold no CCUSD treasury balance and cannot call token-transfer methods with these keys.

Full-access owner keys remain separate authorities. In particular the vault account's full-access upgrade key can replace the contract code and thereby alter its protections. Safety claims assume the verified code remains deployed and those owner keys stay protected. The host operator can change backend configuration or code but has no treasury signing key in these worker environments. A compromised committer plus requester is still constrained by the deployed vault's supplier, payout, daily, balance and pause checks, not by an assertion that those roles are harmless.

Prompt injection cannot select a signing tool, token or recipient: the LLM's registered tools end at proposals; trusted catalog/PO resolution and deterministic policy supply financial terms. A forged JSON permit cannot cross the nonserializable execution boundary. This is backend/tool isolation plus onchain policy, not TEE attestation or automatic supplier reputation scoring.

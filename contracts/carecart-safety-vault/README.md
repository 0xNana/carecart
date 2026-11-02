# CareCart safety vault v2

Fresh-init contract for the approved limits, guardian, treasury accounting and reviewed Base dispatch. It is a separate ABI/state layout from `carecart-vault`; it has **not been deployed**. Do not deploy it over the existing CCTEST account or use the old deployment script/approval package.

The authority is [mainnet-todo.md](../../mainnet-todo.md). Local evidence and remaining operational gates are tracked in [todo-testnet-gap.md](../../todo-testnet-gap.md) and the [operator guide](../../docs/testnet-gap-implementation.md).

## Local verification

From the repository root, with the pinned Node/Rust tools and backend dependencies installed:

```sh
cargo test --manifest-path contracts/Cargo.toml --locked -p carecart-safety-vault
cargo clippy --manifest-path contracts/Cargo.toml --locked -p carecart-safety-vault --all-targets -- -D warnings
bash scripts/build-safety-vault.sh
```

The Sandbox is disposable and uses a six-decimal **CCUSD mock**, not real USDC or public testnet funds. The original test-FT `new` initializer still creates zero-decimal CCTEST; `new_test_usdc` is a distinct initializer. The v2 initializer starts paused and accepts independent admin/guardian/treasury plus the token and policy. Testnet account IDs select the testnet profile. A mainnet deployment requires the pinned native USDC candidate and independent offchain network/token verification.

## Authority and accounting

- Admin privileged operations and admin/guardian pause require exactly one yoctoNEAR. Guardian can pause only. Backend committer/requester roles are disjoint and accept zero deposit; admin separately provisions storage.
- Six-decimal atomic amounts: initial auto limit 10, hard payout 25, hard combined UTC-day dispatch 25, accepted ceiling 5; code maxima are 25/25/50. Admin approval bypasses only the auto threshold.
- Only the configured token's treasury-originated `ft_transfer_call` with message `deposit` credits accounted funds. Excess is returned. Plain FT transfers never become spendable; actual token balance can exceed accounted funds.
- Payment and treasury-withdrawal reservations reduce spendable funds. Payments retain their original UTC-day reservation across midnight. Definitive callback failure restores reservations exactly once.
- `withdraw` and `withdraw_all` always target the fixed treasury. Emergency exit pauses first and excludes in-flight funds. A later exit can collect funds released after callbacks. Dispatched transfers cannot be clawed back.

## Cross-chain boundary

POs and quote attempts are immutable. Base route versions, invoice digest, token, amount, signed quote identity, deposit account, deadline, minimum output and bounded native registration budget are committed. Every cross-chain request is pending human approval. The reviewed hash must match; registration completes before the token transfer, with policy/pause/route/expiry rechecks between stages.

Source success is **Dispatched**. The contract makes no Base settlement claim. The backend independently checks destination/refund receipts and records backend-verified Settled/Refunded evidence. The contract cannot authenticate the ultimate Base recipient or 1Click signature itself; human review, the pinned 1Click signer, independent RPCs and the separate committer are trust boundaries. A retained deployer key can replace code.

Callbacks are private and fixed-size state transitions. Ambiguous or missing callbacks retain reservations; they do not trigger automatic retries. Fresh initialization, public role/control proof, deployment, wallet integration and smoke transactions need separate exact review. There is no automatic deployment workflow.

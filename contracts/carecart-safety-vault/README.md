# CareCart Safety Vault v2 (`safety-v2.carecart.testnet`)

Rust smart contract for NEAR Testnet enforcing immutable purchase-order commitments, supplier allowlists, pause-only guardian authority, treasury recovery, and six-decimal `CCUSD` spending limits.

## Local Verification

From the repository root, with the pinned Node/Rust tools and backend dependencies installed:

```sh
cargo test --manifest-path contracts/Cargo.toml --locked -p carecart-safety-vault
cargo clippy --manifest-path contracts/Cargo.toml --locked -p carecart-safety-vault --all-targets -- -D warnings
bash scripts/build-safety-vault.sh
```

The local NEAR Sandbox uses a disposable six-decimal **CCUSD** test token (`new_test_usdc`). The v2 initializer starts paused and accepts independent `admin`, `guardian`, and `treasury` accounts plus the token and policy limits.

## Authority & Accounting Invariants

- Admin privileged operations and admin/guardian pause require `1 yoctoNEAR`. Guardian can pause only. Backend `committer` and `requester` roles are disjoint and accept zero deposit; `admin` separately provisions storage.
- Six-decimal atomic amounts: initial automatic payout limit `10 CCUSD` (`10_000_000`), hard per-PO payout limit `25 CCUSD` (`25_000_000`), hard combined UTC-day dispatch limit `25 CCUSD` (`25_000_000`), and initial accepted deposit ceiling `5 CCUSD` (`5_000_000`); immutable code maxima are `25 / 25 / 50`. Admin approval bypasses only the automatic threshold (`10 CCUSD`), never a hard block.
- Only the configured token's treasury-originated `ft_transfer_call` with message `"deposit"` credits accounted spendable funds. Excess is refunded automatically. Plain `ft_transfer` calls never become spendable.
- Payment and treasury-withdrawal reservations reduce spendable funds immediately. Payments retain their original UTC-day reservation across midnight. Definitive callback failure restores reservations exactly once.
- `withdraw` and `withdraw_all` always target the fixed `treasury` account. Emergency exit pauses first and excludes in-flight reserved funds.

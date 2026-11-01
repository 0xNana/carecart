# CareCart policy vault

This NEAR contract stores the active payment policy, supplier allowlist, PO committer and payment requester roles, and immutable purchase-order commitments. A payment request accepts only a PO ID, queries the configured NEP-141 token balance, reserves policy capacity, and then transfers to the supplier recorded in that PO. Private callbacks record `Paid` or `Failed`; cap excess waits for admin approval, while invalid or unfunded requests are `Blocked`. Payment state changes also emit `carecart` audit events.

`contracts/test-ft/` is a separate test-only NEP-141/NEP-145 token fixture. It has no production or mainnet configuration. The integration test deploys it only into local NEAR Sandbox. No contract is deployed to testnet or mainnet by these commands.

## Local checks

From the repository root:

1. Run `cargo test --manifest-path contracts/Cargo.toml -p carecart-vault --test policy --locked`; see the policy and access-control cases pass.
2. Run `cargo test --manifest-path contracts/Cargo.toml -p carecart-vault --test payment --locked`; see request idempotency, capacity reservation, approval, insufficient balance, and callback outcomes pass.
3. Run `cargo test --manifest-path contracts/Cargo.toml -p carecart-vault --test sandbox --locked`; see the test token deposit/balance and the paid, pending, blocked, and failed-transfer flows run against local Sandbox. On first use, `near-sandbox` downloads its pinned local node binary, so this step needs network access. Restricted environments also need permission to bind local loopback RPC sockets.
4. Run `cargo check --target wasm32-unknown-unknown --manifest-path contracts/Cargo.toml --workspace --locked`; see both workspace contracts compile for WASM.
5. Run `cargo near build non-reproducible-wasm --manifest-path contracts/carecart-vault/Cargo.toml --locked`; see the vault artifact build.

The tests use synthetic accounts and integer token amounts. Sandbox state is local and disposable. These commands do not sign a public-network transaction or deploy a contract. Any testnet transaction or deployment still requires the human's explicit confirmation.

# CareCart policy vault

This NEAR contract stores the active payment policy, supplier allowlist, PO committer and payment requester roles, and immutable purchase-order commitments. A payment request accepts only a PO ID, queries the configured NEP-141 token balance, reserves policy capacity, and then transfers to the supplier recorded in that PO. Private callbacks record `Paid` or `Failed`; cap excess waits for admin approval, while invalid or unfunded requests are `Blocked`. Payment state changes also emit `carecart` audit events.

`contracts/test-ft/` is a separate test-only NEP-141/NEP-145 token fixture. It has no production or mainnet configuration. The integration test deploys it only into local NEAR Sandbox. No contract is deployed to testnet or mainnet by these commands.

The human-controlled admin can fund `fund_commit_storage` and read `get_commit_storage_reserve`. Authorized committers can then call `commit_purchase_order` with zero deposit, consuming the funded reserve for measured storage growth. This supports a backend function-call key restricted to `commit_purchase_order`; the request key is separately restricted to `request_payment`. Existing wallet-signed commitments may still attach their own storage deposit. The backend rejects full-access keys and verifies the RPC chain ID before signing.

The reserve field changes contract state serialization. No public contract has been deployed; initialize older disposable local fixtures from the updated artifact rather than reusing their state.

CC-14 disables the pinned SDK's default `wee_alloc` feature in both contracts and the unit-test dependency, using Rust's standard Wasm allocator. This removes an unmaintained runtime dependency without upgrading crate versions or changing contract state/API. Rebuild and review the current binary size/gas for deployment. Remaining RustSec findings are in local test dependencies; see the [security report](../../docs/security-release.md) for the audit, deferrals and verification scope.

## Local checks

From the repository root:

1. Run `cargo test --manifest-path contracts/Cargo.toml -p carecart-vault --test policy --locked`; see the policy and access-control cases pass.
2. Run `cargo test --manifest-path contracts/Cargo.toml -p carecart-vault --test payment --locked`; see request idempotency, capacity reservation, approval, insufficient balance, and callback outcomes pass.
3. Run `cargo test --manifest-path contracts/Cargo.toml -p carecart-vault --test sandbox --locked`; see the test token deposit/balance and the paid, pending, blocked, and failed-transfer flows run against local Sandbox. On first use, `near-sandbox` downloads its pinned local node binary, so this step needs network access. Restricted environments also need permission to bind local loopback RPC sockets.
4. Run `cargo check --target wasm32-unknown-unknown --manifest-path contracts/Cargo.toml --workspace --locked`; see both workspace contracts compile for WASM.
5. Run `cargo near build non-reproducible-wasm --manifest-path contracts/carecart-vault/Cargo.toml --locked`; see the vault artifact build.

The Sandbox test also invokes the actual TypeScript backend HTTP procurement/payment flow; install backend dependencies and put the pinned Node runtime on PATH first. The tests use synthetic accounts and integer token amounts. Sandbox state is local and disposable. These commands do not sign a public-network transaction or deploy a contract. Any testnet transaction or deployment still requires the human's explicit confirmation.

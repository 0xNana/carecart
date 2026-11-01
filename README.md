# CareCart

## What it is

CareCart is a testnet-first procurement prototype for healthcare supplies. It uses synthetic inventory and supplier data to forecast reorders, draft purchase orders, and route payment requests through a NEAR policy vault.

## Problem

Routine supply reorders depend on manual stock checks and purchase-order work. An AI agent can speed up that work, but it should not be able to invent a payee or move funds outside a human-set policy. CareCart puts supplier allowlists, payment limits, approval states, and pause controls in the payment flow.

All initial data is synthetic. This repository does not contain patient, hospital, or real supplier data.

## Current state

The Rust vault implements policy and role controls, immutable purchase-order commitments, ID-only payment requests, capacity reservations, and private NEP-141 settlement callbacks. The locked workspace suite passes, including a local Sandbox test using a separate test-only NEP-141 token. Both contracts build to Wasm. The backend has typed domain records, SQLite migrations, and deterministic synthetic seed data, but no API endpoints yet. No contract is deployed. `web/` is still the generated Next.js starter. NEAR Intents has no testnet deployment, so cross-chain settlement is not part of the first testnet demo.

## Track

Real-World Money (`realworld`).

## Try the contract

From the repository root:

1. Run `cargo test --manifest-path contracts/Cargo.toml -p carecart-vault --test policy --locked`; see the policy and access-control cases pass.
2. Run `cargo test --manifest-path contracts/Cargo.toml -p carecart-vault --test payment --locked`; see ID-only request, idempotency, reservation, approval, and callback cases pass.
3. Run `cargo test --manifest-path contracts/Cargo.toml -p carecart-vault --test sandbox --locked`; see the test token deposit/balance and full payment lifecycle run in local Sandbox. On first run this downloads the pinned Sandbox node binary, so network access is required. In restricted environments, the test also needs permission to bind local loopback RPC sockets.
4. Run `cargo check --target wasm32-unknown-unknown --manifest-path contracts/Cargo.toml --workspace --locked`; see both contracts compile for WASM.
5. Run `cargo near build non-reproducible-wasm --manifest-path contracts/carecart-vault/Cargo.toml --locked`; see the vault Wasm artifact build.

The Sandbox setup uses synthetic accounts and a local test token only. These commands do not interact with testnet or mainnet. Procurement endpoints and the dashboard are still unimplemented; opening `web/` shows the generated starter page.

## Try the backend data foundation

1. Run `npm test --prefix backend`; see the fresh SQLite migration, trusted ID registry, deterministic synthetic seed, and exact smallest-unit amount cases pass.
2. Run `npm run typecheck --prefix backend`; see the strict backend TypeScript check pass.

The seed uses synthetic items and supplier labels, has no supplier account addresses, and records the sample payment as `not_requested`. The default SQLite file is `backend/data/carecart.sqlite`, which Git ignores.

## Planned judge flow

This flow becomes runnable after implementation:

1. Open the inventory with a low-stock item; see its deterministic forecast, supplier quotes, and drafted purchase order.
2. Request a payment for an allowlisted test supplier; see the vault mark it `Paid`, `Pending`, or `Blocked` according to policy.
3. Send an untrusted supplier message that asks to change the payee; see the agent keep the registered supplier and the vault reject an unknown supplier.
4. Open a cross-chain preview; see the quote and recipient checks. A preview is not a settlement, and no testnet Intents settlement is available.

## Safety boundary

The first implementation targets NEAR testnet and uses test-only funds. Mainnet deployment, transaction signing, and token spending require the human's explicit confirmation. Secrets belong in a local `.env` file that is ignored by Git; never commit keys.

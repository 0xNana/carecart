# CareCart

## What it is

CareCart is a testnet-first procurement prototype for healthcare supplies. It uses synthetic inventory and supplier data to forecast reorders, draft purchase orders, and route payment requests through a NEAR policy vault.

## Problem

Routine supply reorders depend on manual stock checks and purchase-order work. An AI agent can speed up that work, but it should not be able to invent a payee or move funds outside a human-set policy. CareCart puts supplier allowlists, payment limits, approval states, and pause controls in the payment flow.

All initial data is synthetic. This repository does not contain patient, hospital, or real supplier data.

## Current state

The Rust vault implements policy and role controls, immutable purchase-order commitments, ID-only payment requests, capacity reservations, and private NEP-141 settlement callbacks. The locked workspace suite passes, including a local Sandbox test using a separate test-only NEP-141 token. Both contracts build to Wasm. The backend has typed domain records, SQLite migrations, deterministic synthetic seed data, inventory and forecast reads, and a simulated supplier quote endpoint. No contract is deployed. `web/` is still the generated Next.js starter. NEAR Intents has no testnet deployment, so cross-chain settlement is not part of the first testnet demo.

## Track

Real-World Money (`realworld`).

## Try the contract

From the repository root:

1. Run `cargo test --manifest-path contracts/Cargo.toml -p carecart-vault --test policy --locked`; see the policy and access-control cases pass.
2. Run `cargo test --manifest-path contracts/Cargo.toml -p carecart-vault --test payment --locked`; see ID-only request, idempotency, reservation, approval, and callback cases pass.
3. Run `cargo test --manifest-path contracts/Cargo.toml -p carecart-vault --test sandbox --locked`; see the test token deposit/balance and full payment lifecycle run in local Sandbox. On first run this downloads the pinned Sandbox node binary, so network access is required. In restricted environments, the test also needs permission to bind local loopback RPC sockets.
4. Run `cargo check --target wasm32-unknown-unknown --manifest-path contracts/Cargo.toml --workspace --locked`; see both contracts compile for WASM.
5. Run `cargo near build non-reproducible-wasm --manifest-path contracts/carecart-vault/Cargo.toml --locked`; see the vault Wasm artifact build.

The Sandbox setup uses synthetic accounts and a local test token only. These commands do not interact with testnet or mainnet. Purchase-order, payment, agent, and dashboard flows are still unimplemented; opening `web/` shows the generated starter page.

## Try the backend inventory and quote API

1. Run `npm run dev --prefix backend`; see the API listen on `http://127.0.0.1:3001` and initialize the ignored local database at `backend/data/carecart.sqlite`.
2. Run `curl -s http://127.0.0.1:3001/api/inventory`; see both synthetic items with `onHand`, `reorderPoint`, and `isLowStock` fields.
3. Run `curl -s http://127.0.0.1:3001/api/inventory/item-000001/forecast`; see the 30-day synthetic usage total and integer reorder recommendations for registered suppliers Alpha and Beta.
4. Run `curl -s -X POST http://127.0.0.1:3001/api/supplier-quotes -H 'content-type: application/json' -d '{"itemId":"item-000001"}'`; see two simulated quotes with registered supplier IDs and atomic prices. Run the request again to see new quote records persisted in SQLite.
5. Run `npm test --prefix backend`; see fresh and upgraded SQLite migrations, deterministic forecast, quote persistence, rejected caller-supplied supplier fields, and synthetic seed cases pass.
6. Run `npm run typecheck --prefix backend`; see the strict backend TypeScript check pass.

The quote route accepts only a registered item ID. It reads supplier identities, lead times, and prices from the synthetic catalog; caller-supplied supplier text, identities, and prices are rejected. The seed has no supplier account addresses and records the sample payment as `not_requested`. The default SQLite file is Git-ignored. The API binds to loopback and does not submit blockchain transactions.

## Planned judge flow

The inventory → forecast → simulated quote portion is runnable through the API above. The remaining flow becomes runnable after implementation:

1. Open the inventory with a low-stock item; see its deterministic forecast, supplier quotes, and drafted purchase order.
2. Request a payment for an allowlisted test supplier; see the vault mark it `Paid`, `Pending`, or `Blocked` according to policy.
3. Send an untrusted supplier message that asks to change the payee; see the agent keep the registered supplier and the vault reject an unknown supplier.
4. Open a cross-chain preview; see the quote and recipient checks. A preview is not a settlement, and no testnet Intents settlement is available.

## Safety boundary

The first implementation targets NEAR testnet and uses test-only funds. Mainnet deployment, transaction signing, and token spending require the human's explicit confirmation. Secrets belong in a local `.env` file that is ignored by Git; never commit keys.

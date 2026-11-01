# CareCart

## What it is

CareCart is a testnet-first procurement prototype for healthcare supplies. It uses synthetic inventory and supplier data to forecast reorders, draft purchase orders, and route payment requests through a NEAR policy vault.

## Problem

Routine supply reorders depend on manual stock checks and purchase-order work. An AI agent can speed up that work, but it should not be able to invent a payee or move funds outside a human-set policy. CareCart puts supplier allowlists, payment limits, approval states, and pause controls in the payment flow.

All initial data is synthetic. This repository does not contain patient, hospital, or real supplier data.

## Current state

Setup scaffold only. `web/` is the generated Next.js starter, `backend/` has its dependencies but no API, and `contracts/carecart-vault/` is the generated NEAR auction example. None of those implements CareCart yet. There is no deployed contract or testnet payment flow. The implementation spec sets testnet as the first NEAR target. NEAR Intents has no testnet deployment, so cross-chain settlement is not part of the first testnet demo.

## Track

Real-World Money (`realworld`).

## Try this repository today

1. Run `npm ls --prefix backend --depth=0`; see the pinned backend dependencies.
2. Run `npm ls --prefix web --depth=0`; see the pinned Next.js and NEAR wallet dependencies.
3. Run `npm run dev --prefix web`, then open `http://localhost:3000`; see the generated Next.js starter page. This is not the CareCart product flow.
4. Run `cat implementation.md`; see the intended testnet-first product behavior, workspace layout, verified endpoints, and setup state.

These steps inspect the setup and starter screen. They do not demonstrate CareCart behavior.

## Planned judge flow

This flow becomes runnable after implementation:

1. Open the inventory with a low-stock item; see its deterministic forecast, supplier quotes, and drafted purchase order.
2. Request a payment for an allowlisted test supplier; see the vault mark it `Paid`, `Pending`, or `Blocked` according to policy.
3. Send an untrusted supplier message that asks to change the payee; see the agent keep the registered supplier and the vault reject an unknown supplier.
4. Open a cross-chain preview; see the quote and recipient checks. A preview is not a settlement, and no testnet Intents settlement is available.

## Safety boundary

The first implementation targets NEAR testnet and uses test-only funds. Mainnet deployment, transaction signing, and token spending require the human's explicit confirmation. Secrets belong in a local `.env` file that is ignored by Git; never commit keys.

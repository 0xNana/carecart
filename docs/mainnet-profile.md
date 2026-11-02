# MN-01 — mainnet profile and exact amounts

The mainnet candidate lives in [profiles/mainnet.candidate.json](../profiles/mainnet.candidate.json). It binds the network, pinned HTTPS RPC and expected chain ID, native USDC token/decimals/1Click asset candidate, state path and NEAR/Base explorers. `deployment: null` deliberately prevents conversion into a signing profile. No mainnet database is created by inspecting it.

G0B must supply/control-prove the vault, admin, treasury, guardian, committer and requester identities, distinct public keys, finite key allowance and reviewed code hash. Populating these fields is configuration validation, not deployment/funding approval. `mainnetSafetyProfile()` converts a complete manifest to the separate v2 ABI profile. The manual settlement CLI now requires this manifest instead of accepting an unbound v2 profile. Exact operational approvals and G1/G2 remain required.

The existing CCTEST server accepts only `testnet-cctest`/`testnet`. It checks this **before opening or seeding SQLite**, even when no payment credentials are present. An environment change cannot enable mainnet. Its database cannot target the reserved mainnet directory. Mainnet v2 profiles reject legacy/outside paths, traversal out of the reserved directory, symbolic links (including dangling links) and hardlinked database files. Mainnet profile paths resolve against the project root, independently of the working directory. The v2 client checks the live chain, code hash, token metadata, roles and canonical PO before signing; mainnet also requires the `USDC` symbol.

## Read-only verification

[Recorded observations](mainnet-asset-verification-2026-11-02.json) contain the timestamp, manifest fingerprint, official-registry content digest, RPC chain/genesis identity, finalized block references, metadata and storage bounds. These are observations, not transaction authorization.

- [Circle's official registry](https://developers.circle.com/stablecoins/usdc-contract-addresses) lists `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1` for native NEAR USDC.
- The live primary NEAR RPC returned chain `mainnet`, token symbol/name `USDC`, and `decimals: 6`. `storage_balance_bounds` returned minimum and maximum `1250000000000000000000` yoctoNEAR (0.00125 NEAR per registration at observation time). No registration was performed. The [NEAR RPC reference](https://docs.near.org/api/rpc/contracts) documents these read-only contract queries.
- **Still unverified:** the live [1Click token listing](https://docs.near-intents.org/api-reference/oneclick/get-supported-tokens). Requests to `https://1click.chaindefuser.com/v0/tokens` returned HTTP 521 with Node and HTTP 403 with Python; web retrieval also failed. Neither the pinned candidate asset ID nor offline mocks establish current support. Full verification must succeed before release/funding.
- **Pending G0B:** `storage_balance_of` for the actual vault and treasury; suppliers and quote deposit accounts also require their own registration checks before payments. An unknown account is never treated as registered. The verifier queries vault/treasury once deployment identities exist and preserves null registrations as observations.
- FastNEAR was checked as a diagnostic endpoint listed in the [official provider list](https://docs.near.org/api/rpc/providers); a later status reported `syncing: true` and was correctly rejected. The candidate and saved evidence use `https://rpc.mainnet.near.org`.

Run from the project root; no `.env`, private keys or API credentials are loaded:

```sh
cd backend
./node_modules/.bin/tsx src/ops/verify-mainnet-assets.ts ../profiles/mainnet.candidate.json /tmp/carecart-mainnet-assets.json
```

An output file must not already exist. RPC/HTTP errors, an unsynced node, wrong chain, missing/ambiguous assets, wrong decimals/symbol, invalid storage bounds or mismatched 1Click identity fail the full verification. To retain only the available registry/chain observations, append `--chain-only`; the report explicitly sets `oneClickVerification: "not-verified"` and `assets: null`. This mode cannot satisfy the outstanding 1Click check.

## Synthetic fixtures and amount rules

`backend/src/amounts.ts` parses human decimal **strings** into U128-bounded `bigint` atoms and formats six-decimal strings. It rejects numbers, negatives, exponent notation, whitespace and more than six fractional digits. No rounding or floating-point transfer arithmetic is used.

`mainnetFixtures()` in `backend/src/profiles/mainnet-fixtures.ts` provides six synthetic items and three suppliers. All supplier accounts remain null; all orders are local drafts with `executionAuthorized: false`. It neither opens a database nor imports/migrates CCTEST records. The original testnet seed/configuration files and existing database bytes remain unchanged.

| Scenario | USDC | Atomic units | Quantity × unit price (atoms) |
| --- | ---: | ---: | ---: |
| Saline | 1 | 1000000 | 10 × 100000 |
| Gauze | 2 | 2000000 | 10 × 200000 |
| Masks | 3 | 3000000 | 10 × 300000 |
| Syringes | 4 | 4000000 | 10 × 400000 |
| Bandages | 5 | 5000000 | 10 × 500000 |
| Nitrile gloves — later ceiling review required | 6.20 | 6200000 | 10 × 620000 |

The 1–5 USDC cases are **individual fixtures**, not a combined funded smoke plan. The later 6.20 fixture was checked locally for exact quantity/price arithmetic; it exceeds the initial 5 USDC accepted ceiling and is not authorized for execution. Real smoke amounts and any ceiling increase require exact approval.

## Verification and remaining gate

Backend checks: **26 test files / 151 tests pass**, typechecking passes, and emitted TypeScript compilation passes. [Local verification evidence](mainnet-local-verification-2026-11-02.json) records source hashes and preservation checks. Verification used an isolated clean install from the unchanged lockfile with the pinned **Node 24.21.0 / npm 12.2.1** toolchain. Registry installation initially timed out; the successful install used integrity-checked cached tarballs. npm 12 blocked install scripts by default, so the locked SQLite dependency's native build ran explicitly with cached Node 24 headers in the temporary copy. The project installation and npm script policy were not changed.

Commands after clean installation: `npm test`, `npm run typecheck`, and `./node_modules/.bin/tsc --noEmit false --rootDir src --outDir dist`. Emit into `dist`, which the test runner excludes; emitting test copies into `build` causes duplicate CommonJS test discovery. Regression coverage includes exact 10/10.000001/25/25.000001 boundaries, one micro-USDC, U128 overflow, profile/DB isolation, identity conflicts, prototype startup before DB creation, and wrong-chain/token/decimals/PO-profile rejection before signing. Live 1Click support and owner-account registration remain open, so MN-01 is not fully closed.

Package manifests, lockfiles, existing toolchain pins, testnet fixtures and runtime environment remain unchanged. No accounts, keys, token registrations, funding, transactions, public APIs or deployments were created by this work.

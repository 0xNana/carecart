# MN-05 — signed Base quote and approval review

**Status: local implementation present; owner reports all delegated backend/unit/Sandbox checks passed on 2026-11-02.** Raw output/counts were not supplied; see the [owner verification record](mainnet-owner-verification-2026-11-02.md). Short TypeScript typechecking, Rust formatting/parsing and static checks were previously observed directly. No live quote was requested, account created, deposit made or wallet transaction signed for this work. G0B identity setup and live MN-03/MN-04 verification remain open.

## Separate adapter and signer trust

`backend/src/intents/settlement.ts` is the Base-only real-quote adapter. Testnet preview/simulation code is unchanged. Asset identities come from supported-token records matched by chain, contract address, symbol and six decimals; missing or ambiguous matches fail closed. The previously blocked live token lookup remains an external release check, not a verified capability.

The provider's [signature documentation](https://docs.near-intents.org/integration/distribution-channels/1click-api/verify-quote-signature) recommends `verifyQuoteSignature()`. CareCart uses the pinned SDK **0.1.26** and its `quoteHash()`/Ed25519 verification, with this source-pinned public signer:

```text
ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc
```

The trust source is the installed SDK's `ONE_CLICK_MANAGER_PUB_KEY` in `dist/index.js`, matching the reviewed key in source. Its reviewed bundle SHA-256 is `d1b3ee8bb610963971328d52e82a90c7db281d9c47fcd77dbc1e32b7d49cce53`. Rotation requires a reviewed source/dependency change; the production adapter/client has no environment override. Pure verification functions accept an explicit fixture trust root for offline tests; live wrappers always use the pinned root.

The SDK signs the UTF-8 bytes of a Base58-encoded deterministic SHA-256 digest. Its signed-field selection is authoritative; hashing arbitrary response JSON is not a signature check. Unsupported execution/request fields are rejected, including memo/alternate deposit addresses, app fees and virtual-chain options. A provider schema change therefore requires review rather than silently broadening the route.

The adapter sends the explicit configured partner token as `X-API-Key`, as documented by the [provider authentication reference](https://docs.near-intents.org/integration/distribution-channels/1click-api/authentication). It does not read EVM/Solana private keys, load dotenv, sign transactions or expose a public API. Requests use the fixed HTTPS provider, reject redirects and use a timeout. The app's existing preview remains independent.

## Persisted evidence and amount bounds

Verified quote records contain:

- Canonical PO and full accepted request/response, signature and provider reference.
- `signedMessage`, exact `signedBytesBase64`, verified `signerPublicKey`, SDK-derived quote identity hash and review hash.
- Signed deposit account, effective expiry, input/output/minimum atoms, fee fields, recipient and treasury refund address.

The provider reference (`correlationId`) is informational; the SDK does not authenticate it as an execution authority. The cryptographically verified quote hash and immutable commitment determine identity. Revalidation compares the stored signer, bytes, message, hashes and **effective expiry** with independently recomputed values. Altering an unsigned `expiresAt` property cannot extend an onchain commitment. Old local quote records without the new evidence fields fail closed; they are not silently reinterpreted or migrated.

All USDC fields are U128-bounded integer strings. `maxFeeAtomic` is now enforced as a conservative **fee/loss budget**, less than the PO input: the existing sum-of-reported-withdrawal-and-refund-fees bound remains, and the signed minimum output must also limit the input-minus-minimum-output loss to that budget. Both assets use six decimals. Withdrawal fees are already included in provider `amountOut`; the summary does not subtract them a second time. This bounds worst-case output including price movement/slippage without claiming the two alternative fee paths are simultaneously charged. Zero minimum input is rejected.

Actual current time controls expiry, including a 30-second handoff margin. Revalidating an older, still-live quote does not require a new provider timestamp, but a future-dated response, expired evidence or changed live asset ID is rejected.

## Human approval and final handoff

`approvalReview()` rechecks the chain/release/roles, live assets/signature, immutable PO/route hash, pending payment and complete onchain quote commitment. It compares attempt ID, PO ID, route ID/version, quote hash, deposit account, signed minimum output and effective deadline. A matching quote hash alone cannot excuse a different minimum or deadline. The native storage budget is bounded and shown explicitly for human review.

The unsigned result includes:

- NEAR input, Base chain ID `8453`, native token addresses, recipient and fixed treasury refund.
- Input, quoted/minimum output, reported fees, fee/loss ceiling and native storage budget; decimal USDC strings are computed locally from atoms.
- Route and quote identity, expiry/handoff cutoff, human signer/receiver, `approve_payment` args, one yocto and gas.

`revalidateApproval(attemptId, reviewedArtifact, journal)` rebuilds the review immediately before a wallet handoff and compares the complete artifact. Changed quote/route/native budget, recipient/refund, expiry, signer/receiver/args/deposit/gas or altered review data is rejected. It returns reconstructed **unsigned** data, never accepts a supplied transaction for execution and never calls a signer. The persisted JSON artifact's property ordering must be preserved for this exact-artifact comparison; changed serialization fails closed.

**Onchain race guard / fresh v2 ABI:** Base approvals now require both `expected_quote_hash` (the signed provider identity) and `expected_commitment_hash` (the complete immutable onchain quote commitment). The latter hashes the ordered JSON array `[attempt_id, po_id, route_id, route_version, signed_quote_hash, deposit_account, deadline_ns, min_amount_out, storage_deposit_yocto]`, with deadline/amount/budget values encoded as decimal strings. It therefore binds the attempt and native budget even if a refreshed attempt reuses the same signed provider quote. The vault checks these before any payment state/reservation change. An old pending wallet transaction cannot approve a replacement attempt. Same-chain approval requires both optional hash fields to be absent/null.

`get_quote_commitment_hash(attempt_id)` is a bounded public view. Shared Rust/TypeScript vectors and a same-signature/replacement-attempt regression cover the hash semantics. Source receipt verification now also checks the exact commitment hash in the approved transaction. Fresh v2 Wasm and updated wallet ABI are required; do not reuse old approval artifacts or deploy over existing state without a separately reviewed migration. The original CCTEST contract ABI is unchanged.

The manual settlement CLI now has a `revalidate` action taking the previously reviewed JSON file. It rechecks finalized source state and rebuilds the unsigned review. This is a read-only operator capability for later configured/approved operations; it is not a wallet approval. MN-07 must wire this final recheck immediately before its explicit human wallet action. No browser signing, scheduling, deployment or live settlement is enabled here.

At dispatch, the v2 contract independently repeats its pause, supplier, policy, route/version/hash and deadline checks, including after asynchronous token registration. It cannot verify the SDK signature or ultimate Base recipient itself. The human/adapter and 1Click remain explicit trust assumptions; only independent Base receipt evidence can establish settlement (MN-06).

## Verification for the owner

Run the long checks and share output:

```sh
cd /home/nana/projects/carecart
nvm use
cd backend
npm run typecheck
npm test
```

Then run the contract checks, including the fresh-Wasm Sandbox:

```sh
cd /home/nana/projects/carecart
cargo test --locked --manifest-path contracts/Cargo.toml -p carecart-safety-vault --test safety
cargo test --locked --manifest-path contracts/Cargo.toml -p carecart-safety-vault --test sandbox -- --nocapture
```

Focused regression files: `src/intents/settlement.test.ts`, `src/intents/settlement-security.test.ts`, `src/intents/approval.test.ts`, `src/near/approval-review.test.ts`. Real cryptographic fixtures cover signer/bytes/signature validation and provider-root rejection. Approval integration fixtures stub provider trust explicitly while testing canonical views and review races; they do not pretend to be live provider evidence. All network/signing capabilities in these tests are mocked.

New cases cover persisted expiry/signer/byte substitution, authenticated but invalid minimum output/U128 bounds, changed/aliased assets, future/stale/expired evidence, pinned production trust, every quote commitment identity field, route changes, native-budget changes and altered wallet gas. Tests also assert that review/revalidation never signs. Rust cases cover the mandatory full commitment hash, matching hash serialization and a stale wallet approval against a different attempt/native budget sharing the same signed quote. Sandbox rebuilds the v2 Wasm and exercises the added approval argument using local test funds only.

Live native-USDC listing compatibility, actual provider-signed responses, wallet integration, deployment bytes and all real-fund actions still require their release/operational gates. The owner reports the local MN-05 regression suites passed; live compatibility and wallet integration remain open.

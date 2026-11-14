# Judge walkthrough

CareCart owns the inventory ledger: staff record receipts, dispensing, consumption and adjustments. Its monitor creates a canonical PO from a shortage. A separate deterministic policy authorizes eligible testnet purchases; two isolated role workers commit/request payment and an independent observer verifies the result. The LLM can assist with proposals but cannot authorize or sign a payment.

## 1. Verify the public payment without keys or private data

```bash
nvm use
npm ci --prefix backend
node --import ./backend/node_modules/tsx/dist/loader.mjs backend/src/ops/testnet-payment-evidence.ts \
  profiles/testnet.payments.json evidence/testnet/autonomous-payment.json
```

Expected: `nativeSettlementVerified: true`, `deltaVerified: true`, a final public transaction, and exact historical balance deltas. This fetches fresh public testnet/archival RPC evidence. The checked-in JSON supplies lookup terms, not trusted receipt truth. No clinic database or signer is needed.

| Record | Expected result |
| --- | --- |
| [Order commitment](https://testnet.nearblocks.io/txns/GkenNfSpQq7YeXfUS6fH5rHhEHKo3kkwV3VbAPtwMK9F) | Restricted committer commits the canonical glove PO. |
| [Supplier payment](https://testnet.nearblocks.io/txns/EsrPBQ9h7AZvASMBLkTDE1TZd1aMwvUF8HtyxfqrmbD) | Final success; `request_payment` by `agent-v2.carecart.testnet`; one 1,500,000-base-unit CCUSD transfer to `medsupply-a.carecart.testnet`; vault callback reports Paid. |
| [Duplicate request](https://testnet.nearblocks.io/txns/CHQWp7kA7veiBmryrRzBvHHE775n9A6XTdQLuSEACDGH) | Final success returns existing Paid state; no additional FT transfer. Supplier remains at 3,000,000 base units. |
| Historical balances | Supplier 1,500,000 → 3,000,000; vault 3,500,000 → 2,000,000 at the transfer block. |
| [Headless inventory trace](evidence/testnet/headless-sprint.json) | 54 gloves → consumption of 28 → 26; still 26 after payment; separate synthetic receipt of 30 → 56. Duplicate goods receipt adds zero. |

This is a genuine public testnet payment with synthetic inventory/quotes and a controlled test supplier. CCUSD has no cash value and is not Circle USDC. There was no mainnet or Intents settlement, live AI inference in this run, real distributor integration, or real physical shipment.

## 2. Match the deployed source

```bash
bash scripts/reproduce-deployed-vault.sh
```

Expected: Rust 1.93.0/cargo-near 0.22.0 rebuild the exact archived revision, SHA-256 hex `979c178881f12ce6694ea804d9374af3606b55dbb0b8074434e791d5c9b0b71e`, NEAR Base58 code hash `BCpcRunpuzhjrshyq1yrKtsmABrAAPy6ZFmMrUvUUqK3`, and byte-for-byte agreement with independently retrieved public code. The script performs no deployment. The current Rust source and Cargo.lock match the archived revision; later package-metadata/container builds produce a different artifact. See the [source verification evidence](evidence/testnet/vault-source-verification.json).

## 3. Reproduce the stock workflow offline

```bash
npm ci --prefix web
bash scripts/verify-phase2.sh
node scripts/mvp-browser-acceptance.mjs /tmp/carecart-phase2-verify.REPLACE_WITH_PRINTED_SUFFIX
```

Expected: all checks pass, then a real local browser records receiving, dispensing, consumption and adjustment; the background worker creates one PO; a separate goods receipt increments inventory once; restart creates no duplicate order. Set `CARECART_CHROMIUM_BIN` if Chromium is not `/snap/bin/chromium`. Add `--headed` for a visible window.

This isolated browser fixture makes **no public payment**. Its payment state remains Unobserved. The public payment in section 1 is separately verifiable and must not be presented as a transaction from this offline fixture.

## 4. Inspect the completed live case in the owner's local app

The owner retains the private clinic database and protected runtime configuration. From a verified source snapshot, start `bash scripts/serve-testnet-payments.sh SNAPSHOT`, sign in as the clinic administrator, then:

1. Open Inventory/Activity and find the sprint consumption. Expected: the recorded synthetic consumption moves 54 to 26.
2. Open Replenishment and the generated glove PO `tn-po-9d89fce0612cd51f625efe1c0a9b87b1b23febd67fbafdb7401de804`. Expected: 30 units, 1.5 CCUSD, the approved supplier and canonical order reference.
3. Open its purchase activity. Expected: separate committer/requester authorizations were issued by automatic policy version 1; both are Observed. There is no per-order human wallet signature.
4. Inspect payment status and the explorer link. Expected: Paid/SameChainConfirmed and a separately verified supplier receipt; the link matches section 1.
5. Open the duplicate-request explorer link. Expected: no additional transfer, unchanged supplier balance.
6. Inspect the separate synthetic delivery record. Expected: 26 to 56; a replay adds no units.
7. Open Payments → Automatic purchasing. Expected: the bounded sprint activation is disabled. Normal clinic policies require a verified control wallet and explicit item/supplier/amount selection. Do not enable another payout merely to inspect this demonstration.

Browser verification of the new public-policy panel is an owner-run procedure; the terminal evidence and build/tests do not claim a browser capture of that panel. No private clinic database is committed. A fresh-clone judge can complete sections 1–3.

## 5. Reproduce policy defenses

```bash
cargo test --manifest-path contracts/Cargo.toml --locked --workspace
npm test --prefix backend -- src/tenancy/automatic-purchasing.test.ts src/tenancy/testnet-payments.test.ts src/tenancy/treasury.test.ts
```

Expected: allowed requests pay, an unknown supplier is blocked, hard/daily caps cannot be overridden by admin approval, eligible above-automatic-threshold orders wait for a human, pause prevents dispatch, duplicates cannot pay again, and queued automatic permits fail after revocation/change. The Rust suite includes genuine local Sandbox receipt execution. Backend RPC fixtures are explicitly mocked; do not label them public chain effects. Public supplier success and duplicate idempotency are the two public scenarios executed in this sprint.

The normal public tenant admin-wallet handoff remains disabled; above-threshold app orders are held. Valid human approval is demonstrated in local Sandbox. The one-order owner grant is a disclosed host control-plane authority, not a forged clinic login. The vault full-access upgrade key can replace code; see the public [safety and authority guide](https://docs.carecart.xyz/safety-and-data).

## 6. A 90–150-second presentation

| Time | Show | Expected result |
| --- | --- | --- |
| 0–20 s | Stock activity/terminal trace | Synthetic consumption creates the shortage; stock becomes 26. |
| 20–40 s | Canonical glove PO | Approved supplier, 30 units and 1.5 CCUSD. |
| 40–65 s | Automatic authorizations and payment | Two role authorizations, Paid state and genuine explorer receipt. |
| 65–85 s | Supplier balance proof | Exact +1,500,000 base-unit credit, independently observed. |
| 85–105 s | Duplicate-request receipt and defense tests | Zero additional transfer; label Sandbox/backend scenarios correctly. |
| 105–125 s | Physical delivery activity | Stock becomes 56 once, separately from payment. |
| 125–140 s | Policy/authority explanation | Preapproved limits; no agent treasury funds; completed grant disabled. |

Only show observed results. The completed run is reproducible through source, tests and fresh public reads; replaying its historical data is not a new payment.

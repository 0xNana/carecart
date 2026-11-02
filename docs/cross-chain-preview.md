# Cross-chain preview (CC-12)

The current app is testnet-first. The human plans a later mainnet deployment for actual cross-chain payments; CC-12 implements previews only. It adds no deposit, signing, settlement, or swap-status operation and does not change the wallet network. Mainnet settlement needs a separate implementation and reviewed deployment.

NEAR Intents [has no testnet deployment](https://docs.near-intents.org/resources/faqs). The default offline adapter therefore simulates a destination route for a stored synthetic PO. It resolves the supplier and amount from backend records and uses a visibly invalid placeholder destination such as `simulation:supplier-000001:base`. This is not a registered live cross-chain address, exchange rate, or deliverable output quote. Simulation does not change the PO, payment, or audit state.

## API and UI

- `GET /api/intents/config` reports simulation mode, supported mock destinations (`base`, `arb`, `sol`), optional dry-quote availability, and `settlementEnabled: false`.
- `POST /api/intents/preview` accepts only `{ "purchaseOrderId": "po-000001", "destinationChain": "base" }`. Unknown POs return 404; extra payee, amount, supplier or `dry` fields return 400. There is no client-controlled recipient.
- `POST /api/intents/dry-quote` accepts only `{}` and uses a separate server-configured route and amount. It returns 503 unless explicitly enabled.

Every response uses `status: preview_only` and `settlement: not_initiated`. Structured logs say `cross_chain_preview` with `mock_simulation` or `oneclick_dry_preview`; they never contain raw provider payloads, credentials, or deposit instructions. The web proxy exposes these preview routes with same-origin checks for POST. Deposit and settlement endpoints are absent.

The dashboard panel follows the purchase-order records. Select a stored PO and a simulated destination, then click **Run offline simulation**. The result names the registered supplier, exact synthetic amount, placeholder destination, and the stop before deposit/settlement. The UI states **Simulation only · No settlement** and **Settlement not initiated**. Loading, empty-order and retry/error states are provided.

## Optional dry market data

The optional adapter is disabled by default, even if `ONECLICK_JWT` is already set. To enable it later, the human reviews the following backend-only settings:

```dotenv
ONECLICK_PREVIEW_ENABLED=true
ONECLICK_PREVIEW_ORIGIN_ASSET_ID=
ONECLICK_PREVIEW_DESTINATION_ASSET_ID=
ONECLICK_PREVIEW_AMOUNT_ATOMIC=
ONECLICK_PREVIEW_RECIPIENT=
ONECLICK_PREVIEW_REFUND_TO=
```

Empty values are incomplete configuration and fail startup when enabled. Use exact asset IDs from the current token list, an explicit whole atomic input amount, and human-provided recipient/refund addresses appropriate to their chains. No mainnet address or asset ID is invented by this feature. Existing `ONECLICK_JWT` is optional and stays server-side; `ONECLICK_BASE_URL`, if supplied, must equal the official HTTPS origin.

On each explicit dry-preview request the adapter fetches [`GET /v0/tokens`](https://docs.near-intents.org/api-reference/oneclick/get-supported-tokens), validates its token metadata, and resolves both configured IDs exactly from that fresh list. It supports a NEAR origin and a Base, Arbitrum or Solana destination. It then calls [`POST /v0/quote`](https://docs.near-intents.org/api-reference/oneclick/request-a-swap-quote) with `dry: true`, `EXACT_INPUT`, 100-bps slippage, a ten-minute request deadline, and the configured amount, recipient and refund address. The quoted amount is independent of CCTEST orders; no conversion from a test PO to mainnet token units occurs.

The response validator follows the documented required `QuoteResponse`, `QuoteRequest` and `Quote` fields and the installed official SDK 0.1.26 types. It requires a dry echo matching every sent field, exact input amount, valid atomic outputs, and minimum output no greater than estimated output. A dry response's quote must omit deposit addresses, memos, chain deposit addresses, deadline and inactive-time fields; the request echo still includes its deadline. Nonconforming responses fail closed. The normalized UI result contains only indicative amounts and route details, with `quoteNetwork: mainnet_market_data` and `unrelatedToTestPurchaseOrder: true`.

No quote-signature verification or settlement-authenticity claim is made for this informational preview. Provider signatures and raw responses are not forwarded to the browser. Future funding/settlement code must have its own quote verification and transaction review; it cannot reuse this preview as approval to pay.

## Verification

`npm test --prefix backend` covers fully offline mock routes for all three destinations, unchanged persisted state, payee/amount overrides, unknown POs, disabled configuration, documented dry-response fixtures, exact live-list asset resolution, unsupported routes, wet responses, leaked deposit fields, mismatched recipients/amounts, malformed data, and sanitized transport failures. A supplier-message regression test confirms an actual drafted PO retains its registered supplier and amount despite a redirect instruction.

Web lint and the production Webpack build pass. Real-browser checks exercised Base and Solana simulations and responsive layouts at 320, 768, 1024 and 1440 pixels, with no page overflow or console errors. Local HTTP checks verified forbidden payee overrides (400), wet-quote overrides (400), unconfigured dry quotes (503), foreign-origin requests (403), and deposit endpoints (404).

The optional live 1Click quote was not requested: no mainnet route/recipient configuration has been supplied. Its documented schema and failure cases are validated using injected HTTP fixtures without network access. No public transaction was signed for CC-12.

# Wallet handoff fix and CLI fallback — 2026-11-02

> **Current testnet state (2026-11-02 10:01 UTC):** Payment processing is **Active** (`is_paused=false`) after the human-requested [resume transaction](https://testnet.nearblocks.io/txns/DfKGXzjhZ3h8eMSAKcf5EcJwTbX1ac1gqWjeXBPUJq5f), with FINAL success and zero failed receipts. Vault balance remains 10000 CCTEST. The earlier `po-000002` stays Blocked/Paused; resume does not retry it. Refresh vault to replace an older UI snapshot. [Verification](testnet-resume-verification.json).

The reported “Waiting for wallet…” text came from the transaction review after Continue. The app kept a native `showModal()` dialog open while NEAR Connect mounted its wallet interface under `document.body`. A native modal makes the rest of the document inert and occupies the top layer; an ordinary wallet overlay cannot fix this by raising its CSS z-index. The installed connector's `Popup.create()` appends its overlay to the body. The obstruction was reproduced in an isolated browser fixture with a fake, non-signing wallet; the real external wallet's specific response was not captured.

The fix closes the native review synchronously on the explicit Continue click, then clears review state before account checks and signing. Review, cancellation, configured testnet/admin checks, canonical PO checks and the final explicit wallet authorization remain required. No key, automatic signing, mainnet route or browser payment endpoint was added.

## Bounded waits and unresolved transactions

- Connector load/account/disconnect and signing preflight checks have bounded waits (15 seconds; initial wallet connection allows 45 seconds). A timed-out preflight ends before signing; a late preflight response cannot continue into a transaction.
- After 45 seconds without a signing response, the app explains that the original request may still complete. It stops the generic busy display, keeps new signing/connection controls disabled, and leaves read-only vault refresh available. It observes late success/rejection and refreshes canonical state, without re-sending anything.
- A timeout or page reload is **not cancellation** of a wallet transaction. Close/reject the original wallet request and inspect the wallet history and canonical vault/payment state before using a different signing path. Redirects and missing outcomes still do not report success.

Reload [the fixed judge app](http://127.0.0.1:3102/#vault) after closing the old wallet prompt. Reconnect the supplied testnet admin, review resume, then confirm only the intended transaction in the wallet. The fixed production build is running on ports 3102 and 3002; 3102 uses the configured isolated testnet backend on 3101.

## Human-run CLI fallback

The CLI path can complete the testnet demo if a particular browser/wallet environment still does not respond. It does not establish successful browser-wallet verification. First reject/close any old wallet request and check current state:

```sh
near contract call-function as-read-only vault.carecart.testnet is_paused empty-args network-config testnet now
```

If it is already `false`, do not sign resume again. If it remains `true` and you want to resume, the exact human-run command is:

```sh
near contract call-function as-transaction vault.carecart.testnet set_paused json-args '{"paused":false}' prepaid-gas '100 Tgas' attached-deposit '0 NEAR' sign-as admin.carecart.testnet network-config testnet sign-with-keychain --signer-public-key ed25519:6MUQgVsfivFVaCo6P8ZEL4ENr9XHueMXndfX1EHSnh5z send
```

This is an actual testnet transaction: admin signer, vault receiver, `set_paused({"paused":false})`, 0 attached NEAR, 100 Tgas; gas comes from the existing admin balance. Verify the CLI's `testnet` connection really reports testnet. The retained Ed25519 key stays in the CLI keychain; no admin secret is exported. The debugging task did **not** execute this command.

A final read-only check found that `po-000002` was already committed and requested at 09:36 UTC while paused. Canonical state is `Blocked` / `Paused`, with 10000 CCTEST still in the vault. Its request hash is [6qShKi…76xD](https://testnet.nearblocks.io/txns/6qShKisW753E78Vq8LygQugoQMnWM38cLDJ5gr7b76xD); commitment hash is [mV4SFV…YXyb](https://testnet.nearblocks.io/txns/mV4SFVgkbm4aK51MGWTRvFmPXvTbPDmeY6iA743YXyb). The debugging agent did not submit either transaction. Do not retry the old PO or delete/reset its records. After confirmed resume, draft and review a new PO for a new test. The earlier [payment review](testnet-payment-review.json) is now historical/blocked, not a runnable fresh-payment proposal.

## Evidence and limits

Nine wallet/RPC tests (three new timeout/late-response regressions), four proxy-body cases, web lint and the production Webpack build pass. The offline browser fixture verified:

1. Before: `dialog:modal` remained open while the fake wallet overlay existed in the body.
2. After: review modal closed; the fake wallet approval/reject button was visible and clickable.
3. With the fixture watchdog shortened to two seconds: read-only refresh stayed enabled, new signing stayed disabled, and late rejection removed the unresolved state and unlocked controls.

Screenshots: [before](evidence/wallet-overlay-before.png), [accessible offline wallet overlay](evidence/wallet-overlay-after.png), and [fixed public-read-only app](evidence/wallet-fixed-preview.png). The fixture had no real signer and never used the public payment route. These are UI recovery checks, not a successful real-wallet signature or payment claim. Final canonical state is paused with 10000 CCTEST and the above blocked PO. No public transaction was initiated by the debugging agent.

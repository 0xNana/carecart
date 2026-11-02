# Testnet backend and human-wallet smoke test

> **Current testnet state (2026-11-02 10:01 UTC):** Payment processing is **Active** (`is_paused=false`) after the human-requested [resume transaction](https://testnet.nearblocks.io/txns/DfKGXzjhZ3h8eMSAKcf5EcJwTbX1ac1gqWjeXBPUJq5f), with FINAL success and zero failed receipts. Vault balance remains 10000 CCTEST. The earlier `po-000002` stays Blocked/Paused; resume does not retry it. Refresh vault to replace an older UI snapshot. [Verification](testnet-resume-verification.json).

> **Later state check (2026-11-02 09:48 UTC):** `po-000002` has already been committed/requested and is **Blocked: Paused**. No CCTEST moved. Its public hashes are in [wallet recovery](wallet-recovery.md). Do not run the historical payment command below or reset its database. After a confirmed resume, create/review a fresh PO.

**2026-11-02:** The two existing restricted Ed25519 keys were retrieved from their exact local keychain entries, checked against live on-chain permissions and locally verified for key possession. Only those restricted keys were written to ignored `.env.testnet` with mode **0600**. No admin/recovery key was read or exported. The new ignored database `backend/data/testnet-smoke.sqlite` has Alpha/Beta mappings; the earlier judge database is preserved. Backend port **3101** now runs this profile, and the existing web preview at **3102** reads it. The vault remains paused with 10000 CCTEST. Preparation sent **zero public transactions**.

Evidence: [readiness](testnet-backend-readiness.json). A fresh synthetic **po-000002**, 14 boxes / **1680 CCTEST**, is drafted for **medsupply-a.carecart.testnet**. It is not committed, requested or paid. See the [exact three-transaction review](testnet-payment-review.json) before any resume/payment action.

## Check or restart the configured backend

From the repository root, with the pinned Node version on PATH:

```sh
bash scripts/configure-testnet-backend.sh --check
```

This reads the saved configuration and public RPC, verifies key possession/permissions, deployed byte hashes, token/admin/policy, supplier allowlist/storage and committer/storage reserve. It prints public IDs and readiness only. It does not sign a transaction. A local cryptographic self-test signs an in-memory diagnostic message, not a blockchain or wallet authorization. The testnet keys are server-only; never put `.env.testnet` in the web project or share its contents.

The backend is already running. If it has stopped, start it with:

```sh
node --env-file=.env.testnet backend/node_modules/tsx/dist/cli.mjs backend/src/server.ts
```

This loads the restricted keys without placing them in command arguments and uses the isolated database on loopback:3101. Do not start a second listener if that port is already occupied. Normal README judge commands still use blank root `.env` and do not enable signing.

For a different machine, first supply/recover the existing restricted identities through its local keychain. The one-time preparation command is:

```sh
bash scripts/configure-testnet-backend.sh --configure
```

**Already completed here; do not rerun to reset the database.** The helper refuses existing preparation files, wrong networks/artifacts/assets, full-access/extra-method keys, missing gas allowance and a previously committed seed PO. Supplier mapping accepts only untouched synthetic fixtures; it cannot silently remap a live procurement database. No key is created/rotated. The Linux reader uses PyGObject/libsecret and the exact service/username naming from the [official near-cli-rs v0.30.1 implementation](https://github.com/near/near-cli-rs/blob/v0.30.1/src/common.rs). Permission checks precede secret loading; private data travels only through a dedicated process pipe, never stdout. Locked/missing keychain entries fail closed without exporting recovery keys.

## Human browser-wallet step

If an older page is stuck on “Waiting for wallet…”, close/reject its wallet request and reload the fixed app before retrying. See [wallet recovery and human-run CLI fallback](wallet-recovery.md); never submit the same action concurrently through a stuck wallet and the CLI.

1. Open [Testnet vault & wallet](http://127.0.0.1:3102/#vault) and refresh the page after the backend switch. Choose **Connect testnet wallet**.
2. Select a testnet wallet already containing **admin.carecart.testnet**. CLI keychain availability does not import that account into a browser wallet. Any wallet recovery/import must be done by the human in the trusted wallet interface; do not share seed phrases or keys in chat or app configuration.
3. Connection alone should not sign or authorize a function-call key. Confirm the connected account and testnet label. If the wallet does not contain the admin, stop before trying an admin action.
4. To resume, choose **Review resume payments**. Review signer `admin.carecart.testnet`, receiver `vault.carecart.testnet`, method `set_paused`, args `{"paused":false}`, deposit **0 NEAR**, gas **100 Tgas**. Only continue and confirm in the wallet if those are the intended values.
5. Refresh canonical state and confirm it is resumed before submitting a payment. Wallet ownership/signing remains unverified until the human completes this step and the final chain result is checked. No browser-wallet action was performed during backend preparation.

## Historical exact payment test — now blocked

The [review](testnet-payment-review.json) covers **po-000002 only**, **1680 CCTEST** to registered Alpha. Backend submission will sign two zero-deposit transactions: committer `commit_purchase_order` with the canonical PO fields and agent `request_payment` with only the PO ID, **120 Tgas each**. The vault then attaches one yoctoNEAR internally to the mock FT transfer and settles through its private callback. Gas and commitment storage use the already reviewed accounts/reserve. No cross-chain path is involved.

After the human has reviewed that exact test and resumed the vault, the human can initiate it with:

```sh
# Historical command: po-000002 is now Blocked/Paused. Do not rerun.
# Use a fresh reviewed PO after confirmed resume.
```

**This is a real testnet signing command, not a dry run.** Do not run it while paused; that records a blocked request. It transfers only synthetic, valueless CCTEST when the contract permits. The backend derives payee/token/amount from stored records; the browser/agent cannot supply replacements. If code, PO, policy, recipient or amount differs from the review, stop and prepare a new review.

Expect a canonical `Paid` result only after successful FT receipts; otherwise inspect the returned pending/blocked/failed state. Refresh purchase orders and canonical payment status in the app, and verify the returned public transaction hashes, supplier/vault balance changes and audit record. A timeout is not permission to invent a result or submit a different PO; reconcile the canonical record first. Review a final pause separately when the human is finished. No public signing was performed by this preparation task.

Verification for this addition: **68 backend tests**, including four new readiness/mapping cases, and strict typecheck pass. Bash/Python syntax and the Python reader's direct-invocation refusal pass. The actual local backend and web proxy both expose the fresh draft PO. Admin browser signing and this exact public payment remain pending human execution/approval.

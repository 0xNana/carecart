# Testnet account plan

The human selected `carecart.testnet` as the project namespace on 2026-11-01. On 2026-11-02, read-only testnet RPC queries verified all ten accounts. The latest check at blocks 275861551–275861554 verifies one Ed25519 full-access key plus the original ML-DSA-65 recovery key on `admin.carecart.testnet`, and a separate Ed25519 function-call key on each of committer and agent. That pre-deployment snapshot had empty code hashes. Later on 2026-11-02 the human approved all twelve testnet deployment/setup steps; both contracts are now deployed and verified. See [deployment receipts and final state](testnet-deployment.md). Private keys were not read or exported during verification.

The installed `near-api-js` supports ML-DSA-65. An ephemeral local key-generation, encode/decode, signing and signature-verification self-test passed without using the human's keys or signing an on-chain transaction. Existing Sandbox backend coverage uses Ed25519. The approved public token/vault deployments and treasury funding now verify CLI ML-DSA-65 signing; admin setup used the retained Ed25519 key. Browser-wallet ML-DSA-65 integration and live app PO payment signing remain unverified. Signature scheme and permission are separate: the existing ML-DSA-65 full-access keys belong in the human wallet/CLI keychain, while the backend requires separate method-restricted function-call keys.

| Account | Purpose | Verified test NEAR (2026-11-02) |
| --- | --- | ---: |
| `carecart.testnet` | Parent namespace and child-account funder | 1.6358750941625 |
| `vault.carecart.testnet` | Policy vault contract | 2.5 |
| `token.carecart.testnet` | In-repo test-only token contract | 2.5 |
| `admin.carecart.testnet` | Human wallet approvals, policy and pause | 1.5 |
| `treasury.carecart.testnet` | Synthetic token funding | 0.5 |
| `committer.carecart.testnet` | Separate PO committer identity | 0.5 |
| `agent.carecart.testnet` | Request-only payment identity | 0.5 |
| `medsupply-a.carecart.testnet` | Synthetic supplier Alpha | 0.1 |
| `medsupply-b.carecart.testnet` | Synthetic supplier Beta | 0.1 |
| `rogue.carecart.testnet` | Unlisted-supplier demo | 0.1 |

The nine children received 8.3 test NEAR in total. The table preserves the account-creation snapshot, before deployment. Updated post-setup balances/code hashes are in [final deployment verification](testnet-deployment-verification.json). The current prototype has two registered suppliers. No guardian or cross-chain settlement account is needed by the implemented contract.

Account creation is complete. The commands below are retained as setup reference; do not recreate these accounts.

Root-creation command:

```sh
near account create-account sponsor-by-faucet-service carecart.testnet autogenerate-new-keypair --signature-scheme ed25519 save-to-keychain network-config testnet create
```

Check its balance and print complete child-creation commands:

```sh
near tokens carecart.testnet view-near-balance network-config testnet now
bash scripts/plan-testnet-accounts.sh carecart.testnet
```

The default planner only prints commands. For future setup or recovery of missing children, creation mode can be run from the repository root in an interactive terminal:

```sh
bash scripts/plan-testnet-accounts.sh carecart.testnet --create-children
```

Creation mode verifies the testnet RPC, checks the parent and each child, skips existing children without changing their keys, and shows the exact CLI command before every missing-account creation. Type `CREATE` followed by the complete child ID when prompted to authorize that transaction. Any other input stops. A failed CLI operation stops the script; rerunning checks existing accounts before continuing. Existing-account key ownership is not verified by the script. Review each transaction before running it. Account creation does not deploy contracts, grant vault roles, register token storage, or configure backend signing keys. Keep full-access recovery keys in the human's wallet/CLI keychain. For CC-11, the human must control the admin account in a testnet wallet. The later backend keys must be separate function-call keys restricted to `commit_purchase_order` and `request_payment`, respectively; account-creation full-access keys must never be copied into backend configuration.

This plan follows the role separation in `DESIGN.md` and the testnet scope in `implementation.md`, which supersedes the older design's mainnet target.

## Ed25519 keys for the app

On 2026-11-02, the human requested Ed25519 for NEAR wallet/tooling compatibility. ML-DSA-65 is also supported natively by NEAR; existing accounts and recovery keys remain valid. Account-creation commands now explicitly select `--signature-scheme ed25519` for future accounts. This does not change keys on existing accounts.

The human has added the Ed25519 admin key and both restricted backend keys. The following backend-key commands are retained as reference only; do not rerun them to check status, because each execution adds another key:

```sh
near account add-key committer.carecart.testnet grant-function-call-access --allowance '0.25 NEAR' --contract-account-id vault.carecart.testnet --function-names commit_purchase_order autogenerate-new-keypair --signature-scheme ed25519 save-to-keychain network-config testnet sign-with-keychain send

near account add-key agent.carecart.testnet grant-function-call-access --allowance '0.25 NEAR' --contract-account-id vault.carecart.testnet --function-names request_payment autogenerate-new-keypair --signature-scheme ed25519 save-to-keychain network-config testnet sign-with-keychain send
```

The admin key stays in the human-controlled wallet/keychain. Only the restricted committer and agent keys belong in backend configuration. RPC verification confirms each backend key targets only `vault.carecart.testnet`, permits only its respective method, and has a 0.25 test NEAR gas allowance. The original ML-DSA-65 full-access recovery keys remain on both accounts. Vault roles and contract deployment are now configured by the approved setup. Both restricted private keys are now retrieved/validated and configured only in ignored owner-only `.env.testnet`; [readiness evidence](testnet-live-setup.md) is recorded. Browser-wallet import/ownership remains unverified; no full-access key belongs in application env.

On 2026-11-02, the human explicitly authorized removing duplicate admin keys. The CLI keychain identified `ed25519:6MUQgVsfivFVaCo6P8ZEL4ENr9XHueMXndfX1EHSnh5z` as available locally; this key successfully signed the cleanup transaction. Three other Ed25519 admin keys were removed in [transaction DBVQiB4MFdcB3ii2vHxsVvmUSy55LECbnFYwdRpFKpfS](https://explorer.testnet.near.org/transactions/DBVQiB4MFdcB3ii2vHxsVvmUSy55LECbnFYwdRpFKpfS). The post-transaction RPC check confirms exactly one Ed25519 full-access key and the original ML-DSA-65 full-access recovery key remain on the admin account. No local credential files were deleted. Successful CLI signing establishes access through the keychain; browser-wallet access remains unverified.

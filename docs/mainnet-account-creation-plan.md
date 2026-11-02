# Mainnet subaccount creation — carecartxyz.near

**Status: planning only; no creation or funding commands executed.** The owner selected `carecartxyz.near` as the replacement parent to avoid the Ledger workflow. Existence, owner control, wallet app, CLI signing access, child custody and exact native amounts remain unverified. Previous Ledger/Meteor details for `carecart.near` do not establish custody of the new parent.

The local CLI is `near-cli-rs 0.30.1`. The [official CLI guide](https://github.com/near/near-cli-rs/blob/main/docs/GUIDE.en.md#use-manually-provided-public-key---use-the-provided-public-key-manually-fund-myself) documents `fund-myself`, assigning a specified child public key and signing with an existing parent keychain. The actual replacement parent signer/keychain is not yet verified. The [NEAR account model](https://docs.near.org/protocol/accounts-contracts/account-id#named-address) distinguishes a parent's ability to create a subaccount from subsequent control of that account.

## Signer and key assignment

`carecartxyz.near` is the proposed creation signer and native-funds source. A non-Ledger signing method must be selected and verified for that parent. Each child separately receives its intended public access key; parent signing does not establish child custody or continuing parent control.

| Proposed child | Key/custody plan to review |
| --- | --- |
| `vault.carecartxyz.near` | Human-held deploy/upgrade/recovery key; offline/cold during judging; never in backend env |
| `admin.carecartxyz.near` | Human-wallet custody; owner selects wallet/signing method and verifies access |
| `treasury.carecartxyz.near` | Human-wallet custody; owner selects wallet/signing method and verifies access |
| `guardian.carecartxyz.near` | Independent pause-only identity; custody selection pending |
| `committer.carecartxyz.near` | Human-held recovery authority plus a separately provisioned restricted committer key; worker has no recovery key |
| `agent.carecartxyz.near` | Human-held recovery authority plus a different restricted requester key; worker has no recovery key |
| `supplier-a.carecartxyz.near` | Owner-controlled synthetic receiver; key/custody selection pending |
| `supplier-b.carecartxyz.near` | Owner-controlled synthetic receiver; key/custody selection pending |
| `supplier-c.carecartxyz.near` | Owner-controlled synthetic receiver; key/custody selection pending |

Human admin and treasury remain wallet-held under the approved scope; the deployer remains offline/cold during judging, and restricted worker keys remain isolated. Avoiding Ledger for the parent does not authorize moving human full-access keys into backend environment files. A guardian's independent identity/custody must be selected explicitly.

## Owner-run first step — read only

```sh
near account view-account-summary carecartxyz.near network-config mainnet now
```

This reads public chain data and does not create an account, install/export keys, sign a transaction or move funds. Share the public output. If the account is absent, that establishes a separate parent-account creation step; if it exists, its public key listing alone does not prove owner control. No Ledger command is required by this plan.

## Transaction package still to prepare

After public-key matching and custody/name selection:

1. Check existence of all proposed children. Existing accounts require reviewed control evidence; do not overwrite or blindly retry creation.
2. Record the exact public key and permission assigned to each new account. Distinct committer/requester restrictions are provisioned separately; worker processes must not possess parent/admin/recovery keys.
3. Review exact per-account initial NEAR amounts and the total native budget including fees. Vault code/state storage sizing must use the reviewed fresh release artifact; a guessed uniform allocation is not a deployment-storage estimate. USDC funding is a separate package.
4. Prepare complete CLI commands using explicit `network-config mainnet`, the verified parent signing method, and final send actions. Present the exact accounts, keys and amounts for owner approval before execution.
5. The owner runs the approved creation commands and shares public receipts. Reconcile each account's keys, balance and custody access before proceeding. Stop on mismatch or an ambiguous response.

The [G0B identity roster](mainnet-identities.md), candidate manifest and approval gates remain authoritative. The candidate retains `deployment: null`; this preparation neither supplies fake public keys nor authorizes account creation/funding/deployment.

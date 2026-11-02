# G0B mainnet identities and control evidence

**Status: collecting owner inputs; G0B remains open.** Selecting identities does not authorize account creation, key changes, signing, registration, funding or deployment. Account existence, owner confirmation and cryptographic control proof are recorded separately. No private keys or seed phrases belong in this document.

## Owner-confirmed input

The current selected parent is **`carecartxyz.near`**, chosen by the owner to avoid the Ledger workflow. Account existence/control and its wallet app/signing method are still pending. The earlier owner report of `carecart.near` on Ledger through Meteor is superseded for this plan; it is not evidence of the replacement account's custody.

| Field | Recorded value | Evidence status |
| --- | --- | --- |
| Proposed project parent | `carecartxyz.near` | Name selected by owner; existence, owner control and public-key lookup pending |
| Parent custody | Non-Ledger workflow requested | Wallet app, actual custody, CLI signing access and control proof pending |
| Base receiving address | `0x52F016116508986c6ef2419266075cD7C4C01434` | Local `EVM_PRIVATE_KEY` public-address derivation matches. No signing, network transaction or wallet-transport test performed. |
| Solana receiving address | `Hxt3bDQ7Ag8ZASUxAFFrK2sbTHpRGTY6zsbshLg5D3JT` | Owner-supplied; Solana settlement remains deferred from launch scope |
| Receiver-wallet private-key custody | Owner reports adding Base/Solana private keys to ignored `.env` | File is untracked, ignored and mode 0600. Base key/address match verified locally; no recognizable Solana secret variable identified, so Solana matching remains unverified. No private values recorded here. This is receiver software-key custody, separate from the NEAR parent custody decision. |
| Mainnet account creation | None performed by this workflow | Exact account/key/native-budget package not yet approved |
| Mainnet funding | None performed by this workflow | No exact NEAR/USDC funding authorization recorded |

## Proposed role roster — awaiting owner selection

These names are proposals under the owner-confirmed parent. They are **not** availability, ownership or custody evidence, and are not deployment configuration.

| Role | Proposed identity | Required custody/control |
| --- | --- | --- |
| Parent / account-creation signer | `carecartxyz.near` | Wallet/signing method and public control proof pending |
| Vault / upgrade authority | `vault.carecartxyz.near` | Reviewed deployment key; offline/cold recovery custody during judging |
| Human admin | `admin.carecartxyz.near` | Human wallet; exact signing/custody arrangement pending |
| Fixed treasury / NEAR refund | `treasury.carecartxyz.near` | Human wallet; exact custody pending; immutable in initialized vault |
| Pause-only guardian | `guardian.carecartxyz.near` | Independent identity; owner selects custody arrangement |
| PO committer | `committer.carecartxyz.near` | Restricted role key in isolated committer process; recovery custody separate |
| Payment requester / agent | `agent.carecartxyz.near` | Different restricted key in isolated requester process; recovery custody separate |
| Synthetic supplier Alpha | `supplier-a.carecartxyz.near` | Owner-controlled receiver; public control/registration evidence pending |
| Synthetic supplier Beta | `supplier-b.carecartxyz.near` | Owner-controlled receiver; public control/registration evidence pending |
| Synthetic supplier Gamma | `supplier-c.carecartxyz.near` | Owner-controlled receiver; public control/registration evidence pending |
| Base USDC destination | `0x52F016116508986c6ef2419266075cD7C4C01434` | Local key/address match verified; receiver custody acknowledged as software-key custody. No payout authorized or performed. |

The three suppliers are synthetic. No extra rogue account is selected or created here. The NEAR refund destination is proposed to be the fixed treasury; a quote must bind that exact reviewed account before approval.

## Inputs still needed

1. Confirm control and wallet app for `carecartxyz.near`, then select admin/treasury/guardian custody and the proposed child names. Do not carry the old parent's Ledger/Meteor custody claim to this account.
2. Confirm the Base receiver custody arrangement before any payout. Local key/address matching passed; wallet transport and a live payment are untested. The Solana address is recorded for future scope only and remains unverified.
3. Read-only mainnet existence/key checks for the selected accounts, followed by exact, separately reviewed control-proof steps. A public access-key listing alone does not prove the user possesses the key.
4. Selected public committer/requester keys, their explicit method scopes and finite gas allowances. Do not generate, install, delete or export keys implicitly.
5. Exact NEAR account/storage/gas budget and maximum USDC at risk. The approved initial 5 USDC accepted ceiling is policy, not a funding authorization.

The full G0B gate also includes operator/hosting/auth and recovery arrangements from [the primary checklist](../mainnet-todo.md). Completing this identity roster alone does not close those requirements.

The backend loads the root `.env`. Receiving payments does not require receiver private keys in the application environment. Keep proof/receiver-wallet secrets in a separate local ignored file or wallet custody arrangement; the existing files were not moved or edited by this verification. Local matching derived the EVM public address in memory and printed only the public result and match status.

## Read-only first check for the owner

The [CLI creation plan](mainnet-account-creation-plan.md) records the revised children, separate key/custody requirements and owner-run public account check. The parent signing method is pending; child custody is assigned explicitly.

```sh
near account view-account-summary carecartxyz.near network-config mainnet now
```

This reads public account data; it does not require Ledger signing or move funds. Share the public output for review. Longer commands remain owner-run. Do not run an account-creation or funding command until its exact identities, public keys, costs and actions are reviewed.

The [mainnet candidate](../profiles/mainnet.candidate.json) retains `deployment: null` until the required operational values and evidence are available. The approved MN-00 record is unchanged.

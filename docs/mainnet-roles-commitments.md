# MN-03 / MN-04 — roles, recovery and immutable commitments

**Status: local implementation present; owner reports all delegated backend/unit/Sandbox checks passed on 2026-11-02.** Raw output/counts were not supplied. Short TypeScript typechecking, Rust formatting/parsing and static checks were previously observed directly. See the [owner verification record](mainnet-owner-verification-2026-11-02.md). No account creation, funding, public endpoint or live signing was performed.

These changes target the separate `carecart-safety-vault` and its v2 backend. The deployed prototype's `carecart-vault`/CCTEST ABI, configuration and database are not changed. MN-01's outstanding live 1Click check and G0B identities remain open; skipping account setup does not remove release gates.

## Human roles and treasury recovery

- `propose_admin(new_admin)` requires the current admin, one yocto and a paused vault. Passing null cancels a proposal. The successor must call `accept_admin()` with one yocto while paused. The old admin retains authority until acceptance, then loses it.
- `set_guardian(guardian)` requires the admin, one yocto and a paused vault. The old guardian loses pause authority. Guardians cannot unpause, approve, withdraw or administer roles. Human identities cannot overlap backend roles, the token contract or the vault. Variable-size human identity state is charged against the separately prefunded storage reserve.
- `set_role` grants/revokes a restricted backend role. `rotate_role(old_account, new_account, role)` grants the validated replacement and revokes the old account in one atomic receipt. Existing PO contents are never rewritten. Role revocation can occur while active.
- **Treasury is immutable.** No rotation method can change it. Existing `withdraw_all` pauses first and reserves only unreserved accounted funds; pending payment reservations remain protected. Failed callbacks restore reservations once, and later exit can recover funds released by finished operations. All callbacks have both the SDK's private wrapper and explicit current-contract/zero-deposit checks.
- `get_state` includes the contract's chain profile and pending admin. `get_roles(account)` is a constant-size lookup. Individual PO/quote/route views validate bounded identifiers. `get_payments(po_ids)` accepts at most 50 IDs; no unbounded onchain enumeration was added.

Rotation changes the reviewed operational manifest/fingerprint. Workers fail closed on a changed admin, guardian, key or code hash. Rebinding or migrating journals after an approved operational rotation needs explicit review; this change does not silently migrate them or authorize any account-key changes.

## Audit events

Events use the [NEP-297 envelope](https://github.com/near/NEPs/blob/master/neps/nep-0297.md): `EVENT_JSON:`, standard `carecart_safety_vault`, version `1.0.0`, one event and an array of data records. New semantic events cover admin proposals/acceptance, guardian/backend rotation, payment approval, registration, dispatch, failure, block, expiry and rejection, alongside existing policy/pause/withdrawal records.

Deposit events include token, sender, accepted/unused amounts and accounted balance. `deposit_refund_requested` records a returned unused amount for the FT resolver. It **does not claim an actual refund receipt**. Consumers must check successful receipt outcomes and independently reconcile FT balances. Likewise, a cross-chain `payment_dispatched` event establishes source-chain dispatch only, not Base settlement.

Private callbacks follow the [NEAR callback guidance](https://docs.near.org/smart-contracts/security/cross-contract-calls/callbacks). Added Sandbox cases cover forged callbacks and an admin-owned function-call key: it cannot attach the one yocto required by privileged methods, and a zero-deposit call fails the contract check.

## Canonical PO and route binding

`SafetyOrderSchema` independently validates PO ID, chain profile, supplier/token IDs, positive U128 atoms, lowercase invoice digest and destination. Unexpected fields, float/exponent amounts and instruction-like identifiers are rejected. The committer verifies the live reviewed profile, supplier allowlist and active route before signing. The requester accepts only a registered PO ID and reads immutable contents from finalized contract state.

Base destinations now contain `{ route_id, version, route_hash }`. The hash is SHA-256 of this ordered UTF-8 JSON array:

```text
[route_id, version, supplier, recipient, asset_id, active]
```

Rust and TypeScript have a shared golden-vector regression case. The contract verifies the hash when committing a PO and again before dispatch, including after asynchronous token registration. Updating a route advances its version and invalidates the old PO's route; an old PO cannot be rebound. Mainnet route configuration accepts native Base USDC's expected asset identity only; live 1Click listing verification remains mandatory.

Identical PO/quote commitments remain idempotent; any conflicting reuse fails. An identical expired quote can still be recognized as already committed, but cannot be dispatched after expiry. Refreshes use a new attempt ID referencing the same immutable PO. The settlement journal now preserves immutable PO fields across attempts, including failed/expired attempts; a quote refresh cannot change supplier, amount, route, recipient or invoice. Fee review remains attempt-specific.

**Fresh-init v2 ABI/state change:** `pending_admin` changes contract state layout, and Base PO destinations require `route_hash`. Rebuild the v2 Wasm for Sandbox. Do not deploy these bytes over an existing state without a separately reviewed migration. No existing artifact or deployed code is certified by these source edits.

## Worker and durable-write boundary

`SafetyVaultClient` rejects loading both restricted credentials, even when their keys differ. The operational credential loader rejects the other role's current/legacy credential and conventional human-custody secret variables. Before each signature, the client rechecks chain, release code hash, native-token metadata, contract profile/human identities, reviewed public key, receiver, explicit role-method permissions, finite nonzero allowance and active onchain role membership. Wildcards, duplicate method names, FullAccess and overlapping roles fail closed; calls attach zero deposit.

The manual `ops/same-chain.ts` worker supports separate process invocations:

| Action | Input | Credential | Result |
| --- | --- | --- | --- |
| `inspect` | Manifest + canonical order JSON | None | Local exact PO hash and profile fingerprint |
| `commit` | Manifest + canonical order JSON + reviewed PO hash | Committer only | Independently validated commitment |
| `review` | Manifest + PO ID | None | Finalized canonical PO and exact hash |
| `request` | Manifest + PO ID + reviewed PO hash | Requester only | ID-only same-chain request |

Writes additionally require the existing separately approved write mode. The settlement CLI also uses isolated credentials and the operation journal; its committer derives the route hash from the reviewed live route. These workers load no dotenv files, use no admin/recovery signer, expose no API and start no scheduler. Mainnet operational commands remain gated and are not part of the verification instructions below. Live agent/UI integration remains in MN-07/MN-08.

The owner must still provide actual OS/container isolation and secret mounts under G0B. Environment checks are defense in depth, not proof of custody. An attacker controlling both workers and both credentials remains a trust boundary; these checks do not remove that assumption.

`OperationJournal` shares the separate profile-bound v2 state database with the settlement journal. It stores immutable canonical orders and records `Sending` durably before calling the signer. A thrown/lost RPC response becomes `Ambiguous`; a crash leaving `Sending` has the same retry prohibition after restart. A new application-level send for that operation is blocked until finalized canonical observations establish what happened. Absence of a record after a timeout is not failure proof and does not authorize a resend.

An already committed identical PO/quote or an already processed request reconciles without another signature. Observations without a known transaction hash return `transactionHash: null, reconciled: true`; no explorer hash or successful payment is invented. A PO remaining `Committed` after a lost response stays frozen for review. Production mainnet signing refuses an in-memory journal. The journal never opens a CCTEST procurement database for migration.

## Verification for the owner

Run from the repository root and share the output. These commands run local tests/builds only. They do not use mainnet keys or funds.

First, use the pinned Node version and run backend checks plus Rust unit tests:

```sh
cd /home/nana/projects/carecart
nvm use
(cd backend && npm run typecheck && npm test)
cargo test --locked --manifest-path contracts/Cargo.toml -p carecart-safety-vault --test safety
```

After those pass, run the longer Sandbox suite. It builds fresh v2/test-token Wasm and uses ephemeral local test accounts:

```sh
cargo test --locked --manifest-path contracts/Cargo.toml -p carecart-safety-vault --test sandbox -- --nocapture
```

Added coverage includes admin acceptance/cancellation boundaries, revoked human/backend authority, pause/one-yocto checks, treasury exit, callback privacy, bounded reads/events, every immutable PO field, changed route content, quote refresh, FullAccess/duplicate method rejection, separate credential loading, and lost-response/crash recovery without resending. Prior tests retain deposit, hard-limit, UTC rollover and reservation failure checks.

The owner reports the local MN-03/MN-04 checks passed. This does not establish operational custody, deployed-byte verification or release readiness. G0B, G1/G2 and every live operational gate remain open.

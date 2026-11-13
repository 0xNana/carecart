## What changed

- Reworked the submission README, added the MIT license and an executable judge walkthrough, and excluded `internal-docs/` from the current tracked tree.
- Corrected customer-facing copy to describe automatic stock monitoring and purchase preparation accurately, including the per-order clinic approval boundary.
- Improved the local inventory demo, responsive layout checks, test fixtures, and portable process-test paths.
- Patched the web lint dependency tree and added the NEP-0330 repository metadata required for a pinned reproducible vault build.

## Verification

- `bash scripts/verify-phase2.sh`: 71 backend test files / 467 tests and 72 web tests passed; TypeScript, route types, lint and production Webpack build passed.
- `cargo test --manifest-path contracts/Cargo.toml --locked --workspace`: 66 tests passed, including local NEAR Sandbox receipt flows.
- `cargo check --target wasm32-unknown-unknown --manifest-path contracts/Cargo.toml --workspace --locked` and workspace Clippy with `-D warnings`: passed.
- Browser acceptance and all 8 local HTTP/process acceptance tests passed. Payment state remained `Unobserved`; financial, signing and external-submission spies remained zero.
- `npm audit --prefix backend` and `npm audit --prefix web`: zero vulnerabilities after the scoped lint dependency override.
- The pinned reproducible vault build passed for source commit `54fbdd5` using the image digest in its manifest.

## Payment evidence and limits

The browser walkthrough is synthetic and makes no payment. Local NEAR Sandbox tests exercise the vault, but there is no verified public supplier-payment receipt. CCUSD is a CareCart test token, not Circle USDC. The reproducible vault artifact hash for `54fbdd5` is `5QUCiYxCP8g3oP6edLzjSvYrKXP7sag4rCozhn1SLyYL`; the last read-only testnet check recorded deployed hash `BCpcRunpuzhjrshyq1yrKtsmABrAAPy6ZFmMrUvUUqK3`. They differ, so this PR does not claim the deployed vault is byte-identical to the source artifact.

## Security and documentation

- No payment keys, local databases or `.env` files are included in the PR.
- The security scan is heuristic. The previously tracked `internal-docs/` files remain reachable in existing Git history, and commit metadata contains the author email `hellodaries@gmail.com`. Review both before making the repository public; no history rewrite is included.
- The testnet profile examples still require a checkout-specific `databasePath`; preserve `fingerprintDatabasePath` when relocating the payment profile.

## Remaining owner actions

- [ ] Review the source, test output, Git history and public-visibility privacy items.
- [ ] Approve merging this pull request.
- [ ] After security review and merge, make the repository public as the final publication step.
- [ ] Record and publish the demo video and X post, then complete the hackathon form with owner-confirmed identity, tracks and NEAR payout address.

No deployment, public transaction, repository visibility change, social post or hackathon submission was performed for this PR.

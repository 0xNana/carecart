# CC-14 security and release checks

Checked **2026-11-02 (UTC)**. CC-14 is complete for the local/testnet prototype with the dependency deferrals and verification limit below. This is not a zero-advisory claim or authorization to deploy. Recheck all deferrals by **2026-11-09**, or before CC-15/public release, whichever comes first.

## Dependency audit and disposition

The [check summary](security/release-checks.json), [redacted source/history scan](security/source-scan.json) and [normalized audit evidence](security/advisories.json) record native npm/RustSec results, affected packages, patched versions, dispositions, signature checks and lockfile SHA-256 hashes. Native reports remain unsuppressed; no `npm audit fix --force`, blanket major override, Cargo advisory ignore or install-script approval was used.

| Audit | Result | Disposition |
| --- | --- | --- |
| Backend npm, all dependencies | 0 advisories | No dependency change required. |
| Web npm, production dependencies | 0 advisories | No production `minimatch` dependency. |
| Web npm, full tree | 16 moderate affected-package entries, 0 high/critical | One root advisory in the lint-only dependency tree; deferred below. |
| Cargo/RustSec, full lockfile after allocator fix | 4 vulnerability entries, 12 informational warnings | Remaining findings enter through local NEAR unit-test dependencies, not normal contract Wasm dependencies; details below. |
| npm registry signatures | Backend: 186 verified signatures / 62 attestations. Web production: 23 / 17. | Full web development-tree signature verification was incomplete after registry connection resets; it is not reported as passed. |

### Web development dependency deferral

[GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) affects `minimatch` versions below 11.0.1. The lockfile contains 3.1.5 under ESLint/plugins and 10.2.6 under TypeScript ESLint. npm propagates the finding to 16 entries; these are not 16 independent vulnerabilities. The described amplification needs attacker-controlled glob patterns with optimization level at least 2. These dependencies serve local lint configuration, not HTTP/supplier/model inputs; the installed v10 implementation defaults to level 1. Production npm audit reports zero findings.

npm proposes downgrades to ESLint 4.0.0 / eslint-config-next 0.2.4, incompatible with this Next.js flat-config toolchain. A blanket override to minimatch 11 would also cross dependent packages' declared APIs. Neither was applied. Keep lint patterns/configuration trusted and rerun the audit when compatible parent dependencies adopt the patch. The install also marks ESLint 9 unsupported; include a compatible maintained lint-toolchain upgrade in this follow-up. Recheck by the deadline above; do not expose lint execution as a service accepting untrusted patterns.

### Rust dependency triage and allocator fix

The initial RustSec audit reported four vulnerability entries plus thirteen warnings. The one warning reachable in the normal Wasm graph was the SDK's default [`wee_alloc` 0.4.5](https://rustsec.org/advisories/RUSTSEC-2022-0054.html), which is unmaintained and has no patched release. Both contracts now use `near-sdk = 5.29.1` with `default-features = false`, including the vault's unit-test dependency. The installed SDK source gates its custom allocator behind that feature; disabling it selects Rust's standard Wasm allocator, as recommended by the advisory. The full Sandbox lifecycle and Wasm build/check were rerun after the change.

Cargo regenerated its lockfile offline, removing `wee_alloc` and five allocator-only dependencies. A package/version/checksum comparison confirmed no new or upgraded crate versions. The application policy/state API did not change. Binary size/gas may differ from the earlier allocator build; CC-15 must review the current artifact and funding, not an older binary.

The remaining entries are:

- [`crypto-bigint` 0.5.5 / RUSTSEC-2026-0387](https://rustsec.org/advisories/RUSTSEC-2026-0387.html): timing concerns; patch starts at 0.7.6. Path: NEAR unit-test VM → p256/elliptic-curve. The contracts hold no signing secrets and this crate is absent from their normal Wasm graph.
- [`zstd` 0.13.3 / RUSTSEC-2026-0391](https://rustsec.org/advisories/RUSTSEC-2026-0391.html) and `zstd-safe` 7.3.0: three vulnerability entries in total for context/stream/seekable operations, plus ten unsoundness warnings. Patches start at zstd 0.14.3 / zstd-safe 8.2.0. Path: NEAR unit-test primitives. The app has no archive/decompression upload surface and those versions are absent from normal Wasm dependencies.
- [`lru` 0.16.4 / RUSTSEC-2026-0253](https://rustsec.org/advisories/RUSTSEC-2026-0253.html): panic-safety warning, patched in 0.18.2; NEAR unit-test VM only.
- `unsafe-libyaml` 0.2.11 / RUSTSEC-2024-0449: unmaintained warning via NEAR unit-test parameters/serde_yaml; no patched release and absent from normal Wasm dependencies.

Every remaining advisory ID is in the evidence JSON. These are deferred local-test dependencies awaiting compatible upstream NEAR updates; they are not declared harmless or fixed. Test only reviewed sources/fixtures on loopback and reassess before using these host Rust dependencies for public services, untrusted archives or real signing keys. No incompatible upstream dependency rewrite was forced into this release check.

## Source, credentials and permission boundaries

`node scripts/security-check.mjs` checks current non-ignored source and all reachable historical Git blobs, redacting matches. It also checks example credentials/testnet defaults, ignore rules, blocked npm scripts, authoritative manager/lockfile declarations, competing JS locks, browser secret environment references, auction methods and deployment workflow patterns. The scan found no matches. A disposable Git fixture confirmed detection of a synthetic token in current source and deleted history without printing its value. This is a heuristic scan with manual source review, not proof that every possible secret format is detectable.

The current root `.env` is ignored and had no nonempty private-key/API-key/JWT fields; the root web project had no `.env.local`. Verification clones used only the blank example and public web IDs. No human full-access key was read, exported or placed in application configuration; tests use disposable Sandbox identities only. Signer tests reject on-chain `FullAccess`, wrong contract/method permissions and a mainnet RPC before sending. Admin actions stay in the human wallet; agent tools cannot approve, edit policy or pause the vault. Contract authorization and callback-privacy tests pass. No signing endpoint is exposed by the web proxy.

Manual source inspection confirms no auction implementation and no `.github` deployment workflow in current release source. Historical references in TODO/design documents are not executable scaffold code. Both npm projects retain `ignore-scripts=true`; all installs used their lockfiles, and native packages loaded without enabling lifecycle scripts. npm lockfiles are unchanged. Cargo's only dependency change is the reviewed allocator pruning above.

## HTTP hardening and verification

The proxy now bounds actual streamed POST bytes to **16 KiB** before forwarding, independent of `Content-Length`; oversized requests return 413. Four tests cover normal/split UTF-8, declared oversize, a false length, exact limit and multibyte oversize. An isolated mutation removing the streamed-byte guard made the tests fail.

Next.js adds `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, and a camera/microphone/geolocation permissions policy; its framework header is disabled. The [HTTP evidence](security/http-checks.json) verifies those headers, fixed/chunked oversize rejection, foreign-origin 403, blocked payment/admin/deposit paths and strict PO-field rejection. Rejected requests left quotes, orders and audit records unchanged. The valid synthetic judge script also passed after hardening.

This remains a loopback prototype with synthetic data. The direct backend is not a public authenticated payment service. Public hosting requires a separate access-control/TLS/operational review. A wallet-compatible nonce CSP and TLS-terminator HSTS are not claimed here; a permissive CSP was not added merely to claim coverage. All public deployment/signing remains subject to CC-15 and explicit human review.

## Clean-clone checks

Created a new local Git snapshot clone at `/tmp/carecart-cc14-0f9mfn0a/checkout` without dependencies, secrets, databases or web build output. Restored both npm lockfiles using the CC-13 package cache in offline mode (186 backend / 359 web packages). Existing pinned tools and the compiler dependency cache were reused. No remote revision was published; the shared workspace changes remain uncommitted.

- 64 backend tests and strict typecheck pass, including the v3 → v4 existing-data migration.
- Six wallet/RPC tests and four proxy-body tests pass; web lint and production Webpack build pass.
- 21 policy, nine payment and one local Sandbox integration test pass after the allocator change. Sandbox builds and executes both Wasm contracts and the real backend payment path.
- The locked Wasm workspace check passes. Current source/lockfile agreement and ignored runtime state are checked before completion.

Run from the repository root:

```sh
node scripts/security-check.mjs
npm audit --prefix backend
npm audit --prefix web
npm audit --prefix web --omit=dev
npm audit signatures --prefix backend
npm audit signatures --prefix web --omit=dev
cargo audit --file contracts/Cargo.lock
npm test --prefix backend
npm run typecheck --prefix backend
node --experimental-strip-types web/tests/wallet.test.mts
node --experimental-strip-types web/tests/proxy-body.test.mts
npm run lint --prefix web
npm run build --prefix web -- --webpack
cargo test --manifest-path contracts/Cargo.toml --workspace --locked
cargo check --target wasm32-unknown-unknown --manifest-path contracts/Cargo.toml --workspace --locked
```

Native web full-tree and Cargo audits still exit nonzero for the documented deferrals; do not suppress them or equate a passing test suite with a clean dependency audit. Registry checks require network access and may need retry after transport failures. No public transaction, deployment, push or publication was performed for CC-14.

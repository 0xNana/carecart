# NEAR Hackathon submission handoff

**Status:** Local release candidate prepared. The branch is not pushed, no pull request is open, and the repository remains private pending the owner's final security review.

**Branch:** `codex/hackathon-submission-release`

**Base:** `origin/main` at `52060a1`
**Commits:** `6a76ce3` (submission docs/license), `4b4a1e3` (application and verification), `54fbdd5` (reproducible vault metadata). This handoff is included in the current branch head.

## A. Completed by Codex

### Submission materials

- Replaced the README with a judge-facing overview, architecture, offline quick start, verification commands, truthful scope and evidence limits: [`README.md`](../README.md).
- Added the requested MIT license: [`LICENSE`](../LICENSE).
- Added direct, runnable judge steps and troubleshooting: [`JUDGE_WALKTHROUGH.md`](JUDGE_WALKTHROUGH.md).
- Prepared a pull request body: [`PR_DESCRIPTION.md`](PR_DESCRIPTION.md).
- Added `internal-docs/` to `.gitignore` and removed those files from the current branch tree. The historical copies remain in Git history; see the owner review below.

### Application and verification changes

- Landing and workspace copy now distinguishes automatic stock monitoring and purchase preparation from clinic-authorized payments.
- The local browser flow exercises stock receipt, dispensing, consumption, adjustment, worker-created purchase order, goods receipt, restart recovery and mobile widths. Its optional `--headed` mode pauses for owner-recorded video.
- Process tests now use the verified temporary snapshot instead of this workstation's absolute repository path. The security helper test generates its own signed fixture rather than depending on a deleted internal evidence file.
- The web lint dependency tree pins patched `minimatch@11.0.1` only below `@typescript-eslint/typescript-estree`; the web dependency audit reports zero vulnerabilities.
- `contracts/carecart-safety-vault/Cargo.toml` now has the repository metadata required by cargo-near's reproducible build.

### Verification evidence

| Check | Result |
| --- | --- |
| `bash scripts/verify-phase2.sh` | Pass: 71 backend files / 467 tests; 72 web tests; TypeScript, Next route types, lint and production Webpack build. Lint reports 3 existing `window.location.assign()` warnings and no errors. |
| `node scripts/mvp-browser-acceptance.mjs /tmp/carecart-phase2-verify.twhBrf` | Pass: real local UI/worker with synthetic data; one PO, exactly-once receipt and restart; zero payment/signing/submission calls; no runtime or console errors; no document overflow at 1440, 1280, 768, 390 or 360 px. Two known CSS-preload advisories were recorded. |
| Supplemental process acceptance | Pass: 8/8 local process tests for operations recovery, inventory worker recovery, wallet proxy, security, mocked identity, financial isolation, tenant treasury isolation and the local procurement flow. All explicitly report no public-chain execution. |
| `cargo test --manifest-path contracts/Cargo.toml --locked --workspace` | Pass: 66 total, including 33 safety-vault unit tests, 2 genuine local Sandbox receipt tests, 9 legacy payment tests, 21 legacy policy tests and 1 legacy Sandbox payment lifecycle. |
| `cargo check --target wasm32-unknown-unknown --manifest-path contracts/Cargo.toml --workspace --locked` | Pass. |
| `cargo clippy --manifest-path contracts/Cargo.toml --locked --workspace --all-targets -- -D warnings` | Pass. |
| `node --test scripts/*.test.mjs`; Python backup and hosted-preflight tests | Pass: 5/5 JavaScript tests, 2/2 backup tests and 3/3 preflight-input tests. |
| `npm audit --prefix backend`; `npm audit --prefix web` | Pass: zero vulnerabilities in both dependency trees. |
| `node scripts/security-check.mjs` | No findings: 421 current text files and 1,179 reachable Git-history blobs, including the current working-tree changes. This scanner is heuristic, not a substitute for owner review. |

The completed browser report and screenshots are in `/tmp/carecart-mvp-browser-rXOMzj/`; they are local evidence, not checked-in files. The latest verified production snapshot is `/tmp/carecart-phase2-verify.O67GzU` and is specific to this working environment.

### NEAR evidence and limits

- The last read-only RPC check was at finalized block `EKi9urzVA9Af64i8LTcwPBQFdrrpQukcjQ6D2wsH148T`, height `277475353`, at `2026-11-13T06:48:08Z`. It found the deployed testnet vault and test token hashes matched `profiles/testnet.payments.json`; token metadata was CCUSD, six decimals, `ft-1.0.0`.
- A pinned reproducible safety-vault build succeeded for source commit `54fbdd5`, using `sourcescan/cargo-near:0.21.1-rust-1.96.0` at digest `sha256:ccb22bb4e677ed022d8b9d1aa1b32f0af52dd0471ef1c32e48dedbf68ee6ee17`. Output hash: `5QUCiYxCP8g3oP6edLzjSvYrKXP7sag4rCozhn1SLyYL` (285,111 bytes). It differs from the deployed vault hash `BCpcRunpuzhjrshyq1yrKtsmABrAAPy6ZFmMrUvUUqK3`; the current deployment therefore is not claimed as byte-identical to this source artifact.
- No complete public supplier-payment receipt is attached. The browser recording leaves payment **Unobserved**. Sandbox contract runs are genuine local chain tests, not public testnet payments. CCUSD is a CareCart test token, not Circle USDC; no completed NEAR Intents settlement was verified.
- Current app scope: monitoring and PO preparation can be automatic when configured; each order/payment still requires clinic authorization. Do not claim unattended end-to-end purchasing.

### Track assessment

- **Best supported:** AI Security & Defense, based on local vault policy tests, role restrictions, replay/failure cases and the verified deployed code hash. Clearly label the Sandbox evidence and deployed/source hash mismatch.
- **Autonomous Business:** product fit is strong, but the current app still requires per-order clinic authorization. Do not claim autonomous spending; include this track only if the owner confirms the rules accept automated monitoring and PO preparation without payment authorization.
- **Real-World Money:** not demonstrated; no verified supplier payment or real settlement is attached, and CCUSD is a test asset.
- **NEAR Intents:** not demonstrated; no completed public cross-chain settlement was verified.

The official requirements are in the [NEAR Hackathon rules](https://nearhackathon.com/HACKATHON.md). The owner makes the final track selection.

### Pull request and external state

No remote update or PR was created. `gh auth status` reports that the configured GitHub token for `0xNana` is invalid. The last successful GitHub visibility check showed the repository as **PRIVATE**. Existing PRs #1 and #2 were merged before this sprint; this release branch has no remote tracking branch.

## B. Required from the owner

### 1. Review before publication

The branch removes `internal-docs/` from its latest tree, but the files remain reachable in earlier commits. Git commit metadata also contains `hellodaries@gmail.com`. The two committed testnet profiles contain `/home/nana/projects/carecart` database paths; the README explains how to relocate `databasePath`, while `fingerprintDatabasePath` must remain unchanged to preserve the reviewed profile identity. Confirm that these history and configuration details are acceptable to expose before making the repository public. No history rewrite was performed.

### 2. Authenticate, push and open the PR

After reviewing the local branch, authenticate GitHub and run:

```bash
gh auth login -h github.com
git push -u origin codex/hackathon-submission-release
gh pr create --base main --head codex/hackathon-submission-release \
  --title "CareCart — Hackathon Submission Release" \
  --body-file docs/PR_DESCRIPTION.md
```

Review the resulting PR and approve its merge. Codex did not merge it.

### 3. Record the 90–150-second demo

The automated runner supports a visible, paced mode. From the reviewed branch:

```bash
nvm use
npm ci --prefix backend
npm ci --prefix web
bash scripts/verify-phase2.sh
```

Start a screen recorder, then run the visible demo using the exact snapshot path printed by the verifier. For roughly 90–150 seconds of narration, use a 9-second step pause:

```bash
CARECART_DEMO_PAUSE_MS=9000 node scripts/mvp-browser-acceptance.mjs \
  /tmp/carecart-phase2-verify.REPLACE_WITH_PRINTED_SUFFIX --headed
```

If Chromium is elsewhere, set `CARECART_CHROMIUM_BIN` to its executable. The visible flow uses synthetic clinic data and leaves payment **Unobserved**.

Suggested narration:

| Time | Show and say |
| --- | --- |
| 0:00–0:15 | Introduce CareCart and the clinic stock ledger; say the data is synthetic. |
| 0:15–0:35 | Record a stock receipt, dispensing, consumption and a small adjustment; show the on-hand total update. |
| 0:35–0:55 | Show the background worker detect the shortage and prepare one canonical purchase order. |
| 0:55–1:15 | Inspect the supplier offer and payment section. State that each purchase still needs clinic authorization and this demo sends no payment. |
| 1:15–1:35 | Record the physical goods receipt and show inventory increase exactly once. |
| 1:35–1:55 | Show worker restart recovery and the same single order. If mentioning contract policy tests, label them “local NEAR Sandbox”; they are not this PO's payment. |

### 4. Publish and submit

After the PR is approved/merged and the owner completes the Git-history/security review, make the repository public as the **last release publication step**. Then publish the demo video and an X post, and submit the hackathon form with the owner's real identity, selected tracks, consent and NEAR payout address.

Unpublished X draft:

> CareCart helps clinics keep essential supplies in stock with automatic monitoring and purchase preparation. We verified policy controls in local NEAR Sandbox tests; the recorded app demo uses synthetic data and does not send a supplier payment. @NEARProtocol #NEARHackathon — [repository link after publication] · [demo video link]

Do not claim public settlement, Circle USDC, completed NEAR Intents settlement, or autonomous supplier spending. No deployment, funding, public transaction, X post, repository visibility change or hackathon submission was performed.

#!/usr/bin/env bash
# Rebuild the reviewed historical deployment, without modifying the checkout or deploying.
set -euo pipefail
task_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
task_revision=52060a1626c02f9d8b93538110715f01937e31cb
task_expected=979c178881f12ce6694ea804d9374af3606b55dbb0b8074434e791d5c9b0b71e
[[ "$(cargo near --version)" == 'cargo-near-near 0.22.0' ]] || { echo 'Requires cargo-near 0.22.0'; exit 1; }
task_directory="$(mktemp -d /tmp/carecart-vault-reproduce.XXXXXX)"
git -C "$task_root" archive "$task_revision" contracts rust-toolchain.toml | tar -x -C "$task_directory"
[[ "$(cd "$task_directory"; rustc --version)" == 'rustc 1.93.0 (254b59607 2026-01-19)' ]] || { echo 'Requires pinned Rust 1.93.0'; exit 1; }
cargo near build non-reproducible-wasm --locked --manifest-path "$task_directory/contracts/carecart-safety-vault/Cargo.toml" --out-dir "$task_directory/output"
task_artifact="$task_directory/output/carecart_safety_vault.wasm"
[[ "$(sha256sum "$task_artifact" | cut -d ' ' -f 1)" == "$task_expected" ]] || { echo 'Build differs from deployed release; stop'; exit 1; }
node "$task_root/scripts/verify-vault-release.mjs" "$task_root/profiles/testnet.payments.json" "$task_artifact" > "$task_directory/public-rpc-evidence.json"
node -e 'const e=require(process.argv[1]);if(!e.artifactMatchesDeployment||!e.profileMatchesDeployment)process.exit(1)' "$task_directory/public-rpc-evidence.json"
printf 'Verified source: %s\nArtifact: %s\nRPC evidence: %s\n' "$task_revision" "$task_artifact" "$task_directory/public-rpc-evidence.json"

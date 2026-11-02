#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p artifacts/testnet
# Local pinned-toolchain builds. No reproducible-container build or deployment claim.
cargo near build non-reproducible-wasm --locked --manifest-path contracts/carecart-vault/Cargo.toml --out-dir artifacts/testnet
cargo near build non-reproducible-wasm --locked --manifest-path contracts/test-ft/Cargo.toml --out-dir artifacts/testnet
node scripts/testnet-source.mjs --write

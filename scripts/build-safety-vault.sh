#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p artifacts/safety-v2
# Fresh-init v2 artifact only. No deploy, source-plan rewrite, or CCTEST artifact overwrite.
cargo near build non-reproducible-wasm --locked --manifest-path contracts/carecart-safety-vault/Cargo.toml --out-dir artifacts/safety-v2
cargo near build non-reproducible-wasm --locked --manifest-path contracts/test-ft/Cargo.toml --out-dir artifacts/safety-v2
sha256sum artifacts/safety-v2/carecart_safety_vault.wasm
sha256sum artifacts/safety-v2/carecart_test_ft.wasm

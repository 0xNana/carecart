#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if (( $# == 0 )); then set -- --check; fi
exec backend/node_modules/.bin/tsx backend/src/ops/setup-testnet.ts "$@"

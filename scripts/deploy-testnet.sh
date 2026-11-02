#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# This helper only reads public RPC state and prints a plan. It never signs or sends.
exec node scripts/deploy-testnet.mjs "$@"

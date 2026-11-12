#!/usr/bin/env bash
set -euo pipefail

role="${1:?expected committer or requester}"
case "$role" in
  committer|requester) ;;
  *) echo 'Invalid payment worker role' >&2; exit 64 ;;
esac

: "${CARECART_TENANT_REGISTRY_FILE:?missing registry path}"
: "${CARECART_TESTNET_PAYMENTS_FILE:?missing testnet payment profile}"
: "${NVM_DIR:=/home/ubuntu/.nvm}"
export NVM_DIR

# Use the instance's pinned nvm default (currently Node 24.21.0), without relying on
# an interactive login shell. Each systemd unit supplies only its own role key.
# shellcheck disable=SC1090
. "$NVM_DIR/nvm.sh"
exec nvm exec default "$PWD/node_modules/.bin/tsx" \
  "$PWD/src/ops/testnet-payment-worker.ts" \
  "$role" "$CARECART_TENANT_REGISTRY_FILE" "$CARECART_TESTNET_PAYMENTS_FILE"

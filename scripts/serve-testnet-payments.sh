#!/usr/bin/env bash
# Owner-run local testnet runtime. Existing scoped workers; no deployment/policy/funding operation.
set -euo pipefail
task_repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
task_node="$(command -v node || true)"
task_node_version=""
if [[ -n "$task_node" ]]; then task_node_version="$("$task_node" --version)"; fi
if [[ "$task_node_version" != "v24.21.0" ]]; then
  printf '%s\n' 'Node.js 24.21.0 is required; run nvm use from the repository root first.' >&2
  exit 1
fi
task_snapshot="${1:-}"
task_mode="${2:---start}"
if [[ $# -gt 2 || -z "$task_snapshot" || ( "$task_mode" != --start && "$task_mode" != --dry-run ) ]]; then
  printf '%s\n' 'Usage: bash scripts/serve-testnet-payments.sh /tmp/carecart-phase2-verify.XXXXXX [--start|--dry-run]' >&2
  exit 2
fi
python3 - "$task_repo" "$task_snapshot" <<'PY'
from pathlib import Path
import sys,json,hashlib,stat
root=Path(sys.argv[1]).resolve();snapshot=Path(sys.argv[2]).resolve()
if snapshot.parent!=Path('/tmp') or not snapshot.name.startswith('carecart-phase2-verify.') or not (snapshot/'web/.next/BUILD_ID').is_file():raise SystemExit('A completed source-only production verification snapshot is required')
for name,expected in json.loads((snapshot/'source-hashes.json').read_text()).items():
 p=root/name
 if not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest()!=expected:raise SystemExit('Verification source mismatch; rerun the checks before starting')
for name in ['backend/.env.identity','backend/.env.testnet-committer','backend/.env.testnet-requester']:
 p=root/name
 if p.is_symlink() or not p.is_file() or stat.S_IMODE(p.stat().st_mode)!=0o600:raise SystemExit('Owner-private separate environment files required')
c=json.loads((root/'profiles/testnet.payments.json').read_text())
if c['profile']['network']!='testnet' or c['profile']['rpcUrl']!='https://test.rpc.fastnear.com':raise SystemExit('Only the reviewed testnet profile is supported')
PY
task_registry="$task_repo/backend/data/tenancy/registry.sqlite"
task_activation="$task_repo/profiles/testnet.payments.json"
if [[ "$task_mode" == --dry-run ]]; then
  printf '%s\n' 'Starts the key-free API, inventory monitor, separate observer, committer/requester workers, and production web on loopback.'
  printf '%s\n' 'Uses only .env.identity for web/API/observer and one .env.testnet-ROLE per signing process. No unpause, funding or deployment. Automatic authorization requires an explicit clinic policy.'
  exit 0
fi
python3 - <<'PY'
import socket
for port in [3000,3002]:
 with socket.socket() as s:
  try:s.bind(('127.0.0.1',port))
  except OSError:raise SystemExit(f'Port {port} is occupied; stop the previous owner-launched runtime first')
PY
task_pids=()
cleanup(){ for task_pid in "${task_pids[@]}"; do kill -TERM "$task_pid" 2>/dev/null || true; done; wait 2>/dev/null || true; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
start_backend(){
 local task_env="$1";shift
 (cd "$task_repo/backend";exec env -i HOME="$HOME" PATH="$PATH" "$task_node" --env-file="$task_env" --import tsx "$@") &
 task_pids+=("$!")
}
start_backend .env.identity src/tenancy/server.ts
start_backend .env.identity src/tenancy/worker.ts
start_backend .env.identity src/ops/testnet-payment-worker.ts authorize "$task_registry" "$task_activation"
start_backend .env.identity src/ops/testnet-payment-worker.ts observe "$task_registry" "$task_activation"
start_backend .env.testnet-committer src/ops/testnet-payment-worker.ts committer "$task_registry" "$task_activation"
start_backend .env.testnet-requester src/ops/testnet-payment-worker.ts requester "$task_registry" "$task_activation"
(cd "$task_snapshot/web";exec env -i HOME="$HOME" PATH="$PATH" NEXT_TELEMETRY_DISABLED=1 "$task_node" --env-file="$task_repo/backend/.env.identity" node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3000) &
task_pids+=("$!")
printf '%s\n' 'CareCart local native-testnet runtime: http://127.0.0.1:3000/app. Synthetic CCUSD only; Ctrl-C stops this runtime.'
wait -n "${task_pids[@]}"

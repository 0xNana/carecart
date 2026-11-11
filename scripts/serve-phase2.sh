#!/usr/bin/env bash
# Owner-run local preview only. No deployment, key loading or financial worker.
set -euo pipefail
task_repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
task_node="${NVM_DIR:-$HOME/.nvm}/versions/node/v24.21.0/bin/node"
if [[ ! -x "$task_node" ]]; then
  if ! task_node="$(command -v node)"; then
    printf '%s\n' 'Node is not available. Load nvm and run nvm use before starting the preview.' >&2
    exit 2
  fi
fi
if [[ $# -ne 1 || "$("$task_node" -p 'process.versions.node')" != '24.21.0' ]]; then
  printf '%s\n' 'Use nvm use, then: bash scripts/serve-phase2.sh /tmp/carecart-phase2-verify.XXXXXX' >&2
  exit 2
fi
printf 'Checking verified preview with Node %s\n' "$("$task_node" -p 'process.versions.node')"
task_snapshot="$(python3 - "$task_repo" "$1" <<'PY'
import pathlib,sys,json,hashlib,socket
root=pathlib.Path(sys.argv[1]);snapshot=pathlib.Path(sys.argv[2]).resolve()
if snapshot.parent!=pathlib.Path('/tmp') or not snapshot.name.startswith('carecart-phase2-verify.'):
    raise SystemExit('A verification snapshot under /tmp is required.')
if not (snapshot/'web/.next/BUILD_ID').is_file():raise SystemExit('No completed production build in this snapshot.')
hashes=json.loads((snapshot/'source-hashes.json').read_text())
for name,expected in hashes.items():
    source=(root/name).resolve()
    if not source.is_relative_to(root.resolve()) or not source.is_file() or hashlib.sha256(source.read_bytes()).hexdigest()!=expected:
        raise SystemExit('Source differs from this build. Run the web-only verification again.')
for port in [3000,3002]:
    with socket.socket() as check:
        try:check.bind(('127.0.0.1',port))
        except OSError:raise SystemExit(f'Port {port} is occupied. Stop that previous local service before previewing.')
print(snapshot)
PY
)"
task_api_pid=''
task_web_pid=''
cleanup() {
  for task_pid in "$task_web_pid" "$task_api_pid"; do
    if [[ -n "$task_pid" ]]; then kill -TERM "$task_pid" 2>/dev/null || true; fi
  done
  wait 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
(
  cd "$task_repo/backend"
  exec env -i HOME="$HOME" PATH="$PATH" CARECART_OPERATIONS_MODE=local-synthetic \
    CARECART_OPERATIONS_ORIGIN=http://127.0.0.1:3000 CARECART_OPERATIONS_PORT=3002 \
    "$task_node" --env-file=.env.operations --import tsx src/operations/server.ts
) &
task_api_pid=$!
(
  cd "$task_snapshot/web"
  exec env -i HOME="$HOME" PATH="$PATH" NEXT_TELEMETRY_DISABLED=1 \
    "$task_node" node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3000
) &
task_web_pid=$!
printf 'Local production preview: http://127.0.0.1:3000/app\nAPI and web stay in this terminal. Ctrl-C stops both.\n'
task_status=0
wait -n "$task_api_pid" "$task_web_pid" || task_status=$?
printf 'A preview service exited (status %s); stopping both services. Check the startup output above.\n' "$task_status" >&2
exit "$task_status"

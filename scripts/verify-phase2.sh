#!/usr/bin/env bash
# Owner-run full checks. Source-only snapshots exclude credentials and operational state.
set -euo pipefail
task_repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
task_node="$(command -v node)"
if [[ $# -gt 1 || ( $# -eq 1 && "$1" != '--prepare-only' && "$1" != '--web-only' && "$1" != '--web-preview' ) ]]; then
  printf '%s\n' 'Usage: bash scripts/verify-phase2.sh [--prepare-only|--web-only|--web-preview]' >&2
  exit 2
fi
if [[ "$("$task_node" -p 'process.versions.node')" != "24.21.0" ]]; then
  printf '%s\n' 'Use the repository Node pin first: nvm use' >&2
  exit 2
fi
task_output="$(mktemp -d /tmp/carecart-phase2-verify.XXXXXX)"
mkdir "$task_output/web" "$task_output/backend"
git -C "$task_repo" rev-parse HEAD > "$task_output/source-head.txt"
python3 - "$task_repo" "$task_output" <<'PY'
import errno,hashlib,json,os,pathlib,shutil,sys
root=pathlib.Path(sys.argv[1]);out=pathlib.Path(sys.argv[2]);web=root/'web'
for name in ['src','public','content']:
    if (web/name).exists():shutil.copytree(web/name,out/'web'/name)
for pattern in ['package*.json','tsconfig.json','next-env.d.ts','next.config.*','eslint.config.*','postcss.config.*','source.config.*']:
    for source in web.glob(pattern):shutil.copy2(source,out/'web'/source.name)
# Turbopack resolves dependencies inside its project root. A symlink back into
# the checkout escapes that root; a separate directory tree preserves resolution.
def link_dependency(source,destination):
    try:os.link(source,destination)
    except OSError as error:
        if error.errno!=errno.EXDEV:raise
        shutil.copy2(source,destination)
shutil.copytree(web/'node_modules',out/'web'/'node_modules',copy_function=link_dependency,symlinks=True)
backend=root/'backend'
for name in ['src','test-support']:
    shutil.copytree(backend/name,out/'backend'/name)
for pattern in ['package*.json','tsconfig*.json']:
    for source in backend.glob(pattern):shutil.copy2(source,out/'backend'/source.name)
(out/'backend'/'node_modules').symlink_to(backend/'node_modules',target_is_directory=True)
shutil.copytree(root/'profiles',out/'profiles')
# Profiles carry checkout-specific absolute paths. Rebind only the copied testnet
# fixture to this isolated snapshot so path guards still exercise the intended
# testnet-v2 boundary instead of reading state from the developer checkout.
profile_path=out/'profiles'/'testnet.demo.json'
profile=json.loads(profile_path.read_text())
profile['profile']['databasePath']=str(out/'backend'/'data'/'testnet-v2'/'offline-demo'/'state.sqlite')
profile_path.write_text(json.dumps(profile,indent=2)+'\n')
assert not (out/'.env').exists() and not (out/'backend'/'.env').exists()
files={str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest()
       for folder in [root/'web'/'src',root/'backend'/'src'] for p in folder.rglob('*') if p.is_file()}
(out/'source-hashes.json').write_text(json.dumps(files,indent=2)+'\n')
PY
if [[ "${1:-}" == '--prepare-only' ]]; then
  printf 'Source-only verification snapshot: %s\n' "$task_output"
  exit 0
fi
run_check() {
  local task_name="$1" task_directory="$2"
  shift 2
  printf '\nRunning %s\n' "$task_name"
  set +e
  (cd "$task_directory"; env -i HOME="$HOME" PATH="$PATH" NEXT_TELEMETRY_DISABLED=1 "$task_node" "$@") 2>&1 | tee "$task_output/$task_name.log"
  local task_status=("${PIPESTATUS[@]}")
  set -e
  printf '%s\n' "${task_status[0]}" > "$task_output/$task_name.exit-code"
  if [[ "${task_status[0]}" != 0 ]]; then return "${task_status[0]}"; fi
  if [[ "${task_status[1]}" != 0 ]]; then return "${task_status[1]}"; fi
}
if [[ "${1:-}" != '--web-only' && "${1:-}" != '--web-preview' ]]; then
  run_check backend-tests "$task_output/backend" node_modules/vitest/vitest.mjs run --maxWorkers=4
  run_check backend-types "$task_output/backend" node_modules/typescript/lib/tsc.js --noEmit
fi
task_web_tests=("$task_repo"/web/tests/*.test.mts)
run_check web-tests "$task_repo/web" --experimental-strip-types --test --test-isolation=none "${task_web_tests[@]}"
run_check web-route-types "$task_repo/web" node_modules/next/dist/bin/next typegen
run_check web-types "$task_repo/web" node_modules/typescript/bin/tsc --noEmit --incremental false
run_check web-lint "$task_repo/web" node_modules/eslint/bin/eslint.js .
run_check web-production-build "$task_output/web" node_modules/next/dist/bin/next build
printf '\nAll checks exited 0. Evidence and isolated production build: %s\n' "$task_output"
printf 'After stopping previous web/API preview services, keep both services running with:\nbash %q %q\n' "$task_repo/scripts/serve-phase2.sh" "$task_output"
if [[ "${1:-}" == '--web-preview' ]]; then
  exec bash "$task_repo/scripts/serve-phase2.sh" "$task_output"
fi

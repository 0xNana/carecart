#!/usr/bin/env bash
# Default: print commands. --create-children: review and confirm each child creation.
set -euo pipefail
root="${1:-}"
mode="${2:-plan}"
if [[ ! "$root" =~ ^[a-z0-9]+([-_][a-z0-9]+)*\.testnet$ ]] || (( ${#root} > 53 )) || [[ "$mode" != plan && "$mode" != --create-children ]]; then
  printf 'Usage: bash scripts/plan-testnet-accounts.sh YOUR-ROOT.testnet [--create-children]\n' >&2
  exit 1
fi
command_line() {
  printf '%q ' "$@"
  printf '\n\n'
}
account_status() {
  python3 - "$1" <<'PY'
import json,sys,urllib.request
endpoint='https://test.rpc.fastnear.com'
def rpc(method,params):
    request=urllib.request.Request(endpoint,data=json.dumps({'jsonrpc':'2.0','id':'carecart-setup','method':method,'params':params}).encode(),headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(request,timeout=25) as response:return json.load(response)
if rpc('status',[]).get('result',{}).get('chain_id')!='testnet':
    raise SystemExit('RPC network mismatch; no creation attempted')
response=rpc('query',{'request_type':'view_account','finality':'final','account_id':sys.argv[1]})
if 'result' in response:print('exists')
elif response.get('error',{}).get('cause',{}).get('name')=='UNKNOWN_ACCOUNT':print('missing')
else:raise SystemExit('Account lookup failed; stop and check RPC before retrying')
PY
}
roles=(vault token admin treasury committer agent medsupply-a medsupply-b rogue)
balances=('2.5 NEAR' '2.5 NEAR' '1.5 NEAR' '0.5 NEAR' '0.5 NEAR' '0.5 NEAR' '0.1 NEAR' '0.1 NEAR' '0.1 NEAR')
if [[ "$mode" == plan ]]; then
  printf 'PROPOSED TESTNET ACCOUNT PLAN — no commands are executed\nRoot: %s\n\n' "$root"
  printf '1. Create the parent with the testnet faucet (if it does not already exist):\n'
  command_line near account create-account sponsor-by-faucet-service "$root" autogenerate-new-keypair --signature-scheme ed25519 save-to-keychain network-config testnet create
  printf '2. Review the parent balance before funding children:\n'
  command_line near tokens "$root" view-near-balance network-config testnet now
else
  command -v near >/dev/null || { printf 'Install near-cli-rs or put near on PATH first.\n' >&2; exit 1; }
  [[ -t 0 ]] || { printf 'Creation mode requires an interactive terminal for transaction review.\n' >&2; exit 1; }
  [[ "$(account_status "$root")" == exists ]] || { printf 'Create the parent account first.\n' >&2; exit 1; }
  printf 'CREATION MODE — each missing child requires explicit confirmation before signing.\n'
  near tokens "$root" view-near-balance network-config testnet now
fi
printf 'Nine children: proposed funding totals 8.3 test NEAR plus gas.\nKeep additional test NEAR on the parent for gas.\n\n'
for index in "${!roles[@]}"; do
  account="${roles[$index]}.$root"
  cmd=(near account create-account fund-myself "$account" "${balances[$index]}" autogenerate-new-keypair --signature-scheme ed25519 save-to-keychain sign-as "$root" network-config testnet sign-with-keychain send)
  printf '# %s — %s\n' "$account" "${balances[$index]}"
  command_line "${cmd[@]}"
  if [[ "$mode" == --create-children ]]; then
    status="$(account_status "$account")"
    if [[ "$status" == exists ]]; then
      printf 'EXISTS: %s — unchanged. Existing key ownership is not verified by this script.\n\n' "$account"
      continue
    fi
    printf 'To sign and send this creation, type CREATE %s (anything else stops): ' "$account"
    read -r confirmation
    [[ "$confirmation" == "CREATE $account" ]] || { printf 'Stopped before signing. Rerun to continue later.\n'; exit 0; }
    "${cmd[@]}"
    printf 'CLI completed creation for %s.\n\n' "$account"
  fi
done
if [[ "$mode" == plan ]]; then
  printf 'To CREATE the children with per-transaction review, run:\n'
  command_line bash scripts/plan-testnet-accounts.sh "$root" --create-children
fi
printf 'Account setup does not deploy contracts or grant backend signing permissions.\n'
printf 'Keep recovery/full-access keys in the human wallet or CLI keychain; never copy them into backend configuration or chat.\n'

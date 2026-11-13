#!/usr/bin/env python3
"""Internal helper: return one verified restricted key over fd 3, never stdout."""
import json
import os
import stat
import sys
import urllib.request


def main():
    # Require the parent's private pipe; running this file in a terminal cannot print a key.
    if not (stat.S_ISFIFO(os.fstat(3).st_mode) or stat.S_ISSOCK(os.fstat(3).st_mode)):
        raise RuntimeError()
    request = json.loads(sys.stdin.read(4096))
    methods = {
        'committer.carecart.testnet': 'commit_purchase_order',
        'agent.carecart.testnet': 'request_payment',
        'committer-v2.carecart.testnet': 'commit_purchase_order',
        'agent-v2.carecart.testnet': 'request_payment',
    }
    account, public = request['accountId'], request['publicKey']
    if account not in methods or not public.startswith('ed25519:'):
        raise RuntimeError()

    def rpc(method, params):
        data = json.dumps({'jsonrpc': '2.0', 'id': 'restricted-key-check', 'method': method, 'params': params}).encode()
        req = urllib.request.Request('https://test.rpc.fastnear.com', data, {'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=20) as response:
            payload = json.load(response)
        if 'error' in payload:
            raise RuntimeError()
        return payload['result']

    if rpc('status', [])['chain_id'] != 'testnet':
        raise RuntimeError()
    key = rpc('query', {'request_type': 'view_access_key', 'finality': 'final', 'account_id': account, 'public_key': public})
    permission = key['permission']
    if not isinstance(permission, dict):
        raise RuntimeError()
    fc = permission.get('FunctionCall', {})
    if (fc.get('receiver_id') != ('safety-v2.carecart.testnet' if account in ['committer-v2.carecart.testnet','agent-v2.carecart.testnet'] else 'vault.carecart.testnet') or fc.get('method_names') != [methods[account]]
            or fc.get('allowance') is None or int(fc['allowance']) <= 0):
        raise RuntimeError()
    if account in ['committer-v2.carecart.testnet','agent-v2.carecart.testnet'] and int(fc['allowance']) > 200000000000000000000000:
        raise RuntimeError()

    import gi
    gi.require_version('Secret', '1')
    from gi.repository import Secret
    service = Secret.Service.get_sync(Secret.ServiceFlags.NONE, None)
    attrs = {'service': 'near-testnet-' + account, 'username': account + ':' + public}
    items = service.search_sync(None, attrs, Secret.SearchFlags.ALL, None)
    if len(items) != 1 or items[0].get_locked():
        raise RuntimeError()
    item = items[0]
    if not all(item.get_attributes().get(k) == v for k, v in attrs.items()):
        raise RuntimeError()
    item.load_secret_sync(None)
    credential = json.loads(item.get_secret().get_text())
    private = credential.get('private_key') or credential.get('secret_key')
    if credential.get('public_key') != public or not isinstance(private, str) or not private.startswith('ed25519:'):
        raise RuntimeError()
    with os.fdopen(3, 'w') as pipe:
        pipe.write(json.dumps({'privateKey': private}))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # No exception details: SDK/keychain/parser failures must never reveal credential content.
        print('Restricted key lookup failed; no secret was printed. Check testnet permissions and unlocked keychain.', file=sys.stderr)
        sys.exit(1)

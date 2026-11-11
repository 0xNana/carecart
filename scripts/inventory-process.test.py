#!/usr/bin/env python3
"""Actual local API, Next proxy, independent worker, process crash and SQLite checks.

No dotenv, operational credentials, provider calls, wallets or public RPC.
"""
import http.cookiejar
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import sqlite3
import subprocess
import time
import urllib.error
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which('node')
assert NODE, 'Installed Node required; dependencies are never installed by this test'
ENV = {'PATH': os.environ.get('PATH', '/usr/bin:/bin'), 'HOME': os.environ['HOME'], 'TSX_DISABLE_CACHE': '1','CARECART_INVENTORY_WORKER_ENABLED':'true','CARECART_INVENTORY_DATASET':'playground'}

def port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]

def wait(check, message):
    for _ in range(150):
        try:
            result = check()
            if result:
                return result
        except (urllib.error.URLError, ConnectionError):
            pass
        time.sleep(.1)
    raise AssertionError(message)

processes = []
names = ['p4a-process-' + uuid.uuid4().hex, 'p4a-crash-' + uuid.uuid4().hex, 'p4a-concurrent-' + uuid.uuid4().hex]
def database(name):
    return ROOT / 'backend/data/local-v2/local-operations' / name / 'state.sqlite'

def launch(args, env):
    p = subprocess.Popen([NODE, *args], cwd=ROOT / 'backend', env={**ENV, **env}, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    processes.append(p)
    return p

def stop(p):
    if p.poll() is None:
        p.terminate()
        try:
            p.wait(timeout=10)
        except subprocess.TimeoutExpired:
            p.kill()
            p.wait(timeout=5)

try:
    api_port, web_port = port(), port()
    origin = f'http://127.0.0.1:{web_port}'
    service = origin
    credential = secrets.token_hex(32)
    env = {'CARECART_OPERATIONS_MODE': 'local-synthetic', 'CARECART_INVENTORY_WORKSPACE': names[0], 'CARECART_OPERATIONS_ORIGIN': origin,
           'CARECART_OPERATIONS_PORT': str(api_port), 'CARECART_OPERATIONS_OPERATOR_SECRET': credential}
    api = launch(['--import', 'tsx', 'src/ops/inventory.ts', 'api'], env)
    web = subprocess.Popen([NODE, 'node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', str(web_port)], cwd=ROOT / 'web',
                           env={**ENV, 'CARECART_OPERATIONS_API_URL': f'http://127.0.0.1:{api_port}', 'NEXT_TELEMETRY_DISABLED': '1'}, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    processes.append(web)
    cookies = http.cookiejar.CookieJar()
    client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookies))
    def request(path, payload=None, headers=None):
        data = None if payload is None else json.dumps(payload).encode()
        req = urllib.request.Request(service + '/api/operations/' + path, data=data, headers={'Origin': origin, 'Content-Type': 'application/json', **(headers or {})})
        with client.open(req, timeout=10) as response:
            return json.load(response)
    wait(lambda: request('login', {'credential': credential}), 'API/Next startup failed')
    def mutate(path, payload):
        s = request('session')
        return request(path, payload, {'x-csrf-token': s['csrf'], 'x-operation-nonce': s['nonce']})
    assert request('stock')['items'][0]['balance']['onHand'] == 12
    mutate('stock/movements', {'requestId': str(uuid.uuid4()), 'movement': {'id': 'consume-four', 'productId': 'mn-item-1', 'kind': 'Consume', 'quantity': 4, 'unit': 'base', 'source': 'synthetic'}})
    assert request('stock')['items'][0]['balance']['onHand'] == 8
    worker = launch(['--import', 'tsx', 'src/ops/inventory.ts', 'worker'], {'CARECART_OPERATIONS_MODE': 'local-synthetic', 'CARECART_INVENTORY_WORKSPACE': names[0]})
    stock = wait(lambda: (s if (s := request('stock'))['caseStates'] and s['caseStates'][0]['state'] == 'PoDrafted' else None), 'Independent worker did not prepare PO')
    case_id = stock['obligations'][0]['caseId']
    before = request('cases/' + case_id)
    case = before['projection']['cases'][0]
    assert case['paymentState'] == 'Unobserved' and case['nextAction'] == 'AuthorizeCommitment'
    assert case['inventory']['forecasts'][0]['recommendedQuantity'] == 40
    assert case['domain']['purchaseOrder']['canonical']['amount'] == '2000000'
    po_id = case['poId']
    mutate('stock/movements', {'requestId': str(uuid.uuid4()), 'movement': {'id': 'incoming', 'productId': 'mn-item-1', 'kind': 'ConfirmInbound', 'quantity': 40, 'unit': 'base', 'source': 'synthetic', 'orderId': po_id,'confirmationReference':'SYNTHETIC-CONFIRMATION','confirmedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}})
    stock = request('stock')
    assert stock['items'][0]['balance']['inventoryPosition'] == 48 and stock['items'][0]['balance']['onHand'] == 8
    stop(worker)
    worker = launch(['--import', 'tsx', 'src/ops/inventory.ts', 'worker'], {'CARECART_OPERATIONS_MODE': 'local-synthetic', 'CARECART_INVENTORY_WORKSPACE': names[0]})
    time.sleep(1.2)
    recovered = request('cases/' + case_id)
    # generatedAt is the live API projection time, not durable workflow state.
    assert recovered['projection']['cases'] == before['projection']['cases']
    assert recovered['revision'] == before['revision'] and recovered['eventCount'] == before['eventCount']
    assert len(request('stock')['obligations']) == 1
    mutate('stock/movements', {'requestId': str(uuid.uuid4()), 'movement': {'id': 'physical-receipt', 'productId': 'mn-item-1', 'kind': 'Receive', 'quantity': 4, 'unit': 'pack', 'source': 'synthetic', 'orderId': po_id,'receiptReference':'SYNTHETIC-DELIVERY-LINE-1'}})
    assert request('stock')['items'][0]['balance']['onHand'] == 48
    assert request('cases/' + case_id)['projection']['cases'][0]['paymentState'] == 'Unobserved'
    stop(web)
    service = f'http://127.0.0.1:{api_port}'
    old_runs = {r['id'] for r in request('stock')['runs']}
    mutate('stock/movements', {'requestId': str(uuid.uuid4()), 'movement': {'id': 'web-is-closed', 'productId': 'mn-item-1', 'kind': 'Consume', 'quantity': 1, 'unit': 'base', 'source': 'synthetic'}})
    wait(lambda: any(r['id'] not in old_runs and r['state'] == 'Completed' for r in request('stock')['runs']), 'Worker stopped when Next process stopped')
    # Abrupt process exit after obligation commit but before workflow invocation.
    crash = subprocess.run([NODE, '--import', 'tsx', 'test-support/inventory-process.ts', 'crash', names[1]], cwd=ROOT / 'backend', env=ENV, capture_output=True, timeout=30)
    assert crash.returncode == 73
    with sqlite3.connect(database(names[1])) as db:
        obligation = db.execute('SELECT case_id,event_id FROM inventory_obligations').fetchone()
        assert db.execute('SELECT count(*) FROM replenishment_cases').fetchone()[0] == 0
    resume = subprocess.run([NODE, '--import', 'tsx', 'test-support/inventory-process.ts', 'resume', names[1], str(int(time.time()*1000)+31000)], cwd=ROOT / 'backend', env=ENV, capture_output=True, timeout=30)
    assert resume.returncode == 0 and json.loads(resume.stdout)['state'] == 'Completed'
    with sqlite3.connect(database(names[1])) as db:
        assert db.execute('SELECT case_id,event_id FROM inventory_obligations').fetchall() == [obligation]
        assert db.execute('SELECT state FROM replenishment_cases').fetchone()[0] == 'PoDrafted'
        assert db.execute('SELECT count(*) FROM v2_procurement_orders').fetchone()[0] == 1
    # Two real processes consume eight each from twelve; exactly one succeeds.
    initialized = subprocess.run([NODE, '--import', 'tsx', 'test-support/inventory-process.ts', 'init', names[2]], cwd=ROOT / 'backend', env=ENV, capture_output=True, timeout=30)
    assert initialized.returncode == 0
    claimers = [subprocess.Popen([NODE, '--import', 'tsx', 'test-support/inventory-process.ts', 'claim', names[2]], cwd=ROOT / 'backend', env=ENV, stdout=subprocess.PIPE, stderr=subprocess.PIPE) for _ in range(2)]
    claims = [p.communicate(timeout=30) for p in claimers]
    assert all(p.returncode == 0 for p in claimers)
    assert sum(json.loads(output[0]) is not None for output in claims) == 1
    racers = [launch(['--import', 'tsx', 'test-support/inventory-process.ts', 'consume', names[2], f'race-{i}'], {}) for i in range(2)]
    codes = sorted(p.wait(timeout=30) for p in racers)
    assert codes == [0, 2], codes
    with sqlite3.connect(database(names[2])) as db:
        assert db.execute("SELECT count(*) FROM inventory_movements WHERE kind='Consume'").fetchone()[0] == 1
    report = {'status': 'passed', 'apiProcess': True, 'nextProxyProcess': True, 'independentWorkerProcess': True, 'browserRuntime': False,
              'caseId': case_id, 'poId': po_id, 'poHash': case['poHash'], 'quantity': 40, 'proposedAmountAtomic': '2000000',
              'paymentState': 'Unobserved', 'physicalReceiptOnly': True, 'workerRestart': True, 'workerContinuedWithoutNext': True, 'abruptCrashRecovery': True, 'concurrentJobLease': True,
              'concurrentConsumerExitCodes': codes, 'publicChainExecution': False, 'financialExecution': False}
    target = Path('/tmp/carecart-closeout/p4a-process-evidence.json')
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, indent=2))
    print(json.dumps(report))
finally:
    for process in reversed(processes):
        stop(process)
    for name in names:
        shutil.rmtree(database(name).parent, ignore_errors=True)

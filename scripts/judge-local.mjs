import assert from 'node:assert/strict';

// This path exercises synthetic procurement HTTP APIs only. It never calls payment submission,
// wallets, public RPCs, or 1Click. Actual policy outcomes are verified by the local Sandbox test.
const base = new URL(process.argv[2] || 'http://127.0.0.1:3101');
assert.ok(base.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)
  && base.pathname === '/' && !base.search && !base.hash && !base.username && !base.password,
  'Use a loopback HTTP backend origin, such as http://127.0.0.1:3101');

async function api(path, body, expected = 200) {
  const response = await fetch(new URL(`/api/${path}`, base), {
    method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined, redirect: 'error', signal: AbortSignal.timeout(10000),
  });
  const data = await response.json();
  assert.equal(response.status, expected, `${path}: ${JSON.stringify(data)}`);
  return data;
}
try {
  const inventory = await api('inventory');
  const gloves = inventory.items.find((item) => item.id === 'item-000001');
  assert.ok(gloves?.isLowStock);
  assert.equal(gloves.onHand, 4);
  const forecast = await api(`inventory/${gloves.id}/forecast`);
  assert.equal(forecast.observedUsageUnits, 27);
  assert.deepEqual(forecast.supplierForecasts.map((entry) => entry.recommendedQuantity), [11, 14]);
  const generated = await api('supplier-quotes', { itemId: gloves.id }, 201);
  const alpha = generated.quotes.find((quote) => quote.supplierId === 'supplier-000001');
  assert.ok(alpha); assert.equal(alpha.quantity, 14); assert.equal(alpha.totalAmountAtomic, '1680');
  const request = { requestId: `judge-local:${alpha.quoteId}`, itemId: gloves.id, quoteId: alpha.quoteId };
  const created = await api('purchase-orders', request, 201);
  const order = created.purchaseOrder;
  assert.equal(order.supplierId, alpha.supplierId);
  assert.equal(order.amountAtomic, alpha.totalAmountAtomic);
  const beforeReplay = await api('dashboard');
  const replay = await api('purchase-orders', request);
  assert.equal(replay.replayed, true); assert.equal(replay.purchaseOrder.id, order.id);
  const afterReplay = await api('dashboard');
  assert.equal(afterReplay.purchaseOrders.length, beforeReplay.purchaseOrders.length);
  assert.equal(afterReplay.auditEvents.length, beforeReplay.auditEvents.length);
  const rejected = await api('purchase-orders', { ...request, destinationAccountId: 'attacker.near', amountAtomic: '1' }, 400);
  assert.equal(rejected.error.code, 'VALIDATION_ERROR');
  const agent = await api('agent/tasks', { itemId: gloves.id });
  assert.equal(agent.mode, 'deterministic');
  const config = await api('intents/config');
  assert.equal(config.mode, 'mock_simulation'); assert.equal(config.settlementEnabled, false);
  const simulation = await api('intents/preview', { purchaseOrderId: order.id, destinationChain: 'base' });
  assert.equal(simulation.mode, 'mock_simulation'); assert.equal(simulation.settlement, 'not_initiated');
  assert.equal(simulation.supplierId, order.supplierId); assert.equal(simulation.amountAtomic, order.amountAtomic);
  assert.ok(!('depositAddress' in simulation));
  const final = await api('dashboard');
  assert.equal(final.dataOrigin, 'synthetic');
  assert.deepEqual(final.purchaseOrders, afterReplay.purchaseOrders);
  assert.deepEqual(final.auditEvents, afterReplay.auditEvents);
  const audit = final.auditEvents.find((event) => event.entityId === order.id && event.eventType === 'purchase_order_created');
  assert.ok(audit);
  console.log(JSON.stringify({ result: 'passed', backend: base.origin, dataOrigin: final.dataOrigin,
    inventory: { itemId: gloves.id, onHand: gloves.onHand, reorderPoint: gloves.reorderPoint },
    forecast: { observedUsageUnits: forecast.observedUsageUnits, recommendations: forecast.supplierForecasts },
    quoteId: alpha.quoteId, purchaseOrder: order, replay: { sameOrder: true, replayed: replay.replayed },
    payeeOverride: { status: 400, code: rejected.error.code }, agentMode: agent.mode,
    simulation: { mode: simulation.mode, settlement: simulation.settlement, supplierId: simulation.supplierId, amountAtomic: simulation.amountAtomic },
    auditEventId: audit.id, previewChangedPaymentOrAudit: false,
    policyVerification: 'Run the documented local Sandbox test; this HTTP script submits no payments.' }, null, 2));
} catch (error) {
  console.error('Local judge path failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

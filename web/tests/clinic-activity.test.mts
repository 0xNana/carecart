import test from "node:test";
import assert from "node:assert/strict";
import type { StockDashboard } from "../src/lib/inventory.ts";
import {
  clinicActivity,
  filterClinicActivity,
} from "../src/lib/clinic-activity.ts";
const data: StockDashboard = {
  dataOrigin: "synthetic",
  financialExecution: false,
  profileFingerprint: "a".repeat(64),
  config: {
    monitoring: true,
    automaticCases: true,
    automaticPreparation: true,
    financialExecution: false,
    intervalSeconds: 30,
  },
  trackedSkus: 1,
  lowStock: 0,
  criticalStock: 0,
  obligations: [],
  jobs: [],
  items: [
    {
      id: "mn-item-1",
      sku: "GLOVES-BOX",
      name: "Gloves",
      clinicId: "clinic",
      storeroomId: "store",
      baseUnit: "box",
      packSize: 1,
      source: "synthetic",
      balance: {
        onHand: 30,
        reserved: 0,
        available: 30,
        incoming: 0,
        inventoryPosition: 30,
        expired: 0,
      },
      forecast: {
        basis: "fixture",
        dailyDemand: 1,
        leadTimeDays: 1,
        safetyStock: 1,
        reorderPoint: 2,
        targetStock: 30,
        shortage: false,
        daysOfSupply: 30,
      },
      movements: [
        {
          id: "move-1",
          productId: "mn-item-1",
          kind: "Receive",
          quantity: 3,
          baseQuantity: 3,
          unit: "base",
          source: "synthetic",
          timestamp: "2026-11-14T10:00:00Z",
          actor: "staff",
          reference: "receipt-123",
        },
      ],
    },
  ],
  runs: [
    {
      id: "run-1",
      productId: "mn-item-1",
      worker: "fixture",
      state: "Completed",
      startedAt: Date.parse("2026-11-14T09:00:00Z"),
      completedAt: Date.parse("2026-11-14T09:01:00Z"),
      error: null,
    },
  ],
  audit: [
    {
      id: 1,
      type: "InventoryEvaluated",
      timestamp: "2026-11-14T09:00:00Z",
      actor: "inventory-monitor",
      evidence: {},
    },
    {
      id: 2,
      type: "AutonomyConfigured",
      timestamp: "2026-11-14T08:00:00Z",
      actor: "staff",
      evidence: {},
    },
  ],
};
test("clinic activity is chronological, uses supply units and avoids duplicate monitoring audit records", () => {
  const rows = clinicActivity(data);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].description, "3 boxes");
  assert.equal(rows.filter((row) => row.id.startsWith("check:")).length, 1);
  assert.equal(filterClinicActivity(rows, "stock", "receipt-123").length, 1);
  assert.equal(filterClinicActivity(rows, "monitoring", "").length, 2);
  assert.equal(filterClinicActivity(rows, "all", "no match").length, 0);
});

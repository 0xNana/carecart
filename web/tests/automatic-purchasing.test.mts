import test from "node:test";
import assert from "node:assert/strict";
import {
  parseAutomaticPurchasingSnapshot,
  automaticPurchasingError,
} from "../src/lib/automatic-purchasing.ts";
import { OperatorApiError } from "../src/lib/operator-client.ts";
import { exactTokenAmount } from "../src/lib/funding.ts";
const policy = {
  version: 1,
  enabled: true,
  policy: {
    maxAutomaticAmount: "1000000",
    expiresAt: "2026-11-15T00:00:00Z",
    suppliers: ["supplier.testnet"],
    itemIds: ["mn-item-1"],
  },
};
test("automatic purchasing distinguishes an absent API route from a disabled policy", () => {
  assert.equal(
    automaticPurchasingError(new OperatorApiError("HTTP_ERROR", 404)).status,
    "Not connected",
  );
  assert.equal(
    parseAutomaticPurchasingSnapshot({
      version: 0,
      enabled: false,
      policy: null,
    }).enabled,
    false,
  );
  assert.equal(parseAutomaticPurchasingSnapshot(policy).enabled, true);
  for (const value of [
    {},
    { ...policy, policy: null },
    { ...policy, version: -1 },
    { ...policy, policy: { ...policy.policy, maxAutomaticAmount: "no" } },
  ])
    assert.throws(() => parseAutomaticPurchasingSnapshot(value));
});
test("payment amounts retain small token units while ordinary amounts show cents", () => {
  assert.equal(exactTokenAmount("1000000"), "1.00");
  assert.equal(exactTokenAmount("1250000"), "1.25");
  assert.equal(exactTokenAmount("1"), "0.000001");
  assert.equal(exactTokenAmount("0"), "0.00");
});

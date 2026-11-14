import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("landing describes budgeted autonomy accurately without screenshots or simulated transactions", () => {
  const source = readFileSync("src/components/landing-page.tsx", "utf8");
  const landing = source
    .replace(/\{" "\}/g, " ")
    .replace(/<br\s*\/?>/g, " ")
    .replace(/<\/?span[^>]*>/g, "")
    .replace(/\s+/g, " ");
  assert.match(
    landing,
    /Your medical supplies shouldn&apos;t run out before you notice\./,
  );
  assert.match(landing, /Give AI a budget, not your wallet\./);
  assert.match(landing, /CCUSD/);
  assert.match(landing, /no cash value/);
  assert.match(landing, /Circle USDC/);
  assert.doesNotMatch(source, /screenshots\/|next\/image|<img\b|<Image\b/);
  assert.match(source, /role="tablist"/);
  assert.match(source, /role="tabpanel"/);
  assert.match(landing, /Eligible orders can proceed automatically/);
  assert.doesNotMatch(
    landing,
    /Clinic approval before every|Each purchase needs clinic authorization|A clinic approver authorizes each purchase|paymentMock|inventoryMock|poPrepared/,
  );
});

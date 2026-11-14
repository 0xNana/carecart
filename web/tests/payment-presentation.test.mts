import test from "node:test";
import assert from "node:assert/strict";
import {
  confirmedSupplierPayment,
  paymentStage,
} from "../src/lib/payment-presentation.ts";
import type { FinancialReview } from "../src/lib/financial-review.ts";
const hash = "EsrPBQ9h7AZvASMBLkTDE1TZd1aMwvUF8HtyxfqrmbD";
function fixture(): FinancialReview {
  return {
    profileFingerprint: "a".repeat(64),
    caseId: "case",
    revision: 1,
    state: "PoDrafted",
    nextAction: "AuthorizePayment",
    canonicalHash: "b".repeat(64),
    canonical: {
      po_id: "order",
      profile: "testnet",
      supplier: "supplier.testnet",
      token: "token.testnet",
      amount: "1500000",
      invoice_digest: "c".repeat(64),
      destination: "Near",
    },
    quote: {
      id: "quote",
      supplierId: "Supplier A",
      supplierAccount: "supplier.testnet",
      quantity: 30,
      unitPriceAtomic: "50000",
      amountAtomic: "1500000",
      issuedAt: "2026-11-13T00:00:00Z",
      expiresAt: "2026-11-14T00:00:00Z",
      asset: "CCUSD",
      decimals: 6,
    },
    quoteExpired: false,
    policy: {
      limits: {},
      spendable: null,
      usage: null,
      blocks: [],
      observed: false,
      humanRequired: false,
      supplierApproved: null,
    },
    requiredAuthority: "requester",
    approvalStatus: "Unobserved",
    operations: [],
    settlement: null,
    execution: "public-rpc",
    publicSigningEnabled: true,
    authorizations: [],
  };
}
function receipt(r: FinancialReview) {
  return {
    transactionHash: hash,
    poId: r.canonical.po_id,
    token: r.canonical.token,
    recipient: r.canonical.supplier,
    amount: r.canonical.amount,
    network: "testnet",
    nativeSettlementVerified: true,
  };
}
function addReceipt(r: FinancialReview) {
  r.authorizations = [
    {
      id: "authorization",
      role: "requester",
      state: "Completed",
      termsHash: "d".repeat(64),
      expiresAt: "2026-11-14T00:00:00Z",
      execution: "public-rpc",
      publicSigningEnabled: true,
      error: null,
      events: [
        {
          state: "Observed",
          timestamp: "2026-11-13T00:00:00Z",
          error: null,
          nativePayment: receipt(r),
        },
      ],
    },
  ];
  return r;
}
test("payment presentation distinguishes prepared, approval, authorization, submission, failure and blocked states", () => {
  const r = fixture();
  assert.equal(paymentStage(r), "Prepared");
  r.approvalStatus = "PendingApproval";
  assert.equal(paymentStage(r), "Awaiting approval");
  r.approvalStatus = "Unobserved";
  r.authorizations = [
    {
      ...addReceipt(fixture()).authorizations[0],
      state: "Authorized",
      events: [],
    },
  ];
  assert.equal(paymentStage(r), "Authorized");
  r.state = "DispatchInProgress";
  assert.equal(paymentStage(r), "Submitted");
  r.state = "Failed";
  assert.equal(paymentStage(r), "Failed");
  r.state = "PoDrafted";
  r.policy.blocks = ["Paused"];
  assert.equal(paymentStage(r), "Blocked");
});
test("only a matching independent public testnet receipt can show Confirmed", () => {
  const r = addReceipt(fixture());
  assert.equal(paymentStage(r), "Confirmed");
  assert.equal(confirmedSupplierPayment(r)?.transactionHash, hash);
  for (const patch of [
    { network: "mainnet" },
    { amount: "1" },
    { recipient: "other.testnet" },
    { token: "other.testnet" },
    { poId: "other-order" },
    { nativeSettlementVerified: false },
    { transactionHash: "" },
  ]) {
    const bad = structuredClone(r);
    Object.assign(bad.authorizations[0].events[0].nativePayment!, patch);
    assert.notEqual(paymentStage(bad), "Confirmed");
  }
  for (const execution of ["mocked-rpc", "sandbox-rpc", "disabled"] as const)
    assert.notEqual(paymentStage({ ...r, execution }), "Confirmed");
  const crossChain = structuredClone(r); crossChain.canonical.destination={Base:{}}; assert.notEqual(paymentStage(crossChain),"Confirmed");
  const unverified = fixture();
  unverified.state = "SameChainConfirmed";
  unverified.settlement = { state: "Settled" };
  assert.equal(paymentStage(unverified), "Checking status");
});

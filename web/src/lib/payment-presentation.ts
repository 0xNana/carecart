import type { FinancialReview } from "./financial-review.ts";

/** Presentation only: submission and journal completion are never payment proof. */
export function confirmedSupplierPayment(review: FinancialReview) {
  if (
    review.execution !== "public-rpc" ||
    review.canonical.profile !== "testnet" || review.canonical.destination !== "Near"
  )
    return undefined;
  return review.authorizations
    .flatMap((a) => a.events.map((e) => e.nativePayment))
    .find(
      (p) =>
        p?.nativeSettlementVerified === true &&
        p.network === "testnet" &&
        p.poId === review.canonical.po_id &&
        p.token === review.canonical.token &&
        p.recipient === review.canonical.supplier &&
        p.amount === review.canonical.amount &&
        /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(p.transactionHash),
    );
}
export function paymentStage(review: FinancialReview) {
  if (confirmedSupplierPayment(review)) return "Confirmed";
  if (
    review.state === "Failed" ||
    review.authorizations.some((a) => a.state === "Failed")
  )
    return "Failed";
  if (
    review.policy.blocks.length ||
    ["Rejected", "Expired"].includes(review.state)
  )
    return "Blocked";
  if (
    review.approvalStatus === "PendingApproval" ||
    review.state === "AwaitingHumanApproval"
  )
    return "Awaiting approval";
  if (["DispatchInProgress", "SourceDispatched"].includes(review.state))
    return "Submitted";
  if (
    [
      "SameChainConfirmed",
      "DestinationSettled",
      "RequiresReconciliation",
    ].includes(review.state) ||
    review.authorizations.some((a) =>
      ["Executing", "RequiresReconciliation", "Completed", "Observed"].includes(
        a.state,
      ),
    )
  )
    return "Checking status";
  if (
    review.authorizations.some(
      (a) => a.role === "requester" && a.state === "Authorized",
    )
  )
    return "Authorized";
  return "Prepared";
}

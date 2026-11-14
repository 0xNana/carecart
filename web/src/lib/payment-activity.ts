import type { WorkspaceCase } from "./workflow.ts";

export type PaymentFilter = "all" | "attention" | "processing" | "recorded";
/** Saved workflow outcomes are not independent confirmation of a supplier transfer. */
export function paymentActivityState(entry: WorkspaceCase): {
  label: string;
  group: Exclude<PaymentFilter, "all">;
} {
  if (["Failed", "Rejected", "Expired"].includes(entry.state))
    return {
      label: entry.state === "Rejected" ? "Declined" : entry.state,
      group: "attention",
    };
  if (entry.state === "Refunded")
    return { label: "Refund recorded", group: "recorded" };
  if (entry.state === "RequiresReconciliation")
    return { label: "Check status", group: "attention" };
  if (
    ["SameChainConfirmed", "DestinationSettled"].includes(entry.state) ||
    entry.vault?.status === "Paid"
  )
    return { label: "Receipt available", group: "recorded" };
  if (
    entry.humanInterventions.length ||
    entry.state === "AwaitingHumanApproval" ||
    entry.vault?.status === "PendingApproval"
  )
    return { label: "Needs approval", group: "attention" };
  if (
    [
      "CommitmentPending",
      "PaymentRequestPending",
      "DispatchInProgress",
      "SourceDispatched",
    ].includes(entry.state)
  )
    return { label: "Processing", group: "processing" };
  return { label: "Ready for review", group: "attention" };
}
export function paymentSupplier(entry: WorkspaceCase) {
  return (
    entry.quotes.find((quote) => quote.id === entry.selection?.quoteId)
      ?.supplierAccount ?? "Supplier not selected"
  );
}
export function paymentActivity(
  cases: WorkspaceCase[],
  filter: PaymentFilter,
  search: string,
) {
  const query = search.trim().toLowerCase();
  return cases.filter(
    (entry) =>
      (entry.selection || entry.vault || entry.settlement) &&
      (filter === "all" || paymentActivityState(entry).group === filter) &&
      (!query ||
        [
          entry.item?.name,
          entry.itemId,
          entry.poId,
          paymentSupplier(entry),
        ].some((value) => value?.toLowerCase().includes(query))),
  );
}

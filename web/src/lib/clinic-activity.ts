import type { StockDashboard } from "./inventory.ts";
import { statusLabel, unitLabel } from "./product-copy.ts";
export type ActivityCategory = "all" | "stock" | "monitoring";
export type ClinicActivity = {
  id: string;
  category: Exclude<ActivityCategory, "all">;
  title: string;
  subject: string;
  description: string;
  timestamp: string;
  attention: boolean;
  fields: { label: string; value: string }[];
};
const activityTime = (value: string | number) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
};
/** Movement rows and monitoring runs are distinct records; routine audit copies
 * of those runs are excluded to avoid repeating the same check in the feed. */
export function clinicActivity(data: StockDashboard): ClinicActivity[] {
  const movements: ClinicActivity[] = data.items.flatMap((item) =>
    item.movements.map((m) => ({
      id: "movement:" + m.id,
      category: "stock" as const,
      title: statusLabel(m.kind),
      subject: item.name,
      description: `${m.baseQuantity} ${unitLabel(item.baseUnit, m.baseQuantity)}${m.destination ? " · " + m.destination : ""}`,
      timestamp: activityTime(m.timestamp),
      attention: false,
      fields: [
        { label: "Supply", value: item.name },
        {
          label: "Quantity",
          value: `${m.baseQuantity} ${unitLabel(item.baseUnit, m.baseQuantity)}`,
        },
        ...Object.entries({
          Reference: m.reference,
          Receipt: m.receiptReference,
          Supplier: m.supplierId,
          Lot: m.batch,
          Destination: m.destination,
          Reason: m.reason,
          Order: m.orderId,
          "Recorded by": m.actor,
          "Record reference": m.id,
        }).flatMap(([label, value]) => (value ? [{ label, value }] : [])),
      ],
    })),
  );
  const runs: ClinicActivity[] = data.runs.map((run) => ({
    id: "check:" + run.id,
    category: "monitoring",
    title:
      run.state === "Failed"
        ? "Stock check needs attention"
        : run.state === "Completed"
          ? "Stock check completed"
          : "Stock check in progress",
    subject:
      data.items.find((item) => item.id === run.productId)?.name ??
      run.productId,
    description:
      run.state === "Failed"
        ? "Open the record to review this check."
        : statusLabel(run.state),
    timestamp: activityTime(run.startedAt),
    attention: run.state === "Failed",
    fields: [
      {
        label: "Supply",
        value:
          data.items.find((item) => item.id === run.productId)?.name ??
          run.productId,
      },
      { label: "Status", value: statusLabel(run.state) },
      {
        label: "Completed",
        value: run.completedAt
          ? new Date(run.completedAt).toLocaleString()
          : "Not completed",
      },
      ...(run.state === "Failed"
        ? [
            {
              label: "Next step",
              value:
                "Check stock records and supplier offers, then review monitoring in Settings.",
            },
          ]
        : []),
      { label: "Record reference", value: run.id },
    ],
  }));
  const audit: ClinicActivity[] = (data.audit ?? [])
    .filter(
      (record) =>
        !["InventoryEvaluated", "InventoryEvaluationFailed"].includes(
          record.type,
        ),
    )
    .map((record) => ({
      id: "update:" + record.id,
      category: "monitoring",
      title:
        record.type === "ClinicRuntimeInitialized"
          ? "Clinic workspace set up"
          : statusLabel(record.type),
      subject: "Clinic workspace",
      description: "Monitoring update",
      timestamp: activityTime(record.timestamp),
      attention: false,
      fields: [
        { label: "Update", value: statusLabel(record.type) },
        { label: "Recorded by", value: record.actor },
        { label: "Record reference", value: String(record.id) },
      ],
    }));
  return [...movements, ...runs, ...audit].sort(
    (a, b) => (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0),
  );
}
export function filterClinicActivity(
  rows: ClinicActivity[],
  category: ActivityCategory,
  query: string,
) {
  const search = query.trim().toLowerCase();
  return rows.filter(
    (row) =>
      (category === "all" || row.category === category) &&
      (!search ||
        [
          row.title,
          row.subject,
          row.description,
          ...row.fields.map((field) => field.value),
        ].some((value) => value.toLowerCase().includes(search))),
  );
}

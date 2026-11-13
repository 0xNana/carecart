# CareCart product brief

**Status:** Current product description with unvalidated customer hypotheses.  
**Purpose:** Keep product, sales and implementation language aligned with what CareCart can demonstrate today.

## Product

CareCart helps clinics keep inventory records current and prepare replenishment work. Staff record stock received, used, dispensed or adjusted. A monitor can identify low stock, compare configured supplier offers and prepare a purchase order for clinic review.

The product manages inventory and procurement records. It does not make clinical decisions, recommend treatment, or need patient records for the workflow described here.

## Intended users and buyer hypotheses

The likely day-to-day user is the person responsible for a clinic's store room or stock records. A clinic administrator or operations lead may sponsor a pilot; whoever controls purchasing and finance must approve any real order or payment. These roles are hypotheses to validate with clinics, not evidence of a defined sales pipeline.

The first customer segment is open. A small outpatient clinic with recurring supply orders and a simple purchasing chain may be a manageable place to learn, but CareCart has not validated this segment, its budget, or its purchasing process. See the [first-client plan](FIRST_CLIENT_PLAN.md).

## Workflow and authority

1. Staff record stock movements against the clinic's catalog.
2. The inventory monitor evaluates stock and replenishment needs.
3. CareCart can prepare a case and purchase order using configured supplier information.
4. A clinic representative can select a bounded standing testnet policy; eligible orders are automatically authorized and other orders remain for review.
5. Payment services process only already-authorized requests within configured controls.
6. Staff confirm physical delivery separately; a payment observation is not a delivery record.

A bounded headless testnet run demonstrated automatic purchasing within an owner-approved policy. Production activation remains separate. Keep clinic approval visible in product copy and customer conversations.

## Evidence and limits

| Statement | Current evidence |
| --- | --- |
| Inventory and replenishment flow | Local browser acceptance uses synthetic clinic data and verifies stock movements, a worker-prepared order, receipt and restart recovery. |
| Payment policy controls | Contract tests include local NEAR Sandbox flows. These do not establish a public supplier payment. |
| Public testnet payment | A bounded November 13 headless run paid 1.5 CCUSD to an approved test supplier; final receipts, exact balance deltas and a no-transfer duplicate request are independently verifiable. |
| Supplier pricing and availability | Demo data is synthetic. Do not present it as a live supplier catalog or quote. |
| Real-world clinic fit | Not established by the included demo or code. Validate workflows, permissions, data handling and willingness to pay with a clinic. |

The archived reviewed source was rebuilt and matched the deployed vault byte for byte; the bounded November 13 testnet run paid 1.5 CCUSD and verified a duplicate request transferred nothing. CCUSD is a CareCart test token, not Circle USDC. See the root [README](../README.md) and [submission handoff](SUBMISSION_HANDOFF.md) for the exact evidence details.

## Product principles

- Keep stock records and purchase preparation understandable to clinic staff.
- Make the source and age of stock, supplier and quote information visible.
- Keep approval and payment authority explicit; do not imply that an agent can spend without clinic authorization.
- Minimize data. Do not collect patient information for inventory replenishment.
- Keep synthetic, local Sandbox, testnet and real-customer evidence clearly distinguished.


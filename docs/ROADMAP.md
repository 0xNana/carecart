# CareCart product roadmap

**Status:** Proposed; no delivery dates or customer commitments have been approved.
**Goal:** Validate a useful, safe inventory and replenishment workflow with one clinic, then decide whether to make it repeatable.

This is a product roadmap, not the engineering task list. Engineering work already in progress remains tracked in [`tasks/todo.md`](../tasks/todo.md); this roadmap does not close, replace or reorder those tasks.

## Stage 0 — Find a real workflow worth solving

**Outcome:** One clearly defined clinic problem, buyer, day-to-day user and pilot sponsor.

- Choose a first geography and clinic type the team can support in person or remotely.
- Interview clinic staff about how they track stock, decide to reorder, compare suppliers, approve purchases and record deliveries.
- Observe the current process where permitted; record baseline effort and failure points without collecting patient or confidential supplier information.
- Test whether stockouts, excess stock, manual reconciliation or order-preparation time is the most urgent problem.

**Exit gate:** A named clinic sponsor agrees to a bounded pilot, an operational lead is available, and the clinic confirms the workflow and success measures. If this evidence is absent, continue discovery instead of building speculative features.

## Stage 1 — Make a bounded pilot safe to operate

**Outcome:** A clinic can use a limited inventory workflow with known support and recovery procedures.

- Agree the pilot location, stock room, item set, staff roles, supplier-information source and manual approval boundary.
- Confirm production hosting, clinic isolation, authentication, backups and a tested restore, auditability, support contact, and data retention/deletion expectations.
- Agree how the clinic provides opening balances and how corrections, expired stock and deliveries are recorded.
- Confirm local privacy, security, procurement and commercial requirements with the clinic and qualified local advisers where needed.
- Keep live payment execution outside the pilot until it has a separately reviewed, tested and approved operating process.

**Exit gate:** The clinic signs off on the data and workflow plan; the team can restore the pilot data and explain who can view or change it; unresolved high-impact security or operational gaps have owners and dates.

## Stage 2 — Run a limited clinic pilot

**Outcome:** Evidence that the workflow improves an agreed inventory or purchasing task for actual staff.

- Start with one clinic site and a bounded group of frequently replenished items selected with staff.
- Use clinic-validated catalog and supplier information. The synthetic demo catalog is not a live source.
- Onboard the inventory lead and purchasing approver; practice corrections and delivery recording before relying on alerts.
- Keep every purchase decision with the clinic. Do not describe the pilot as autonomous procurement.
- Review errors, ignored alerts, stock discrepancies and staff feedback with the sponsor on an agreed cadence.

**Exit gate:** Compare results with the baseline using success measures agreed before the pilot. The clinic and CareCart decide whether to stop, revise, continue or convert to a paid service.

## Stage 3 — Convert learning into a repeatable service

**Outcome:** A defined onboarding and support process that a second clinic can use without custom engineering.

- Standardize setup, catalog loading, training, backup and recovery, support response and offboarding.
- Establish a pricing model from customer willingness to pay, hosting/support cost and the value measured in the pilot; do not invent a price before those inputs exist.
- Confirm which supplier connections and reports multiple clinics actually need.
- Add monitoring and operational measures for service reliability, data quality and support load.

**Exit gate:** The first clinic renews or pays against written terms, and a second clinic can onboard using the documented process with only bounded configuration.

## Stage 4 — Expand only after evidence

Consider multi-site operations, supplier integrations, broader product categories or more automation only when customer demand and operational evidence support them. Any change to financial authority, real-money payment, regulated product handling or cross-chain settlement requires its own security, legal, customer and release review.

## Not in the current roadmap

- Clinical recommendations or patient-record processing.
- Claims that supplier catalogs or prices are live when they are not.
- Unattended spending or automatic payment without a separately approved authority model.
- Mainnet or production financial execution based only on local tests or testnet configuration.

## Decisions to resolve through discovery

- Initial geography and clinic segment.
- Which supply categories and inventory units are in scope.
- Who owns stock accuracy, purchase approval and payment at the first clinic.
- How the clinic currently receives supplier prices and availability.
- Data residency, privacy, security, retention and support expectations.
- Pilot duration, success thresholds and paid-conversion terms.

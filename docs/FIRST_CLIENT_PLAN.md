# First-client plan

**Status:** Proposed customer-discovery and pilot plan. No clinic, buyer, price or pilot commitment is recorded here.  
**Objective:** Secure one clinic as a design partner, validate a costly inventory workflow, and earn a paid pilot or a clear decision not to proceed.

## 1. Start with a customer hypothesis

Initial segment to test: a small outpatient clinic with a recurring supply-purchasing process, a staff member who maintains stock records, and a reachable person who can approve a pilot. Prefer a clinic where the team can learn directly from the inventory and purchasing workflow. This is a starting hypothesis, not a validated market choice.

Do not assume the clinic's country, regulatory obligations, budget, procurement rules, internet access, or preferred suppliers. Choose a launch area the team can support and confirm local requirements before a live pilot.

### People to identify

- **Daily user:** stores or inventory staff who record receipts, usage and adjustments.
- **Operational sponsor:** clinic administrator, operations lead or owner who can prioritize the problem and make staff available.
- **Approver:** the person authorized to approve orders and payments; may be different from the sponsor.

One person may hold several roles. Confirm who actually does each task rather than relying on job titles.

## 2. Qualify before offering a pilot

Look for a clinic that can describe a recent inventory failure or time-consuming ordering process, has a staff champion, can share a small non-patient inventory catalog, and can make a decision about a time-bounded pilot.

| Qualification question | Evidence to capture |
| --- | --- |
| Is the problem frequent and costly enough to change? | A recent example, its operational impact and how often it happens. |
| Can staff participate? | A named daily user and time for onboarding and weekly feedback. |
| Is a decision-maker involved? | The sponsor, purchasing approver and next decision date. |
| Can the workflow start with limited data? | A small item list, units, opening counts and agreed supplier-information source. |
| Can the team support it safely? | Hosting, access, backups, support, retention and local requirements reviewed before live records are used. |

If the clinic cannot identify a sponsor, provide agreed workflow access or explain why its current process is failing, do not treat interest in a demo as a pilot commitment.

## 3. Run discovery conversations

Ask about the clinic's current process before showing the product. Keep notes free of patient information and private commercial details in this repository; store any real interview record in an owner-approved private system.

1. Walk me through the last time an essential item ran low. What happened from discovery to delivery?
2. Where do stock counts live today, and who updates them?
3. How do you choose when to reorder and how much to order?
4. How do you get supplier prices, availability and lead times? How old can that information be before it is unsafe to use?
5. What happens when the physical count and the recorded count disagree?
6. Who prepares, approves and pays for an order? What records do they need?
7. What was the consequence of the most recent stockout, late delivery or excess purchase?
8. Which items would be safe and useful to include in a small pilot? Which must be excluded?
9. What information would the clinic allow a new service to store, where may it be stored, and for how long?
10. If the workflow worked, who would decide whether to continue and what would that decision require?

Ask for examples of the process, not a forecast of whether the clinic would use an imagined feature. End by asking for a follow-up with the operational sponsor and purchasing approver if they were not both present.

## 4. Make a truthful first offer

Offer a short workflow review using synthetic data first. State that the current demonstration uses synthetic clinic and supplier data, has a separately verified test-token payment, and does not prove live supplier integration or production readiness. Show the current approval step clearly.

If discovery supports a pilot, propose a bounded, preferably paid pilot. Agree the fee only after learning the customer's budget, support needs, hosting/security requirements and purchasing process. If the parties choose an unpaid design partnership, write down its end date, data handling, what the clinic contributes and the decision required at the end; avoid an open-ended free trial.

### Suggested outreach note

> Hello [name], I’m building CareCart, a clinic inventory and replenishment tool. I’m speaking with clinic teams to understand how they record stock, decide when to reorder and prepare purchase orders. Would you be open to a 20-minute conversation about your current process? The demo uses synthetic data; I’m looking for feedback, not asking you to share patient information or make a purchase.

This is a draft for the founder to adapt. Do not send it from this repository or imply that a clinic has already agreed to participate.

## 5. Bound the pilot

Agree a pilot brief with the clinic before importing real operational data:

- One site and one stock room to start; the clinic chooses the small group of frequently replenished items.
- Named daily user, sponsor, purchasing approver and CareCart support contact.
- Opening-count process, units of measure, reorder rules and correction procedure.
- Provenance and freshness rules for any supplier offers. If live supplier data is unavailable, keep the order-preparation step a review exercise and do not label synthetic offers as real quotes.
- Manual clinic approval for every real order and payment. No automatic financial execution in this first-client pilot.
- Written data scope, access, hosting, retention/deletion, backup/restore, support and incident contact, reviewed for the clinic's jurisdiction.
- A fixed review cadence and end date, with a stop/continue/paid-conversion decision.

Begin with no patient data. Do not use real clinical or purchasing records until the clinic has approved the environment and data terms and any required local review is complete.

## 6. Agree success measures before starting

Record a baseline first and choose targets with the clinic. Do not claim improvement from a demo or set success thresholds after seeing the results.

| Measure | How to evaluate |
| --- | --- |
| Time to prepare a replenishment order | Compare staff time for the agreed items before and during the pilot. |
| Stock record quality | Compare a sample of system balances with physical counts; track corrections and causes. |
| Alert usefulness | Count alerts staff confirm, dismiss or correct; inspect false or missed alerts. |
| Stockout and urgent-order events | Track the agreed items using the clinic's definitions and baseline period. |
| Workflow adoption | Track whether the named users record receipts, usage and adjustments as agreed. |
| Delivery reconciliation | Compare expected and physically received quantities and capture discrepancies. |
| Commercial fit | Ask the decision-maker whether the measured result warrants a paid continuation and what approval is needed. |

Success is a clinic decision supported by these measures, not a prewritten percentage or a favorable anecdote.

## 7. Decide what happens next

- **Continue / convert:** the clinic confirms value, names a budget owner, agrees to commercial terms and the team can support the required service safely.
- **Revise:** value is plausible but data quality, role design, supplier information or staff workflow prevents reliable use. Agree one bounded revision and re-test.
- **Stop:** the problem is not urgent, users cannot maintain the records, the clinic will not sponsor a pilot, the value does not support a purchase, or required controls are beyond current capability.

Capture only de-identified learning in repository docs. Store customer contact information, agreements, pricing and operational data in approved private systems.

## Immediate founder checklist

- [ ] Choose one launch geography the team can support and identify any local review needed.
- [ ] Make a short list of clinics through warm introductions and relevant professional networks.
- [ ] Schedule discovery conversations with the daily user and decision-maker.
- [ ] Record the current workflow and baseline before discussing features.
- [ ] Select a design partner only after qualification; agree scope, data terms and success measures in writing.
- [ ] Review production access, backups, support and incident handling before using real clinic records.
- [ ] Revisit the [product roadmap](ROADMAP.md) with the evidence and update priorities only after the pilot decision.

### Suggested first discovery sprint

Use this as a starting funnel for the first two weeks of customer discovery; adjust it to the founder's capacity and local access. These are work targets, not market evidence or a promise of conversion.

1. Shortlist 10 clinics in one chosen geography and note why each may have the inventory workflow being tested.
2. Ask for five warm introductions through the founder's existing network or relevant professional groups.
3. Hold at least three discovery conversations, aiming to speak with both a daily user and a purchasing decision-maker.
4. Write down the strongest repeated problem and the most important disconfirming evidence.
5. Offer a pilot only if one clinic has a sponsor, an operational lead, a feasible data boundary and an agreed decision path.

If the first conversations do not confirm the problem, revise the segment or problem statement before adding product features.


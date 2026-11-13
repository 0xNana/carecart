# CareCart documentation

This directory separates repository documentation from the visitor-facing product guide at [`/docs`](https://carecart.xyz/docs). The website guide is authored as MDX in `web/content/docs/`; this folder keeps product planning, engineering instructions and hackathon handoff material in Markdown.

## Product and customers

- [Product brief](PRODUCT_BRIEF.md): current product scope, evidence and customer hypotheses.
- [Product roadmap](ROADMAP.md): proposed stages from discovery through a repeatable clinic pilot.
- [First-client plan](FIRST_CLIENT_PLAN.md): a practical path to finding, qualifying and supporting the first clinic.

The roadmap and customer plan are proposals. They do not record a customer commitment, validated market finding, agreed price or delivery date. Treat buyer, segment and workflow descriptions as hypotheses until confirmed in interviews. Treat these documents as publishable; do not add customer names, contact details, interview notes, credentials or operational records to tracked files.

## Engineering and verification

- [Judge walkthrough](JUDGE_WALKTHROUGH.md): reproduce the synthetic local demonstration.
- [Submission handoff](SUBMISSION_HANDOFF.md): evidence, limits and owner release steps.
- [PR description](PR_DESCRIPTION.md): hackathon release pull request summary.
- [EC2 backend deployment](../backend/deploy/ec2/README.md): existing backend and worker deployment instructions.

For the current implementation and known evidence limits, use the root [README](../README.md) and verify claims against code and recorded evidence before offering them to a clinic.

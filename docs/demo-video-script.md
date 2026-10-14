# Two-minute Rovelink demo

**Govern first. Automate second.** Record only after the [quickstart](demo-quickstart.md)
has been verified. This is a script and shot list, not a recorded or published video.

## Prepare

Use fake providers, fictional ACME GmbH and the isolated local demo. Start with
empty-reference drift, then explicitly import two Proxmox VMs. Deliberately enrich
one reference VM for a useful Governance Ready/Needs attention split. Have a
source-bound blueprint, evaluation, inventory and drift comparison prepared.

Use 1440×900 or 1920×1080, dark theme and normal readable zoom, with the sidebar
open. Close terminals, password managers, token/env pages and notifications.
Never record login/token creation, credentials, raw configs or real customer data.

## Script and exact clicks

| Time | Click / shot | Spoken text |
| --- | --- | --- |
| 0:00–0:15 | Dashboard (`/`), recorded eligibility and Getting started | “Automation depends on reference data we can trust. Missing customers, owners, addresses, and approval create uncertainty before a playbook even runs. Rovelink makes those gaps visible.” |
| 0:15–0:30 | Inputs > CMDBs, open Demo NetBox; Providers, open Demo Proxmox | “NetBox describes documented reference state. Providers describe observed runtime state. They are separate. NetBox Tenant becomes a Rovelink CustomerScope; provider hints do not decide customer ownership.” |
| 0:30–0:50 | Provider Inventory Objects, then CMDB VMs and Customer Assignment | “This local demo uses fake Proxmox, Azure, and generic inventory. We started with empty NetBox, then deliberately imported selected demo VMs as reference documentation. Discovery and drift do not write them back automatically.” |
| 0:50–1:10 | Governance > Blueprints; prepared blueprint; Run Evaluation; run; automatic redirect | “Governance evaluates cached reference objects against an active blueprint. Results show scores, customer assignment, ownership, and findings. The new evaluation opens directly for inspection. Governance Ready is a policy result, not permission to execute.” |
| 1:10–1:30 | Reports > Governance Readiness (`/reports/governance`) | “The report summarizes the latest completed evaluations. Compare Ready with Needs attention and see recurring issues. After a manual NetBox change, refresh and evaluate again; stored reports do not update themselves.” |
| 1:30–1:45 | Reports > Automation Readiness (`/reports/automation`) | “Inventory eligibility and execution authorization are different. Unknown means the report cannot prove all required execution signals. Ready stays zero in this alpha rather than claiming safety it cannot verify. Execution still checks GATE.” |
| 1:45–2:00 | Drift > Drift Reports (`/reports/drift`), comparison and item detail | “Drift compares reference and runtime, including unmatched objects and field differences. It is analysis only: no writeback, remediation, or GATE impact. This local alpha is not production-ready. Govern first. Automate second.” |

Rehearse at 120–140 words/minute with click pauses. Prepared results can avoid
startup delays; identify them as recorded results. Show a real evaluation redirect.
Do not call intentional unmatched-provider results a failed sync or promise a
no-drift baseline after import.

## Optional stills and claims to avoid

Dashboard/onboarding; provider inventory; CustomerScope derived from NetBox Tenant;
evaluation findings; both readiness reports; drift item detail. Review each still
for secrets and identifiers before publishing.

No production-readiness, certification, live cloud coverage from fake fixtures,
automatic writeback/remediation, or blanket execution approval. Job success is not
estate readiness; governance score alone is not Execution Allowed. Add a video URL
only after a reviewed recording exists.

## Decision layer and execution boundary

Rovelink is the governance-first pre-flight decision layer for infrastructure
automation. Built-in Ansible is intended for local demos, short tests, migrations,
and lightweight controlled environments. It remains available, but is not the
recommended enterprise-scale execution architecture. The enterprise direction is
controlled external AWX/RHAAP/webhook adapters with decision snapshots, scoped
credentials and durable workers; the existing AWX connector is MVP-level.

Checks apply to routed workflows. Direct SSH, provider-console, Terraform and
manual administrative access can bypass an application-layer gate. See the
[enforcement boundary](enforcement-boundary.md) for IAM/PAM, network controls and audited break-glass
requirements. Reports and pre-flight evidence do not grant execution permission.

# Rovelink concepts

| Concept | Practical meaning |
| --- | --- |
| Reference state / CMDB | Documented intended/reference data, cached from NetBox in Rovelink. |
| Runtime state / provider inventory | Infrastructure observed through provider discovery or offline demo fixtures. |
| CustomerScope / customer assignment | A business/customer boundary and an object's assignment to it, scoped to the Rovelink organization and reference source. |
| NetBox Tenant | Source-side customer object. For MSPs, use one Tenant per customer and assign each reference VM directly. |
| Provider customer hints | Non-authoritative tags, pools, and candidate names. They are not CustomerScope assignments. |
| Drift | A stored comparison of reference and runtime VMs. Missing reference VMs yield unmatched provider results; drift does not update either source or Governance/GATE. |
| Governance | An explicit evaluation of reference completeness, ownership, and customer assignment against a versioned blueprint. |
| Governance Ready | A stored reference object satisfies the active blueprint's readiness rules. It is a policy result over cached data, not a guarantee of current source accuracy or execution safety. |
| Automation Eligible | Known inventory/readiness signals support preparing a target for automation. Missing or unknown signals must be reviewed. Inventory inclusion does not authorize a run. |
| Execution Allowed | The final GATE decision for a specific automation action/run. Execution-time checks and configured inventory governance enforcement remain authoritative. |

The product model is **CMDB/reference → governance readiness → inventory eligibility →
automation runs → run results**, with provider/runtime discovery and drift used
to compare reference documentation with observed infrastructure. The Dashboard
onboarding walkthrough introduces sources and drift before automation preparation;
that navigation order is not an authorization flow. Getting started only
reads progress. Its milestones are not freshness or security guarantees. An empty
reference cache can be a successful demo import; it remains Ready in the stepper.

Use [the NetBox customer model](netbox-customer-model.md): one NetBox Tenant
per customer, imported as a CustomerScope. Rovelink organizations and Azure
identity tenants are separate concepts. Provider hints never replace CMDB truth.
Refresh imports reference VMs and assignments but does not evaluate Governance.
Run governance explicitly to replace historical findings. Drift is analysis-only.

Reports are posture dashboards: `/reports` shows both, `/reports/governance`
shows Governance Readiness, and `/reports/automation` shows Automation Readiness.
Drift remains a separate sidebar section. The [Automation Readiness Report](automation-readiness-report.md)
keeps unproven execution readiness **Unknown**. Ready = 0 is intentional in this
alpha because current execution authorization, connection users, and credentials
are not verified there. Reports never prepare or execute automation.

CustomerScope policies and inventory enforcement settings determine the effects
of findings. A visibility-only policy reports issues without itself affecting
readiness; separate required-data rules can still affect the governance result.
See [demo scenarios](demo-scenarios.md) for the empty-source walkthrough and
limitations. Explicit CMDB write pipelines or demo scripts are separate,
user-initiated operations, never a side effect of discovery or drift.

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
requirements. Reports do not authorize execution. A positive pre-flight decision is bounded to its target/action and is not an execution token.

## Action-specific pre-flight decisions

Governance Ready describes reference quality. Automation Eligible describes
verified technical prerequisites. Execution Allowed additionally requires an
explicit requester/action/CustomerScope grant and fresh, consistent evidence.
The decision-only GATE API can now return allow for a narrowly verified local
Linux/SSH path under an admin-managed inventory action policy. Missing grants,
unsupported capabilities or incomplete evidence stay unknown; known blockers
return block. No approval state is fabricated. Reports remain posture-only and
Automation Readiness remains conservative, even when one action-specific request
can be allowed.

Every action policy sets explicit age limits and a bounded validity period; caller
requests can only tighten freshness. Source/customer changes, blueprint versions,
playbook pins and final rereads constrain the result. No snapshot is persisted and
no runner is launched. Future adapters must revalidate immediately before launch;
direct administrative access can bypass an application-layer gate. See the
[complete GATE contract](gate-decision-api.md) for configuration, reason codes, supported
prerequisites and remaining TOCTOU risks. AWX/RHAAP integration and durable workers
remain roadmap work.

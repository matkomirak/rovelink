# Automation Readiness Report

Open **Reports > Automation Readiness** (`/reports/automation`). The existing `/reports` page also shows it below Governance Readiness. Inventory names and **View inventory** open the existing inventory detail page. Refresh report rereads stored data; it does not sync inventories or execute automation.

**Rovelink does not mark targets Ready unless readiness can be proven.** Unknown
means required governance, inventory, or execution signals cannot yet be verified.
Ready = 0 is expected in this alpha, not a failed report. Governance Ready,
Automation Eligible, and Execution Allowed are distinct; see [Concepts](concepts.md).

The first version deliberately distinguishes inventory signals from authorization:

| Category | Meaning in this version |
| --- | --- |
| Needs attention | A cached linked target has no host address, or its latest stored governance evaluation says it is not ready. Multiple issues count once in this category. |
| Unknown | No known issue above, but full execution readiness cannot be established. Also includes file/script targets and recorded targets whose host details are unavailable. |
| Ready | Reserved for fully established execution readiness. Always zero in this version because current execution GATE authorization is not available to the report. |

Host addresses can be IP addresses or DNS names. Governance context is read by explicit local CMDB object identity within the current organization. Provider hints and cached governance claims do not establish readiness. Governance results may be stale; they do not authorize execution.

Connection users and credentials can be chosen when preparing a run and are not assessed here. Approval state and current GATE authorization are not tracked. Run success statistics are omitted because a run's inventory association is resolved through a mutable template rather than an immutable inventory snapshot.

Counts cover targets already in automation inventories. Linked inventory caches exclude source VMs blocked during sync, so these totals are not a count of every CMDB VM. A host belonging to multiple inventories counts once per inventory. Top issues count affected targets per issue and may overlap. The table also shows address presence, recorded governance readiness/unknown counts, and the last inventory refresh time.

Use inventory detail to investigate, refresh source data and reevaluate governance when needed, then prepare execution through the normal automation workflow. Execution still performs its authoritative GATE checks. Reports do not change governance, GATE, credentials, CMDB data, provider data, or automation state.

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

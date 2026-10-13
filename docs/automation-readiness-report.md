# Automation Readiness Report

Open **Reports** to find Automation Readiness below Governance Readiness. Inventory names and **View inventory** open the existing inventory detail page. Refresh report rereads stored data; it does not sync inventories or execute automation.

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

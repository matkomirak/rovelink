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
| Automation readiness / GATE | Readiness is an evaluation result; configured execution-time GATE checks remain authoritative. Creating inventory or completing onboarding does not authorize automation. |

The normal path is **CMDB/reference → provider/runtime → drift → governance →
automation preparation**. Dashboard Getting started links to each step and only
reads progress. Its milestones are not freshness or security guarantees. An empty
reference cache can be a successful demo import; it remains Ready in the stepper.

Use [the NetBox customer model](netbox-customer-model.md): one NetBox Tenant
per customer, imported as a CustomerScope. Rovelink organizations and Azure
identity tenants are separate concepts. Provider hints never replace CMDB truth.
Refresh imports reference VMs and assignments but does not evaluate Governance.
Run governance explicitly to replace historical findings. Drift is analysis-only.

CustomerScope policies and inventory enforcement settings determine the effects
of findings. A visibility-only policy reports issues without itself affecting
readiness; separate required-data rules can still affect the governance result.
See [demo scenarios](demo-scenarios.md) for the empty-source walkthrough and
limitations. Explicit CMDB write pipelines or demo scripts are separate,
user-initiated operations, never a side effect of discovery or drift.

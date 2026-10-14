# Website copy for the public alpha

Prepared for the local static landing page in `website/`. Nothing is deployed by
this document or by the repositioning change.

## Primary positioning

**Know what's ready to automate. Before you automate.**

Supporting line: **Turn infrastructure inventory into actionable readiness
decisions.**

Rovelink helps growing MSPs and infrastructure teams connect CMDB reference data
with infrastructure providers, find missing ownership and incomplete VM
information, evaluate governance policies, and understand what needs attention
before automation runs.

Product philosophy: **Govern first. Automate second.**

## Audience and value

- Growing MSPs managing multiple customers and infrastructure sources.
- Infrastructure and DevOps teams adopting NetBox-driven automation.
- Teams that need governance readiness, actionable findings, customer-aware
  visibility, drift analysis, and conservative pre-flight decisions.

## First-value workflow

1. Connect NetBox and a supported provider.
2. Evaluate ownership, required information, and relevance with a blueprint.
3. Review readiness reports and findings.
4. Correct information in its source system, then refresh and evaluate again.
5. Use current evidence to guide controlled automation workflows.

Discovery and drift are analysis-only. They do not automatically repair NetBox or
provider state.

## Current alpha capabilities

NetBox VM reference browsing; versioned blueprints and governance evaluations;
Governance and Automation Readiness reports; manual VM drift comparisons;
offline Proxmox/Azure/generic demos; early read-only normalized Azure and Proxmox
discovery; public HTTPS Git projects and opt-in local Ansible/SSH execution.
The isolated demo runner is disabled; the walkthrough executes no playbooks.

## Intentionally conservative

Governance Ready is not Execution Allowed. Reports do not verify current GATE
authorization, connection users or credentials, so unproven targets stay Unknown
and Automation Readiness stays at Ready = 0. Drift is analysis only. Provider hints
never replace CMDB customer assignments. Caches/results require explicit refreshes
and reruns; integrations are not production-certified.

The action-specific pre-flight API can return `allow` only for a narrowly verified
local Linux/SSH path under explicit policy. It can also return `block` or `unknown`.
It does not launch jobs or persist approval snapshots.

## Integration status

- **Available:** NetBox reference integration; built-in Ansible for limited,
  controlled use; public HTTPS Git and SSH foundation.
- **Experimental / alpha:** normalized read-only Azure and Proxmox provider visibility.
- **Planned:** target-bound AWX/RHAAP adapters, normalized VMware visibility,
  i-doit, ServiceNow, AWS, GCP, and broader adapters.

## Calls to action

- **Try the local demo** → [demo quickstart](demo-quickstart.md).
- **View GitHub repository** → [Rovelink on GitHub](https://github.com/matkomirak/rovelink).
  Enable this public CTA only after the maintainer changes visibility and tests access.
- **Watch the two-minute demo** → embedded on the landing page from the reviewed,
  captioned public-alpha export in `website/assets`.

## Public alpha announcement

**Rovelink v0.1.1-alpha is public.**

Govern first. Automate second.

It connects CMDB reference data, provider runtime state, governance evaluation,
drift analysis, and conservative automation readiness into one local demo.

This is an early public alpha, not production-ready yet, but the core product
story is now demoable.

## Footer disclaimer

Rovelink is a public-alpha candidate for local evaluation with synthetic data.
It is not production-ready and comes without warranty. Do not expose demo stacks
or use their configuration for production. Review the MIT license and security policy.

## Decision layer and execution boundary

Rovelink is the governance-first pre-flight decision layer for infrastructure
automation. Built-in Ansible is intended for local demos, short tests, migrations,
and lightweight controlled environments. It remains available, but is not the
recommended enterprise-scale execution architecture. The enterprise direction is
controlled external AWX/RHAAP/webhook adapters with decision snapshots, scoped
credentials and durable workers. A legacy MVP-level AWX connector exists, but it
is not the target-bound enterprise adapter described by that roadmap.

Checks apply to routed workflows. Direct SSH, provider-console, Terraform and
manual administrative access can bypass an application-layer gate. See the
[enforcement boundary](enforcement-boundary.md) for IAM/PAM, network controls and audited break-glass
requirements. Reports and pre-flight evidence do not grant execution permission.

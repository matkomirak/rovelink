# Website copy for the public alpha

Prepared copy only; nothing is deployed, published or made public by this task.

## Hero

**Govern first. Automate second.**

Rovelink helps infrastructure teams and MSPs compare CMDB reference data with
provider runtime state, evaluate governance readiness, and prepare automation
with explicit inventory eligibility and execution-time GATE checks.

## Why Rovelink

- Understand reference quality before preparing infrastructure automation.
- Model customers through NetBox Tenant → Rovelink CustomerScope.
- Compare documented VMs with observed runtime inventory and inspect drift.
- See Ready, Needs attention and Unknown without treating them as execution permission.
- Try the workflow locally with fake providers and no cloud credentials.

## How it works

1. Connect NetBox and refresh cached reference VMs/customer assignments.
2. Discover provider runtime inventory separately; customer hints stay non-authoritative.
3. Evaluate an active blueprint and inspect governance findings.
4. Compare reference/runtime state and review readiness dashboards.
5. Prepare automation through inventories, templates and credentials; a specific
   execution still requires GATE checks and trusted playbooks.

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

## Calls to action

- **Try the local demo** → [demo quickstart](demo-quickstart.md).
- **View GitHub repository** → [Rovelink on GitHub](https://github.com/matkomirak/rovelink).
  Enable this public CTA only after the maintainer changes visibility and tests access.
- **Watch the two-minute demo** → recording/link pending. Use
  [the prepared script](demo-video-script.md); do not publish a broken video button.

## Footer disclaimer

Rovelink is a public-alpha candidate for local evaluation with synthetic data.
It is not production-ready and comes without warranty. Do not expose demo stacks
or use their configuration for production. Review the MIT license and security policy.

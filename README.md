# Rovelink

**Govern first. Automate second.**

Rovelink is a governance-first pre-flight decision layer for infrastructure automation.
It helps infrastructure teams and MSPs connect documented CMDB reference state with
observed provider runtime state, evaluate reference quality, and prepare automation with explicit
inventory eligibility and execution-time GATE checks.

## Public alpha

The current v0.1.x alpha is for isolated local evaluation and synthetic demos.
**It is not production-ready and has no warranty.** APIs and schemas may change.
Do not expose the local Compose stacks publicly or connect the demo to production.
The existing release tag is `v0.1.0-alpha`; package metadata is not the release label.

## Why it exists

A successful job does not prove the rest of an estate is safe to automate. Missing
customer assignments, ownership, addresses, approval, and stale reference data
need to be visible before execution. Rovelink asks: what do we know about these
targets, what needs attention, and which signals are still unknown?

## Core concepts

| Concept | Meaning |
| --- | --- |
| Reference state | Documented NetBox/CMDB data cached in Rovelink. |
| Runtime state | Provider-observed infrastructure, or deterministic offline demo inventory. |
| CustomerScope | Rovelink's normalized customer boundary, derived from NetBox Tenant for the recommended MSP model. |
| Governance Ready | A recorded reference object meets the blueprint's readiness rules; this does not authorize execution. |
| Automation Eligible | Known inventory/readiness signals support preparing a target; unknown signals still need review. |
| Execution Allowed | The final GATE decision for a specific automation action/run. |
| Drift | Differences between cached reference and runtime state; analysis only. |

For MSPs, use **one NetBox Tenant per customer** and assign VMs directly to it.
Rovelink imports Tenant → CustomerScope → customer assignment. Rovelink organizations
are application security boundaries; Azure tenants are identity boundaries.
Provider tags and customer hints are non-authoritative.
See [Concepts](docs/concepts.md) and [NetBox customer modeling](docs/netbox-customer-model.md).

## Try the self-contained demo

Prerequisites: Git, Node.js 20.19+ with npm, and Docker Desktop/Linux containers
(or Docker Engine with Compose). From the repository root in PowerShell:

```powershell
npm.cmd run demo:setup
docker compose --env-file .env.demo -f docker-compose.demo.yml config --quiet
docker compose --env-file .env.demo -f docker-compose.demo.yml up -d --build
docker compose --env-file .env.demo -f docker-compose.demo.yml exec -e ROVELINK_DEMO_DATA=true app npm run db:seed:demo-providers
```

Use `npm` on Linux/macOS. Wait for healthy services; initial NetBox migrations,
image downloads, and builds can take several minutes.

| Browser | URL | Login | Private password location |
| --- | --- | --- | --- |
| Rovelink | http://localhost:5100 | `admin` | `.env.demo`: `DEMO_ADMIN_PASSWORD` |
| NetBox | http://localhost:8100 | `demo-admin` | `.env.demo`: `DEMO_NETBOX_ADMIN_PASSWORD` |

`demo:setup` generates local-only secrets and preserves an existing `.env.demo`.
Never commit or share that file. From the Rovelink container, connect NetBox at
**`http://netbox:8080`**, without `/api`. Create a local NetBox API token manually
and paste only its raw value; omit `Bearer`/`Token` prefixes.

The walkthrough starts with **empty NetBox reference inventory** and three fake
providers: 4 Proxmox VMs, 14 Azure objects (including 4 VMs), and 4 generic VMs.
Sync their cached inventory in the UI. Empty reference state produces intentional
`unmatched_provider` drift. An optional, explicit demo-only Proxmox import then
adds selected reference VMs so you can demonstrate customer assignment,
governance findings, and manual changes. No real provider credentials are needed.

Follow the [demo quickstart](docs/demo-quickstart.md) for the complete flow and
[demo scenarios](docs/demo-scenarios.md) for expected results and limitations.
The isolated demo disables the local automation runner; the walkthrough executes
no playbooks or remediation. Use separate browser profiles when running normal
and demo apps together: cookies belong to hostnames, not ports.

## Demo video and screenshots

A [two-minute script and shot list](docs/demo-video-script.md) is ready for recording.
The video is not recorded or published yet; add its link only after review for
secrets and fictional identifiers. Record the real UI, including Unknown readiness.

## Current capabilities

- Cached NetBox VM reference browsing, CustomerScopes and customer assignments.
- Versioned governance blueprints, explicit evaluations, findings and run inspection.
- Governance and conservative Automation Readiness dashboards.
- Cached normalized provider discovery: fake/demo; early Azure VMs/NICs/VNets/subnets/public IPs; early Proxmox VM-only inventory.
- Manual VM drift comparison and item inspection, including unmatched/ambiguous results.
- Automation inventories, templates, public HTTPS Git projects, encrypted SSH credentials, and local Ansible execution when explicitly enabled outside the isolated demo.
- HttpOnly cookie authentication and organization-scoped application data.

Sidebar: **Navigation** → Dashboard; **Reports** → Governance Readiness and
Automation Readiness; **Drift** → Drift Reports; **Inputs** → Providers, CMDBs,
Sync Flows; **Governance** → Blueprints and Evaluation Runs; **Automation** →
Inventories, Templates, Credentials, Projects, Automation Runs;
**System** → Notifications and Settings.

`/reports` retains both dashboards; `/reports/governance` and
`/reports/automation` open each individually. Drift stays at `/reports/drift`.

## Current limitations

- Governance and reports read stored/cached data. Refresh sources and rerun evaluations/comparisons after changes.
- Automation Readiness does not verify current GATE authorization, connection users, or credentials. **Ready = 0 is intentional**; insufficient execution evidence is Unknown, not permission to execute.
- Linked inventory counts exclude source VMs blocked during inventory sync. Targets can occur in more than one inventory/blueprint group.
- Provider hints and drift never grant execution authority. Governance blocking recommendations affect execution only through configured inventory governance enforcement and existing GATE checks.
- Discovery, governance evaluation, reference refresh, reports, and drift do not write back. Legacy explicit CMDB pipelines and opt-in demo scripts do contain CMDB writes; confine them to disposable systems.
- CMDB refresh upserts VMs but does not purge upstream deletions. Current refresh replaces obsolete customer assignments for each refreshed VM; historical scopes and separate seeded fixtures can still overlap summaries.
- Drift matching is heuristic; VM names alone are not strong identity. Missing reference fields can be skipped; NetBox cached power state and reference IPv6 comparison are limited.
- i-doit is outside the supported pilot. VMware/AWS/GCP normalized live sync, AWX/AAP execution, private/SSH Git repositories, embedded Git credentials, and SSH-key passphrases are outside this MVP.
- Azure/Proxmox integrations are early implementations, not production-certified integrations. The demo proves offline fixtures, not live cloud coverage.

## Architecture and development

React/Vite frontend → Express TypeScript API → Drizzle/Postgres storage.
Integrations populate separate reference and runtime caches; blueprints evaluate
reference objects. Configured GATE checks remain authoritative for execution.
CustomerScope defaults to visibility-only; blueprint policy and required-data
rules determine scoring/readiness effects.

For the normal development app (port 5000), optional host NetBox (port 8000),
Git projects, and runner setup, see [Local Development](LOCAL-DEVELOPMENT.md)
and [Local NetBox](LOCAL-NETBOX.md). Host NetBox from Docker uses
`http://host.docker.internal:8000`; the isolated demo uses `http://netbox:8080`.

```powershell
npm.cmd ci
npm.cmd run check
npm.cmd test
npm.cmd run build
npm.cmd audit --omit=dev
```

The default tests do not replace fresh-demo/browser verification. The existing
PostCSS build warning is non-fatal. The public-alpha checks and evidence are in
[the launch checklist](docs/public-alpha-checklist.md).

## Next directions

The roadmap centers on the decision engine and conservative Pre-flight GATE API,
execution decision snapshots, controlled AWX/RHAAP adapters, drift/readiness
evidence, command hardening, runtime ingestion validation, durable workers,
Vault/credential integration and approval workflows. Enterprise adapters and
durable snapshots/workers remain planned; broader provider coverage follows
validated evidence and access controls. These are directions, not delivery promises.

## Documentation

- [Demo quickstart](docs/demo-quickstart.md) and [demo scenarios](docs/demo-scenarios.md)
- [Concepts](docs/concepts.md) and [NetBox customer model](docs/netbox-customer-model.md)
- [Automation Readiness Report](docs/automation-readiness-report.md)
- [Local Development](LOCAL-DEVELOPMENT.md) and [Governance MVP](GOVERNANCE-MVP.md)
- [Demo video script](docs/demo-video-script.md) and [website copy](docs/website-copy.md)
- [Public-alpha checklist](docs/public-alpha-checklist.md)

## Security and contributing
- [Enforcement boundary](docs/enforcement-boundary.md) and [Pre-flight GATE API](docs/gate-decision-api.md)
- [Decision snapshots](docs/execution-decision-snapshots.md) and [worker/queue plan](docs/worker-queue-architecture.md)
- [Command hardening](docs/command-execution-hardening.md) and [ingestion validation](docs/ingestion-validation.md)

Use dedicated test credentials and trusted playbooks. Supported credential paths
encrypt secrets at rest with AES-256-GCM; that does not replace access controls
or an independent security review. Never commit `.env`, credentials, private keys,
`.local/`, runtime data, databases, logs, or unredacted screenshots.

Follow [SECURITY.md](SECURITY.md) for private reporting. Maintainers must establish
a private reporting channel as part of the manual visibility transition and
verify GitHub private vulnerability reporting before announcing the alpha.
Do not post sensitive vulnerability details publicly. See [CONTRIBUTING.md](CONTRIBUTING.md)
and [AGENTS.md](AGENTS.md); preserve cookie authentication, org isolation and GATE.

## License

[MIT](LICENSE), without warranty. Third-party dependencies retain their own licenses.

## Decision layer and execution boundary

Rovelink is the governance-first pre-flight decision layer for infrastructure
automation. Built-in Ansible is intended for local demos, short tests, migrations,
and lightweight controlled environments. It remains available, but is not the
recommended enterprise-scale execution architecture. The enterprise direction is
controlled external AWX/RHAAP/webhook adapters with decision snapshots, scoped
credentials and durable workers; the existing AWX connector is MVP-level.

Checks apply to routed workflows. Direct SSH, provider-console, Terraform and
manual administrative access can bypass an application-layer gate. See the
[enforcement boundary](docs/enforcement-boundary.md) for IAM/PAM, network controls and audited break-glass
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
[complete GATE contract](docs/gate-decision-api.md) for configuration, reason codes, supported
prerequisites and remaining TOCTOU risks. AWX/RHAAP integration and durable workers
remain roadmap work.

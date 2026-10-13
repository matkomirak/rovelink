# Local Development

For the public-alpha walkthrough, use the self-contained [demo quickstart](docs/demo-quickstart.md).
This page also describes development workflows that can execute playbooks or write
to disposable NetBox. Governance Ready is a blueprint evaluation result;
Automation Eligible is an inventory signal; Execution Allowed is a specific run's
GATE decision. See [Concepts](docs/concepts.md). Provider hints never replace
CustomerScope assignments derived from NetBox Tenant.

For a focused first-run story, follow the [alpha demo quickstart](docs/demo-quickstart.md)
and [smoke checklist](docs/smoke-test.md). This page retains the detailed workflows.

This workflow starts Rovelink, optional local NetBox, demo VM data, public HTTPS
Git project sync, and local Ansible execution for both localhost playbooks and
reachable remote Linux SSH targets.

## Start Rovelink

```powershell
docker compose up -d --build
```

The app port binds to host loopback only. Rovelink is available at:

```text
http://localhost:5000
```

Default local login values come from `docker-compose.yml`:

```text
username: admin
password: changeme
```

Docker Compose also sets:

```text
ROVELINK_LOCAL_DEV=true
ROVELINK_GIT_ALLOWED_HOSTS=github.com
ROVELINK_LOCAL_RUNNER_ENABLED=true
```

That marker is what allows the intentionally weak `changeme` password for local
first-run development. Do not use `ROVELINK_LOCAL_DEV=true` in production.
`ROVELINK_GIT_ALLOWED_HOSTS` controls where server-side Git sync may connect,
and production must set a non-empty allowlist. Local Ansible execution is also
guarded by `ROVELINK_LOCAL_RUNNER_ENABLED`; keep it disabled in production
unless the app host is intentionally allowed to run `ansible-playbook`.

Bootstrap seeding is idempotent. If the admin user already exists, the seed step
does not reset or overwrite the existing password.

Docker Compose stores synced Git project checkouts in a named volume mounted at:

```text
/data/git-projects
```

The app uses this path through:

```text
ROVELINK_PROJECTS_ROOT=/data/git-projects
```

This keeps synced project checkouts available after app container rebuilds.

## Start NetBox

Create a local env file if needed:

```powershell
Copy-Item .env.netbox.example .env.netbox
```

Edit `.env.netbox` and set local-only values for passwords, token, secret key,
and API token pepper. Then start NetBox:

```powershell
docker compose -p rovelink-netbox --env-file .env.netbox -f docker-compose.netbox.yml up -d
```

NetBox is available at:

```text
http://localhost:8000
```

## Seed Demo VMs

After NetBox is running and `.env.netbox` has `NETBOX_URL` and `NETBOX_TOKEN`,
run:

```powershell
npm.cmd run netbox:seed:demo
```

The seed script is optional and never runs automatically.

## Seed CustomerScope Demo Data

The CustomerScope demo seed creates a local MSP pilot dataset for the CMDB
Customer Scopes table, VM customer assignment sheet, and governance reporting
columns. It is intended for local development, smoke validation, and screenshots.

Start Rovelink and verify the app and database containers are healthy:

```powershell
docker compose up -d --build
docker compose ps
```

After Rovelink has cached VM data for the local NetBox CMDB, run the opt-in demo
seed:

```powershell
npx --no-install cross-env ROVELINK_DEMO_DATA=true node --env-file=.env --import=tsx server/scripts/seed-customer-scope-demo.ts
```

When running inside Docker, use the container command:

```powershell
docker compose exec -e ROVELINK_DEMO_DATA=true app npm run db:seed:demo-customer-scopes
```

To target a specific local CMDB source, set:

```powershell
$env:ROVELINK_DEMO_CMDB_ID="<cmdb-id>"
```

To target a specific local organization, set:

```powershell
$env:ROVELINK_DEMO_ORG_ID="<org-id>"
```

The script is demo-only, opt-in, and idempotent. It uses local cached
`netbox_vms.id` values for assignments and does not write to NetBox, credentials,
tokens, or CMDB configuration. Local databases may retain extra demo blueprint
versions or seeded CustomerScope records after smoke tests.

Open the printed CMDB URL, or navigate from the app:

```text
http://localhost:5000
```

Then open `CMDBs`, select the local NetBox CMDB, and check the `Customer Scopes`
card. It should show populated governance summary columns for objects, evaluation
coverage, average score, readiness, block recommendations, top finding, and last
evaluated time.

### CustomerScope Demo Scenarios

All customer names in this seed, including ACME GmbH, are fictional placeholders,
not real customer records. The seed creates or updates these local demo scenarios:

- `ACME GmbH`, with an evaluated ready VM and good score.
- `Customer B`, with an evaluated not-ready VM and a governance finding.
- `Customer C`, with an evaluated VM that has a `block_automation`
  recommendation.
- `Customer D`, with assigned VM data but no demo evaluation, so the UI can show
  `Not evaluated`.
- An explicit Unassigned pseudo-scope assignment.

`ACME GmbH` represents a healthy customer: the VM is evaluated, has a high
governance score, and is Governance Ready in the stored evaluation. This is not Execution Allowed.

`Customer B` represents a customer with a governance issue: the VM is evaluated
but not Governance Ready.

`Customer C` represents a policy escalation: the evaluation recommends
`block_automation`. Actual blocking still depends on Automation Inventory
governance enforcement settings.

`Customer D` represents assigned inventory without an evaluation yet. The
Customer Scopes table should show `Not evaluated`.

`Unassigned` represents objects with no CustomerScope assignment. This should be
shown as a warning or attention state and must not be treated as internal.

### CustomerScope Screenshot Checklist

Capture screenshots manually after the demo seed if you need MSP pilot material:

- Governance Blueprint detail page showing the `CustomerScope Policy` card.
- CustomerScope policy edit dialog.
- Versions table showing an inactive policy version.
- CMDB detail page showing the Customer Scopes card with populated governance
  columns.
- Unassigned row warning or attention state.
- VM detail sheet showing the Customer Assignment section.
- Governance evaluation findings showing a CustomerScope finding.
- Automation Inventory governance controls showing observe, warn, and enforce
  modes.

The repository does not currently keep generated screenshot assets. Prefer this
checklist over committing binary screenshots.

### MSP Pilot Demo Script

Use this short flow for a CustomerScope MSP pilot walkthrough:

1. Show NetBox/CMDB cached VMs in the CMDB object browser.
2. Show CustomerScopes discovered or seeded for the selected CMDB.
3. Show customer-level governance summary columns in the Customer Scopes card.
4. Open a VM detail sheet and show the Customer Assignment section.
5. Open the Governance Blueprint detail page and show the CustomerScope Policy.
6. Explain policy modes:
   - `visibility_only`: reports CustomerScope issues only.
   - `score_only`: may affect governance/data-management score.
   - `readiness`: may mark an object not Governance Ready.
   - `enforce`: recommends `block_automation`.
7. Show evaluation findings and automation readiness.
8. Explain the enforcement distinction:
   - Blueprint `enforce` recommends blocking.
   - Automation Inventory `enforce` decides whether automation actually blocks.
9. Show cached Azure/Proxmox inventory or Drift Reports if prepared. Drift
   compares reference and runtime VMs for analysis only; it does not update
   CMDBs, providers, Governance readiness, or Automation GATE decisions.

### Provider Infrastructure Inventory Sync

The fake/demo, Azure, and Proxmox providers can populate Rovelink's normalized
infrastructure inventory tables without contacting NetBox or changing CMDB
data. This is an opt-in, read-only validation path for the provider inventory
model.

After creating a fake, Azure, or Proxmox provider account, run:

```bash
curl -X POST http://localhost:5000/api/providers/<provider-id>/inventory/sync \
  -H "Cookie: auth_token=<your-login-cookie>"
```

The sync writes observed provider runtime objects into `infrastructure_objects`.
For Azure, the sync calls the read-only discovery APIs and caches normalized
VM, network interface, VNet, subnet, and public IP objects. It does not write to
Azure and does not write to NetBox.

For Proxmox, the current normalized sync is VM-only. It calls the read-only VM
listing path and caches normalized VM objects. It does not write to Proxmox and
does not write to NetBox.

The sync may also write provider CustomerScope candidates into
`provider_customer_scope_candidates` when fake tags, labels, or naming hints
contain customer-like values, or when Azure tags/resource groups/subscriptions
look customer-like, or when Proxmox tags, pools, notes, or VM names look
customer-like. These candidates are hints only: they do not create
CustomerScopes, do not create authoritative assignments, do not write to NetBox,
and do not affect Governance or Automation GATE behavior.

### MSP Pilot Roadmap

Current MSP pilot scope:

- NetBox as the reference CMDB and governance source.
- CustomerScope as the customer/environment boundary.
- Azure read-only normalized inventory sync.
- Proxmox read-only VM-only normalized inventory sync.
- Manual provider-vs-CMDB VM drift reporting.

Deferred:

- i-doit integration. Useful API access requires licensed/paid access, so i-doit
  is not suitable for the open MSP pilot.

Future work:

- Richer provider discovery and relationship coverage.
- Broader reference object types and drift comparisons.
- Customer-level dashboard and reporting detail pages.

## Configure Rovelink CMDB

When Rovelink runs in Docker, configure the NetBox CMDB URL as:

```text
http://host.docker.internal:8000
```

Use a base URL such as `https://netbox.example.com`, without `/api` at the end.
If Rovelink runs in Docker and NetBox runs on the host at `http://localhost:8000`,
set the CMDB connection URL to `http://host.docker.internal:8000`.
Inside the Rovelink container, `localhost` points to that container, not the host.
Your browser and seed scripts running directly on the host can still use
`http://localhost:8000`.

Enter the raw NetBox API token only, for example `nbt_xxx` (a placeholder).
Do not paste a `Bearer` or `Token` prefix into the token field.

## Test Governance MVP

See [Governance MVP](GOVERNANCE-MVP.md) for the manual local checklist covering cached NetBox VM import, Governance Blueprints, evaluation runs, findings, readiness, Automation GATE context, and optional inventory-level enforcement.

## Sync A Public Git Project

In Rovelink, create or update a Project with a public HTTPS Git URL. For example:

```text
https://github.com/ansible/ansible-examples.git
```

Then click `Sync`. The checkout path should be under:

```text
/data/git-projects/<org-id>/<project-id>/repo
```

Private Git URLs, SSH Git URLs, Git tokens, and embedded URL credentials are
intentionally not supported in the current MVP. Git hosts must be listed in
`ROVELINK_GIT_ALLOWED_HOSTS`, and localhost/private/link-local addresses are
rejected.

## Run Ansible Playbooks

Create a Job Template that uses:

```text
runnerMode: local
playbook: path/to/localhost-playbook.yml
```

For localhost-only playbooks, the playbook can target:

```text
localhost
127.0.0.1
::1
```

These playbooks do not require SSH credentials. Rovelink uses a generated local
inventory with `ansible_connection: local`.

For remote SSH playbooks:

- Create an `ssh_key` credential in Rovelink with a username and private key.
- SSH key passphrases are not supported yet.
- Targets must be reachable from the app container.
- Inventory must still pass the automation GATE; blocked hosts are excluded.
- `strictHostKeyChecking` controls whether Ansible disables host key checking.

Rovelink computes and stores the gate snapshot before execution for both
localhost and remote SSH runs. The local runner must be intentionally enabled;
Docker Compose does this for local development with
`ROVELINK_LOCAL_RUNNER_ENABLED=true`. Local runner execution is bounded by:

```text
ROVELINK_LOCAL_RUNNER_TIMEOUT_MS=600000
ROVELINK_LOCAL_RUNNER_MAX_OUTPUT_BYTES=1048576
```

## Stop Commands

Stop Rovelink:

```powershell
docker compose down
```

Stop NetBox:

```powershell
docker compose -p rovelink-netbox --env-file .env.netbox -f docker-compose.netbox.yml down
```

## Fake Azure runtime inventory demo

Under **Providers**, add a **Fake** provider named **Demo Azure** and select
**Azure demo inventory (4 VMs + networks)**. Save it, open its inventory page,
and use **Sync Cached Inventory**. The API equivalent is a fake provider with config
`{"variant":"azure","scenario":"azure"}` and
`POST /api/providers/<provider-id>/inventory/sync` using your login cookie.

This fixed scenario generates four VMs (`acme-web-01`, `acme-db-01`,
`contoso-app-01`, `orphan-runtime-01`), four NICs, two VNets, three subnets,
and one public IP from the documentation range (`192.0.2.10`). ARM-like IDs
use placeholder subscriptions ending in `0001` and `0002`. ACME and Contoso
are fictional demo customers. Seed and VM count do not change this scenario.
Objects retain provider type `fake` and metadata `demoProfile: azure`.

No Azure credentials or live API calls are needed. Sync only stores observed
runtime inventory and provider customer candidate hints in Rovelink. It does
not write to NetBox or providers, create CustomerScopes or assignments, or
change Governance readiness or Automation GATE. Existing fake variants stay unchanged.

Use this provider as runtime inventory in **Drift Reports**. Match results
depend on your existing NetBox reference: no reference data is created. If
reference VMs have the same names/IPs, they can match; `orphan-runtime-01` is
intended to be unmatched, and the stopped `acme-db-01` can demonstrate status
drift against an active reference. Without matching reference VMs, all four
will appear only in provider inventory. Relationships remain empty; NIC links
are recorded in metadata through the existing Azure normalizer.

## Demo scenarios

The recommended first public demo is the self-contained empty-NetBox stack.
It needs no real Azure/Proxmox credentials. With provider runtime VMs and zero
NetBox reference VMs, expect `unmatched_provider` drift: missing CMDB
documentation is the intended result.

See [Demo scenarios](docs/demo-scenarios.md) for commands, private demo credentials, manual
NetBox token creation, the three-provider walkthrough, expected results, and
troubleshooting. It also covers existing host NetBox through
`host.docker.internal` and optional real-provider exploration.

## Recommended NetBox modeling for MSPs

Use **one NetBox Tenant per customer**, and assign customer objects to that
Tenant. Rovelink imports each VM's NetBox Tenant as a **CustomerScope** and
resolves its customer assignment. Provider hints are non-authoritative and
cannot replace CMDB customer modeling. A Rovelink organization or Azure tenant
is not the same thing as a customer.

See [Recommended NetBox customer model](docs/netbox-customer-model.md) for the terminology table,
ACME GmbH example, object-type support, and refresh/evaluation workflow.

For the explicit offline Proxmox-to-NetBox reference follow-up, see [Customer-style demo](docs/demo-scenarios.md#customer-style-follow-up-demo-explicit-proxmox-reference-import). This is an opt-in demo write, never automatic provider sync.

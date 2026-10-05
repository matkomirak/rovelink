# Local Development

This workflow starts Rovelink, optional local NetBox, demo VM data, public HTTPS
Git project sync, and local Ansible execution for both localhost playbooks and
reachable remote Linux SSH targets.

## Start Rovelink

```powershell
docker compose up -d --build
```

Rovelink is available at:

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
$env:ROVELINK_DEMO_DATA="true"
npm.cmd run db:seed:demo-customer-scopes
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

The seed creates or updates these local demo scenarios:

- `ACME GmbH`, with an evaluated ready VM and good score.
- `Customer B`, with an evaluated not-ready VM and a governance finding.
- `Customer C`, with an evaluated VM that has a `block_automation`
  recommendation.
- `Customer D`, with assigned VM data but no demo evaluation, so the UI can show
  `Not evaluated`.
- An explicit Unassigned pseudo-scope assignment.

`ACME GmbH` represents a healthy customer: the VM is evaluated, has a high
governance score, and is automation ready.

`Customer B` represents a customer with a governance issue: the VM is evaluated
but not automation ready.

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
   - `readiness`: may mark an object not automation ready.
   - `enforce`: recommends `block_automation`.
7. Show evaluation findings and automation readiness.
8. Explain the enforcement distinction:
   - Blueprint `enforce` recommends blocking.
   - Automation Inventory `enforce` decides whether automation actually blocks.
9. Explain the next roadmap: Azure provider, Proxmox provider, and
   provider-vs-CMDB governance comparison.

### Provider Infrastructure Inventory Sync

The fake/demo provider and Azure provider can populate Rovelink's normalized
infrastructure inventory tables without contacting NetBox or changing CMDB
data. This is an opt-in, read-only validation path for the provider inventory
model.

After creating a fake or Azure provider account, run:

```bash
curl -X POST http://localhost:5000/api/providers/<provider-id>/inventory/sync \
  -H "Cookie: auth_token=<your-login-cookie>"
```

The sync writes observed provider runtime objects into `infrastructure_objects`.
For Azure, the sync calls the read-only discovery APIs and caches normalized
VM, network interface, VNet, subnet, and public IP objects. It does not write to
Azure and does not write to NetBox.

The sync may also write provider CustomerScope candidates into
`provider_customer_scope_candidates` when fake tags, labels, or naming hints
contain customer-like values, or when Azure tags/resource groups/subscriptions
look customer-like. These candidates are hints only: they do not create
CustomerScopes, do not create authoritative assignments, do not write to NetBox,
and do not affect Governance or Automation GATE behavior.

### MSP Pilot Roadmap

Current MSP pilot scope:

- NetBox as the reference CMDB and governance source.
- CustomerScope as the customer/environment boundary.
- Azure as a planned provider source.
- Proxmox as a planned provider source, initially with fake/demo or read-only
  data.

Deferred:

- i-doit integration. Useful API access requires licensed/paid access, so i-doit
  is not suitable for the open MSP pilot.

Future work:

- Provider inventory abstraction.
- Azure read-only inventory.
- Proxmox read-only or fake-data provider.
- Provider-to-CMDB drift and comparison.
- Customer-level dashboard and reporting detail pages.

## Configure Rovelink CMDB

When Rovelink runs in Docker, configure the NetBox CMDB URL as:

```text
http://host.docker.internal:8000
```

Use the local NetBox API token from `.env.netbox`.

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

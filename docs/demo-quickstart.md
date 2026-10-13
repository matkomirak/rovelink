# Alpha demo quickstart

**Govern first. Automate second.** This is an isolated v0.1.x alpha walkthrough,
not a production deployment. Use synthetic data. Allow several minutes for initial
NetBox migrations/builds, then about 5–10 minutes for the browser flow.

## 1. Start the self-contained stack

Prerequisites: Git, Node.js 20.19+/npm, Docker Desktop with Linux containers
(or Docker Engine/Compose). Run from the repository root:

```powershell
npm.cmd run demo:setup
docker compose --env-file .env.demo -f docker-compose.demo.yml config --quiet
docker compose --env-file .env.demo -f docker-compose.demo.yml up -d --build
docker compose --env-file .env.demo -f docker-compose.demo.yml ps
```

Use `npm` on Linux/macOS. Wait until services are healthy. The compose project
has its own databases, network, Redis/cache and worker; it does not reset normal
app data. Existing demo volumes retain data: a previously used demo is not empty.

| Browser | URL | User | Password in private `.env.demo` |
| --- | --- | --- | --- |
| Rovelink | http://localhost:5100 | `admin` | `DEMO_ADMIN_PASSWORD` |
| NetBox | http://localhost:8100 | `demo-admin` | `DEMO_NETBOX_ADMIN_PASSWORD` |

Generated passwords are local-only. Setup preserves `.env.demo`, prints no
passwords, and does not reset existing users. Keep it private. Use a separate
browser profile/incognito session for normal and demo apps because `auth_token`
cookies are shared by hostname, not port. See [demo scenarios](demo-scenarios.md)
for alternate ports, troubleshooting and fresh-project verification.

## 2. Connect an empty NetBox reference source

1. Log into NetBox as `demo-admin`. Open **Admin > API Tokens** and create a
   token for that local user. A read-only token is sufficient for refresh/drift;
   the optional explicit import below needs a write-enabled local demo token.
2. Copy the raw token privately. If NetBox shows a full `Bearer` value, remove
   the prefix. Never include tokens in screenshots, logs or public reports.
3. In Rovelink, open **CMDBs > Add CMDB**, choose NetBox and name it `Demo NetBox`.
   Base URL: **`http://netbox:8080`**, without `/api`. Paste only the raw token;
   do not prepend `Bearer` or `Token`. Save the account, then test its connection
   from the CMDB list's test button.
4. Open its detail page, click **Refresh**, confirm **Refresh CMDB**, and verify
   zero imported VMs. This reads NetBox into the cached reference state and may
   update CustomerScopes from NetBox Tenant; it executes no automation or writeback.

`localhost:8100` is the browser URL; `netbox:8080` is the service address inside
the demo network. `host.docker.internal` is for a different NetBox on the host,
not this internal connection. A fresh NetBox has zero VMs by design.

## 3. Add offline runtime inventory and compare

```powershell
docker compose --env-file .env.demo -f docker-compose.demo.yml exec -e ROVELINK_DEMO_DATA=true app npm run db:seed:demo-providers
```

Open **Providers**, open each account and click **Sync Cached Inventory**:

| Provider account | Expected cached objects |
| --- | --- |
| Demo Proxmox | 4 VMs |
| Demo Azure | 14 objects: 4 VMs, 4 NICs, 2 VNets, 3 subnets, 1 public IP |
| Demo Generic/Fake | 4 VMs |

All are `fake` providers. There are no live Azure/Proxmox calls or credentials.
Provider customer hints do not create CustomerScopes or authoritative assignments.

Open **Drift > Drift Reports** (`/reports/drift`), select Demo NetBox and a demo
provider, and run a VM comparison. Repeat for each provider. Each has four runtime
VMs and zero reference VMs, so expect four `unmatched_provider` items. The Azure
networks remain visible in runtime inventory but are not VM drift targets.
Open item details and show analysis-only/no writeback/no GATE-impact wording.

## 4. Optional: add selected reference VMs explicitly

This is an opt-in **write to disposable NetBox**, separate from discovery/drift.
Use a write-enabled local demo token on the selected CMDB. List available names:

```powershell
docker compose --env-file .env.demo -f docker-compose.demo.yml exec -e ROVELINK_DEMO_DATA=true app npm run demo:import:proxmox
```

Replace `PASTE_CMDB_ID` with the ID from the CMDB page URL and choose exact names
from the list (for the seeded fixture: `alpha-web-001,gamma-app-002`):

```powershell
docker compose --env-file .env.demo -f docker-compose.demo.yml exec -e ROVELINK_DEMO_DATA=true -e "ROVELINK_DEMO_CMDB_ID=PASTE_CMDB_ID" -e "ROVELINK_DEMO_VM_NAMES=alpha-web-001,gamma-app-002" app npm run demo:import:proxmox
```

The importer permits only the internal `http://netbox:8080` connection and offline
Demo Proxmox data. It creates fictional ACME GmbH, cluster/platform, selected VMs,
interfaces and IPs. Existing named VMs are preserved; partial API failures need
manual inspection before retry. It does not run automatically.

In NetBox, verify the two VMs have **Tenant: ACME GmbH**. In Rovelink, refresh
the CMDB, open a VM's Customer Assignment, and verify **CustomerScope: ACME GmbH**
and **Derived from: NetBox Tenant**. For MSPs use one NetBox Tenant per customer;
see [the customer model](netbox-customer-model.md).

## 5. Evaluate governance and inspect reports

Open **Governance > Blueprints**, create the standard NetBox VM blueprint for
Demo NetBox, open it, and click **Run Evaluation**. Select the source and run.
Successful evaluation closes the dialog and redirects to the new run inspection.
Inspect source, blueprint, object count, findings, and the link back to the blueprint.

Customer assignment should be present. The importer does not approve automation
or supply every required role/owner/provider-state value, so Needs attention is
expected. For a useful mixed report, deliberately enrich **one** VM in disposable
NetBox and leave the other incomplete:

- Assign a VM-capable Role, such as fictional `demo-web`.
- Under **Customization > Custom Fields**, associate these fields with Virtual
  Machine: `automatable` (Boolean), `provider_state` (Text), `technical_owner`
  (Text), and `service_owner` (Text).
- Edit that VM: `automatable=true`, `provider_state=active`, and fictional owners
  `Demo Engineering` / `Demo Service`. Preserve its Tenant, platform and primary IP.

Refresh the CMDB and run evaluation again. Inspect actual findings/scores;
Governance Ready is a blueprint result, not Execution Allowed. Open **Reports >
Governance Readiness** and compare Ready versus Needs attention.

Open **Automation > Inventories** if you want inventory signals:
create a linked NetBox inventory and inspect the recorded eligibility/policy.
That inventory operation is separate from the read-only report. Then open
**Reports > Automation Readiness**. Ready = 0/Unknown is intentional while current
execution GATE authorization, users and credentials are not verified there.
An empty report is valid before creating inventory. Do not execute a playbook to
populate the demo. The isolated stack keeps the local runner disabled.

## 6. Demonstrate a manual change

Remove one VM's NetBox Tenant manually, refresh the CMDB, and reevaluate.
Expect a customer-assignment finding. Restore it and repeat; the finding should
clear. Separately change an existing primary IPv4 value in NetBox, refresh, and
rerun Proxmox drift. Inspect the changed reference/runtime field difference.

Reports are historical until refreshed/rerun. CMDB refresh does not purge upstream
deletions. Missing reference IPs can be skipped by drift; runtime IPv6/reference
power-state limitations mean an initially imported VM may already have drift.
See [demo scenarios](demo-scenarios.md) for the full interpretation.

## Development and launch material

Host-development/normal-stack instructions and the separate CustomerScope fixture
seed are in [Local Development](../LOCAL-DEVELOPMENT.md). Fixture evaluations are
not proof of a live governance run. For recording, use [the two-minute script](demo-video-script.md).
Before publication, complete [the launch checklist](public-alpha-checklist.md).

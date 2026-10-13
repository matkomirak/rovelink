# Rovelink demo scenarios

## Overview

Rovelink is governance-first automation: **govern first, automate second**.
CMDB/NetBox is documented/reference state; providers are observed/runtime state.
Drift compares both. Establish source trust and governance readiness before
attempting automation. Drift itself does not change readiness or authorize GATE.

Start with Scenario 1, the recommended first public demo. It requires no real
Azure/Proxmox credentials. Run commands from the repository root in PowerShell,
with Node.js 20.19+, npm, and Docker Desktop using Linux containers. Install
repository dependencies with `npm.cmd ci` first. Linux/macOS can use `npm`.

## Scenario 1: Self-contained empty-NetBox demo (recommended)

### Purpose

Connect an empty CMDB/reference source, sync fictional provider runtime
inventory, and inspect missing CMDB documentation in Drift Reports. The flow
demonstrates source onboarding, provider inventory sync, and drift reporting
without live provider credentials or inventory writeback.

The optional `docker-compose.demo.yml` includes Rovelink/Postgres,
NetBox/Postgres, Redis/cache components, and a NetBox worker. It has its own
network and volumes. Three fake provider accounts are added by an explicit seed.
The existing normal Compose stacks remain unchanged.

### Start and sign in

```powershell
npm.cmd run demo:setup
docker compose --env-file .env.demo -f docker-compose.demo.yml config --quiet
docker compose --env-file .env.demo -f docker-compose.demo.yml up -d --build
docker compose --env-file .env.demo -f docker-compose.demo.yml ps
```

Wait until services are healthy. Initial NetBox migrations can take several
minutes; image downloads and builds add time.

| Destination | URL | User | Password key in private `.env.demo` |
| --- | --- | --- | --- |
| Rovelink browser | http://localhost:5100 | `admin` | `DEMO_ADMIN_PASSWORD` |
| NetBox browser | http://localhost:8100 | `demo-admin` | `DEMO_NETBOX_ADMIN_PASSWORD` |
| Rovelink container to NetBox | `http://netbox:8080` | API token | Created manually below |

`demo:setup` generates random, local-only credentials in ignored `.env.demo`.
It preserves an existing file and does not print passwords. Read passwords
locally from that file; never commit or publish it, and never use these settings
in production. Override ports through `DEMO_ROVELINK_PORT` and
`DEMO_NETBOX_PORT` if needed.

Cookies are shared by hostname, not port. Normal and demo Rovelink apps both
use `localhost` and the `auth_token` cookie; logging into one can affect the
other. Use separate browser profiles or an incognito session side by side.

### Connect NetBox manually

1. Sign into NetBox as `demo-admin` at `http://localhost:8100`.
2. Open **Admin > API Tokens**, create a token for the local demo user, and
   copy its raw value privately. NetBox may display/copy the full `Bearer`
   authorization value; remove that prefix before pasting into Rovelink.
   Token creation is manual, not scripted.
3. In Rovelink, use **CMDBs > Add CMDB > NetBox**. Enter `http://netbox:8080`
   as the base URL. Do not append `/api`.
4. Enter only the raw token, for example `nbt_xxx` (a placeholder).
   Do not paste `Bearer` or `Token` prefixes. Test the connection and open
   the CMDB object browser: a fresh demo NetBox has zero VMs.

Inside the shared Compose network, `netbox` is the service name. Browser
localhost URLs use mapped ports and are not container connection URLs.
If NetBox does not create its admin, use its interactive command:

```powershell
docker compose --env-file .env.demo -f docker-compose.demo.yml exec netbox /opt/netbox/venv/bin/python /opt/netbox/netbox/manage.py createsuperuser
```

### Seed and sync provider inventory

```powershell
docker compose --env-file .env.demo -f docker-compose.demo.yml exec -e ROVELINK_DEMO_DATA=true app npm run db:seed:demo-providers
```

The seed targets the bootstrap `default` organization. For another existing
organization add `-e ROVELINK_DEMO_ORG_SLUG=<slug>` before `app`. Repeated
seeding adds missing accounts without overwriting settings or clearing other
providers. Open **Providers**, open each demo account, and use
**Sync Cached Inventory**.

| Account | Expected runtime inventory |
| --- | --- |
| Demo Proxmox | 4 VMs with fake node/VMID identities |
| Demo Azure | 14 objects: 4 VMs, 4 NICs, 2 VNets, 3 subnets, 1 public IP |
| Demo Generic/Fake | 4 seeded fake vSphere-style VMs |

All accounts keep kind `fake` and use offline mechanics. Azure uses fake
ARM-like IDs and placeholder subscriptions. Its public IP is the reserved
documentation address `192.0.2.10`. No real tenant/subscription IDs or live
Azure/Proxmox credentials are needed; no live Azure/Proxmox APIs are called.
Provider CustomerScope candidates remain hints, create no CustomerScopes or
customer_scope_object_assignments, and do not establish CMDB authority.

### Run drift and interpret the result

Open **Drift Reports**, select the enabled NetBox CMDB and a synced provider,
and run a VM comparison. Repeat for the other providers.

With zero NetBox reference VMs, expect **4 `unmatched_provider` items per
provider**. This is intentional: runtime VMs exist but their CMDB documentation
is missing. Azure's network objects appear in inventory; only its four VMs
participate in drift.

Fresh NetBox volumes contain the admin and built-in metadata but zero VMs.
No VM seed runs during setup. Existing volumes survive restarts and may contain
objects you added, changing match results. Do not run `netbox:seed:demo` for
this empty-reference scenario.

These inventory sync and drift operations do not write provider data back to
NetBox or providers, change Governance readiness, or affect Automation GATE.
Drift is analysis-only; this walkthrough adds no automation or remediation.
Legacy explicit CMDB write pipelines and optional NetBox VM seeds are separate
features outside this walkthrough.

### Stop and verification status

```powershell
docker compose --env-file .env.demo -f docker-compose.demo.yml down
```

Volumes are preserved. Removing volumes deletes that demo's data.
End-to-end smoke verified on 2026-10-13 against the documented demo flow
following commit `f273e33`: services started; the demo-admin NetBox session and
Rovelink admin login worked; a read-only v2 token was created through the
NetBox UI; the raw token connected Rovelink to `http://netbox:8080`; the CMDB
browser showed zero VMs.

| Runtime provider | Cached objects | VM drift items | Matched | Unmatched provider |
| --- | --- | --- | --- | --- |
| Demo Proxmox | 4 | 4 | 0 | 4 |
| Demo Azure | 14 | 4 | 0 | 4 |
| Demo Generic/Fake | 4 | 4 | 0 | 4 |

All three runs completed. Every item had `unmatched_provider`,
`not_compared`, and warning severity; zero reference matches and zero field
drift were expected. Item details opened for each provider. Analysis-only
copy explicitly excluded CMDB/provider updates, Governance readiness, and
Automation GATE changes; no writeback or remediation actions appeared in
the drift report/detail views.

Read-only database checks confirmed NetBox still had zero VMs and Rovelink
had zero CustomerScopes, assignments, Governance evaluation runs, Automation
GATE decisions, and job runs. Only demo configuration/token state and stored
drift reports were added by this smoke. The test reused the isolated demo
volumes; fresh-volume startup was verified during initial stack implementation.
No token, password, or private report identifier is included in this document.

## Scenario 2: Existing local NetBox

Use this when NetBox already runs separately or holds local reference VMs.
See [Local NetBox](../LOCAL-NETBOX.md) and
[Local Development](../LOCAL-DEVELOPMENT.md).

- NetBox browser example: `http://localhost:8000`.
- Rovelink in Docker reaching host NetBox: `http://host.docker.internal:8000`.
- Rovelink directly on the host: `http://localhost:8000`.
- Normal deployment example: `https://netbox.example.com`.

Do not append `/api`. Enter a raw NetBox token, for example `nbt_xxx`, without
`Bearer` or `Token` prefixes. Inside Docker, localhost means the Rovelink
container, not the Windows host. A valid token cannot fix the wrong address.
Drift depends on actual reference/runtime data: matches, differences, and
unmatched objects are all possible; the empty-reference result is not guaranteed.

## Scenario 3: Real provider exploration (optional/advanced)

Use test/lab accounts and an evaluation organization. A real Azure provider
requires subscription ID, tenant ID, client ID, and client secret. A real
Proxmox provider requires a reachable endpoint and API-token or password
credentials. Enter credentials only in the application's credential fields;
never publish them in documentation or commits.

Use **Sync Cached Inventory** to observe runtime inventory. Azure includes VMs
and network objects; current normalized Proxmox support is VM-only. These
syncs call live APIs but do not write back to Azure, Proxmox, or the CMDB.
Provider inventory remains runtime/observed state and customer hints remain
non-authoritative. Compare it against reference state in Drift Reports;
drift does not change Governance or GATE decisions.

## Troubleshooting

- **CMDB 500 / connection failure:** for host NetBox, use
  `http://host.docker.internal:8000` from Rovelink in Docker; for the
  self-contained stack, use `http://netbox:8080`.
- **Token rejection:** enter the raw token without `Bearer`/`Token` prefixes
  and check NetBox permissions. `nbt_xxx` is a placeholder, not a usable token.
- **Wrong endpoint/HTML response:** remove `/api` from the base URL and confirm
  you are reaching NetBox.
- **Unexpected logout:** use separate browser profiles/incognito to avoid
  shared localhost `auth_token` cookies.
- **NetBox is not empty:** confirm browser port 8100; reused volumes retain
  objects and optional NetBox seeds populate VMs.

For startup problems:

```powershell
docker compose --env-file .env.demo -f docker-compose.demo.yml ps
docker compose --env-file .env.demo -f docker-compose.demo.yml logs app
docker compose --env-file .env.demo -f docker-compose.demo.yml logs netbox
```

Review logs locally and remove secrets/private data before sharing. Resolved
`docker compose config` output contains environment secrets; use `config --quiet`
for safe configuration validation.

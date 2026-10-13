# Alpha Demo Quickstart

**Govern first. Automate second.** Allow 5-10 minutes for the browser walkthrough
after setup, downloads, and builds. Use a disposable database and synthetic data.
Rovelink v0.1.0-alpha is not production-ready.

## 1. Start Locally

Prerequisites: Git, Node.js 20.19+, npm, and a reachable development Postgres
database. Optional local NetBox needs Docker Desktop with Linux containers.
Run commands from the repository root. These examples use PowerShell;
Linux/macOS users use `npm` instead of `npm.cmd` and `cp` instead of `Copy-Item`.

```powershell
npm.cmd ci
Copy-Item .env.example .env
```

Edit the private `.env`: set a working `DATABASE_URL`, `DATABASE_CLIENT=pg`,
separate random `SESSION_SECRET` and `JWT_SECRET`, and an `ENCRYPTION_KEY` of
exactly 64 random hex characters. Set a strong `BOOTSTRAP_ADMIN_PASSWORD`, or
leave it blank for one-time generated credentials. Keep `ROVELINK_DEMO_DATA=false`
until deliberately seeding. Never commit environment files or credentials.

Apply the schema and bootstrap the login, then start the dev server:

```powershell
node --env-file=.env ./node_modules/drizzle-kit/bin.cjs push
node --env-file=.env --import=tsx server/seed.ts
npx --no-install cross-env NODE_ENV=development node --env-file=.env --import=tsx server/index.ts
```

These explicitly load `.env`; the first two run the same operations as `db:push`
and `db:seed`. The current `dev` script uses a Unix environment assignment, so use
the cross-platform launch above on Windows. Review schema-push prompts; use only
a disposable DB. Open [local login](http://localhost:5000/login).
Generated credentials are in the private `bootstrap-credentials.txt`; delete it
after login and change the password. Seeding does not reset an existing user.

### Docker Alternative

Use [Local Development](../LOCAL-DEVELOPMENT.md) for the bundled app/database:

```powershell
docker compose up -d --build
docker compose ps
```

Startup waits for Postgres, pushes the schema, and bootstraps the admin. Configure
private Compose overrides before starting. Do not use a host-only `DATABASE_URL`
from `.env`: omit it to use Compose's internal DB connection. The DB is not
published for host seed commands. Use the container seed command below instead.
The unchanged local-only bootstrap defaults are documented in Local Development;
there is no universal login for an already initialized database.

## 2. Prepare Reference Data

For the full walkthrough, provision a **disposable local NetBox** using
[Local NetBox](../LOCAL-NETBOX.md). Set its private `.env.netbox` values and API
token, then run the existing optional seed from the host:

```powershell
Copy-Item .env.netbox.example .env.netbox
# Edit .env.netbox before starting; do not overwrite an existing private file.
docker compose -p rovelink-netbox --env-file .env.netbox -f docker-compose.netbox.yml up -d
# Wait for NetBox login/API to be available and configure NETBOX_URL/NETBOX_TOKEN.
npm.cmd run netbox:seed:demo
```

This optional command **writes synthetic VMs to NetBox**; never target a real CMDB.
The default example VM names are `demo-vm-001` through `demo-vm-020`.

In Rovelink, select the demo organization and add a NetBox account under **CMDBs**.
Use a base URL such as `https://netbox.example.com`, without `/api` at the end.
If Rovelink runs in Docker and NetBox runs on the host at `http://localhost:8000`,
set the CMDB connection URL to `http://host.docker.internal:8000`.
Inside the Rovelink container, `localhost` points to that container, not the host.
Your browser and seed scripts running directly on the host can still use
`http://localhost:8000`.

Enter the raw NetBox API token only, for example `nbt_xxx` (a placeholder).
Do not paste a `Bearer` or `Token` prefix into the token field.

Verify the connection from Rovelink before proceeding. Do not solve a connection
failure by exposing the demo stack publicly.

Open **Governance > Run Evaluation** to load/materialize the configured CMDB's
NetBox inventory source. Select it and use **Sync/Refresh cached VMs** in the
launcher. Verify a nonzero cached count. This imports reference VMs and tenant
assignments into Rovelink; it does not write back to NetBox. The object browser's
Refresh button reloads its view, not the source cache.

## 3. Seed CustomerScope Scenarios

The seed needs an existing organization, NetBox CMDB account, and linked NetBox
inventory source. It can fill missing local cached VMs, but does not provision
the CMDB connection. Run in another terminal while the app remains running.

For a host app, enable the seed for this process only:

```powershell
npx --no-install cross-env ROVELINK_DEMO_DATA=true node --env-file=.env --import=tsx server/scripts/seed-customer-scope-demo.ts
```

For the bundled Docker database:

```powershell
docker compose exec -e ROVELINK_DEMO_DATA=true app npm run db:seed:demo-customer-scopes
```

These invoke the existing `db:seed:demo-customer-scopes` script. With multiple
orgs/sources, explicitly set `ROVELINK_DEMO_ORG_ID` and `ROVELINK_DEMO_CMDB_ID`
to local IDs from your demo; for Docker, supply each with another `-e` argument.
Without overrides the script uses the default organization and prefers a
local/docker/demo-named NetBox CMDB. Check its printed source before continuing.

Expect four fictional CustomerScopes and five assignment scenarios: healthy,
not ready, block recommendation, explicit unassigned, and not evaluated. Three
sample evaluations are fixtures, **not evidence of a live evaluator run**.
The seed is opt-in/idempotent and writes Rovelink demo DB records, not NetBox.
It creates a draft demo blueprint/version but does not activate it.

## 4. Browser Demo Checklist

1. Log in and open **Dashboard**. Stay in the organization used by the seed.
2. Open **Providers**, create a **Fake (Generator)** account, and open its detail.
   Click **Sync Cached Inventory** in **Inventory Objects**. This is separate
   from live/generated VM preview and legacy CMDB pipeline actions.
3. Inspect cached object type cards, search/filter the objects, and open a detail
   sheet. Local object IDs identify cache rows; provider IDs are display context.
   CustomerScope candidates must say hints, not authoritative assignments.
4. Open the prepared **CMDB**. Inspect cached VMs, Customer Scopes and their
   governance summary columns. Open a VM's Customer Assignment; Unassigned is
   an attention state, not Internal. Check the seeded not-evaluated scenario.
5. Open **Governance** and view sample evaluation findings/readiness. To prove
   live evaluation separately, create the standard source-bound NetBox VM
   blueprint (or explicitly activate a suitable version), then run evaluation
   against cached VMs. New policy versions remain inactive until activated.
   Live results can replace the demo summaries; inspect fixtures first.
6. Open **Drift Reports** at `/reports/drift`. Select the prepared CMDB and fake
   provider, run a VM comparison, and inspect the summary and an item detail:
   confidence, candidate IDs, signals, field differences, and findings.
7. Confirm the page explains **analysis only**: no CMDB/provider writeback,
   no Governance readiness change, and no Automation GATE impact. No remediation
   or auto-fix action should be offered.
8. Open **Automation Inventories**, **Templates**, and **Runs** to show the
   automation foundation. Empty lists are acceptable in a fresh demo. Do not
   execute an unreviewed playbook just to populate a screen.
9. Open the account menu and log out; confirm return to `/login`.

## Expected Results and Limits

- Fake provider objects and hint candidates are visible after cached sync.
- CustomerScopes/assignments and sample governance summaries appear after seed.
- Older unassigned rows may remain beside newer dedicated demo assignments.
  CustomerScope summary rows can overlap; do not sum them as an authoritative
  customer partition. Assignment lifecycle/reporting cleanup is future work.
- A completed drift run and item rows appear. Independently seeded reference
  and fake datasets may be unmatched; matching or a particular drift count is
  not guaranteed. Unmatched/ambiguous results are valid report outcomes.
- Provider inventory is observed runtime state, not CMDB truth. CustomerScope
  is a source-local customer/environment boundary, not the app organization.
- Blueprint enforce recommends blocking; actual blocking depends on Automation
  Inventory governance enforcement. Drift never supplies that authority.

Use fake data for the first run. Azure/Proxmox require sensitive real credentials
and isolated test infrastructure; use them carefully, not for this basic demo.
Proxmox normalized inventory is VM-only. No production-readiness claim is made.

Use the [smoke checklist](smoke-test.md) to record validation. There is no single
end-to-end demo command or automated browser smoke script; account/source setup
and browser checks are manual. Do not publish screenshots with identifiers or
secrets. Existing public-release history concerns remain in the
[sanitization audit](public-sanitization-audit.md).

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

## Self-contained demo with empty NetBox and demo providers

This optional stack includes Rovelink/Postgres, NetBox/Postgres, two Redis
services, and a NetBox worker. NetBox was already available separately in
`docker-compose.netbox.yml`; this stack brings everything onto one private
Compose network. The normal development stacks remain unchanged.

Run from the repository root (Docker Desktop with Linux containers):

```powershell
npm.cmd run demo:setup
docker compose --env-file .env.demo -f docker-compose.demo.yml config --quiet
docker compose --env-file .env.demo -f docker-compose.demo.yml up -d --build
docker compose --env-file .env.demo -f docker-compose.demo.yml ps
```

The setup command generates private, local-only credentials in ignored
`.env.demo`. It never prints them or overwrites an existing file. Keep that
file private and do not use these settings in production. Open it locally to
read `DEMO_ADMIN_PASSWORD` for Rovelink user `admin`, and
`DEMO_NETBOX_ADMIN_PASSWORD` for NetBox user `demo-admin`.

- Rovelink browser: `http://localhost:5100`
- NetBox browser: `http://localhost:8100`
- NetBox URL in Rovelink CMDB settings: `http://netbox:8080` (no `/api` suffix)

Browser cookies are shared by hostname, not port. The normal app and demo app
both run on `localhost` and use the `auth_token` cookie, so logging into one
can affect the other. Use separate browser profiles or an incognito session
when testing them side by side.

Ports are separate from the existing 5000/8000 stacks; override
`DEMO_ROVELINK_PORT` and `DEMO_NETBOX_PORT` in `.env.demo` if needed.
Inside the shared Docker network use the service name `netbox`. The browser
uses the mapped localhost port. If NetBox instead runs on the host, use
`http://host.docker.internal:8000` from Rovelink's container.

Wait for NetBox to become healthy (its first migration can take several minutes).
Log into NetBox, create an API token under **Admin > API Tokens**, and copy the
raw token into **CMDBs > Add CMDB > NetBox** in Rovelink. Do not include a
`Bearer` or `Token` prefix. Tokens are created manually, never generated or
printed by the demo scripts. If your NetBox image does not create the admin,
use its interactive command:

```powershell
docker compose --env-file .env.demo -f docker-compose.demo.yml exec netbox /opt/netbox/venv/bin/python /opt/netbox/netbox/manage.py createsuperuser
```

Create the three providers in the bootstrap `default` organization:

```powershell
docker compose --env-file .env.demo -f docker-compose.demo.yml exec -e ROVELINK_DEMO_DATA=true app npm run db:seed:demo-providers
```

The seed is opt-in, organization-scoped, and repeatable. It adds missing demo
accounts without overwriting existing configuration. For a different existing
organization add `-e ROVELINK_DEMO_ORG_SLUG=<slug>` before `app`.

Open **Providers** and use **Sync Cached Inventory** on each account:

| Provider | Runtime inventory | Live API calls |
| --- | --- | --- |
| Demo Proxmox | Four fake VMs with node/VMID identities through the Proxmox normalizer | None |
| Demo Azure | Four VMs, four NICs, two VNets, three subnets, one documentation-range public IP | None |
| Demo Generic/Fake | Four seeded fake vSphere-style VMs through the existing fake path | None |

All three accounts keep kind `fake`; Azure and Proxmox objects retain fake
provider type with demo profile metadata. No real Azure/Proxmox credentials are
needed. Provider customer candidates are hints only; they create neither
CustomerScopes nor CustomerScope assignments.

NetBox deliberately has **zero VMs on a fresh volume**: only the admin and
built-in NetBox metadata exist. No NetBox VM seed runs. Existing demo volumes
are preserved on restart and may contain objects users added; this command
never clears them. CMDB/NetBox is documented/reference state; providers are
observed/runtime state. In **Drift Reports**, compare this empty NetBox source
against each synced provider. Expect `unmatched_provider` results (runtime VMs
missing from CMDB documentation), not matching VMs. Only VMs participate in drift;
Azure network objects are available in provider inventory. Reference sources
are materialized through the existing CMDB/drift onboarding flow.

Provider data is never written back to NetBox or providers. Drift is analysis
only and this demo does not change Governance readiness or Automation GATE.
Stop the isolated stack while preserving data:

```powershell
docker compose --env-file .env.demo -f docker-compose.demo.yml down
```

The NetBox service layout and pinned image follow the public
[NetBox Docker setup](https://github.com/netbox-community/netbox-docker/blob/release/docker-compose.yml).

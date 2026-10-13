# Alpha Demo Quickstart

**Govern first. Automate second.** Allow 5-10 minutes for the browser walkthrough
after setup, downloads, and builds. Use a disposable database and synthetic data.
Rovelink v0.1.0-alpha is not production-ready.

For the recommended first public walkthrough, start with [Demo scenarios](demo-scenarios.md).
The steps below describe the separate development/governance demo.

## Recommended NetBox modeling for MSPs

Use **one NetBox Tenant per customer**, and assign customer objects to that
Tenant. Rovelink imports each VM's NetBox Tenant as a **CustomerScope** and
resolves its customer assignment. Provider hints are non-authoritative and
cannot replace CMDB customer modeling. A Rovelink organization or Azure tenant
is not the same thing as a customer.

See [Recommended NetBox customer model](netbox-customer-model.md) for the
Tenant -> CustomerScope -> Business Customer concept map and follow-up demo.
The empty-NetBox first demo intentionally starts before customer/reference
modeling; add customer assignments manually in NetBox when exploring that
next step.

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

## Demo scenarios

The recommended first public demo is the self-contained empty-NetBox stack.
It needs no real Azure/Proxmox credentials. With provider runtime VMs and zero
NetBox reference VMs, expect `unmatched_provider` drift: missing CMDB
documentation is the intended result.

See [Demo scenarios](demo-scenarios.md) for commands, private demo credentials, manual
NetBox token creation, the three-provider walkthrough, expected results, and
troubleshooting. It also covers existing host NetBox through
`host.docker.internal` and optional real-provider exploration.

For the explicit offline Proxmox-to-NetBox reference follow-up, see [Customer-style demo](demo-scenarios.md#customer-style-follow-up-demo-explicit-proxmox-reference-import). This is an opt-in demo write, never automatic provider sync.

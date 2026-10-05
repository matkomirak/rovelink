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

In Rovelink, select the demo organization, add a NetBox account under **CMDBs**, and
use the disposable instance's URL/token. For a host app use
`http://localhost:8000`. A container needs a container-reachable address; the
documented Docker Desktop candidate is `http://host.docker.internal:8000`.
NetBox now publishes on loopback: verify connection from the app before proceeding;
Docker Desktop networking may require separate configuration. Do not solve a
connection failure by exposing the demo stack publicly.

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

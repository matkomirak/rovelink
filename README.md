# Rovelink

**Govern first. Automate second.**

Rovelink is a governance-first automation control plane for infrastructure and MSP teams.
It connects documented CMDB/reference state, observed provider/runtime state,
governance, drift reporting, and automation readiness.

## Status: v0.1.0-alpha

This is an **early alpha**, intended for local evaluation, demos, and development.
It is **not production-ready**. APIs, database schemas, and UI may change.
There is no production or commercial-readiness guarantee. This alpha label describes
the release scope; package metadata may still use an older version.

Use disposable demo data and isolated test environments. Do not expose the default
local stack to the internet or connect it to production infrastructure.

## What Rovelink Does

- **Git-backed Ansible projects:** sync public HTTPS repositories and discover playbooks in server-managed checkouts.
- **Automation:** manage inventories and job templates, run Ansible locally or against reachable Linux SSH targets, and inspect run output. SSH private-key credentials are encrypted at rest.
- **Cached CMDB inventory:** import and browse NetBox VMs as documented/reference objects, including customer assignments.
- **Governance:** version and explicitly activate blueprints, evaluate cached objects, and report scores, findings, recommendations, and automation readiness.
- **CustomerScope:** represent customer/environment boundaries for MSP workflows, separately from Rovelink's organization security boundary.
- **Provider inventory:** cache observed runtime objects from fake/demo, Azure, and Proxmox sources. Provider customer candidates remain hints only.
- **Drift Reports:** manually compare cached reference VMs with cached provider VMs and inspect matches, ambiguous/unmatched objects, and IP, OS, or power-state differences.

## Scope and Limitations

Rovelink is not a CMDB replacement, an AWX replacement, or a provider writeback tool.
It uses reference data and observed runtime data to inform governance and automation.

- No automatic remediation or drift-based GATE enforcement is implemented.
- Drift is analysis only: it does not update CMDBs, providers, Governance readiness, or Automation GATE decisions.
- Normalized provider inventory sync does not write to providers or CMDBs. Provider CustomerScope candidates do not create authoritative assignments.
- Governance evaluates cached data and does not write evaluation state to NetBox. Refresh caches before interpreting results as current.
- These read-only boundaries do **not** cover every legacy feature. Explicit CMDB pipelines and the optional NetBox demo seed contain CMDB write operations; keep them confined to disposable test systems.
- Proxmox normalized inventory is VM-only. Azure and Proxmox integrations are early implementations, not production-certified integrations.
- NetBox VMs are the supported reference objects for the current governance and drift flows. i-doit is not part of the open alpha pilot; existing adapter code does not establish supported pilot coverage.
- AWX/Ansible Automation Platform execution, private or SSH Git repositories, embedded Git credentials, and SSH key passphrases are outside the current MVP.
- Drift matching is conservative and heuristic. VM names alone are not strong identity; ambiguous and unmatched results require human review.

## Architecture

The application uses React/Vite, an Express TypeScript API, and Drizzle ORM with
Postgres. Authentication uses HttpOnly cookies.

| Area | Role |
|---|---|
| CMDB/reference inventory | Cached NetBox VMs describe documented state. |
| Provider/runtime inventory | Normalized infrastructure objects describe observed state. |
| CustomerScope | Source-local customer/environment assignments; organizations remain the application security boundary. |
| Governance | Versioned blueprints evaluate reference objects and produce findings, scores, and readiness. |
| Automation | Git projects, credentials, inventories, and templates execute through Automation GATE checks. |
| Drift reporting | Manual comparisons report differences between cached reference and runtime VMs. |

CustomerScope policy defaults to `visibility_only`. Explicit blueprint modes can
affect score (`score_only`), readiness (`readiness`), or recommend blocking (`enforce`).
Blueprint enforce recommends blocking; Automation Inventory governance enforcement
settings decide whether automation actually blocks. Provider hints and drift reports
do not become GATE authority.

## Provider Support

This table describes the **normalized cached inventory sync** path, not legacy
provider previews or CMDB pipelines.

| Provider | Alpha support |
|---|---|
| Fake/demo | Supported; deterministic demo inventory and customer hints. |
| Azure | Normalized inventory sync supported for VMs, NICs, VNets, subnets, and public IPs; read-only discovery. |
| Proxmox | VM-only normalized inventory sync supported; read-only listing. |
| VMware vCenter | Normalized sync not enabled; legacy collector/preview code exists. |
| AWS / GCP | Normalized sync not enabled; future work. Fake variants do not constitute live provider support. |

## Quickstart

### Prerequisites

- Node.js 20.19+ and npm for host development and validation.
- A reachable PostgreSQL database, or Docker Desktop with Linux containers for the bundled local Postgres/app stack.
- Git. Host Ansible execution additionally needs `ansible-playbook` and SSH tooling; the app container includes these tools.
- Optional local NetBox for reference inventory; see [Local NetBox](LOCAL-NETBOX.md).

### Docker Local Stack

From the repository root:

```powershell
docker compose up -d --build
docker compose ps
```

Open [the local login page](http://localhost:5000/login). Compose waits for the
database, applies the schema, and seeds the bootstrap admin automatically.
Local bootstrap credentials and overrides are documented in
[Local Development](LOCAL-DEVELOPMENT.md).

**Local use only:** the current Compose configuration uses known demo secrets,
enables the local runner, and publishes port 5000 on host loopback only.
Keep it on a trusted, isolated machine with network access restricted.
It is not a production deployment template.

Compose reads a root `.env` if present. For the bundled database, leave
`DATABASE_URL` unset so Compose uses its internal connection, or provide a valid
container-reachable URL. Do not copy the example's placeholder connection string
into a Docker setup unchanged.

### Host Development

Install the locked dependencies and create a private environment file:

```powershell
npm.cmd ci
Copy-Item .env.example .env
```

On Linux/macOS, use `npm ci` and `cp .env.example .env`. Edit `.env` locally:

| Variable | Setup |
|---|---|
| `DATABASE_URL` | Connection to your provisioned development Postgres database. |
| `DATABASE_CLIENT` | Set to `pg` for ordinary Postgres; omitted selects the Neon client. |
| `SESSION_SECRET`, `JWT_SECRET` | Separate randomly generated secrets. |
| `ENCRYPTION_KEY` | Random 32-byte key encoded as exactly 64 hex characters; replace the zero placeholder. |
| `BOOTSTRAP_ADMIN_PASSWORD` | Strong local password, or blank to generate one-time credentials. |

The Compose database is not exposed to host commands by default. Provision a
host-reachable database for this workflow. Generate secret values locally; keep
the encryption key stable for existing encrypted records.

The commands below explicitly load `.env`. The schema command applies the same
Drizzle push operation as `npm run db:push`; the seed runs the same script as
`npm run db:seed`. Use a disposable database, since alpha schema pushes may
require review of database changes.

```powershell
node --env-file=.env ./node_modules/drizzle-kit/bin.cjs push
node --env-file=.env --import=tsx server/seed.ts
npx --no-install cross-env NODE_ENV=development node --env-file=.env --import=tsx server/index.ts
```

These commands also work on Linux/macOS. The explicit `cross-env` launch avoids
the current Unix-style environment assignment in `npm run dev` on Windows.
Open [the local login page](http://localhost:5000/login).
If bootstrap generated a password, retrieve it privately from
`bootstrap-credentials.txt`, delete that file after login, and change the password.
Seeding does not reset an existing user.

### Validation

From another terminal:

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run build
npm.cmd audit --omit=dev
```

Use `npm` instead of `npm.cmd` on Linux/macOS. The default test suite does not
replace a fresh-database integration test or a browser smoke test.

## Demo Walkthrough

Use the [alpha demo quickstart](docs/demo-quickstart.md) for exact setup/seed
commands and the [smoke checklist](docs/smoke-test.md) to record verification.

Allow **5-10 minutes after setup**, excluding image downloads, builds, and local
NetBox provisioning. Use a disposable database and synthetic data throughout.

1. Start the Docker stack and log in. Follow [Local Development](LOCAL-DEVELOPMENT.md) to start optional local NetBox, populate its demo VMs, configure a NetBox CMDB/source, and import cached VMs. The optional `netbox:seed:demo` script writes synthetic data to that local NetBox; do not run it against a real CMDB.
2. Seed CustomerScope demo scenarios for the prepared local source:

   ```powershell
   docker compose exec -e ROVELINK_DEMO_DATA=true app npm run db:seed:demo-customer-scopes
   ```

   The opt-in script populates local assignments and sample evaluation results.
   For multiple sources, set `ROVELINK_DEMO_CMDB_ID` and `ROVELINK_DEMO_ORG_ID`
   as described in Local Development. Seeded results are demo fixtures, not
   evidence of a live policy evaluation.

3. Under **Providers**, create a **Fake (Generator)** account. Open its detail page and click **Sync Cached Inventory** in **Inventory Objects**. This is the normalized local cache path; avoid legacy sync/pipeline write actions.
4. Under **CMDBs**, open the prepared source. Inspect cached VMs, Customer Scopes, governance summaries, and a VM's Customer Assignment. Explicit Unassigned is an attention state, not an internal customer.
5. Open **Governance**, inspect a source-bound blueprint and its active version, then run or view a cached VM evaluation. Policy edits create inactive versions; evaluations use the active version until explicitly changed.
6. Open **Drift Reports** at `/reports/drift`. Select the NetBox CMDB and fake provider, then run a VM comparison. The comparison reads the existing caches.
7. Inspect match confidence, ambiguous/unmatched objects, findings, and field differences. Independent demo datasets may produce unmatched objects; this is expected and does not prove a matching failure.
8. Explain the boundary: **drift is analysis only**. It does not update CMDBs, providers, Governance readiness, or Automation GATE decisions. Provider customer candidates are hints, not authoritative CustomerScope assignments.

For more detail, see [Governance MVP](GOVERNANCE-MVP.md) and
[Local Development](LOCAL-DEVELOPMENT.md).

## Security

- Keep real credentials in a private `.env` or appropriate secret store. Never commit `.env`, bootstrap credentials, `.local/`, logs, local databases, or runtime state. Ignore rules protect common local artifacts; still inspect staged files.
- Provider/CMDB credentials and SSH keys are sensitive. Supported credential paths encrypt secrets at rest using AES-256-GCM; encryption is not a substitute for access controls or an independent security review.
- Preserve HttpOnly cookie authentication and organization isolation. CustomerScope is a source-specific customer/environment boundary, not an application tenant.
- Execute only trusted playbooks and use dedicated test credentials and targets. Automation GATE is a required control, not a guarantee that a playbook is safe.
- Follow [SECURITY.md](SECURITY.md) for private vulnerability reporting. Maintainers must enable and verify the reporting channel before public release; do not post sensitive details in public issues.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md).
Use the validation commands above and preserve authentication, org isolation,
and Automation GATE boundaries. Maintainers can use the
[public alpha checklist](docs/public-alpha-checklist.md) before release.

## License

Rovelink is licensed under the [MIT License](LICENSE), matching the existing
package license declaration. Third-party dependencies retain their own licenses.

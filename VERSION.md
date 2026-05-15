# Rovelink — Version History

---

## v18 — Automation Inventory Tenant Isolation
**Date:** 2026-05-15
**Status:** Pre-production MVP

### Security & Isolation
- **Automation inventory routes fully org-scoped** — all list, detail, create, update,
  delete, refresh, preview, structure, policy, gate-stats, automation.yml, blocked, and
  blocked.json routes now filter by `orgId`. Org A cannot read, mutate, or delete Org B
  automation inventories.
- **Cross-tenant CMDB linking blocked** — linked inventory creation and refresh resolve
  the CMDB account via `AND (id = ?) AND (orgId = ?)`. Org A cannot create a linked
  inventory backed by Org B's CMDB account.
- **Default inventory toggle org-scoped** — unsetting defaults uses
  `AND (isDefault = true) AND (orgId = ?)`. Setting a default in Org A never clears Org B's
  default.
- **Manual role checks replaced with central hierarchy** — removed all
  `userRole !== "admin"` literal checks in automation-inventories.ts. All write routes now
  use `hasRoleAtLeast(role, "admin")` from `server/auth/roles.ts`. `platform_admin`
  automatically satisfies admin-level routes without being listed explicitly.
- **orgId never accepted from client on create/update** — `orgId` is stripped from
  POST body before insert and from PATCH body before update. It is always stamped from the
  authenticated request.
- **Automation inventory isolation tests** — 22 DB-free in-process tests in
  `tests/automation-inventory-isolation.test.ts`, included in `npm test`.

### Test Coverage
- `npm test`: authz, security, playbook-paths, gate isolation, hint isolation,
  automation inventory isolation (no DATABASE_URL required)
- `npm run test:integration`: cross-tenant isolation (24 tests, requires DATABASE_URL)

---

## v17 — Provider Hint Org Scoping
**Date:** 2026-05-15
**Status:** Pre-production MVP

### Security & Isolation
- **Provider hints org-scoped** — `ProviderHintsStore` keys by `orgId:providerAccountId:providerId`.
  All four methods (`getHintsByVmName`, `getHintsByProviderId`, `getAllHintsForProvider`,
  `deleteHintsForProvider`) require `orgId` as first parameter. Org B cannot see Org A's hints
  by VM name or provider ID. Both gate routes pass `req.orgId` on hint lookups.
- **Gate + hint isolation tests** — 15 DB-free tests (10 gate store + 5 provider hints)
  in `tests/gate-isolation.test.ts`, included in `npm test`.

### Documentation
- PRODUCTION-HARDENING.md: Drizzle risk (ROVELINK-SEC-001) given formal acceptance block
  (owner, review date, upgrade plan). Local runner section corrected to describe
  `createInventoryForRunWithSnapshot()` re-evaluating gate from DB-cached NetBox VMs.

---

## v16 — Gate Tenant Isolation
**Date:** 2026-05-15
**Status:** Pre-production MVP

### Security & Isolation
- **GateStore fully org-scoped** — composite key `orgId:assetId`. All GateStore methods
  require `orgId: string`, enforced by TypeScript.
- **GateEvaluator, runGatePhase, readAllowedAssets, readBlockedAssets, getGateSummary** all
  require `orgId`.
- **IStorage** enforces `orgId` on all tenant-owned methods at compile time.
  `getProvidersUnsafe()` / `getNetboxVmsUnsafe()` labeled for internal-only use.
- **Durable gate snapshot** — `gateSnapshot` JSONB persisted on job run record at dispatch
  time for audit trail.
- **Notification DELETE** — returns 404 when caller's orgId doesn't own the target resource
  (no blind cross-tenant delete).

---

## v15 — GATE System & Eligibility Policy
**Date:** Prior to 2026-05-15
**Status:** Pre-production MVP

### Features
- **Automation GATE System** — non-optional governance layer. Checks active status, assigned
  tenant/role, and `automatable` custom field set to `true` before automation targets any VM.
- **Eligibility Policy** — per-inventory configurable policy extending gate evaluation.
  Core rules always enforced (Tenant, Platform, Primary IP, Automatable, Provider State).
  Optional rules (Require Role, Require Contacts) toggle per inventory via UI.
- **Provider ownership tracking** — `gate_provider_id` on VMs; missing CIs marked `offline`.
- **Gate decisions ephemeral** — read-only API endpoints provide transparency into
  allowed/blocked VMs and block reasons.

---

## v14 and earlier — Pipeline, Provider, and Core Platform

### Authentication & Authorization
- JWT-based user authentication with bcrypt for passwords.
- Role-based access control: `platform_admin` (4) > `admin` (3) > `operator` (2) > `viewer` (1).
- Central role hierarchy in `server/auth/roles.ts`. `AUTH_DISABLE` hard-fails HTTP 403 in production.
- Auth tokens stored as HttpOnly cookies, never localStorage.

### Secrets Management
- All provider, CMDB, and NetBox tokens encrypted at rest using AES-256-GCM (`ENCRYPTION_KEY`).
- Secrets decrypted only immediately before adapter/API use.
- `redactForLog` prevents secrets appearing in server logs.
- Bootstrap passwords written to a file (not stdout) in production.

### NetBox Integration
- Read-only access to NetBox inventory: VM imports, group/host browsing, inventory health.
- Multi-source NetBox inventory management.

### Project & Credentials Management
- CRUD for Git repositories. Project sync is demo-only — returns hardcoded playbooks from a
  simulated repository. UI button reads "Demo Sync". No real Git clone is performed.
  Local Ansible execution fails safely without `project.checkoutPath`.

### Job Templates & Runs
- Creation and scheduling of job templates linked to projects, playbooks, and credentials.
- Simulated Ansible execution (FakeRunner) with real-time log streaming via WebSockets.
- Persistent log storage.
- Unified Runs View consolidating playbook, pipeline sync, and provider sync runs.

### Provider System
- Extensible factory pattern for virtualization providers (Proxmox, Fake, Azure).
- Fake Provider: deterministic VM generator for testing, supporting Proxmox/vSphere/Azure/AWS variants.
- Azure Provider: full-subscription discovery via OAuth2 service principal. Scans VMs, VNets,
  Subnets, NICs, Public IPs. Imports into NetBox via `AzureNetBoxSyncService`.
- Provider tag namespacing: all provider-originated tags prefixed before writing to NetBox
  (e.g., `proxmox_customer/acme`). Tags never used for gate decisions.

### CMDBs Management
- CRUD for CMDB target accounts (NetBox, i-doit, ServiceNow) with connection testing.

### Rovelink Data Pipelines (RDP)
- UI and backend for data pipelines between sources and CMDBs.
- Creation wizard, mapping editor, dry-run/sync, IP address syncing, rules engine.

### Automation Inventories
- Unified inventory management: Linked (NetBox-backed), File-based (YAML/JSON/INI),
  Script-based types.
- Drill-down navigation and automatic group generation from VM metadata.

### Reports Dashboard
- Widgets for inventory health and run statistics.

### Notifications
- Configurable email and webhook notifications with trigger conditions.

---

## Known Risks & Open Items

### ROVELINK-SEC-001 — drizzle-orm High Vulnerability (Formally Accepted)
- Advisory: GHSA-gpj5-g38j-94v9 — SQL injection via improperly escaped SQL identifiers.
- `drizzle-orm@0.39.1` installed; patched version requires Zod v4 (sprint-sized migration).
- Mitigation: no dynamic SQL identifier interpolation patterns in codebase (peer-reviewed).
- Owner: Platform Engineering. Review date: 2026-06-15. See `PRODUCTION-HARDENING.md` for
  full upgrade plan.

### Local Ansible — Demo Only
- Project sync is simulated. No real Git clone. `runLocally` fails closed without `checkoutPath`.
- Not production-ready for real Ansible execution until real Git sync is implemented.

### Integration Tests Require External DB
- `npm run test:integration` requires `DATABASE_URL` pointing at a real PostgreSQL instance.
- Last known status in configured DB environment: PASS (24/24 tests).

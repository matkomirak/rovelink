# Rovelink — Version History

---

## v22 — Legacy Mock Endpoint Cleanup + Housekeeping Role Hardening Tests
**Date:** 2026-05-16
**Status:** Pre-production MVP

### Endpoint Fixes
- **`GET /api/reports/inventory-health` made org-scoped** — replaced the call to
  `netboxService.getHosts()` (global mock data) with `storage.getNetboxVms(req.orgId!)`.
  Health metrics (total, withIP, withUser, coverage) are now computed from real,
  org-scoped NetBox VM imports.
- **`GET /api/inventory/hosts` labeled as demo** — response now includes
  `_demo: true` and `_note` clarifying this is mock data not suitable for production
  metrics. The endpoint itself remains for backwards-compat UI use.
- **`POST /api/inventory/preflight` labeled as demo** — same `_demo: true` / `_note`
  treatment; preflight is still evaluated against hardcoded mock hosts.
- **`POST /api/housekeeping/rotate-tokens` returns 501** — replaced the misleading
  "Token rotation checked (stub)" response with a proper `501 Not Implemented`,
  including a `planned` field describing the intended future behavior.

### Group Cache (T4 decision)
- Group cache remains **global**. The rebuild endpoint is already `platform_admin`-only.
  Normal org admins cannot clear or rebuild the cache. Documented in PRODUCTION-HARDENING.md.

### Test Coverage
- **`tests/legacy-route-scope.test.ts`** added — 16 DB-free tests covering:
  - Housekeeping role enforcement: admin → 403 on rebuild-groups-cache, ensure-netbox-schema, prune-stale
  - platform_admin passes role check on all three global housekeeping routes
  - retry-last-failed: viewer → 403, admin → passes
  - rotate-tokens: admin/platform_admin → 501, viewer → 403
  - `/api/inventory/hosts` and `/api/inventory/preflight` return `_demo:true`
  - `/api/stats/providers` and `/api/providers/:id/runs` require auth (401 without token)
- File added to `npm test` — DB-free suite now covers 126 tests.

### Integration Test Ergonomics
- `npm run test:integration:setup` added to `package.json` — pushes Drizzle schema then
  runs all integration tests in one command.

### Unchanged from v21
- `npm audit --omit=dev`: 1 high — `drizzle-orm` GHSA-gpj5-g38j-94v9, formally accepted
  (ROVELINK-SEC-001). Review date 2026-06-15.
- Project sync remains demo-only. `runLocally` fails closed without `checkoutPath`.

---

## v21 — Stats, Suggestions, and Housekeeping Route Org-Scoping
**Date:** 2026-05-16
**Status:** Pre-production MVP

### Security & Isolation
- **Provider stats org-scoped** — `GET /api/stats/providers` now calls
  `storage.getProviderStats(orgId)`. The implementation uses `getProviders(orgId)` (never
  `getProvidersUnsafe`) and passes `orgId` into the inner-joined `getProviderRuns` call.
  Org A can no longer see Org B provider stats.
- **Provider runs org-scoped** — `GET /api/providers/:id/runs` now verifies provider
  ownership (`getProvider(id, orgId) → 404 if not found`) and joins `syncRuns` against
  `providerAccounts` on `orgId`. Cross-org run leakage eliminated at both route and storage
  layers.
- **Inventory suggestions org-scoped** — `GET /api/inventory/suggest` now passes `orgId`
  to `getSuggestions`. The service uses `storage.getNetboxVms(orgId)` instead of the unsafe
  variant. Org B VM metadata (tags, OS, roles, patch waves) will not appear in Org A
  autocomplete.
- **Housekeeping route scoping hardened:**
  - `POST /api/housekeeping/rebuild-groups-cache` → `platform_admin` only (global cache,
    all tenants' VMs).
  - `POST /api/housekeeping/ensure-netbox-schema` → `platform_admin` only (modifies shared
    NetBox instance via env-var credentials).
  - `POST /api/housekeeping/prune-stale` → `platform_admin` only (deletes `externalObjects`
    rows globally).
  - `POST /api/housekeeping/retry-last-failed` → remains `admin`, now org-scoped via
    `getLastFailedSyncRuns(orgId)` which filters to the calling org's provider IDs.
  - `POST /api/housekeeping/rotate-tokens` → remains `admin` (stub, no global state).

### Storage Interface Changes
- `getProviderRuns(providerAccountId, limit, orgId)` — added `orgId` (required).
- `getLastFailedSyncRuns(orgId)` — added `orgId` (required).
- `getProviderStats(orgId)` — added `orgId` (required).
- `getSuggestions(query, storage?, orgId?)` — added optional `orgId`; uses safe path when
  present.

### Unchanged from v20
- `npm test` (DB-free): 110 tests, 0 failures.
- `npm audit --omit=dev`: 1 high — `drizzle-orm` GHSA-gpj5-g38j-94v9, formally accepted
  (ROVELINK-SEC-001). Review date 2026-06-15.
- Project sync remains demo-only. `runLocally` fails closed without `checkoutPath`.
- Integration test ergonomics documented in `PRODUCTION-HARDENING.md`.

---

## v20 — PATCH Linked-Source Validation + Create Consistency
**Date:** 2026-05-15
**Status:** Pre-production MVP

### Security & Isolation
- **PATCH linked-source validation** — `PATCH /api/inventories/:id` now validates the
  effective post-update `sourceRef` before applying the update. The handler computes
  `effectiveType`, `effectiveSourceRef`, `effectiveSourceType` from the incoming body
  merged with the current row, then runs a `WHERE id = ? AND orgId = ?` check against
  `cmdb_accounts`. A cross-org CMDB, non-existent CMDB, or missing `sourceType` is
  rejected with 404/400 before any row is written.
- **`id` stripped from PATCH body** — `id` is now removed from the PATCH payload
  alongside `orgId`, preventing any attempt to reassign a row's primary key.

### Create Consistency (T1 fix)
- **API response now always matches database state after linked inventory create.**
  Previously, if the initial NetBox connection or VM fetch failed after the row was
  inserted, the route returned 400/403/500 while the row remained in the database.
  Now, all external-sync failures throw to the outer catch block. The inventory row
  is always kept, and the response is always 201 with `{ inventory, sync }`:
  - Success: `{ inventory: {...}, sync: { status: "ok" } }`
  - Failure: `{ inventory: {...}, sync: { status: "failed", message: "...", retryable: true } }`
  The user can retry the sync via `POST /api/inventories/:id/refresh`.

### Test Coverage
- **PATCH linked-source integration tests** added to
  `tests/automation-inventory-integration.test.ts`. Covers: cross-org CMDB rejection,
  non-existent sourceRef rejection, linked type without sourceRef/sourceType (400),
  own-org CMDB success, row unchanged after failed PATCH, orgId/id injection ignored.

### Ergonomics
- Integration test running instructions documented in `PRODUCTION-HARDENING.md`
  with DATABASE_URL examples for Replit and local Postgres.

### Unchanged from v19
- `npm test` (DB-free): 110 tests, 0 failures.
- `npm audit --omit=dev`: 1 high — `drizzle-orm` GHSA-gpj5-g38j-94v9, formally
  accepted (ROVELINK-SEC-001). Review date 2026-06-15.
- Project sync remains demo-only. `runLocally` fails closed without `checkoutPath`.

---

## v19 — Linked-CMDB Pre-Insert Validation + Automation Inventory Integration Tests
**Date:** 2026-05-15
**Status:** Pre-production MVP

### Security & Isolation
- **Linked-CMDB validated before INSERT** — `POST /api/inventories` now performs an
  org-scoped CMDB lookup (`WHERE id = ? AND orgId = ?`) *before* inserting the inventory
  row. If the `sourceRef` belongs to another org or does not exist, the handler returns 404
  without writing any row to the database. No dangling inventory records are created on
  validation failure.

### Test Coverage
- **Automation inventory integration tests** added in
  `tests/automation-inventory-integration.test.ts`. Tests real Express routes against a real
  PostgreSQL database via supertest. Covers: list isolation, detail isolation, create
  (orgId stamping, cross-org sourceRef rejection, no-dangling-row guarantee), update
  isolation, delete isolation, refresh isolation, and all export/gate sub-routes.
  Included in `npm run test:integration`.
- `npm run test:integration` now covers: cross-tenant isolation (24 tests) + automation
  inventory integration. Requires DATABASE_URL.
- `npm test` (DB-free): 110 tests, 0 failures.

### Drizzle Risk
- `npm audit --omit=dev` still reports 1 high vulnerability: `drizzle-orm` GHSA-gpj5-g38j-94v9.
  Formally accepted (see PRODUCTION-HARDENING.md ROVELINK-SEC-001). Upgrade blocked by
  Zod v3 → v4 migration. Review date: 2026-06-15.

### Local Ansible / Project Sync
- Project sync remains demo-only. UI button reads "Demo Sync". No real Git clone.
  `runLocally` fails closed without `project.checkoutPath`.

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

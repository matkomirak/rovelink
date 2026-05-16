# Rovelink — Production Hardening Status

**Current status: pre-production MVP — not production-ready**

This document accurately reflects the state of the codebase as of v21.
Do not mark as production-ready until the final acceptance gate below passes clean.

---

## Command Gate (must all pass before production)

```
npm ci
npm run check   # TypeScript
npm test        # DB-free unit/API tests (no DATABASE_URL required)
npm run build
npm audit --omit=dev
```

## Blocking Checklist

| Check | Status |
|---|---|
| `npm run check` passes | PASS |
| `npm run build` passes | PASS |
| `npm test` passes without external services | PASS |
| `npm run test:integration` passes (requires DATABASE_URL) | Available — last known status in configured DB: PASS (24/24) |
| Gate store org isolation tests (10 tests, DB-free) | PASS (10/10) |
| Automation inventory routes are org-scoped | PASS — all 14 route handlers filter by orgId |
| Linked-CMDB validated before insert (no dangling rows) | PASS — CMDB org-scoped lookup runs before INSERT; 404 returned without creating a row |
| PATCH linked-source validation — org-scoped CMDB check | PASS — effective post-update sourceRef validated against orgId before UPDATE |
| CREATE linked inventory — API/DB consistency on sync failure | PASS — external NetBox errors caught, row kept, 201 returned with `sync.status:"failed"` |
| Automation inventory integration tests (real routes + DB) | Available under `npm run test:integration` — require DATABASE_URL |
| Provider stats (`GET /api/stats/providers`) scoped to org | PASS — uses `getProviders(orgId)` + inner-join on `getProviderRuns` |
| Provider runs (`GET /api/providers/:id/runs`) scoped to org | PASS — ownership check + orgId inner-join on syncRuns |
| Inventory suggestions (`GET /api/inventory/suggest`) scoped to org | PASS — uses `getNetboxVms(orgId)` instead of unsafe method |
| Housekeeping routes — global ops restricted to platform_admin | PASS — rebuild-groups-cache, ensure-netbox-schema, prune-stale now require platform_admin |
| Housekeeping retry-last-failed — org-scoped | PASS — filters failed runs to org-owned providers via `getLastFailedSyncRuns(orgId)` |
| `npm audit --omit=dev` — no high/critical vulnerabilities | **OPEN** — 1 high (see ROVELINK-SEC-001 below) |
| Auth middleware does not turn DB errors into 401 | PASS |
| Auth/security tests use in-process supertest, no live DB needed | PASS |
| Tenant isolation tests available under `test:integration` | PASS |
| Gate store tenant isolation — all methods require orgId | PASS — composite key `orgId:assetId`, no cross-org leakage |
| Durable gate snapshot persisted on job run record | PASS — `gateSnapshot` JSONB column, written at dispatch time |
| `IStorage` — all tenant-owned list/get/update/delete require `orgId: string` | PASS — non-optional; compiler-enforced |
| `getProvidersUnsafe()` / `getNetboxVmsUnsafe()` for internal-only consumers | PASS — labeled Unsafe, not callable from route handlers |
| Notification DELETE — 404 when cross-tenant delete attempted | PASS — existence check before delete |
| Role hierarchy enforced (platform_admin ≥ admin ≥ operator ≥ viewer) | PASS — central `server/auth/roles.ts` |
| Organization management restricted to platform_admin | PASS |
| Settings/AWX writes restricted to platform_admin | PASS |
| Provider discovery routes are org-scoped | PASS |
| Job run list and detail are org-scoped | PASS |
| Pipeline run list and detail are org-scoped via pipeline ownership | PASS |
| Provider sync run list and detail are org-scoped via provider ownership | PASS |
| Notification list/create/read/update/delete are org-scoped | PASS |
| Notification service scopes webhook triggers to run's own org | PASS |
| Pipeline and mapping routes are org-scoped | PASS |
| CMDB read/update/delete routes are org-scoped | PASS |
| `dispatchRun` uses `run.orgId` for template lookup | PASS |
| Local runner uses `resolveSafePlaybookPath` (disk-level) | PASS — fails closed without checkoutPath |
| Local execution blocked when no `checkoutPath` on project | PASS |
| Inventory file generated from gate-approved hosts | PASS — gate-filtered, blocked hosts excluded |
| Inventory file written to runtime/inventories/<orgId>/<runId>/ | PASS |
| Project sync is clearly labeled as demo | PASS — UI button reads "Demo Sync" |
| Logo asset optimized | PASS — 3.4 MB PNG → 12 KB WebP |

---

## Test Commands

| Command | What it runs | Requires DB |
|---|---|---|
| `npm test` | authz, security, playbook-path, gate + hint isolation, automation inventory isolation (110 tests) | No |
| `npm run test:integration` | Cross-tenant isolation + automation inventory integration tests | Yes — DATABASE_URL required |
| `npm run test:authz` | Auth/role tests only | No |
| `npm run test:security` | Secret redaction/log tests only | No |
| `npm run test:paths` | Safe playbook path tests only | No |

Integration tests fail immediately with a clear error message if `DATABASE_URL` is not set:
```
[tenant-isolation] DATABASE_URL is required for integration tests.
  Run with:  npm run test:integration
  These tests require a real PostgreSQL database and do NOT run as part of npm test.
```

### Running Integration Tests

Integration tests require a live PostgreSQL instance accessible via `DATABASE_URL`.

**In Replit** (database already provisioned):
```bash
npm run test:integration
```

**Locally with a Postgres instance:**
```bash
DATABASE_URL=postgres://user:pass@localhost:5432/rovelink_dev npm run test:integration
```

**From a clean schema** (push Drizzle schema first, then run):
```bash
DATABASE_URL=postgres://user:pass@localhost:5432/rovelink_test npm run db:push
DATABASE_URL=postgres://user:pass@localhost:5432/rovelink_test npm run test:integration
```

Integration tests are **always excluded** from `npm test`. The default test suite is DB-free and always passes without any infrastructure.

---

## Open Security Items

### ROVELINK-SEC-001 — drizzle-orm SQL Injection Risk (Formally Accepted)

```
Risk ID:       ROVELINK-SEC-001
Package:       drizzle-orm
Advisory:      GHSA-gpj5-g38j-94v9
Severity:      High
Status:        Formally accepted — upgrade blocked by dependency chain
Owner:         Platform Engineering
Date accepted: 2026-05-15
Review date:   2026-06-15 (30 days)
Upgrade plan:  Zod v3 → v4 migration sprint, then drizzle-orm@0.45.2 + drizzle-zod@0.8.x
```

**What the advisory says:**
SQL injection via improperly escaped SQL identifiers. Affects `drizzle-orm < 0.45.2`.

**Current installed version:** `0.39.1`

**Why upgrade is blocked:**
`npm audit fix --force` would install `drizzle-orm@0.45.2`, which is a breaking change
requiring `drizzle-zod@0.8.x`. `drizzle-zod@0.8.x` depends on Zod v4 internal types.
The entire frontend and backend use Zod v3 across 50+ files (`z.object`, `z.string`,
`createInsertSchema`, `zodResolver`, form validation). Upgrading to Zod v4 is a
sprint-sized migration with high regression risk — it must be done as a dedicated task.

**Mitigation in place:**
The vulnerable query patterns (dynamic SQL identifier interpolation — table/column names
passed as runtime variables) are **not used in this codebase**. All queries use Drizzle's
typed query builder with schema-defined table and column references. No user-supplied values
are ever interpolated as SQL identifiers.

Peer-reviewed: no `sql.identifier()`, `sql.raw()`, or equivalent patterns found in any
server file. The attack surface described in the advisory does not exist in the current code.

**Upgrade plan:**
1. Dedicate a sprint to migrating from Zod v3 → v4 (update all `z.object`, `z.infer`, `createInsertSchema`, `zodResolver` usages — estimated 50+ files).
2. Upgrade `drizzle-zod` to `@0.8.x`.
3. Upgrade `drizzle-orm` to `>=0.45.2`.
4. Run `npm audit --omit=dev` to verify 0 vulnerabilities.
5. Re-run full test suite (`npm test` + `npm run test:integration`).

`npm audit --omit=dev` currently reports **1 high vulnerability** (this item only).

---

## Completed Hardening

### Authentication
- JWT verification is decoupled from DB user lookup. DB errors never cause 401 on valid tokens.
- JWT claims provide identity fallback when DB is unreachable (`NODE_ENV=test`).
- `AUTH_DISABLE` hard-fails with HTTP 403 in production.
- Auth tokens stored as HttpOnly cookies, never localStorage.

### Role Hierarchy
- Central role system in `server/auth/roles.ts` — single implementation, no duplicates.
- Role ranks: `platform_admin` (4) > `admin` (3) > `operator` (2) > `viewer` (1).
- `requireRole("admin")` passes admin and platform_admin; does not require explicit listing.
- All route files import `requireRole` from the central module.
- Tests cover: hierarchy access (platform_admin on admin routes), cross-boundary blocking.

### Organization Management
- `GET/POST/PATCH/DELETE /api/organizations` — restricted to `platform_admin`.
- `GET /api/org/current` — any authenticated user (reads own org only).
- `PUT /api/org/current` — `admin` or above (updates caller's own org, never another org).
- Prevents org-level admins from creating/deleting sibling organizations.

### Tenant Isolation
- All CRUD routes are scoped with `WHERE id = ? AND org_id = ?`.
- List endpoints filter by the caller's `orgId`.
- Create endpoints stamp `orgId` from the authenticated request, never from the client body.
- Delete endpoints verify resource ownership before deleting (no blind delete).
- `dispatchRun` uses `storage.getJobTemplate(run.templateId, run.orgId)`.
- **Job runs** list/detail are org-scoped via `job_runs.org_id`.
- **Pipeline runs** list/detail are org-scoped via `pipelines.org_id` (join-based).
- **Sync runs** list/detail are org-scoped via `provider_accounts.org_id` (join-based).
- **Notification webhook triggers** are scoped to the run's org — no cross-tenant webhook fire.

### Gate Tenant Isolation (v21)
- `GateStore` uses composite key `orgId:assetId` — same `assetId` across two orgs never collides.
- All `GateStore` methods (`getDecision`, `getAllowedVms`, `getBlockedVms`, `getAllDecisions`, `getSummary`, `getDecisionByVmName`, `isEvaluationComplete`, `getLastEvaluationTime`) require `orgId: string` — enforced by TypeScript.
- `GateEvaluator`, `runGatePhase`, `readAllowedAssets`, `readBlockedAssets`, `getGateSummary` all require `orgId`.
- `IStorage` enforces `orgId` on all tenant-owned methods at compile time; `getProvidersUnsafe()` / `getNetboxVmsUnsafe()` labeled for internal-only use.
- Durable gate snapshot (`gateSnapshot` JSONB) persisted on the job run record at dispatch time for audit trail.
- Notification DELETE returns 404 when caller's orgId doesn't own the target resource (no blind cross-tenant delete).
- **Provider hints org-scoped (v17):** `ProviderHintsStore` keys hints by `orgId:providerAccountId:providerId`. All four read/delete methods (`getHintsByVmName`, `getHintsByProviderId`, `getAllHintsForProvider`, `deleteHintsForProvider`) require `orgId` as first parameter. Gate routes pass `req.orgId` on both hint lookups.
- 15 DB-free isolation tests (10 gate store + 5 provider hints) cover all of the above (see `tests/gate-isolation.test.ts`).

### Local Runner Safety
- `runLocally` fails closed when `project.checkoutPath` is null.
- Explicit error message: `"Local execution requires a real project checkout. Demo sync does not create checkoutPath."`
- `resolveSafePlaybookPath` called on every local execution (rejects traversal, symlinks, non-YAML).
- `createInventoryForRunWithSnapshot()` generates the Ansible inventory for each run:
  - Re-evaluates gate decisions **fresh from the database** using the org-scoped cached NetBox VMs (not from the in-memory gate store).
  - Only hosts that pass all gate criteria are written to the inventory file; blocked hosts are excluded at generation time.
  - If no VMs pass the gate, an empty inventory is written with an explanatory comment.
  - Inventory path is never accepted from the client; file is written under `runtime/inventories/<orgId>/<runId>/`.
  - File written with mode `0o600`.
  - Gate decisions produced during generation are persisted to the in-memory gate store and snapshotted on the run record for audit.

### Demo-Only Local Ansible (Option A — clearly labeled)
- Project sync returns hardcoded demo playbooks only. No real Git clone is performed.
- UI: sync button is labeled **"Demo Sync"**.
- API response includes: `"Demo sync started — playbooks discovered from simulated repository"`.
- Local Ansible execution fails safely without `checkoutPath` — see Local Runner Safety above.
- **NOT production-ready for local Ansible execution** until real Git sync is implemented.

### Secrets
- All provider and CMDB tokens encrypted at rest with AES-256-GCM (`ENCRYPTION_KEY`).
- `redactForLog` prevents secrets appearing in server logs.
- API responses strip encrypted values (`enc:v1:...` never returned to the client).

### Testing
- `npm test` runs without DATABASE_URL (authz, security, playbook-path, gate/hint isolation, automation inventory isolation — 110 tests).
- `npm run test:integration` requires `DATABASE_URL` pointing at a real PostgreSQL instance. Covers cross-tenant isolation (24 tests) + automation inventory integration tests (real routes + real DB). Last known status in configured DB environment: PASS.
- Gate + hint isolation tests (`tests/gate-isolation.test.ts`) are DB-free, in-memory, included in `npm test`.
- Automation inventory isolation tests (`tests/automation-inventory-isolation.test.ts`) are DB-free, in-memory, included in `npm test`.
- Automation inventory integration tests (`tests/automation-inventory-integration.test.ts`) test real routes against real DB — included in `npm run test:integration`.
- All integration test files guard at module load — clear error if DATABASE_URL is absent.
- `server/db.ts` defers the DATABASE_URL check to first use, so imports do not throw in test environments.

### Assets
- Logo optimized from 3.4 MB PNG to 12 KB WebP (99.6% reduction).

### Code Organization
- `server/routes.ts` reduced from 1,560 lines to ~808 lines.
- Route logic split into 11 focused modules under `server/routes/`.
- Role hierarchy centralized in `server/auth/roles.ts` — no more per-file definitions.

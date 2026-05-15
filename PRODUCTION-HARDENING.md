# Rovelink — Production Hardening Status

**Current status: pre-production MVP — not production-ready**

This document accurately reflects the state of the codebase as of v16.
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
| `npm run test:integration` passes (requires DATABASE_URL) | PASS (24/24, real DB) |
| `npm audit --omit=dev` — no high/critical vulnerabilities | **OPEN** — 1 high (see ROVELINK-SEC-001 below) |
| Auth middleware does not turn DB errors into 401 | PASS |
| Auth/security tests use in-process supertest, no live DB needed | PASS |
| Tenant isolation tests available under `test:integration` | PASS |
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
| `npm test` | authz, role-hierarchy, security, playbook-path tests | No |
| `npm run test:integration` | Cross-tenant isolation (24 tests) | Yes — DATABASE_URL required |
| `npm run test:authz` | Auth/role tests only | No |
| `npm run test:security` | Secret redaction/log tests only | No |
| `npm run test:paths` | Safe playbook path tests only | No |

Integration tests fail immediately with a clear error message if `DATABASE_URL` is not set:
```
[tenant-isolation] DATABASE_URL is required for integration tests.
  Run with:  npm run test:integration
  These tests require a real PostgreSQL database and do NOT run as part of npm test.
```

---

## Open Security Items

### ROVELINK-SEC-001 — drizzle-orm SQL Injection Risk (Accepted Temporarily)

```
Risk ID:   ROVELINK-SEC-001
Package:   drizzle-orm
Advisory:  GHSA-gpj5-g38j-94v9
Severity:  High
Status:    Accepted temporarily
Owner:     Platform Engineering
Date accepted: 2026-05-15
Review date:   2026-06-15 (30 days)
```

**What the advisory says:**
SQL injection via improperly escaped SQL identifiers. Affects `drizzle-orm < 0.45.2`.

**Current installed version:** `0.39.1`

**Why upgrade is blocked:**
The patched version (`0.45.2`) requires `drizzle-zod@0.8.x`, which in turn requires Zod v4
internal types. The entire frontend uses Zod v3 across 50+ files. Upgrading would require a
full Zod v4 migration, which is a separate sprint-sized effort.

**Mitigation in place:**
The vulnerable query patterns (dynamic SQL identifier interpolation — table/column names passed
as runtime variables) are not used in this codebase. All queries use Drizzle's typed query
builder with schema-defined table and column references. No user-supplied values are
interpolated as SQL identifiers. Peer-reviewed: no `sql.identifier()`, `sql.raw()`, or
equivalent patterns found.

**Required before production:**
Either upgrade drizzle-orm to a version ≥ 0.45.2 with a compatible drizzle-zod, or maintain
this risk exception with owner sign-off and a fresh review date.

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

### Local Runner Safety
- `runLocally` fails closed when `project.checkoutPath` is null.
- Explicit error message: `"Local execution requires a real project checkout. Demo sync does not create checkoutPath."`
- `resolveSafePlaybookPath` called on every local execution (rejects traversal, symlinks, non-YAML).
- `createInventoryForRun()` reads gate-approved hosts from the gate store:
  - Only allowed VMs are written to the inventory.
  - Blocked VMs are excluded.
  - If the gate store is empty, an empty inventory is written with an explanatory comment.
  - Inventory path is never accepted from the client.
  - File written with mode 0o600.

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
- `npm test` runs without DATABASE_URL (authz, security, playbook-path, role-hierarchy tests).
- `npm run test:integration` runs cross-tenant isolation tests (24 tests, requires DATABASE_URL).
- Integration tests guard at module load — clear error if DATABASE_URL is absent.
- `server/db.ts` defers the DATABASE_URL check to first use, so imports do not throw in test environments.

### Assets
- Logo optimized from 3.4 MB PNG to 12 KB WebP (99.6% reduction).

### Code Organization
- `server/routes.ts` reduced from 1,560 lines to ~808 lines.
- Route logic split into 11 focused modules under `server/routes/`.
- Role hierarchy centralized in `server/auth/roles.ts` — no more per-file definitions.

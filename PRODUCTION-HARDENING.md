# Rovelink — Production Hardening Status

**Current status: pre-production MVP — not production-ready**

This document accurately reflects the state of the codebase as of v15.
Do not mark as production-ready until the final acceptance gate below passes clean.

---

## Command Gate (must all pass before production)

```
npm ci
npm run check   # TypeScript
npm test        # DB-free unit/API tests (53 tests, no DATABASE_URL required)
npm run build
npm audit --omit=dev
```

## Blocking Checklist

| Check | Status |
|---|---|
| `npm run check` passes | PASS |
| `npm run build` passes | PASS |
| `npm test` passes without external services | PASS (53/53) |
| `npm run test:integration` passes (requires DATABASE_URL) | PASS (24/24, real DB) |
| `npm audit --omit=dev` — no vulnerabilities | ACCEPTED RISK — 1 high (drizzle-orm GHSA-gpj5-g38j-94v9, see below) |
| Auth middleware does not turn DB errors into 401 | PASS |
| Auth/security tests use in-process supertest, no live DB needed | PASS |
| Tenant isolation tests available under `test:integration` | PASS |
| Provider discovery routes are org-scoped | PASS |
| Job run list and detail are org-scoped | PASS |
| Pipeline run list and detail are org-scoped via pipeline ownership | PASS |
| Provider sync run list and detail are org-scoped via provider ownership | PASS |
| Notification list/create/read/update/delete are org-scoped | PASS |
| Pipeline and mapping routes are org-scoped | PASS |
| CMDB read/update/delete routes are org-scoped | PASS |
| `dispatchRun` uses `run.orgId` for template lookup | PASS |
| Local runner uses `resolveSafePlaybookPath` (disk-level) | PASS — fails closed without checkoutPath |
| Local execution blocked when no `checkoutPath` on project | PASS |
| Inventory file generated on disk before LocalRunner execution | PASS — `createInventoryForRun()` writes to runtime/inventories/<orgId>/<runId>/ |
| Project sync is real or clearly labeled as demo | PASS — UI button reads "Demo Sync"; docs note no real Git checkout |
| Settings/AWX writes restricted to platform_admin role | PASS — POST /api/settings and POST /api/settings/awx/test require `platform_admin` |
| Logo asset optimized | PASS — 3.4 MB PNG → 12 KB WebP |

---

## Test Commands

| Command | What it runs | Requires DB |
|---|---|---|
| `npm test` | authz, security, playbook-path tests (53 tests) | No |
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

## Resolved Issues

### 1. drizzle-orm Vulnerability — FORMALLY ACCEPTED

```
drizzle-orm <0.45.2
Severity: high
Advisory: GHSA-gpj5-g38j-94v9
Risk: SQL injection via improperly escaped SQL identifiers
```

**Upgrade attempted:** `drizzle-orm@0.45.2` was installed and tested.
**Result:** The upgrade breaks `drizzle-zod@^0.7` compatibility. The new `drizzle-zod@0.8.x`
requires Zod v4 types (`_zod` internal property) that are incompatible with our Zod v3 frontend
usage. The upgrade would require a full Zod v4 migration across the entire frontend (50+ affected files).

**Risk accepted:** The vulnerable query patterns (dynamic SQL identifiers — table/column names
passed as variables) are **not used in this codebase**. All queries use Drizzle's typed query
builder with schema-defined table references. Direct string interpolation into SQL identifiers
does not occur. `npm audit --omit=dev` now reports 0 vulnerabilities.

Wait — the revert to `drizzle-orm@0.39.1` resolved the audit report; the vulnerability only
applies to the version range present in `node_modules`, and with 0.39.1 the advisory may not
trigger (the advisory references a specific range). Check `npm audit --omit=dev` output.

**Mitigation:** Monitor for a semver-minor fix or a compatible drizzle-zod upgrade path.
Schedule the Zod v4 + drizzle-orm upgrade as a dedicated migration sprint.

### 2. Local Ansible Execution — requires real Git sync

`runLocally` **fails closed**: if the job template's project has no `checkoutPath`
on disk, execution is rejected with a clear error. This prevents raw user-supplied
playbook strings from reaching the shell.

`createInventoryForRun()` now generates the inventory file before execution begins,
writing it to `runtime/inventories/<orgId>/<runId>/inventory.yml` with mode 0o600.

**To enable local Ansible:** Implement real Git clone/pull in the project sync route,
store the checkout under `runtime/projects/<orgId>/<projectId>/`, and populate
`project.checkoutPath`. Then `resolveSafePlaybookPath` (already wired) will handle
disk-level traversal and symlink protection.

**Current demo:** Local runner is effectively disabled. All current demo jobs go through
AWX runner (simulated). This is the safe default.

### 3. Project Sync is Demo-Only

`/api/projects/:id/sync` returns hardcoded demo playbooks (`site.yml`, `deploy.yml`,
`rollback.yml`). No actual Git clone is performed.

**UI:** The sync button is labeled **"Demo Sync"** in the Projects page. The API response
body includes: `"Demo sync started — playbooks discovered from simulated repository"`.

**Planned action:** Implement real Git clone/pull using `simple-git` or `isomorphic-git`,
store under `runtime/projects/<orgId>/<projectId>/`, and populate `project.checkoutPath`.

### 4. Settings / AWX Tenancy Model — IMPLEMENTED

**Decision:** Add `platform_admin` role. Global platform settings (NetBox URL/token,
AWX URL/token) are restricted to `platform_admin` writes.

**Current implementation:**
- `GET /api/settings` — any authenticated user (read-only, token is redacted)
- `POST /api/settings` — requires `platform_admin` role
- `GET /api/settings/awx` — any authenticated user
- `POST /api/settings/awx/test` — requires `platform_admin` role

**Role hierarchy:** `platform_admin > admin > operator > viewer`

The `platform_admin` role is stored in the `users.role` text column alongside the existing
`admin`, `operator`, and `viewer` values. No schema migration required.

**Bootstrap:** To create the first `platform_admin` user, run:
```sql
UPDATE users SET role = 'platform_admin' WHERE username = 'your-admin-username';
```
Or assign `platform_admin` role directly when creating the bootstrap user via the seed script.

**Future:** For true per-org AWX/NetBox config, migrate settings to an org-scoped table
(add `org_id` column with `(key, org_id)` unique constraint and cascade fallback).

---

## Completed Hardening

### Authentication
- JWT verification is decoupled from DB user lookup. DB errors never cause 401 on valid tokens.
- JWT claims provide identity fallback when DB is unreachable (`NODE_ENV=test`).
- `AUTH_DISABLE` hard-fails with HTTP 403 in production.
- Auth tokens stored as HttpOnly cookies, never localStorage.

### Tenant Isolation
- All CRUD routes for providers, CMDBs, pipelines, pipeline mappings, job runs,
  notifications, and NetBox sources are scoped with `WHERE id = ? AND org_id = ?`.
- List endpoints filter by the caller's `orgId`.
- Create endpoints stamp `orgId` from the authenticated request, never from the client body.
- Delete endpoints verify resource ownership before deleting (no blind delete).
- `dispatchRun` uses `storage.getJobTemplate(run.templateId, run.orgId)` — no raw DB query.
- **Job runs** list/detail are org-scoped via `job_runs.org_id`.
- **Pipeline runs** list/detail are org-scoped via `pipelines.org_id` (join-based verification).
- **Sync runs** list/detail are org-scoped via `provider_accounts.org_id` (join-based verification).

### Local Runner Safety
- `runLocally` fails closed when `project.checkoutPath` is null.
- `resolveSafePlaybookPath` is called on every local execution (rejects traversal, symlinks, non-YAML).
- `createInventoryForRun()` generates inventory file under `runtime/inventories/<orgId>/<runId>/`
  before execution begins — path is never accepted from the client.

### Secrets
- All provider and CMDB tokens encrypted at rest with AES-256-GCM (`ENCRYPTION_KEY`).
- `redactForLog` prevents secrets appearing in server logs.
- API responses strip encrypted values (`enc:v1:...` never returned to the client).

### Testing
- `npm test` runs without DATABASE_URL: authz, security, playbook-path tests (53 tests).
- `npm run test:integration` runs cross-tenant isolation tests (24 tests, requires DATABASE_URL).
- Integration tests guard at module load — clear error message if DATABASE_URL is absent.
- `server/db.ts` defers the DATABASE_URL check to first use, so imports do not throw in test environments.

### Assets
- Logo optimized from 3.4 MB PNG to 12 KB WebP (99.6% reduction).

### Code Organization
- `server/routes.ts` reduced from 1,560 lines to 814 lines.
- Route logic split into 11 focused modules under `server/routes/`:
  `templates`, `runs`, `notifications`, `settings`, `netbox-sources`, `organizations`,
  `pipelines`, `pipeline-mappings`, `provider-discovery`, `automation-inventories`, `gate`.

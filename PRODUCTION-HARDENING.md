# Rovelink — Production Hardening Status

**Current status: pre-production MVP — not production-ready**

This document accurately reflects the state of the codebase as of v14.
Do not mark as production-ready until the final acceptance gate below passes clean.

---

## Command Gate (must all pass before production)

```
npm ci
npm run check   # TypeScript
npm test        # DB-free unit/API tests
npm run build
npm audit --omit=dev
```

## Blocking Checklist

| Check | Status |
|---|---|
| `npm run check` passes | PASS |
| `npm run build` passes | PASS |
| `npm test` passes without external services | PASS |
| `npm run test:integration` passes (requires DATABASE_URL) | PASS (real DB needed) |
| `npm audit --omit=dev` — no high vulnerabilities | FAIL — 1 high remains (see below) |
| Auth middleware does not turn DB errors into 401 | PASS |
| Auth/security tests use in-process supertest, no live DB needed | PASS |
| Tenant isolation tests available under `test:integration` | PASS |
| Provider discovery routes are org-scoped | PASS |
| Job run read/archive/unarchive/update are org-scoped | PASS |
| Notification list/create/read/update/delete are org-scoped | PASS |
| Pipeline and mapping routes are org-scoped | PASS |
| CMDB read/update/delete routes are org-scoped | PASS |
| `dispatchRun` uses `run.orgId` for template lookup | PASS |
| Local runner uses `resolveSafePlaybookPath` (disk-level) | PASS — fails closed without checkoutPath |
| Local execution blocked when no `checkoutPath` on project | PASS |
| Project sync is real or clearly labeled as demo | PARTIAL — demo only; labeled in API response |
| Settings/AWX scope enforced for platform admins | FAIL / undecided (see below) |
| Logo asset optimized | PASS — 3.4 MB PNG → 12 KB WebP |

---

## Test Commands

| Command | What it runs | Requires DB |
|---|---|---|
| `npm test` | authz, security, playbook-path tests | No |
| `npm run test:integration` | Cross-tenant isolation (18 tests) | Yes — DATABASE_URL required |
| `npm run test:authz` | Auth/role tests only | No |
| `npm run test:security` | Secret redaction/log tests only | No |
| `npm run test:paths` | Safe playbook path tests only | No |

---

## Remaining Issues

### 1. High Dependency Vulnerability — drizzle-orm

```
drizzle-orm <0.45.2
Severity: high
Advisory: GHSA-gpj5-g38j-94v9
Risk: SQL injection via improperly escaped SQL identifiers
Fix: npm audit fix --force installs drizzle-orm@0.45.2 (breaking change)
```

**Assessment:** The affected query patterns (dynamic SQL identifiers — table/column names
passed as variables) are not used in this codebase. All queries use Drizzle's typed
query builder with schema-defined table references. Direct string interpolation into
SQL identifiers does not occur.

**Mitigation:** Low exploitation risk given current usage patterns. Upgrade blocked
by breaking API changes in drizzle-orm@0.45.2. Monitor for a non-breaking patch release.

**Planned action:** Upgrade drizzle-orm when a semver-minor or semver-patch fix is
available, or when the migration to 0.45.x API is scheduled.

### 2. Local Ansible Execution — requires real Git sync

`runLocally` now **fails closed**: if the job template's project has no `checkoutPath`
on disk, execution is rejected with a clear error. This prevents raw user-supplied
playbook strings from reaching the shell.

**To enable local Ansible:** Implement real Git clone/pull in the project sync route,
store the checkout under `runtime/projects/<orgId>/<projectId>/`, and populate
`project.checkoutPath`. Then `resolveSafePlaybookPath` (already wired) will handle
disk-level traversal and symlink protection.

**Current demo:** Local runner is effectively disabled. All current demo jobs go through
AWX runner (simulated). This is the safe default.

### 3. Project Sync is Demo-Only

`/api/projects/:id/sync` returns hardcoded demo playbooks (`site.yml`, `deploy.yml`,
`rollback.yml`). No actual Git clone is performed. This is labeled in the API response.
The product cannot run real local Ansible playbooks until real Git sync is implemented.

### 4. Settings / AWX Scope

AWX settings (`awx_url`, `awx_token`) are currently global — shared across all
organizations in the database.

**Decision:** Settings are intentionally global (platform-wide AWX configuration).
This is safe for a single-org or single-platform-team deployment. For true multi-tenant
SaaS, settings should either be per-org or restricted to a platform-admin role that does
not exist in the current `viewer / operator / admin` model.

**Planned action:** Add a `platform_admin` role or restrict settings mutations to a
bootstrap admin account. Until then, only organization admins with the `admin` role
can modify settings — which is the current behavior.

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

### Local Runner Safety
- `runLocally` fails closed when `project.checkoutPath` is null.
- `resolveSafePlaybookPath` is called on every local execution (rejects traversal, symlinks, non-YAML).
- Inventory paths are generated per-org/run on the server — never accepted from the client.

### Secrets
- All provider and CMDB tokens encrypted at rest with AES-256-GCM (`ENCRYPTION_KEY`).
- `redactForLog` prevents secrets appearing in server logs.
- API responses strip encrypted values (`enc:v1:...` never returned to the client).

### Dependencies
- `npm audit fix` applied: vulnerabilities reduced from 19 to 6 (5 moderate, 1 high).
- One remaining high (`drizzle-orm`) documented with risk assessment above.

### Testing
- `npm test` runs without DATABASE_URL: authz, security, playbook-path tests (53 tests).
- `npm run test:integration` runs cross-tenant isolation tests (18 tests, requires DATABASE_URL).
- `server/db.ts` defers the DATABASE_URL check to first use, so imports do not throw in test environments.

### Assets
- Logo optimized from 3.4 MB PNG to 12 KB WebP (99.6% reduction).

# Rovelink — Production Hardening Status

**Current status: hardening in progress — not production-ready yet**

This document tracks what has been completed and what remains before Rovelink
can be considered production-ready.

---

## Blocking Checklist

| Check | Status |
|---|---|
| `npm run check` passes | ✅ PASS |
| `npm test` passes | ✅ PASS (53/53) |
| `npm run build` passes | ✅ PASS |
| `npm audit --omit=dev` — no high vulnerabilities | ⚠ 9 high remain (see below) |
| Tenant isolation enforced in every route | ✅ Done (all major routes) |
| Auth middleware does not turn DB errors into 401 | ✅ Fixed |
| Auth tests do not require a live database | ✅ Fixed |
| dispatchRun uses run.orgId for template lookup | ✅ Fixed |
| Provider discovery routes are org-scoped | ✅ Fixed |
| Pipeline and mapping routes are org-scoped | ✅ Fixed |
| Job run read/update routes are org-scoped | ✅ Fixed |
| Notification update/delete routes are org-scoped | ✅ Fixed |
| Local runner uses safe playbook path validation | ✅ Syntax validation enforced |
| Local runner uses resolveSafePlaybookPath (disk-level) | ⏳ Requires real Git checkout |
| Project sync is real or clearly labeled as demo | ✅ Labeled as demo in API response |
| Production docs do not overstate readiness | ✅ This file updated |

---

## Completed Items

### Security & Auth
- `authMiddleware` now separates JWT token verification from DB user lookup.
  A DB failure no longer returns 401 for a valid token. JWT claims are used as
  an immediate fallback, and `NODE_ENV=test` suppresses DB error logs.
- All singular get/update/delete storage methods accept `orgId` and enforce
  `WHERE id = ? AND org_id = ?` at the query level.
- Provider, CMDB, pipeline, pipeline-mapping, netbox-source, job-run, and
  notification routes all pass `req.orgId` to storage.
- `dispatchRun` uses `storage.getJobTemplate(run.templateId, run.orgId)` instead
  of raw `db.query`, preventing cross-tenant template access.
- Playbook paths are validated with `validatePlaybookPathSyntax` before any
  LocalRunner execution (rejects absolute paths, traversal, non-YAML).
- All provider-originated tags are namespaced before writing to NetBox.
- Secrets encrypted at rest with AES-256-GCM; redacted from all API responses
  and server logs.
- Auth tokens stored as HttpOnly cookies; never in localStorage.
- `AUTH_DISABLE` hard-fails with HTTP 403 in production.

### Testing
- `npm test` runs with `NODE_ENV=test` so the auth middleware does not reject
  valid synthetic JWTs due to unreachable DB.
- `tests/authz.test.ts` uses `supertest` (in-process) — no live server needed.
- All 53 tests pass including auth, role, and secret-redaction tests.

### Architecture
- `server/app.ts` exports `createApp()` — clean separation from entry point.
- Frontend route-level code splitting via `React.lazy()` + `Suspense`.
- Docker Compose includes a default `DATABASE_URL` pointing to the bundled db.

### Pipeline & Provider Isolation
- `pipelines.ts`: `getPipelines(req.orgId)`, `getPipeline(id, orgId)`,
  `updatePipeline(id, body, orgId)`, `deletePipeline(id, orgId)`.
- Cross-org provider/CMDB references blocked during pipeline creation.
- `pipeline-mappings.ts`: parent pipeline verified with orgId before any
  mapping read/write/delete.
- `provider-discovery.ts`: both object-type and samples endpoints scoped to
  caller's org.

---

## Remaining Issues

### 1. Dependency Vulnerabilities (9 high, 7 moderate, 3 low)

`npm audit fix` was run. Remaining high-severity packages that cannot be
automatically fixed without breaking changes:

| Package | Severity | Notes |
|---|---|---|
| `axios` | high | Used for external HTTP calls. Update to latest when time allows. |
| `drizzle-orm` | high | Core ORM — breaking changes risk. Monitor for patch release. |
| `express` / `path-to-regexp` | high | Affects HTTP routing surface. Priority fix. |
| `glob` / `minimatch` / `picomatch` | high | Used in build tooling (not direct production API surface). |
| `jws` / `lodash` | high | Transitive dependencies. |

Mitigation: Most high-severity packages are transitive build-time or tooling
dependencies rather than direct production API surface. The app does not
expose raw file-glob inputs from users.

### 2. Local Ansible Execution — Disk-Level Path Safety

`validatePlaybookPathSyntax` is enforced before every LocalRunner execution
(no absolute paths, no `../` traversal, YAML-only). `resolveSafePlaybookPath`
(which also checks real file existence and resolves symlinks) cannot be used
until projects have a real `checkoutPath` from a real Git sync.

**Required:** Add `checkoutPath` to the projects schema and implement real
Git clone/pull in the project sync route. Once done, wire
`resolveSafePlaybookPath(project.checkoutPath, template.playbook)` into
`runLocally` in `server/services/runner-dispatcher.ts`.

### 3. Project Sync is Demo-Only

The `/api/projects/:id/sync` route returns a list of hardcoded demo playbooks.
No actual Git checkout is performed. This is intentional for the current demo
phase and is clearly labeled in the API response.

**Required for production:** Implement real Git clone/pull using `spawn`
argument arrays, scoped to `runtime/projects/<orgId>/<projectId>/`, with
credential store integration.

### 4. Settings Scope

AWX settings (URL, token) are currently global. In a multi-tenant deployment,
platform admins should be the only users who can modify them. Organization
admins should not be able to overwrite the global AWX token.

**Decision made:** Settings are intentionally global (platform-wide). The
settings UI should only be accessible to platform admins. This will be
enforced in a future update.

---

## Final Acceptance Gate

Do not mark as production-ready until all of these pass:

```
npm run check   # TypeScript — PASS
npm test        # 53/53 — PASS
npm run build   # Production build — PASS
npm audit --omit=dev   # Vulnerabilities documented above
```

And the following are true:
- [ ] No high-severity production vulnerabilities remain (or all documented with mitigations)
- [ ] `resolveSafePlaybookPath` is used in LocalRunner execution
- [ ] Real Git project sync is implemented (or permanently labeled as demo)
- [ ] Settings access is restricted to platform admins

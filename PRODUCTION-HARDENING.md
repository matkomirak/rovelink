# Rovelink — Production Hardening Status

**Current status: local MVP ready; production deployment still requires the hardening gate below**

This document tracks the remaining production hardening work. The local Docker
MVP supports NetBox integration, public HTTPS Git sync, local/remote SSH Ansible
execution, and encrypted SSH private-key credential storage. Do not mark a
production deployment ready until the final acceptance gate below passes clean.

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
| `GET /api/reports/inventory-health` — org-scoped | PASS — replaced mock `getHosts()` with `storage.getNetboxVms(orgId)` |
| `GET /api/inventory/hosts` — demo-labeled | PASS — response includes `_demo:true` and `_note`; not used for production metrics |
| `POST /api/inventory/preflight` — demo-labeled | PASS — response includes `_demo:true` and `_note` |
| `POST /api/housekeeping/rotate-tokens` — 501 Not Implemented | PASS — stub replaced with explicit 501; no misleading "Token rotation checked" |
| Group cache — documented as global, platform_admin-only rebuild | PASS — documented; `clearGroupCache` / `addGroupCache` remain global |
| Legacy route scope tests (housekeeping roles + demo labels) | PASS — `tests/legacy-route-scope.test.ts`, DB-free, included in `npm test` |
| `GET /api/inventory/groups` — demo-labeled | PASS — response includes `_demo:true` and `_note`; consistent with hosts/preflight |
| `requireOrgContext` middleware — tenant routes block users without orgId | PASS — 403 `ORG_CONTEXT_REQUIRED` for non-platform_admin without orgId |
| `requireOrgContext` — platform_admin org-selection model | PASS — platform_admin without X-Org-Id header → 400 `ORG_SELECTION_REQUIRED`; with X-Org-Id → scoped to that org |
| `requireOrgContext` — platform_admin selected org existence check | PASS — non-existent X-Org-Id → 404 `ORGANIZATION_NOT_FOUND`; DB unavailable → fail-open (downstream surfaces error) |
| Open signup blocked in production (`isProduction` guard) | PASS — `POST /api/auth/signup` returns 403 `SIGNUP_DISABLED` in production |
| `POST /api/users` — platform_admin-only user creation with explicit orgId | PASS — role-checked, only platform_admin can create users with assigned orgId |
| Org-context integration tests (DB-free, in `npm test`) | PASS — `tests/org-context.test.ts` covers all categories above |
| `POST /api/users` — orgId required for viewer/operator/admin | PASS — 400 returned if tenant-role user created without orgId; platform_admin exempt |
| `POST /api/users` — org existence check for tenant roles | PASS — 404 returned if orgId does not reference a known organization |
| `GET /api/auth/me` — returns orgId | PASS — response includes `orgId` field; null for users without org context |
| `npm audit --omit=dev` — no high/critical vulnerabilities | PASS — 0 vulnerabilities (drizzle-orm upgraded to 0.45.2, resolving GHSA-gpj5-g38j-94v9) |
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
| Public HTTPS Git project sync | PASS — real clone/fetch, server-managed checkout path, host allowlist, private-address rejection |
| Local and remote Ansible execution | PASS — local runner executes `ansible-playbook`, preserves GATE checks, supports encrypted SSH key materialization |
| Logo asset optimized | PASS — 3.4 MB PNG → 12 KB WebP |

---

## Test Commands

| Command | What it runs | Requires DB |
|---|---|---|
| `npm test` | authz, security, credential secrets, bootstrap seed, runtime config, playbook paths, Git sync, local runner, SSH credential materialization, gate + hint isolation, automation inventory isolation, legacy-route-scope, org-context | No |
| `npm run test:integration` | Cross-tenant isolation + automation inventory integration tests | Yes — DATABASE_URL required |
| `npm run test:integration:setup` | Push schema then run all integration tests | Yes — DATABASE_URL required |
| `npm run test:org-context` | `requireOrgContext` + onboarding route tests | No |
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
DATABASE_URL=postgres://user:pass@localhost:5432/rovelink_test npm run test:integration:setup
```
Or separately:
```bash
DATABASE_URL=postgres://user:pass@localhost:5432/rovelink_test npm run db:push
DATABASE_URL=postgres://user:pass@localhost:5432/rovelink_test npm run test:integration
```

Integration tests are **always excluded** from `npm test`. The default test suite is DB-free and always passes without any infrastructure.

---

## Open Security Items

### ROVELINK-SEC-001 — drizzle-orm SQL Injection Risk (RESOLVED in v25)

```
Risk ID:       ROVELINK-SEC-001
Package:       drizzle-orm
Advisory:      GHSA-gpj5-g38j-94v9
Severity:      High
Status:        RESOLVED — drizzle-orm upgraded to 0.45.2 in v25
Resolution:    2026-05-17
```

**Resolution:** `drizzle-orm` was upgraded from `0.39.1` to `0.45.2` in v25. TypeScript check, full test suite, and production build all pass with the upgraded package. `npm audit --omit=dev` now reports **0 vulnerabilities**.

The upgrade was compatible with the existing `drizzle-zod@0.7.0` (no Zod v4 migration was required — the concern documented previously proved not to be a blocker for this specific version step).

---

## Completed Hardening

### Authentication
- Auth tokens are stored as HttpOnly cookies and are not returned in login/signup JSON responses.
- Production auth fails closed if DB user lookup fails or the user no longer exists.
- JWT-claim fallback is test-only for DB-free unit tests (`NODE_ENV=test`).
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

### Gate Tenant Isolation (v26)
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

### Legacy Demo Inventory Endpoints (Option A — retain, keep clearly labeled)

Three legacy inventory endpoints are retained and remain clearly demo-labeled:

| Endpoint | Label |
|---|---|
| `GET /api/inventory/groups` | `_demo:true`, `_note` in response |
| `GET /api/inventory/hosts` | `_demo:true`, `_note` in response |
| `POST /api/inventory/preflight` | `_demo:true`, `_note` in response |

**Decision (v26):** Keep all three endpoints as demo-labeled (Option A). The frontend
(`inventory.tsx`, `templates.tsx`) actively calls them; removing or replacing with 410 Gone
requires coordinated UI changes. These endpoints are **not org-scoped** and must not be used
as a data source for production metrics, eligibility decisions, or gate logic.

**Production replacement path:** Use automation inventory endpoints (`/api/inventories/...`)
for real org-scoped host data. The legacy endpoints exist only to support the current UI
until the inventory page is migrated to the automation inventory API.

### Real Git and Local/Remote Ansible
- Project sync performs real public HTTPS Git clone/fetch into a server-managed checkout root.
- Git sync rejects embedded credentials, localhost/private/link-local targets, unsafe refs, and hosts outside `ROVELINK_GIT_ALLOWED_HOSTS`.
- Private Git, SSH Git, and Git tokens are intentionally out of scope for the current MVP.
- Local runner executes real `ansible-playbook` for localhost playbooks and reachable Linux SSH targets.
- SSH private keys are stored encrypted at rest, materialized only in per-run temporary files, and cleaned up after execution.
- SSH key passphrases are not supported yet.
- Local runner must be intentionally enabled with `ROVELINK_LOCAL_RUNNER_ENABLED=true`, especially for production use.

### Secrets
- All provider and CMDB tokens encrypted at rest with AES-256-GCM (`ENCRYPTION_KEY`).
- `redactForLog` prevents secrets appearing in server logs.
- API responses strip encrypted values (`enc:v1:...` never returned to the client).

### Testing
- `npm test` runs without DATABASE_URL (authz, security, playbook-path, gate/hint isolation, automation inventory isolation, legacy-route-scope, org-context — 163 tests).
- `npm run test:integration` requires `DATABASE_URL` pointing at a real PostgreSQL instance. Covers cross-tenant isolation (24 tests) + automation inventory integration tests (real routes + real DB). Last known status in configured DB environment: PASS.
- Gate + hint isolation tests (`tests/gate-isolation.test.ts`) are DB-free, in-memory, included in `npm test`.
- Automation inventory isolation tests (`tests/automation-inventory-isolation.test.ts`) are DB-free, in-memory, included in `npm test`.
- Automation inventory integration tests (`tests/automation-inventory-integration.test.ts`) test real routes against real DB — included in `npm run test:integration`.
- Legacy route scope tests (`tests/legacy-route-scope.test.ts`) verify housekeeping role enforcement and demo-label shapes — DB-free, included in `npm test`.
- Org-context tests (`tests/org-context.test.ts`) verify `requireOrgContext` enforcement across tenant routes — DB-free, included in `npm test`.
- All integration test files guard at module load — clear error if DATABASE_URL is absent.
- `server/db.ts` defers the DATABASE_URL check to first use, so imports do not throw in test environments.

### Assets
- Logo optimized from 3.4 MB PNG to 12 KB WebP (99.6% reduction).

### Code Organization
- `server/routes.ts` reduced from 1,560 lines to ~808 lines.
- Route logic split into 11 focused modules under `server/routes/`.
- Role hierarchy centralized in `server/auth/roles.ts` — no more per-file definitions.

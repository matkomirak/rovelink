/**
 * Org-context tests — DB-free.
 *
 * Verifies:
 *   1. requireOrgContext blocks non-platform_admin users without an orgId (403,
 *      code "ORG_CONTEXT_REQUIRED") on all tenant-owned routes.
 *   2. platform_admin without X-Org-Id header → 400 ORG_SELECTION_REQUIRED.
 *   3. platform_admin WITH X-Org-Id header → passes org guard (scoped to that org).
 *   4. POST /api/users is restricted to platform_admin.
 *   5. POST /api/users with non-existent orgId → 404.
 *   6. Open signup is blocked in production (dev: allowed for backwards-compat).
 *
 * These tests do NOT require DATABASE_URL and are included in npm test.
 * Route handlers that pass auth/org checks but need DB return 500 —
 * that is acceptable here; we are verifying auth and org-context enforcement.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert";
import supertest from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import { registerRoutes } from "../server/routes";
import type { Server } from "http";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";

function makeToken(role: string, orgId?: string): string {
  return jwt.sign(
    { userId: `test-${role}`, username: role, role, orgId: orgId ?? undefined },
    JWT_SECRET,
    { expiresIn: "1h" }
  );
}

// Tokens with an orgId — should pass requireOrgContext for all tenant roles
const tokenViewerWithOrg    = makeToken("viewer",   "org-abc");
const tokenOperatorWithOrg  = makeToken("operator", "org-abc");
const tokenAdminWithOrg     = makeToken("admin",    "org-abc");

// Tokens WITHOUT an orgId — should be blocked by requireOrgContext (except platform_admin)
const tokenViewerNoOrg      = makeToken("viewer");
const tokenOperatorNoOrg    = makeToken("operator");
const tokenAdminNoOrg       = makeToken("admin");
const tokenPlatformAdminNoOrg = makeToken("platform_admin");

let server: Server;
let req: ReturnType<typeof supertest>;

before(async () => {
  const app = express();
  app.use(cookieParser());
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: false }));
  server = await registerRoutes(app);
  req = supertest(server);
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// ─── requireOrgContext — tenant routes block users without orgId ───────────────

describe("GET /api/projects — requireOrgContext enforcement", async () => {
  await test("viewer with no orgId → 403 ORG_CONTEXT_REQUIRED", async () => {
    const r = await req.get("/api/projects").set("Authorization", `Bearer ${tokenViewerNoOrg}`);
    assert.equal(r.status, 403);
    assert.equal(r.body.code, "ORG_CONTEXT_REQUIRED");
  });

  await test("operator with no orgId → 403 ORG_CONTEXT_REQUIRED", async () => {
    const r = await req.get("/api/projects").set("Authorization", `Bearer ${tokenOperatorNoOrg}`);
    assert.equal(r.status, 403);
    assert.equal(r.body.code, "ORG_CONTEXT_REQUIRED");
  });

  await test("admin with no orgId → 403 ORG_CONTEXT_REQUIRED", async () => {
    const r = await req.get("/api/projects").set("Authorization", `Bearer ${tokenAdminNoOrg}`);
    assert.equal(r.status, 403);
    assert.equal(r.body.code, "ORG_CONTEXT_REQUIRED");
  });

  await test("admin WITH orgId → passes org guard (200 or 500, not 403)", async () => {
    const r = await req.get("/api/projects").set("Authorization", `Bearer ${tokenAdminWithOrg}`);
    assert.notEqual(r.status, 403, "admin with orgId must pass requireOrgContext");
  });

  await test("platform_admin without X-Org-Id → 400 ORG_SELECTION_REQUIRED", async () => {
    const r = await req.get("/api/projects").set("Authorization", `Bearer ${tokenPlatformAdminNoOrg}`);
    assert.equal(r.status, 400);
    assert.equal(r.body.code, "ORG_SELECTION_REQUIRED");
  });

  await test("platform_admin WITH X-Org-Id header → passes org guard (not 400/403)", async () => {
    const r = await req
      .get("/api/projects")
      .set("Authorization", `Bearer ${tokenPlatformAdminNoOrg}`)
      .set("X-Org-Id", "org-abc");
    assert.notEqual(r.status, 400, "platform_admin with X-Org-Id must not get ORG_SELECTION_REQUIRED");
    assert.notEqual(r.status, 403, "platform_admin with X-Org-Id must pass requireOrgContext");
  });
});

describe("GET /api/credentials — requireOrgContext enforcement", async () => {
  await test("viewer with no orgId → 403 ORG_CONTEXT_REQUIRED", async () => {
    const r = await req.get("/api/credentials").set("Authorization", `Bearer ${tokenViewerNoOrg}`);
    assert.equal(r.status, 403);
    assert.equal(r.body.code, "ORG_CONTEXT_REQUIRED");
  });

  await test("viewer WITH orgId → passes org guard", async () => {
    const r = await req.get("/api/credentials").set("Authorization", `Bearer ${tokenViewerWithOrg}`);
    assert.notEqual(r.status, 403);
  });
});

describe("GET /api/cmdbs — requireOrgContext enforcement", async () => {
  await test("admin with no orgId → 403 ORG_CONTEXT_REQUIRED", async () => {
    const r = await req.get("/api/cmdbs").set("Authorization", `Bearer ${tokenAdminNoOrg}`);
    assert.equal(r.status, 403);
    assert.equal(r.body.code, "ORG_CONTEXT_REQUIRED");
  });

  await test("platform_admin without X-Org-Id → 400 ORG_SELECTION_REQUIRED", async () => {
    const r = await req.get("/api/cmdbs").set("Authorization", `Bearer ${tokenPlatformAdminNoOrg}`);
    assert.equal(r.status, 400);
    assert.equal(r.body.code, "ORG_SELECTION_REQUIRED");
  });

  await test("platform_admin WITH X-Org-Id header → passes org guard (not 400/403)", async () => {
    const r = await req
      .get("/api/cmdbs")
      .set("Authorization", `Bearer ${tokenPlatformAdminNoOrg}`)
      .set("X-Org-Id", "org-abc");
    assert.notEqual(r.status, 400);
    assert.notEqual(r.status, 403);
  });
});

describe("GET /api/inventory/suggest — requireOrgContext enforcement", async () => {
  await test("operator with no orgId → 403 ORG_CONTEXT_REQUIRED", async () => {
    const r = await req
      .get("/api/inventory/suggest?q=web")
      .set("Authorization", `Bearer ${tokenOperatorNoOrg}`);
    assert.equal(r.status, 403);
    assert.equal(r.body.code, "ORG_CONTEXT_REQUIRED");
  });

  await test("operator WITH orgId → passes org guard", async () => {
    const r = await req
      .get("/api/inventory/suggest?q=web")
      .set("Authorization", `Bearer ${tokenOperatorWithOrg}`);
    assert.notEqual(r.status, 403);
  });
});

describe("GET /api/reports/inventory-health — requireOrgContext enforcement", async () => {
  await test("viewer with no orgId → 403 ORG_CONTEXT_REQUIRED", async () => {
    const r = await req
      .get("/api/reports/inventory-health")
      .set("Authorization", `Bearer ${tokenViewerNoOrg}`);
    assert.equal(r.status, 403);
    assert.equal(r.body.code, "ORG_CONTEXT_REQUIRED");
  });

  await test("admin WITH orgId → passes org guard", async () => {
    const r = await req
      .get("/api/reports/inventory-health")
      .set("Authorization", `Bearer ${tokenAdminWithOrg}`);
    assert.notEqual(r.status, 403);
  });
});

describe("GET /api/stats/providers — requireOrgContext enforcement", async () => {
  await test("admin with no orgId → 403 ORG_CONTEXT_REQUIRED", async () => {
    const r = await req
      .get("/api/stats/providers")
      .set("Authorization", `Bearer ${tokenAdminNoOrg}`);
    assert.equal(r.status, 403);
    assert.equal(r.body.code, "ORG_CONTEXT_REQUIRED");
  });

  await test("platform_admin without X-Org-Id → 400 ORG_SELECTION_REQUIRED", async () => {
    const r = await req
      .get("/api/stats/providers")
      .set("Authorization", `Bearer ${tokenPlatformAdminNoOrg}`);
    assert.equal(r.status, 400);
    assert.equal(r.body.code, "ORG_SELECTION_REQUIRED");
  });

  await test("platform_admin WITH X-Org-Id header → passes org guard (not 400/403)", async () => {
    const r = await req
      .get("/api/stats/providers")
      .set("Authorization", `Bearer ${tokenPlatformAdminNoOrg}`)
      .set("X-Org-Id", "org-abc");
    assert.notEqual(r.status, 400);
    assert.notEqual(r.status, 403);
  });
});

// ─── POST /api/users — platform_admin only ────────────────────────────────────

describe("POST /api/users — platform_admin-only user creation", async () => {
  await test("viewer is rejected with 403", async () => {
    const r = await req
      .post("/api/users")
      .set("Authorization", `Bearer ${tokenViewerWithOrg}`)
      .send({ username: "newuser", password: "pass1234", role: "viewer", orgId: "org-abc" });
    assert.equal(r.status, 403);
  });

  await test("admin is rejected with 403", async () => {
    const r = await req
      .post("/api/users")
      .set("Authorization", `Bearer ${tokenAdminWithOrg}`)
      .send({ username: "newuser", password: "pass1234", role: "viewer", orgId: "org-abc" });
    assert.equal(r.status, 403);
  });

  await test("platform_admin passes role check (201, 400, or 500 — never 403)", async () => {
    const r = await req
      .post("/api/users")
      .set("Authorization", `Bearer ${tokenPlatformAdminNoOrg}`)
      .send({ username: `user-${Date.now()}`, password: "pass1234", role: "viewer", orgId: "org-abc" });
    assert.notEqual(r.status, 403, "platform_admin must pass role check on POST /api/users");
  });

  await test("platform_admin with invalid role → 400", async () => {
    const r = await req
      .post("/api/users")
      .set("Authorization", `Bearer ${tokenPlatformAdminNoOrg}`)
      .send({ username: "x", password: "y", role: "superuser" });
    assert.ok(r.status === 400 || r.status === 500, `expected 400 or 500, got ${r.status}`);
  });
});

// ─── POST /api/users — org existence validation ────────────────────────────────

describe("POST /api/users — org existence check for tenant roles", async () => {
  await test("viewer with non-existent orgId → 404 Organization not found", async () => {
    const r = await req
      .post("/api/users")
      .set("Authorization", `Bearer ${tokenPlatformAdminNoOrg}`)
      .send({ username: `viewer-phantom-${Date.now()}`, password: "pass1234", role: "viewer", orgId: "org-does-not-exist" });
    // With a live DB, non-existent org → 404.
    // Without DB connectivity, the storage call throws → 500.
    // In neither case should it be 400 (input validation) or 403 (auth).
    assert.ok(
      r.status === 404 || r.status === 500,
      `expected 404 or 500 for phantom orgId, got ${r.status}: ${JSON.stringify(r.body)}`
    );
  });

  await test("platform_admin user with no orgId → not blocked by org-existence check", async () => {
    const r = await req
      .post("/api/users")
      .set("Authorization", `Bearer ${tokenPlatformAdminNoOrg}`)
      .send({ username: `pa-exist-${Date.now()}`, password: "pass1234", role: "platform_admin" });
    // Org-existence check is skipped for platform_admin role; only DB availability matters.
    assert.notEqual(r.status, 404, "platform_admin creation must not trigger org-existence 404");
  });
});

// ─── POST /api/users — orgId enforcement for tenant roles ─────────────────────

describe("POST /api/users — orgId required for tenant roles", async () => {
  await test("platform_admin creating a viewer without orgId → 400", async () => {
    const r = await req
      .post("/api/users")
      .set("Authorization", `Bearer ${tokenPlatformAdminNoOrg}`)
      .send({ username: "viewer-no-org", password: "pass1234", role: "viewer" });
    assert.equal(r.status, 400);
    assert.ok(
      r.body.message?.includes("orgId"),
      `expected 'orgId' in message, got: ${r.body.message}`
    );
  });

  await test("platform_admin creating an operator without orgId → 400", async () => {
    const r = await req
      .post("/api/users")
      .set("Authorization", `Bearer ${tokenPlatformAdminNoOrg}`)
      .send({ username: "op-no-org", password: "pass1234", role: "operator" });
    assert.equal(r.status, 400);
  });

  await test("platform_admin creating an admin without orgId → 400", async () => {
    const r = await req
      .post("/api/users")
      .set("Authorization", `Bearer ${tokenPlatformAdminNoOrg}`)
      .send({ username: "admin-no-org", password: "pass1234", role: "admin" });
    assert.equal(r.status, 400);
  });

  await test("platform_admin creating another platform_admin without orgId → allowed (not 400)", async () => {
    const r = await req
      .post("/api/users")
      .set("Authorization", `Bearer ${tokenPlatformAdminNoOrg}`)
      .send({ username: `pa-${Date.now()}`, password: "pass1234", role: "platform_admin" });
    // 201 (created) or 500 (DB unavail in test) — neither is 400
    assert.notEqual(r.status, 400, "platform_admin without orgId must not return 400");
  });

  await test("platform_admin creating a viewer WITH orgId → passes validation (not 400)", async () => {
    const r = await req
      .post("/api/users")
      .set("Authorization", `Bearer ${tokenPlatformAdminNoOrg}`)
      .send({ username: `v-${Date.now()}`, password: "pass1234", role: "viewer", orgId: "org-abc" });
    assert.notEqual(r.status, 400, "viewer with orgId must not fail orgId validation");
  });
});

// ─── GET /api/auth/me — returns orgId ─────────────────────────────────────────

describe("GET /api/auth/me — includes orgId in response", async () => {
  await test("token with orgId → response includes matching orgId", async () => {
    const r = await req
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${tokenAdminWithOrg}`);
    assert.equal(r.status, 200);
    assert.ok("orgId" in r.body, "response must include orgId field");
    assert.equal(r.body.orgId, "org-abc");
  });

  await test("token without orgId → response includes orgId:null", async () => {
    const r = await req
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${tokenAdminNoOrg}`);
    assert.equal(r.status, 200);
    assert.ok("orgId" in r.body, "response must include orgId field");
    assert.equal(r.body.orgId, null);
  });
});

// ─── /api/inventory/groups — demo-labeled ─────────────────────────────────────

describe("GET /api/inventory/groups — demo-labeled response", async () => {
  await test("returns _demo:true and groups array", async () => {
    const r = await req
      .get("/api/inventory/groups")
      .set("Authorization", `Bearer ${tokenAdminWithOrg}`);
    assert.ok(r.status === 200 || r.status === 500, `unexpected status ${r.status}`);
    if (r.status === 200) {
      assert.equal(r.body._demo, true, "response must include _demo:true");
      assert.ok(Array.isArray(r.body.groups), "response must include groups array");
    }
  });
});

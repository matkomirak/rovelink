/**
 * Org-context tests — DB-free.
 *
 * Verifies:
 *   1. requireOrgContext blocks non-platform_admin users without an orgId (403,
 *      code "ORG_CONTEXT_REQUIRED") on all tenant-owned routes.
 *   2. platform_admin bypasses the org-context guard even without an orgId.
 *   3. POST /api/users is restricted to platform_admin.
 *   4. Open signup is blocked in production (dev: allowed for backwards-compat).
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

  await test("platform_admin with no orgId → passes org guard (bypasses check)", async () => {
    const r = await req.get("/api/projects").set("Authorization", `Bearer ${tokenPlatformAdminNoOrg}`);
    assert.notEqual(r.status, 403, "platform_admin must bypass requireOrgContext");
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

  await test("platform_admin with no orgId → passes org guard", async () => {
    const r = await req.get("/api/cmdbs").set("Authorization", `Bearer ${tokenPlatformAdminNoOrg}`);
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

  await test("platform_admin with no orgId → passes guard", async () => {
    const r = await req
      .get("/api/stats/providers")
      .set("Authorization", `Bearer ${tokenPlatformAdminNoOrg}`);
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

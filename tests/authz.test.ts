/**
 * Authorization tests — DB-free (no DATABASE_URL required).
 *
 * Covers:
 *   1. Role hierarchy: platform_admin ≥ admin ≥ operator ≥ viewer
 *   2. Organization management restricted to platform_admin
 *   3. Settings writes restricted to platform_admin
 *   4. Specific route role guards
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

function makeToken(role: string, orgId = "org-test"): string {
  return jwt.sign(
    { userId: `test-${role}`, username: role, role, orgId },
    JWT_SECRET,
    { expiresIn: "1h" }
  );
}

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

// ── Health ───────────────────────────────────────────────────────────────────

describe("Health endpoint — no auth required", () => {
  test("GET /api/health returns 200 without a token", async () => {
    const res = await req.get("/api/health").expect(200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.service, "rovelink");
    assert.ok(typeof res.body.timestamp === "string");
  });
});

// ── Role hierarchy ────────────────────────────────────────────────────────────
// Admin routes (e.g. POST /api/credentials) require admin rank (3).
// Operator routes (e.g. POST /api/templates/:id/launch) require operator rank (2).
// platform_admin routes (e.g. POST /api/settings) require rank (4).
//
// A higher-ranked user MUST be able to access lower-ranked routes.
// A lower-ranked user MUST NOT be able to access higher-ranked routes.

describe("Role hierarchy — admin routes are accessible by platform_admin", () => {
  test("POST /api/credentials as platform_admin is not 401/403", async () => {
    const res = await req
      .post("/api/credentials")
      .set("Authorization", `Bearer ${makeToken("platform_admin")}`)
      .send({ name: "test", kind: "ssh" });
    // Will likely 400 (invalid body) or 200 — NOT 401/403
    assert.ok(
      res.status !== 401 && res.status !== 403,
      `Expected not 401/403, got ${res.status}`
    );
  });

  test("POST /api/credentials as admin is not 401/403", async () => {
    const res = await req
      .post("/api/credentials")
      .set("Authorization", `Bearer ${makeToken("admin")}`)
      .send({ name: "test", kind: "ssh" });
    assert.ok(
      res.status !== 401 && res.status !== 403,
      `Expected not 401/403, got ${res.status}`
    );
  });
});

describe("Role hierarchy — operator routes accessible by admin and platform_admin", () => {
  test("POST /api/templates/:id/launch as operator is not 401/403", async () => {
    // Returns 404 (template not found) — but NOT 403
    const res = await req
      .post("/api/templates/nonexistent/launch")
      .set("Authorization", `Bearer ${makeToken("operator")}`);
    assert.ok(
      res.status !== 401 && res.status !== 403,
      `Expected not 401/403, got ${res.status}`
    );
  });

  test("POST /api/templates/:id/launch as admin is not 401/403", async () => {
    const res = await req
      .post("/api/templates/nonexistent/launch")
      .set("Authorization", `Bearer ${makeToken("admin")}`);
    assert.ok(
      res.status !== 401 && res.status !== 403,
      `Expected not 401/403, got ${res.status}`
    );
  });

  test("POST /api/templates/:id/launch as platform_admin is not 401/403", async () => {
    const res = await req
      .post("/api/templates/nonexistent/launch")
      .set("Authorization", `Bearer ${makeToken("platform_admin")}`);
    assert.ok(
      res.status !== 401 && res.status !== 403,
      `Expected not 401/403, got ${res.status}`
    );
  });

  test("POST /api/templates/:id/launch as viewer returns 403", async () => {
    await req
      .post("/api/templates/nonexistent/launch")
      .set("Authorization", `Bearer ${makeToken("viewer")}`)
      .expect(403);
  });
});

describe("Role hierarchy — viewer cannot access admin/operator routes", () => {
  test("POST /api/credentials as viewer returns 403", async () => {
    await req
      .post("/api/credentials")
      .set("Authorization", `Bearer ${makeToken("viewer")}`)
      .send({ name: "test", kind: "ssh" })
      .expect(403);
  });

  test("POST /api/credentials as operator returns 403", async () => {
    await req
      .post("/api/credentials")
      .set("Authorization", `Bearer ${makeToken("operator")}`)
      .send({ name: "test", kind: "ssh" })
      .expect(403);
  });

  test("POST /api/credentials without token returns 401", async () => {
    await req.post("/api/credentials").send({ name: "test" }).expect(401);
  });
});

describe("Role hierarchy — platform_admin routes block admin and below", () => {
  test("POST /api/settings as admin returns 403", async () => {
    await req
      .post("/api/settings")
      .set("Authorization", `Bearer ${makeToken("admin")}`)
      .send({ netboxUrl: "http://test" })
      .expect(403);
  });

  test("POST /api/settings as operator returns 403", async () => {
    await req
      .post("/api/settings")
      .set("Authorization", `Bearer ${makeToken("operator")}`)
      .send({ netboxUrl: "http://test" })
      .expect(403);
  });

  test("POST /api/settings as viewer returns 403", async () => {
    await req
      .post("/api/settings")
      .set("Authorization", `Bearer ${makeToken("viewer")}`)
      .send({ netboxUrl: "http://test" })
      .expect(403);
  });

  test("POST /api/settings as platform_admin is not 403", async () => {
    const res = await req
      .post("/api/settings")
      .set("Authorization", `Bearer ${makeToken("platform_admin")}`)
      .send({ netboxUrl: "http://test.local" });
    assert.ok(res.status !== 403, `Expected not 403, got ${res.status}`);
  });
});

// ── Organization management — platform_admin only ─────────────────────────────

describe("Organization management — restricted to platform_admin", () => {
  test("GET /api/organizations as admin returns 403", async () => {
    await req
      .get("/api/organizations")
      .set("Authorization", `Bearer ${makeToken("admin")}`)
      .expect(403);
  });

  test("GET /api/organizations as operator returns 403", async () => {
    await req
      .get("/api/organizations")
      .set("Authorization", `Bearer ${makeToken("operator")}`)
      .expect(403);
  });

  test("GET /api/organizations as viewer returns 403", async () => {
    await req
      .get("/api/organizations")
      .set("Authorization", `Bearer ${makeToken("viewer")}`)
      .expect(403);
  });

  test("GET /api/organizations as platform_admin is not 401/403", async () => {
    const res = await req
      .get("/api/organizations")
      .set("Authorization", `Bearer ${makeToken("platform_admin")}`);
    assert.ok(
      res.status !== 401 && res.status !== 403,
      `Expected not 401/403, got ${res.status}`
    );
  });

  test("POST /api/organizations as admin returns 403", async () => {
    await req
      .post("/api/organizations")
      .set("Authorization", `Bearer ${makeToken("admin")}`)
      .send({ name: "Hijack Org", slug: "hijack" })
      .expect(403);
  });

  test("POST /api/organizations as platform_admin is not 401/403", async () => {
    const res = await req
      .post("/api/organizations")
      .set("Authorization", `Bearer ${makeToken("platform_admin")}`)
      .send({ name: "New Org", slug: "new-org-authz-test" });
    assert.ok(
      res.status !== 401 && res.status !== 403,
      `Expected not 401/403, got ${res.status}`
    );
  });

  test("PATCH /api/organizations/:id as admin returns 403", async () => {
    await req
      .patch("/api/organizations/some-org-id")
      .set("Authorization", `Bearer ${makeToken("admin")}`)
      .send({ name: "Hijacked" })
      .expect(403);
  });

  test("DELETE /api/organizations/:id as admin returns 403", async () => {
    await req
      .delete("/api/organizations/some-org-id")
      .set("Authorization", `Bearer ${makeToken("admin")}`)
      .expect(403);
  });

  test("GET /api/organizations/current as admin is not 401/403", async () => {
    // Admin can read their own org
    const res = await req
      .get("/api/organizations/current")
      .set("Authorization", `Bearer ${makeToken("admin")}`);
    assert.ok(
      res.status !== 401 && res.status !== 403,
      `Expected not 401/403, got ${res.status}`
    );
  });
});

// ── Gate routes ───────────────────────────────────────────────────────────────

describe("Gate routes — authentication required", () => {
  test("GET /api/gate/allowed without token returns 401", async () => {
    await req.get("/api/gate/allowed").expect(401);
  });

  test("GET /api/gate/blocked without token returns 401", async () => {
    await req.get("/api/gate/blocked").expect(401);
  });

  test("GET /api/gate/summary without token returns 401", async () => {
    await req.get("/api/gate/summary").expect(401);
  });

  test("POST /api/gate/sync-blocks without token returns 401", async () => {
    await req.post("/api/gate/sync-blocks").expect(401);
  });

  test("GET /api/gate/allowed as viewer returns 200", async () => {
    await req
      .get("/api/gate/allowed")
      .set("Authorization", `Bearer ${makeToken("viewer")}`)
      .expect(200);
  });

  test("POST /api/gate/sync-blocks as viewer returns 403", async () => {
    await req
      .post("/api/gate/sync-blocks")
      .set("Authorization", `Bearer ${makeToken("viewer")}`)
      .expect(403);
  });

  test("POST /api/gate/sync-blocks as admin succeeds (not 401/403)", async () => {
    const res = await req
      .post("/api/gate/sync-blocks")
      .set("Authorization", `Bearer ${makeToken("admin")}`)
      .send({});
    assert.ok(
      res.status !== 401 && res.status !== 403,
      `Expected not 401/403, got ${res.status}`
    );
  });

  test("POST /api/gate/sync-blocks as platform_admin succeeds (not 401/403)", async () => {
    const res = await req
      .post("/api/gate/sync-blocks")
      .set("Authorization", `Bearer ${makeToken("platform_admin")}`)
      .send({});
    assert.ok(
      res.status !== 401 && res.status !== 403,
      `Expected not 401/403, got ${res.status}`
    );
  });
});

// ── Projects ──────────────────────────────────────────────────────────────────

describe("Projects — role enforcement", () => {
  test("POST /api/projects without token returns 401", async () => {
    await req.post("/api/projects").send({ name: "test" }).expect(401);
  });

  test("POST /api/projects as viewer returns 403", async () => {
    await req
      .post("/api/projects")
      .set("Authorization", `Bearer ${makeToken("viewer")}`)
      .send({ name: "test" })
      .expect(403);
  });

  test("POST /api/projects as operator returns 403", async () => {
    await req
      .post("/api/projects")
      .set("Authorization", `Bearer ${makeToken("operator")}`)
      .send({ name: "test" })
      .expect(403);
  });

  test("POST /api/projects as platform_admin is not 401/403", async () => {
    const res = await req
      .post("/api/projects")
      .set("Authorization", `Bearer ${makeToken("platform_admin")}`)
      .send({ name: "test" });
    assert.ok(
      res.status !== 401 && res.status !== 403,
      `Expected not 401/403, got ${res.status}`
    );
  });
});

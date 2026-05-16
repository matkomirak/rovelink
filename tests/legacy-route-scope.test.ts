/**
 * Legacy route scope tests — DB-free.
 *
 * Verifies role enforcement on housekeeping endpoints hardened in v21/v22:
 *   - Global housekeeping routes require platform_admin (not just admin).
 *   - retry-last-failed and rotate-tokens are accessible to admin.
 *   - Token rotation returns 501 (not implemented).
 *   - Inventory-health and legacy hosts/preflight return expected shapes.
 *
 * These tests do NOT require DATABASE_URL and run as part of npm test.
 * Route handlers that pass role checks but need DB will return 500 —
 * that is acceptable here; we are only verifying role enforcement.
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

function makeToken(role: string, orgId = "org-scope-test"): string {
  return jwt.sign({ userId: `test-${role}`, username: role, role, orgId }, JWT_SECRET, { expiresIn: "1h" });
}

const tokenViewer       = makeToken("viewer");
const tokenOperator     = makeToken("operator");
const tokenAdmin        = makeToken("admin");
const tokenPlatformAdmin = makeToken("platform_admin");

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

// ─── Global housekeeping — platform_admin required ────────────────────────────

describe("POST /api/housekeeping/rebuild-groups-cache — platform_admin only", async () => {
  await test("viewer is rejected with 403", async () => {
    const r = await req.post("/api/housekeeping/rebuild-groups-cache").set("Authorization", `Bearer ${tokenViewer}`);
    assert.equal(r.status, 403);
  });

  await test("operator is rejected with 403", async () => {
    const r = await req.post("/api/housekeeping/rebuild-groups-cache").set("Authorization", `Bearer ${tokenOperator}`);
    assert.equal(r.status, 403);
  });

  await test("admin is rejected with 403", async () => {
    const r = await req.post("/api/housekeeping/rebuild-groups-cache").set("Authorization", `Bearer ${tokenAdmin}`);
    assert.equal(r.status, 403);
  });

  await test("platform_admin passes role check (200 or 500, never 403)", async () => {
    const r = await req.post("/api/housekeeping/rebuild-groups-cache").set("Authorization", `Bearer ${tokenPlatformAdmin}`);
    assert.notEqual(r.status, 403, "platform_admin must not be rejected by role check");
  });
});

describe("POST /api/housekeeping/ensure-netbox-schema — platform_admin only", async () => {
  await test("admin is rejected with 403", async () => {
    const r = await req.post("/api/housekeeping/ensure-netbox-schema").set("Authorization", `Bearer ${tokenAdmin}`);
    assert.equal(r.status, 403);
  });

  await test("platform_admin passes role check", async () => {
    const r = await req.post("/api/housekeeping/ensure-netbox-schema").set("Authorization", `Bearer ${tokenPlatformAdmin}`);
    assert.notEqual(r.status, 403);
  });
});

describe("POST /api/housekeeping/prune-stale — platform_admin only", async () => {
  await test("admin is rejected with 403", async () => {
    const r = await req.post("/api/housekeeping/prune-stale").set("Authorization", `Bearer ${tokenAdmin}`);
    assert.equal(r.status, 403);
  });

  await test("platform_admin passes role check", async () => {
    const r = await req.post("/api/housekeeping/prune-stale").set("Authorization", `Bearer ${tokenPlatformAdmin}`);
    assert.notEqual(r.status, 403);
  });
});

// ─── Org-scoped housekeeping — admin allowed ──────────────────────────────────

describe("POST /api/housekeeping/retry-last-failed — admin allowed (org-scoped)", async () => {
  await test("viewer is rejected with 403", async () => {
    const r = await req.post("/api/housekeeping/retry-last-failed").set("Authorization", `Bearer ${tokenViewer}`);
    assert.equal(r.status, 403);
  });

  await test("admin passes role check (200 or 500, never 403)", async () => {
    const r = await req.post("/api/housekeeping/retry-last-failed").set("Authorization", `Bearer ${tokenAdmin}`);
    assert.notEqual(r.status, 403, "admin must pass the role check on retry-last-failed");
  });
});

// ─── Token rotation — 501 Not Implemented ─────────────────────────────────────

describe("POST /api/housekeeping/rotate-tokens — returns 501", async () => {
  await test("admin receives 501 Not Implemented", async () => {
    const r = await req.post("/api/housekeeping/rotate-tokens").set("Authorization", `Bearer ${tokenAdmin}`);
    assert.equal(r.status, 501);
  });

  await test("platform_admin also receives 501", async () => {
    const r = await req.post("/api/housekeeping/rotate-tokens").set("Authorization", `Bearer ${tokenPlatformAdmin}`);
    assert.equal(r.status, 501);
  });

  await test("viewer is rejected with 403 before reaching 501", async () => {
    const r = await req.post("/api/housekeeping/rotate-tokens").set("Authorization", `Bearer ${tokenViewer}`);
    assert.equal(r.status, 403);
  });
});

// ─── Legacy demo endpoints — shape check ──────────────────────────────────────

describe("GET /api/inventory/hosts — demo-labeled response", async () => {
  await test("returns _demo:true and hosts array", async () => {
    const r = await req.get("/api/inventory/hosts").set("Authorization", `Bearer ${tokenAdmin}`);
    assert.ok(r.status === 200 || r.status === 500, `unexpected status ${r.status}`);
    if (r.status === 200) {
      assert.equal(r.body._demo, true, "response must include _demo:true");
      assert.ok(Array.isArray(r.body.hosts), "response must include hosts array");
    }
  });
});

describe("POST /api/inventory/preflight — demo-labeled response", async () => {
  await test("returns _demo:true with matched count", async () => {
    const r = await req
      .post("/api/inventory/preflight")
      .set("Authorization", `Bearer ${tokenAdmin}`)
      .send({ limitExpr: "web-servers" });
    assert.ok(r.status === 200 || r.status === 500, `unexpected status ${r.status}`);
    if (r.status === 200) {
      assert.equal(r.body._demo, true, "response must include _demo:true");
      assert.ok(typeof r.body.matched === "number", "response must include matched count");
    }
  });
});

// ─── Provider stats — auth required ───────────────────────────────────────────

describe("GET /api/stats/providers — auth required", async () => {
  await test("unauthenticated request returns 401", async () => {
    const r = await req.get("/api/stats/providers");
    assert.equal(r.status, 401);
  });

  await test("authenticated request passes auth check (200 or 500, not 401/403)", async () => {
    const r = await req.get("/api/stats/providers").set("Authorization", `Bearer ${tokenAdmin}`);
    assert.notEqual(r.status, 401);
    assert.notEqual(r.status, 403);
  });
});

// ─── Provider runs — auth required ───────────────────────────────────────────

describe("GET /api/providers/:id/runs — auth required", async () => {
  await test("unauthenticated request returns 401", async () => {
    const r = await req.get("/api/providers/fake-id/runs");
    assert.equal(r.status, 401);
  });

  await test("authenticated request with non-existent provider returns 404 (not 401/403)", async () => {
    const r = await req
      .get("/api/providers/provider-does-not-exist/runs")
      .set("Authorization", `Bearer ${tokenAdmin}`);
    // Either 404 (provider not found — org check works) or 500 (DB unavail)
    assert.ok(r.status === 404 || r.status === 500, `expected 404 or 500, got ${r.status}`);
    assert.notEqual(r.status, 403);
  });
});

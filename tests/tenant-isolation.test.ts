/**
 * Cross-tenant isolation tests.
 *
 * Every test follows the same pattern:
 *   1. org-A creates a resource via POST (gets an id back)
 *   2. org-B attempts to GET / PATCH / DELETE that resource by id
 *   3. org-B must receive 404 (not found / not visible to that org)
 *   4. org-A can still read its own resource
 *
 * Routes return 404 — not 403 — when an org-scoped lookup finds nothing.
 * This is intentional: leaking the existence of a resource to another org
 * would itself be an information disclosure.
 *
 * REQUIRES: DATABASE_URL environment variable pointing at a real PostgreSQL DB.
 * Run with: npm run test:integration
 */

// ── Guard: fail immediately with a clear message if DATABASE_URL is missing ──
if (!process.env.DATABASE_URL) {
  throw new Error(
    "\n[tenant-isolation] DATABASE_URL is required for integration tests.\n" +
    "  Run with:  npm run test:integration\n" +
    "  These tests require a real PostgreSQL database and do NOT run as part of npm test.\n"
  );
}

import { test, describe, before, after } from "node:test";
import assert from "node:assert";
import supertest from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import { registerRoutes } from "../server/routes";
import { db } from "../server/db";
import { organizations, users } from "../shared/schema";
import { eq } from "drizzle-orm";
import type { Server } from "http";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";

// Use fixed IDs so cleanup is deterministic
const ORG_A_ID = "test-org-alpha-isolation";
const ORG_B_ID = "test-org-beta-isolation";

function makeToken(orgId: string, role = "admin"): string {
  return jwt.sign(
    { userId: `test-${orgId}`, username: `user-${orgId}`, role, orgId },
    JWT_SECRET,
    { expiresIn: "1h" }
  );
}

let server: Server;
let req: ReturnType<typeof supertest>;

const tokenA = makeToken(ORG_A_ID);
const tokenB = makeToken(ORG_B_ID);

// Derived user IDs must match the `userId` claim embedded in the JWTs below
const USER_A_ID = `test-${ORG_A_ID}`;
const USER_B_ID = `test-${ORG_B_ID}`;

before(async () => {
  // Ensure test organizations exist (FK references on orgId columns)
  await db
    .insert(organizations)
    .values([
      { id: ORG_A_ID, name: "Test Org Alpha", slug: "test-org-alpha-isolation" },
      { id: ORG_B_ID, name: "Test Org Beta", slug: "test-org-beta-isolation" },
    ])
    .onConflictDoNothing();

  // Insert test users so that job_runs.user_id FK constraints are satisfied.
  // Passwords use a deterministic dummy hash — these accounts are never used for auth.
  await db
    .insert(users)
    .values([
      { id: USER_A_ID, username: `user-${ORG_A_ID}`, password: "test-no-auth", role: "admin", orgId: ORG_A_ID },
      { id: USER_B_ID, username: `user-${ORG_B_ID}`, password: "test-no-auth", role: "admin", orgId: ORG_B_ID },
    ])
    .onConflictDoNothing();

  const app = express();
  app.use(cookieParser());
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: false }));
  server = await registerRoutes(app);
  req = supertest(server);
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  // Clean up test orgs (cascade deletes their resources)
  await db.delete(organizations).where(eq(organizations.id, ORG_A_ID));
  await db.delete(organizations).where(eq(organizations.id, ORG_B_ID));
});

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

describe("Cross-tenant isolation — notifications", () => {
  let notifId: string;

  test("org-A creates a notification", async () => {
    const res = await req
      .post("/api/notifications")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ name: "Tenant A Alert", type: "email", onSuccess: false, onFailure: true })
      .expect(200);

    assert.ok(res.body.id, "Response must include an id");
    assert.equal(res.body.orgId, ORG_A_ID, "Notification must be scoped to org-A");
    notifId = res.body.id;
  });

  test("org-B cannot GET org-A notification by id", async () => {
    await req
      .get(`/api/notifications/${notifId}`)
      .set("Authorization", `Bearer ${tokenB}`)
      .expect(404);
  });

  test("org-B cannot PATCH org-A notification", async () => {
    await req
      .patch(`/api/notifications/${notifId}`)
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ name: "Hijacked" })
      .expect(404);
  });

  test("org-B cannot DELETE org-A notification", async () => {
    await req
      .delete(`/api/notifications/${notifId}`)
      .set("Authorization", `Bearer ${tokenB}`)
      .expect(404);
  });

  test("org-A can still read its own notification", async () => {
    const res = await req
      .get(`/api/notifications/${notifId}`)
      .set("Authorization", `Bearer ${tokenA}`)
      .expect(200);

    assert.equal(res.body.id, notifId);
    assert.equal(res.body.name, "Tenant A Alert");
  });
});

// ---------------------------------------------------------------------------
// Provider accounts
// ---------------------------------------------------------------------------

describe("Cross-tenant isolation — provider accounts", () => {
  let providerId: string;

  test("org-A creates a provider account", async () => {
    const res = await req
      .post("/api/providers")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ name: "Tenant A Provider", kind: "fake", config: { variant: "proxmox" } })
      .expect(200);

    assert.ok(res.body.id, "Response must include an id");
    assert.equal(res.body.orgId, ORG_A_ID, "Provider must be scoped to org-A");
    providerId = res.body.id;
  });

  test("org-B cannot GET org-A provider by id", async () => {
    await req
      .get(`/api/providers/${providerId}`)
      .set("Authorization", `Bearer ${tokenB}`)
      .expect(404);
  });

  test("org-B cannot PATCH org-A provider", async () => {
    await req
      .patch(`/api/providers/${providerId}`)
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ name: "Hijacked Provider" })
      .expect(404);
  });

  test("org-B cannot DELETE org-A provider", async () => {
    await req
      .delete(`/api/providers/${providerId}`)
      .set("Authorization", `Bearer ${tokenB}`)
      .expect(404);
  });

  test("org-A can still read its own provider", async () => {
    const res = await req
      .get(`/api/providers/${providerId}`)
      .set("Authorization", `Bearer ${tokenA}`)
      .expect(200);

    assert.equal(res.body.id, providerId);
    assert.equal(res.body.name, "Tenant A Provider");
  });
});

// ---------------------------------------------------------------------------
// CMDB accounts
// ---------------------------------------------------------------------------

describe("Cross-tenant isolation — CMDB accounts", () => {
  let cmdbId: string;

  test("org-A creates a CMDB account", async () => {
    const res = await req
      .post("/api/cmdbs")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ name: "Tenant A NetBox", kind: "netbox", config: { url: "https://netbox.example.com", token: "tok123" } })
      .expect(200);

    assert.ok(res.body.id, "Response must include an id");
    assert.equal(res.body.orgId, ORG_A_ID, "CMDB must be scoped to org-A");
    cmdbId = res.body.id;
  });

  test("org-B cannot GET org-A CMDB by id", async () => {
    await req
      .get(`/api/cmdbs/${cmdbId}`)
      .set("Authorization", `Bearer ${tokenB}`)
      .expect(404);
  });

  test("org-B cannot PATCH org-A CMDB", async () => {
    await req
      .patch(`/api/cmdbs/${cmdbId}`)
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ name: "Hijacked CMDB" })
      .expect(404);
  });

  test("org-B cannot DELETE org-A CMDB", async () => {
    await req
      .delete(`/api/cmdbs/${cmdbId}`)
      .set("Authorization", `Bearer ${tokenB}`)
      .expect(404);
  });

  test("org-A can still read its own CMDB", async () => {
    const res = await req
      .get(`/api/cmdbs/${cmdbId}`)
      .set("Authorization", `Bearer ${tokenA}`)
      .expect(200);

    assert.equal(res.body.id, cmdbId);
    assert.equal(res.body.name, "Tenant A NetBox");
  });
});

// ---------------------------------------------------------------------------
// List endpoints must not bleed across orgs
// ---------------------------------------------------------------------------

describe("Cross-tenant isolation — list endpoints", () => {
  let notifIdA: string;
  let notifIdB: string;

  test("org-A and org-B each create a notification", async () => {
    const resA = await req
      .post("/api/notifications")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ name: "Alpha-only notification", type: "webhook", webhookUrl: "https://a.example" })
      .expect(200);
    notifIdA = resA.body.id;

    const resB = await req
      .post("/api/notifications")
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ name: "Beta-only notification", type: "webhook", webhookUrl: "https://b.example" })
      .expect(200);
    notifIdB = resB.body.id;

    assert.ok(notifIdA, "org-A notification id must be set");
    assert.ok(notifIdB, "org-B notification id must be set");
  });

  test("org-A list does not contain org-B notification", async () => {
    const res = await req
      .get("/api/notifications")
      .set("Authorization", `Bearer ${tokenA}`)
      .expect(200);

    const ids: string[] = res.body.map((n: { id: string }) => n.id);
    assert.ok(!ids.includes(notifIdB), "org-A list must not include org-B notification");
    assert.ok(ids.includes(notifIdA), "org-A list must include org-A notification");
  });

  test("org-B list does not contain org-A notification", async () => {
    const res = await req
      .get("/api/notifications")
      .set("Authorization", `Bearer ${tokenB}`)
      .expect(200);

    const ids: string[] = res.body.map((n: { id: string }) => n.id);
    assert.ok(!ids.includes(notifIdA), "org-B list must not include org-A notification");
    assert.ok(ids.includes(notifIdB), "org-B list must include org-B notification");
  });
});

// ---------------------------------------------------------------------------
// Job runs — org-A runs must not be visible to org-B
// ---------------------------------------------------------------------------

describe("Cross-tenant isolation — job runs", () => {
  let projectId: string;
  let templateId: string;
  let runId: string;

  test("org-A creates a project and template", async () => {
    const projRes = await req
      .post("/api/projects")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ name: "Isolation Test Project", gitUrl: "https://github.com/test/repo.git", gitRef: "main" })
      .expect(200);
    projectId = projRes.body.id;
    assert.ok(projectId, "Project id must be set");

    const tmplRes = await req
      .post("/api/templates")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ name: "Isolation Template", projectId, playbook: "site.yml" })
      .expect(200);
    templateId = tmplRes.body.id;
    assert.ok(templateId, "Template id must be set");
  });

  test("org-A launches a job — run is created with org-A scope", async () => {
    const launchRes = await req
      .post(`/api/templates/${templateId}/launch`)
      .set("Authorization", `Bearer ${tokenA}`)
      .expect(200);

    runId = launchRes.body.id;
    assert.ok(runId, "Run id must be set");
    assert.equal(launchRes.body.orgId, ORG_A_ID, "Run must be scoped to org-A");

    // Allow the setImmediate dispatch (local runner + notifications) to complete
    // before the test ends, so no async activity leaks past this test boundary.
    await new Promise((r) => setTimeout(r, 500));
  });

  test("org-B cannot GET org-A job run by id", async () => {
    await req
      .get(`/api/runs/${runId}`)
      .set("Authorization", `Bearer ${tokenB}`)
      .expect(404);
  });

  test("org-B run list does not contain org-A job run", async () => {
    const res = await req
      .get("/api/runs")
      .set("Authorization", `Bearer ${tokenB}`)
      .expect(200);

    const ids: string[] = res.body.map((r: { id: string }) => r.id);
    assert.ok(!ids.includes(runId), "org-B run list must not include org-A job run");
  });

  test("org-A can still GET its own job run", async () => {
    const res = await req
      .get(`/api/runs/${runId}`)
      .set("Authorization", `Bearer ${tokenA}`)
      .expect(200);

    assert.equal(res.body.id, runId);
    assert.equal(res.body.orgId, ORG_A_ID);
  });

  test("org-A run list contains its own job run", async () => {
    const res = await req
      .get("/api/runs")
      .set("Authorization", `Bearer ${tokenA}`)
      .expect(200);

    const ids: string[] = res.body.map((r: { id: string }) => r.id);
    assert.ok(ids.includes(runId), "org-A run list must include its own job run");
  });
});

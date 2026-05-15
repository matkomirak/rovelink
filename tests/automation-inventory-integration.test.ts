/**
 * Automation Inventory Route Integration Tests
 *
 * Tests real Express routes against a real PostgreSQL database.
 * Verifies tenant isolation, role enforcement, and linked-CMDB
 * pre-insert validation on the actual route handlers.
 *
 * REQUIRES: DATABASE_URL environment variable pointing at a real PostgreSQL DB.
 * Run with: npm run test:integration
 *
 * These tests do NOT run as part of npm test (which is DB-free).
 */

if (!process.env.DATABASE_URL) {
  throw new Error(
    "\n[automation-inventory-integration] DATABASE_URL is required for integration tests.\n" +
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
import { organizations, users, automationInventories, cmdbAccounts } from "../shared/schema";
import { eq, and } from "drizzle-orm";
import type { Server } from "http";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";

const ORG_A_ID = "test-inv-org-alpha";
const ORG_B_ID = "test-inv-org-beta";
const USER_A_ID = `test-user-${ORG_A_ID}`;
const USER_B_ID = `test-user-${ORG_B_ID}`;
const CMDB_A_ID = "test-cmdb-alpha";
const CMDB_B_ID = "test-cmdb-beta";

function makeToken(orgId: string, userId: string, role = "admin"): string {
  return jwt.sign({ userId, username: `user-${orgId}`, role, orgId }, JWT_SECRET, { expiresIn: "1h" });
}

const tokenA = makeToken(ORG_A_ID, USER_A_ID);
const tokenB = makeToken(ORG_B_ID, USER_B_ID);
const tokenAViewer = makeToken(ORG_A_ID, USER_A_ID, "viewer");
const tokenAOperator = makeToken(ORG_A_ID, USER_A_ID, "operator");
const tokenAPlatformAdmin = makeToken(ORG_A_ID, USER_A_ID, "platform_admin");

let server: Server;
let req: ReturnType<typeof supertest>;

// IDs for created inventories — set in before() and used across tests
let invAId: string;
let invBId: string;

async function cleanup() {
  await db.delete(automationInventories).where(eq(automationInventories.orgId, ORG_A_ID)).catch(() => {});
  await db.delete(automationInventories).where(eq(automationInventories.orgId, ORG_B_ID)).catch(() => {});
  await db.delete(cmdbAccounts).where(eq(cmdbAccounts.id, CMDB_A_ID)).catch(() => {});
  await db.delete(cmdbAccounts).where(eq(cmdbAccounts.id, CMDB_B_ID)).catch(() => {});
  await db.delete(users).where(eq(users.id, USER_A_ID)).catch(() => {});
  await db.delete(users).where(eq(users.id, USER_B_ID)).catch(() => {});
  await db.delete(organizations).where(eq(organizations.id, ORG_A_ID)).catch(() => {});
  await db.delete(organizations).where(eq(organizations.id, ORG_B_ID)).catch(() => {});
}

before(async () => {
  await cleanup();

  await db.insert(organizations).values([
    { id: ORG_A_ID, name: "Test Inv Org Alpha", slug: "test-inv-org-alpha" },
    { id: ORG_B_ID, name: "Test Inv Org Beta",  slug: "test-inv-org-beta"  },
  ]).onConflictDoNothing();

  await db.insert(users).values([
    { id: USER_A_ID, username: `user-${ORG_A_ID}`, password: "test-no-auth", role: "admin", orgId: ORG_A_ID },
    { id: USER_B_ID, username: `user-${ORG_B_ID}`, password: "test-no-auth", role: "admin", orgId: ORG_B_ID },
  ]).onConflictDoNothing();

  // Seed CMDB accounts — one per org
  await db.insert(cmdbAccounts).values([
    { id: CMDB_A_ID, orgId: ORG_A_ID, name: "Alpha NetBox", type: "netbox", config: { url: "https://nb-a.example.com", token: "tok-a" } as any },
    { id: CMDB_B_ID, orgId: ORG_B_ID, name: "Beta NetBox",  type: "netbox", config: { url: "https://nb-b.example.com", token: "tok-b" } as any },
  ]).onConflictDoNothing();

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  server = await registerRoutes(app);
  req = supertest(app);

  // Create one file inventory per org via the actual route (verifies create path)
  const rA = await req
    .post("/api/inventories")
    .set("Authorization", `Bearer ${tokenA}`)
    .send({ name: "Alpha File Inv", type: "file", fileContent: "all:\n  hosts:\n    alpha-vm:\n", fileFormat: "yaml" });
  assert.equal(rA.status, 201, `org A inventory create failed: ${JSON.stringify(rA.body)}`);
  invAId = rA.body.id;

  const rB = await req
    .post("/api/inventories")
    .set("Authorization", `Bearer ${tokenB}`)
    .send({ name: "Beta File Inv", type: "file", fileContent: "all:\n  hosts:\n    beta-vm:\n", fileFormat: "yaml" });
  assert.equal(rB.status, 201, `org B inventory create failed: ${JSON.stringify(rB.body)}`);
  invBId = rB.body.id;
});

after(async () => {
  await cleanup();
  server?.close();
});

// ─── List route ───────────────────────────────────────────────────────────────

describe("GET /api/inventories — list route isolation", async () => {
  await test("org A only sees org A inventories", async () => {
    const r = await req.get("/api/inventories").set("Authorization", `Bearer ${tokenA}`);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body));
    assert.ok(r.body.every((i: any) => i.orgId === ORG_A_ID), "all items must belong to org A");
    assert.ok(r.body.some((i: any) => i.id === invAId), "org A inventory must be in the list");
  });

  await test("org B items never appear in org A list", async () => {
    const r = await req.get("/api/inventories").set("Authorization", `Bearer ${tokenA}`);
    assert.equal(r.status, 200);
    assert.ok(!r.body.some((i: any) => i.orgId === ORG_B_ID), "org B items must not appear");
    assert.ok(!r.body.some((i: any) => i.id === invBId), "org B inventory ID must not appear");
  });
});

// ─── Detail route ─────────────────────────────────────────────────────────────

describe("GET /api/inventories/:id — detail route isolation", async () => {
  await test("org A can read its own inventory", async () => {
    const r = await req.get(`/api/inventories/${invAId}`).set("Authorization", `Bearer ${tokenA}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.id, invAId);
    assert.equal(r.body.orgId, ORG_A_ID);
  });

  await test("org A cannot read org B inventory — returns 404", async () => {
    const r = await req.get(`/api/inventories/${invBId}`).set("Authorization", `Bearer ${tokenA}`);
    assert.equal(r.status, 404);
  });

  await test("org B cannot read org A inventory — returns 404", async () => {
    const r = await req.get(`/api/inventories/${invAId}`).set("Authorization", `Bearer ${tokenB}`);
    assert.equal(r.status, 404);
  });
});

// ─── Create route ─────────────────────────────────────────────────────────────

describe("POST /api/inventories — create route isolation", async () => {
  await test("client-supplied orgId is ignored — inventory stamped with req.orgId", async () => {
    const r = await req
      .post("/api/inventories")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ name: "OrgId Injection", type: "file", fileContent: "all:\n  hosts:\n", fileFormat: "yaml", orgId: ORG_B_ID });
    assert.equal(r.status, 201);
    assert.equal(r.body.orgId, ORG_A_ID, "orgId must be stamped from JWT, not from body");
    assert.notEqual(r.body.orgId, ORG_B_ID);
    // cleanup
    await db.delete(automationInventories).where(eq(automationInventories.id, r.body.id));
  });

  await test("cross-org sourceRef is rejected — returns 404 and no dangling row is created", async () => {
    const countBefore = await db
      .select()
      .from(automationInventories)
      .where(eq(automationInventories.orgId, ORG_A_ID));

    const r = await req
      .post("/api/inventories")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ name: "Cross-org Linked", type: "linked", sourceRef: CMDB_B_ID, sourceType: "netbox" });

    assert.equal(r.status, 404, "cross-org CMDB sourceRef must return 404");

    const countAfter = await db
      .select()
      .from(automationInventories)
      .where(eq(automationInventories.orgId, ORG_A_ID));

    assert.equal(countAfter.length, countBefore.length, "no dangling inventory row should have been created");
  });

  await test("non-existent sourceRef is rejected — returns 404 and no dangling row is created", async () => {
    const countBefore = await db
      .select()
      .from(automationInventories)
      .where(eq(automationInventories.orgId, ORG_A_ID));

    const r = await req
      .post("/api/inventories")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ name: "Bad Linked", type: "linked", sourceRef: "cmdb-does-not-exist", sourceType: "netbox" });

    assert.equal(r.status, 404);

    const countAfter = await db
      .select()
      .from(automationInventories)
      .where(eq(automationInventories.orgId, ORG_A_ID));

    assert.equal(countAfter.length, countBefore.length, "no dangling row for invalid sourceRef");
  });

  await test("viewer cannot create inventory — returns 403", async () => {
    const r = await req
      .post("/api/inventories")
      .set("Authorization", `Bearer ${tokenAViewer}`)
      .send({ name: "Viewer Inv", type: "file", fileContent: "all:\n  hosts:\n", fileFormat: "yaml" });
    assert.equal(r.status, 403);
  });

  await test("operator cannot create inventory — returns 403", async () => {
    const r = await req
      .post("/api/inventories")
      .set("Authorization", `Bearer ${tokenAOperator}`)
      .send({ name: "Op Inv", type: "file", fileContent: "all:\n  hosts:\n", fileFormat: "yaml" });
    assert.equal(r.status, 403);
  });

  await test("platform_admin can create inventory", async () => {
    const r = await req
      .post("/api/inventories")
      .set("Authorization", `Bearer ${tokenAPlatformAdmin}`)
      .send({ name: "PA Inv", type: "file", fileContent: "all:\n  hosts:\n", fileFormat: "yaml" });
    assert.equal(r.status, 201);
    assert.equal(r.body.orgId, ORG_A_ID);
    await db.delete(automationInventories).where(eq(automationInventories.id, r.body.id));
  });
});

// ─── Update route ─────────────────────────────────────────────────────────────

describe("PATCH /api/inventories/:id — update route isolation", async () => {
  await test("org A can update its own inventory", async () => {
    const r = await req
      .patch(`/api/inventories/${invAId}`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ name: "Alpha Updated" });
    assert.equal(r.status, 200);
    assert.equal(r.body.name, "Alpha Updated");
  });

  await test("org A cannot update org B inventory — returns 404", async () => {
    const r = await req
      .patch(`/api/inventories/${invBId}`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ name: "Hijacked" });
    assert.equal(r.status, 404);
  });

  await test("PATCH cannot change orgId", async () => {
    await req
      .patch(`/api/inventories/${invAId}`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ orgId: ORG_B_ID, name: "Reassign Attempt" });

    const [row] = await db
      .select()
      .from(automationInventories)
      .where(eq(automationInventories.id, invAId));

    assert.equal(row.orgId, ORG_A_ID, "orgId must not change after PATCH");
  });

  await test("viewer cannot update inventory — returns 403", async () => {
    const r = await req
      .patch(`/api/inventories/${invAId}`)
      .set("Authorization", `Bearer ${tokenAViewer}`)
      .send({ name: "Viewer Edit" });
    assert.equal(r.status, 403);
  });
});

// ─── Delete route ─────────────────────────────────────────────────────────────

describe("DELETE /api/inventories/:id — delete route isolation", async () => {
  await test("org A cannot delete org B inventory — org B inventory survives", async () => {
    const r = await req
      .delete(`/api/inventories/${invBId}`)
      .set("Authorization", `Bearer ${tokenA}`);
    assert.equal(r.status, 404);

    const [stillThere] = await db
      .select()
      .from(automationInventories)
      .where(and(eq(automationInventories.id, invBId), eq(automationInventories.orgId, ORG_B_ID)));
    assert.ok(stillThere, "org B inventory must still exist");
  });

  await test("viewer cannot delete inventory — returns 403", async () => {
    const r = await req
      .delete(`/api/inventories/${invAId}`)
      .set("Authorization", `Bearer ${tokenAViewer}`);
    assert.equal(r.status, 403);
  });
});

// ─── Refresh route ────────────────────────────────────────────────────────────

describe("POST /api/inventories/:id/refresh — refresh route isolation", async () => {
  await test("org A cannot refresh org B inventory — returns 404", async () => {
    const r = await req
      .post(`/api/inventories/${invBId}/refresh`)
      .set("Authorization", `Bearer ${tokenA}`);
    assert.equal(r.status, 404);
  });
});

// ─── Export/gate sub-routes ───────────────────────────────────────────────────

describe("Export and gate sub-routes — cross-org isolation", async () => {
  await test("org A cannot access org B automation.yml — returns 404", async () => {
    const r = await req
      .get(`/api/inventories/${invBId}/automation.yml`)
      .set("Authorization", `Bearer ${tokenA}`);
    assert.equal(r.status, 404);
  });

  await test("org A cannot access org B blocked.json — returns 404", async () => {
    const r = await req
      .get(`/api/inventories/${invBId}/blocked.json`)
      .set("Authorization", `Bearer ${tokenA}`);
    assert.equal(r.status, 404);
  });

  await test("org A cannot access org B gate-stats — returns 404", async () => {
    const r = await req
      .get(`/api/inventories/${invBId}/gate-stats`)
      .set("Authorization", `Bearer ${tokenA}`);
    assert.equal(r.status, 404);
  });

  await test("org A cannot access org B preview — returns 404", async () => {
    const r = await req
      .get(`/api/inventories/${invBId}/preview`)
      .set("Authorization", `Bearer ${tokenA}`);
    assert.equal(r.status, 404);
  });

  await test("org A cannot access org B structure — returns 404", async () => {
    const r = await req
      .get(`/api/inventories/${invBId}/structure`)
      .set("Authorization", `Bearer ${tokenA}`);
    assert.equal(r.status, 404);
  });

  await test("org A cannot access org B policy — returns 404", async () => {
    const r = await req
      .get(`/api/inventories/${invBId}/policy`)
      .set("Authorization", `Bearer ${tokenA}`);
    assert.equal(r.status, 404);
  });
});

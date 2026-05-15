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

describe("Health endpoint — no auth required", () => {
  test("GET /api/health returns 200 without a token", async () => {
    const res = await req.get("/api/health").expect(200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.service, "rovelink");
    assert.ok(typeof res.body.timestamp === "string");
  });
});

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
});

describe("Credential routes — role enforcement", () => {
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

describe("Job template launch — role enforcement", () => {
  test("POST /api/templates/:id/launch as viewer returns 403", async () => {
    await req
      .post("/api/templates/nonexistent/launch")
      .set("Authorization", `Bearer ${makeToken("viewer")}`)
      .expect(403);
  });

  test("POST /api/templates/:id/launch without token returns 401", async () => {
    await req.post("/api/templates/nonexistent/launch").expect(401);
  });
});

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
});

describe("Settings — role enforcement", () => {
  test("POST /api/settings as viewer returns 403", async () => {
    await req
      .post("/api/settings")
      .set("Authorization", `Bearer ${makeToken("viewer")}`)
      .send({ netboxUrl: "http://test" })
      .expect(403);
  });
});

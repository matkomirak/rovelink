/**
 * Authorization and role-based access control tests.
 * Tests gate auth, role checks, and unauthenticated access.
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";

function makeToken(role: string, userId = "test-user", orgId = "test-org") {
  return jwt.sign({ userId, username: `test-${role}`, role, orgId }, JWT_SECRET, { expiresIn: "1h" });
}

// Lightweight test server that reuses the real Express app
async function buildApp() {
  const { createServer } = await import("../server/index");
  return (createServer as any)?.app ?? null;
}

describe("Health endpoint — no auth required", () => {
  it("GET /api/health returns 200 without a token", async () => {
    const res = await fetch("http://localhost:5000/api/health");
    assert.equal(res.status, 200);
    const ct = res.headers.get("content-type") ?? "";
    assert.ok(ct.includes("application/json"), `Expected JSON content-type, got: ${ct}`);
    const text = await res.text();
    const body = JSON.parse(text) as any;
    assert.equal(body.ok, true);
    assert.equal(body.service, "rovelink");
    assert.ok(typeof body.timestamp === "string");
  });
});

describe("Gate routes — authentication required", () => {
  it("GET /api/gate/allowed without token returns 401", async () => {
    const res = await fetch("http://localhost:5000/api/gate/allowed");
    assert.equal(res.status, 401);
  });

  it("GET /api/gate/blocked without token returns 401", async () => {
    const res = await fetch("http://localhost:5000/api/gate/blocked");
    assert.equal(res.status, 401);
  });

  it("GET /api/gate/summary without token returns 401", async () => {
    const res = await fetch("http://localhost:5000/api/gate/summary");
    assert.equal(res.status, 401);
  });

  it("POST /api/gate/sync-blocks without token returns 401", async () => {
    const res = await fetch("http://localhost:5000/api/gate/sync-blocks", { method: "POST" });
    assert.equal(res.status, 401);
  });

  it("GET /api/gate/allowed as viewer returns 200", async () => {
    const token = makeToken("viewer");
    const res = await fetch("http://localhost:5000/api/gate/allowed", {
      headers: { Authorization: `Bearer ${token}` },
    });
    // 200 or 500 (no NetBox configured) — but NOT 401/403
    assert.ok(res.status !== 401 && res.status !== 403, `Expected not 401/403, got ${res.status}`);
  });

  it("POST /api/gate/sync-blocks as viewer returns 403", async () => {
    const token = makeToken("viewer");
    const res = await fetch("http://localhost:5000/api/gate/sync-blocks", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 403);
  });

  it("POST /api/gate/sync-blocks as admin succeeds (not 401/403)", async () => {
    const token = makeToken("admin");
    const res = await fetch("http://localhost:5000/api/gate/sync-blocks", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.ok(res.status !== 401 && res.status !== 403, `Expected not 401/403, got ${res.status}`);
  });
});

describe("Credential routes — role enforcement", () => {
  it("POST /api/credentials as viewer returns 403", async () => {
    const token = makeToken("viewer");
    const res = await fetch("http://localhost:5000/api/credentials", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test", kind: "ssh", username: "u", privateKey: "k" }),
    });
    assert.equal(res.status, 403);
  });

  it("POST /api/credentials as operator returns 403", async () => {
    const token = makeToken("operator");
    const res = await fetch("http://localhost:5000/api/credentials", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test", kind: "ssh", username: "u", privateKey: "k" }),
    });
    assert.equal(res.status, 403);
  });

  it("POST /api/credentials without token returns 401", async () => {
    const res = await fetch("http://localhost:5000/api/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test" }),
    });
    assert.equal(res.status, 401);
  });
});

describe("Job template launch — role enforcement", () => {
  it("POST /api/templates/:id/launch as viewer returns 403", async () => {
    const token = makeToken("viewer");
    const res = await fetch("http://localhost:5000/api/templates/nonexistent-id/launch", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    assert.equal(res.status, 403);
  });

  it("POST /api/templates/:id/launch without token returns 401", async () => {
    const res = await fetch("http://localhost:5000/api/templates/nonexistent-id/launch", {
      method: "POST",
    });
    assert.equal(res.status, 401);
  });
});

describe("Projects — role enforcement", () => {
  it("POST /api/projects without token returns 401", async () => {
    const res = await fetch("http://localhost:5000/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test", gitUrl: "https://github.com/test/test.git" }),
    });
    assert.equal(res.status, 401);
  });

  it("POST /api/projects as viewer returns 403", async () => {
    const token = makeToken("viewer");
    const res = await fetch("http://localhost:5000/api/projects", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test", gitUrl: "https://github.com/test/test.git" }),
    });
    assert.equal(res.status, 403);
  });
});

describe("Settings — role enforcement", () => {
  it("POST /api/settings as viewer returns 403", async () => {
    const token = makeToken("viewer");
    const res = await fetch("http://localhost:5000/api/settings", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ netboxUrl: "http://netbox.example.com" }),
    });
    assert.equal(res.status, 403);
  });
});

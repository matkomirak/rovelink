import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import supertest from "supertest";
import { registerRoutes } from "../server/routes";
import { storage } from "../server/storage";
import { NetBoxAdapter } from "../server/services/netbox-adapter";
import type { CmdbAccount, NetboxVm } from "../shared/schema";
import type { Server } from "http";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";
const ORG_A = "org-cmdb-browser-alpha";
const ORG_B = "org-cmdb-browser-beta";

function makeToken(orgId: string, role = "viewer") {
  return jwt.sign(
    { userId: `user-${orgId}-${role}`, username: `${role}-${orgId}`, role, orgId },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

const cmdbA: CmdbAccount = {
  id: "cmdb-alpha",
  orgId: ORG_A,
  kind: "netbox",
  name: "Alpha NetBox",
  enabled: true,
  config: { url: "https://netbox.alpha.test", token: "super-secret-token" },
  cachedData: {},
  lastValidatedAt: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

const cmdbB: CmdbAccount = {
  ...cmdbA,
  id: "cmdb-beta",
  orgId: ORG_B,
  name: "Beta NetBox",
};

const netboxVms = [
  {
    id: 101,
    name: "alpha-app-001",
    status: { value: "active", label: "Active" },
    platform: { id: 1, name: "linux" },
    primary_ip4: { id: 11, address: "10.10.10.10/32" },
    tenant: { id: 20, name: "Engineering" },
    cluster: { id: 30, name: "Lab Cluster" },
    site: { id: 40, name: "Lab Site" },
    role: { id: 50, name: "Application" },
    vcpus: 2,
    memory: 4096,
    tags: [{ name: "demo" }],
    custom_fields: { automatable: true },
    token: "must-not-leak",
  },
];

const cachedNetboxVms: NetboxVm[] = [
  {
    id: "cached-alpha-vm-101",
    sourceId: cmdbA.id,
    netboxId: 101,
    name: "alpha-app-001",
    ip: "10.10.10.10",
    operatingSystem: "Linux",
    customFields: {
      automatable: true,
      tenant: "Engineering",
      role: "Application",
      api_key: "cached-api-key-must-not-leak",
    },
    tags: ["demo"],
    lastImportedAt: new Date("2026-01-02T00:00:00.000Z"),
  },
];

let cachedVmsForTest: NetboxVm[] = [];
let liveListCalls = 0;

const original = {
  getUser: storage.getUser,
  getCmdbAccount: storage.getCmdbAccount,
  getCmdbAccounts: storage.getCmdbAccounts,
  getNetboxVms: storage.getNetboxVms,
  listAllVms: NetBoxAdapter.prototype.listAllVms,
};

let server: Server;
let req: ReturnType<typeof supertest>;

before(async () => {
  storage.getUser = async (id: string) => ({
    id,
    username: id,
    password: "unused",
    role: id.includes("admin") ? "admin" : "viewer",
    orgId: id.includes(ORG_B) ? ORG_B : ORG_A,
    createdAt: new Date(),
  });
  storage.getCmdbAccount = async (id: string, orgId: string) => {
    const account = [cmdbA, cmdbB].find((candidate) => candidate.id === id && candidate.orgId === orgId);
    return account;
  };
  storage.getCmdbAccounts = async (orgId: string) => [cmdbA, cmdbB].filter((candidate) => candidate.orgId === orgId);
  storage.getNetboxVms = async (orgId: string) => orgId === ORG_A ? cachedVmsForTest : [];
  NetBoxAdapter.prototype.listAllVms = async () => {
    liveListCalls += 1;
    return netboxVms;
  };

  const app = express();
  app.use(cookieParser());
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: false }));
  server = await registerRoutes(app);
  req = supertest(server);
});

beforeEach(() => {
  cachedVmsForTest = [];
  liveListCalls = 0;
});

after(async () => {
  storage.getUser = original.getUser;
  storage.getCmdbAccount = original.getCmdbAccount;
  storage.getCmdbAccounts = original.getCmdbAccounts;
  storage.getNetboxVms = original.getNetboxVms;
  NetBoxAdapter.prototype.listAllVms = original.listAllVms;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("CMDB object browser routes", () => {
  test("viewer can list object types for own CMDB", async () => {
    const res = await req
      .get(`/api/cmdbs/${cmdbA.id}/object-types`)
      .set("Authorization", `Bearer ${makeToken(ORG_A)}`)
      .expect(200);

    assert.equal(res.body.objectTypes.length, 1);
    assert.equal(res.body.objectTypes[0].objectType, "netbox_vm");
    assert.equal(res.body.objectTypes[0].name, "Virtual Machines");
  });

  test("object types report cached VM count and cached mode", async () => {
    cachedVmsForTest = cachedNetboxVms;

    const res = await req
      .get(`/api/cmdbs/${cmdbA.id}/object-types`)
      .set("Authorization", `Bearer ${makeToken(ORG_A)}`)
      .expect(200);

    assert.equal(res.body.objectTypes[0].count, 1);
    assert.equal(res.body.objectTypes[0].status, "cached");
    assert.equal(res.body.objectTypes[0].mode, "cached");
  });

  test("viewer can list NetBox VM objects for own CMDB without secrets", async () => {
    const res = await req
      .get(`/api/cmdbs/${cmdbA.id}/objects/netbox_vm`)
      .set("Authorization", `Bearer ${makeToken(ORG_A)}`)
      .expect(200);

    assert.equal(res.body.total, 1);
    assert.equal(res.body.mode, "live");
    assert.equal(res.body.objects[0].name, "alpha-app-001");
    assert.equal(res.body.objects[0].raw.token, "[REDACTED]");
    assert.ok(!JSON.stringify(res.body).includes("super-secret-token"));
    assert.ok(!JSON.stringify(res.body).includes("must-not-leak"));
  });

  test("object list returns cached VMs when cache exists without calling live NetBox", async () => {
    cachedVmsForTest = cachedNetboxVms;

    const res = await req
      .get(`/api/cmdbs/${cmdbA.id}/objects/netbox_vm`)
      .set("Authorization", `Bearer ${makeToken(ORG_A)}`)
      .expect(200);

    assert.equal(res.body.mode, "cached");
    assert.equal(res.body.total, 1);
    assert.equal(res.body.objects[0].id, 101);
    assert.equal(res.body.objects[0].name, "alpha-app-001");
    assert.equal(res.body.objects[0].primary_ip.address, "10.10.10.10");
    assert.equal(res.body.objects[0].custom_fields.api_key, "[REDACTED]");
    assert.equal(res.body.objects[0].raw.customFields.api_key, "[REDACTED]");
    assert.ok(!JSON.stringify(res.body).includes("cached-api-key-must-not-leak"));
    assert.equal(liveListCalls, 0);
  });

  test("viewer can open NetBox VM detail for own CMDB", async () => {
    const res = await req
      .get(`/api/cmdbs/${cmdbA.id}/objects/netbox_vm/101`)
      .set("Authorization", `Bearer ${makeToken(ORG_A)}`)
      .expect(200);

    assert.equal(res.body.object.name, "alpha-app-001");
    assert.equal(res.body.object.raw.token, "[REDACTED]");
  });

  test("object detail returns cached VM when cache exists without calling live NetBox", async () => {
    cachedVmsForTest = cachedNetboxVms;

    const res = await req
      .get(`/api/cmdbs/${cmdbA.id}/objects/netbox_vm/101`)
      .set("Authorization", `Bearer ${makeToken(ORG_A)}`)
      .expect(200);

    assert.equal(res.body.mode, "cached");
    assert.equal(res.body.object.id, 101);
    assert.equal(res.body.object.name, "alpha-app-001");
    assert.equal(res.body.object.custom_fields.api_key, "[REDACTED]");
    assert.equal(res.body.object.raw.customFields.api_key, "[REDACTED]");
    assert.ok(!JSON.stringify(res.body).includes("cached-api-key-must-not-leak"));
    assert.equal(liveListCalls, 0);
  });

  test("cross-org CMDB object access is rejected", async () => {
    await req
      .get(`/api/cmdbs/${cmdbA.id}/object-types`)
      .set("Authorization", `Bearer ${makeToken(ORG_B)}`)
      .expect(404);
  });

  test("unsupported object type returns a clear 400", async () => {
    const res = await req
      .get(`/api/cmdbs/${cmdbA.id}/objects/devices`)
      .set("Authorization", `Bearer ${makeToken(ORG_A)}`)
      .expect(400);

    assert.match(res.body.message, /Unsupported CMDB object type/);
  });
});

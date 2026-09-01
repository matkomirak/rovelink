import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import supertest from "supertest";
import { registerRoutes } from "../server/routes";
import { storage } from "../server/storage";
import { NetBoxAdapter } from "../server/services/netbox-adapter";
import type {
  CmdbAccount,
  CustomerScope,
  CustomerScopeObjectAssignment,
  GovernanceEvaluationRun,
  GovernanceObjectEvaluation,
  NetboxVm,
} from "../shared/schema";
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

const cachedNetboxVm102: NetboxVm = {
  ...cachedNetboxVms[0],
  id: "cached-alpha-vm-102",
  netboxId: 102,
  name: "alpha-unassigned-001",
};

const cachedNetboxVm103: NetboxVm = {
  ...cachedNetboxVms[0],
  id: "cached-alpha-vm-103",
  netboxId: 103,
  name: "alpha-engineering-unevaluated",
};

const customerScopesForTest: CustomerScope[] = [
  {
    id: "scope-alpha-engineering",
    orgId: ORG_A,
    sourceType: "netbox_inventory_source",
    sourceId: cmdbA.id,
    externalId: "20",
    name: "Engineering",
    displayName: "Engineering Team",
    strategy: "tenant",
    isolation: "assignment",
    parentExternalId: null,
    metadata: {
      provider: "netbox",
      slug: "engineering",
      token: "scope-token-must-not-leak",
    },
    lastSyncedAt: new Date("2026-01-03T00:00:00.000Z"),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-03T00:00:00.000Z"),
  },
  {
    id: "scope-alpha-finance-secondary",
    orgId: ORG_A,
    sourceType: "netbox_inventory_source",
    sourceId: "cmdb-alpha-secondary",
    externalId: "21",
    name: "Finance",
    displayName: null,
    strategy: "tenant",
    isolation: "assignment",
    parentExternalId: null,
    metadata: { provider: "netbox" },
    lastSyncedAt: new Date("2026-01-03T00:00:00.000Z"),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-03T00:00:00.000Z"),
  },
  {
    id: "scope-beta-engineering",
    orgId: ORG_B,
    sourceType: "netbox_inventory_source",
    sourceId: cmdbB.id,
    externalId: "20",
    name: "Engineering Beta",
    displayName: null,
    strategy: "tenant",
    isolation: "assignment",
    parentExternalId: null,
    metadata: { provider: "netbox" },
    lastSyncedAt: new Date("2026-01-03T00:00:00.000Z"),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-03T00:00:00.000Z"),
  },
];

const customerScopeAssignmentsForTest: CustomerScopeObjectAssignment[] = [
  {
    id: "assignment-alpha-engineering",
    orgId: ORG_A,
    sourceType: "netbox_inventory_source",
    sourceId: cmdbA.id,
    objectType: "netbox_vm",
    objectId: "cached-alpha-vm-101",
    customerScopeId: "scope-alpha-engineering",
    relationship: "dedicated",
    derivedFrom: "provider",
    confidence: "authoritative",
    metadata: {
      provider: "netbox",
      secret: "assignment-secret-must-not-leak",
    },
    lastSyncedAt: new Date("2026-01-03T00:00:00.000Z"),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-03T00:00:00.000Z"),
  },
  {
    id: "assignment-alpha-unassigned",
    orgId: ORG_A,
    sourceType: "netbox_inventory_source",
    sourceId: cmdbA.id,
    objectType: "netbox_vm",
    objectId: "cached-alpha-vm-102",
    customerScopeId: null,
    relationship: "unassigned",
    derivedFrom: "provider",
    confidence: "authoritative",
    metadata: { provider: "netbox" },
    lastSyncedAt: new Date("2026-01-04T00:00:00.000Z"),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-04T00:00:00.000Z"),
  },
  {
    id: "assignment-alpha-secondary",
    orgId: ORG_A,
    sourceType: "netbox_inventory_source",
    sourceId: "cmdb-alpha-secondary",
    objectType: "netbox_vm",
    objectId: "cached-secondary-vm-201",
    customerScopeId: "scope-alpha-finance-secondary",
    relationship: "dedicated",
    derivedFrom: "provider",
    confidence: "authoritative",
    metadata: { provider: "netbox" },
    lastSyncedAt: new Date("2026-01-03T00:00:00.000Z"),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-03T00:00:00.000Z"),
  },
  {
    id: "assignment-beta-engineering",
    orgId: ORG_B,
    sourceType: "netbox_inventory_source",
    sourceId: cmdbB.id,
    objectType: "netbox_vm",
    objectId: "cached-beta-vm-101",
    customerScopeId: "scope-beta-engineering",
    relationship: "dedicated",
    derivedFrom: "provider",
    confidence: "authoritative",
    metadata: { provider: "netbox" },
    lastSyncedAt: new Date("2026-01-03T00:00:00.000Z"),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-03T00:00:00.000Z"),
  },
];

function makeGovernanceRun(id: string, sourceId = cmdbA.id, orgId = ORG_A): GovernanceEvaluationRun {
  return {
    id,
    orgId,
    blueprintId: `blueprint-${id}`,
    blueprintVersionId: `version-${id}`,
    cmdbAccountId: null,
    netboxSourceId: sourceId,
    status: "ok",
    counts: {},
    error: null,
    startedAt: new Date("2026-01-05T00:00:00.000Z"),
    completedAt: new Date("2026-01-05T00:00:00.000Z"),
    createdAt: new Date("2026-01-05T00:00:00.000Z"),
  };
}

function makeGovernanceEvaluation(
  input: Partial<GovernanceObjectEvaluation> & { id: string; runId: string; objectId: string },
): GovernanceObjectEvaluation {
  const findings = input.findings ?? [];
  const recommendedActions = input.recommendedActions ?? [];
  return {
    orgId: ORG_A,
    blueprintId: `blueprint-${input.runId}`,
    blueprintVersionId: `version-${input.runId}`,
    objectType: "netbox_vm",
    externalId: "101",
    objectName: "alpha-app-001",
    governanceScore: 80,
    dataManagementScore: 80,
    ownershipScore: 80,
    relevanceWeightedPriority: 20,
    automationReady: true,
    result: {
      objectType: "netbox_vm",
      objectId: input.objectId,
      objectName: input.objectName ?? "alpha-app-001",
      scores: {
        governance: input.governanceScore ?? 80,
        dataManagement: input.dataManagementScore ?? 80,
        ownership: input.ownershipScore ?? 80,
        relevanceWeightedPriority: input.relevanceWeightedPriority ?? 20,
      },
      automationReadiness: {
        ready: input.automationReady ?? true,
        reasons: ["test"],
      },
      findings: findings as any,
      recommendedActions: recommendedActions as any,
    },
    objectSnapshot: { sourceId: cmdbA.id },
    evaluatedAt: new Date("2026-01-05T00:00:00.000Z"),
    ...input,
    findings,
    recommendedActions,
  };
}

let cachedVmsForTest: NetboxVm[] = [];
let customerScopesInTest: CustomerScope[] = [];
let customerScopeAssignmentsInTest: CustomerScopeObjectAssignment[] = [];
let governanceRunsInTest: GovernanceEvaluationRun[] = [];
let governanceObjectEvaluationsInTest: GovernanceObjectEvaluation[] = [];
let liveListCalls = 0;

const original = {
  getUser: storage.getUser,
  getCmdbAccount: storage.getCmdbAccount,
  getCmdbAccounts: storage.getCmdbAccounts,
  getNetboxVms: storage.getNetboxVms,
  listCustomerScopes: storage.listCustomerScopes,
  getCustomerScope: storage.getCustomerScope,
  listCustomerScopeObjectAssignments: storage.listCustomerScopeObjectAssignments,
  listAssignmentsForCustomerScope: storage.listAssignmentsForCustomerScope,
  listAssignmentsForObject: storage.listAssignmentsForObject,
  listLatestGovernanceEvaluationsForSourceObjects: storage.listLatestGovernanceEvaluationsForSourceObjects,
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
  storage.listCustomerScopes = async (orgId: string, sourceType?: string, sourceId?: string) => customerScopesInTest.filter((scope) => (
    scope.orgId === orgId &&
    (!sourceType || scope.sourceType === sourceType) &&
    (!sourceId || scope.sourceId === sourceId)
  ));
  storage.getCustomerScope = async (id: string, orgId: string) => customerScopesInTest.find((scope) => scope.id === id && scope.orgId === orgId);
  storage.listCustomerScopeObjectAssignments = async (orgId: string, sourceType?: string, sourceId?: string) => customerScopeAssignmentsInTest.filter((assignment) => (
    assignment.orgId === orgId &&
    (!sourceType || assignment.sourceType === sourceType) &&
    (!sourceId || assignment.sourceId === sourceId)
  ));
  storage.listAssignmentsForCustomerScope = async (orgId: string, customerScopeId: string) => {
    const scope = customerScopesInTest.find((candidate) => candidate.id === customerScopeId && candidate.orgId === orgId);
    if (!scope) return [];
    return customerScopeAssignmentsInTest.filter((assignment) => assignment.orgId === orgId && assignment.customerScopeId === customerScopeId);
  };
  storage.listAssignmentsForObject = async (
    orgId: string,
    sourceType: string,
    sourceId: string,
    objectType: string,
    objectId: string,
  ) => customerScopeAssignmentsInTest.filter((assignment) => (
    assignment.orgId === orgId &&
    assignment.sourceType === sourceType &&
    assignment.sourceId === sourceId &&
    assignment.objectType === objectType &&
    assignment.objectId === objectId
  ));
  storage.listLatestGovernanceEvaluationsForSourceObjects = async (
    orgId: string,
    sourceId: string,
    objectType: string,
    objectIds: string[],
  ) => {
    const objectIdSet = new Set(objectIds);
    const sourceRunIds = new Set(governanceRunsInTest
      .filter((run) => run.orgId === orgId && run.netboxSourceId === sourceId)
      .map((run) => run.id));
    const latestByObjectId = new Map<string, { evaluation: GovernanceObjectEvaluation; run: GovernanceEvaluationRun }>();
    for (const evaluation of governanceObjectEvaluationsInTest
      .filter((candidate) => (
        candidate.orgId === orgId &&
        candidate.objectType === objectType &&
        candidate.objectId &&
        objectIdSet.has(candidate.objectId) &&
        sourceRunIds.has(candidate.runId)
      ))
      .sort((a, b) => b.evaluatedAt.getTime() - a.evaluatedAt.getTime())) {
      if (!evaluation.objectId || latestByObjectId.has(evaluation.objectId)) continue;
      const run = governanceRunsInTest.find((candidate) => candidate.id === evaluation.runId)!;
      latestByObjectId.set(evaluation.objectId, { evaluation, run });
    }
    return Array.from(latestByObjectId.values());
  };
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
  customerScopesInTest = [];
  customerScopeAssignmentsInTest = [];
  governanceRunsInTest = [];
  governanceObjectEvaluationsInTest = [];
  liveListCalls = 0;
});

after(async () => {
  storage.getUser = original.getUser;
  storage.getCmdbAccount = original.getCmdbAccount;
  storage.getCmdbAccounts = original.getCmdbAccounts;
  storage.getNetboxVms = original.getNetboxVms;
  storage.listCustomerScopes = original.listCustomerScopes;
  storage.getCustomerScope = original.getCustomerScope;
  storage.listCustomerScopeObjectAssignments = original.listCustomerScopeObjectAssignments;
  storage.listAssignmentsForCustomerScope = original.listAssignmentsForCustomerScope;
  storage.listAssignmentsForObject = original.listAssignmentsForObject;
  storage.listLatestGovernanceEvaluationsForSourceObjects = original.listLatestGovernanceEvaluationsForSourceObjects;
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
    assert.equal(res.body.objects[0].localObjectId, "cached-alpha-vm-101");
    assert.equal(res.body.objects[0].cachedVmId, "cached-alpha-vm-101");
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
    assert.equal(res.body.object.localObjectId, "cached-alpha-vm-101");
    assert.equal(res.body.object.cachedVmId, "cached-alpha-vm-101");
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

  test("customer scope summary rejects cross-org CMDB access", async () => {
    await req
      .get(`/api/cmdbs/${cmdbA.id}/customer-scope-summary`)
      .set("Authorization", `Bearer ${makeToken(ORG_B)}`)
      .expect(404);
  });

  test("customer scope summary returns assigned and unassigned counts without secrets", async () => {
    customerScopesInTest = customerScopesForTest;
    customerScopeAssignmentsInTest = customerScopeAssignmentsForTest;

    const res = await req
      .get(`/api/cmdbs/${cmdbA.id}/customer-scope-summary`)
      .set("Authorization", `Bearer ${makeToken(ORG_A)}`)
      .expect(200);

    assert.equal(res.body.customerScopeCount, 1);
    assert.equal(res.body.assignedObjectCount, 1);
    assert.equal(res.body.unassignedObjectCount, 1);
    assert.equal(res.body.relationshipCounts.dedicated, 1);
    assert.equal(res.body.relationshipCounts.unassigned, 1);
    assert.equal(res.body.derivedFromCounts.provider, 2);
    assert.equal(res.body.confidenceCounts.authoritative, 2);
    assert.equal(res.body.latestLastSyncedAt, "2026-01-04T00:00:00.000Z");
    assert.ok(!JSON.stringify(res.body).includes("super-secret-token"));
  });

  test("customer scope list returns only scopes for selected CMDB source", async () => {
    customerScopesInTest = customerScopesForTest;
    customerScopeAssignmentsInTest = customerScopeAssignmentsForTest;

    const res = await req
      .get(`/api/cmdbs/${cmdbA.id}/customer-scopes`)
      .set("Authorization", `Bearer ${makeToken(ORG_A)}`)
      .expect(200);

    assert.equal(res.body.length, 1);
    assert.equal(res.body[0].id, "scope-alpha-engineering");
    assert.equal(res.body[0].assignmentCount, 1);
    assert.equal(res.body[0].relationshipCounts.dedicated, 1);
    assert.equal(res.body[0].metadata.token, "[REDACTED]");
    assert.ok(!JSON.stringify(res.body).includes("scope-token-must-not-leak"));
    assert.ok(!JSON.stringify(res.body).includes("scope-alpha-finance-secondary"));
    assert.ok(!JSON.stringify(res.body).includes("scope-beta-engineering"));
  });

  test("customer scope detail rejects scope from another org or source", async () => {
    customerScopesInTest = customerScopesForTest;
    customerScopeAssignmentsInTest = customerScopeAssignmentsForTest;

    await req
      .get(`/api/cmdbs/${cmdbA.id}/customer-scopes/scope-beta-engineering`)
      .set("Authorization", `Bearer ${makeToken(ORG_A)}`)
      .expect(404);

    await req
      .get(`/api/cmdbs/${cmdbA.id}/customer-scopes/scope-alpha-finance-secondary`)
      .set("Authorization", `Bearer ${makeToken(ORG_A)}`)
      .expect(404);
  });

  test("customer scope detail returns scope and source-scoped assignments without secrets", async () => {
    customerScopesInTest = customerScopesForTest;
    customerScopeAssignmentsInTest = customerScopeAssignmentsForTest;

    const res = await req
      .get(`/api/cmdbs/${cmdbA.id}/customer-scopes/scope-alpha-engineering`)
      .set("Authorization", `Bearer ${makeToken(ORG_A)}`)
      .expect(200);

    assert.equal(res.body.scope.id, "scope-alpha-engineering");
    assert.equal(res.body.scope.metadata.token, "[REDACTED]");
    assert.equal(res.body.assignments.length, 1);
    assert.equal(res.body.assignments[0].objectId, "cached-alpha-vm-101");
    assert.equal(res.body.assignments[0].relationship, "dedicated");
    assert.equal(res.body.assignments[0].metadata.secret, "[REDACTED]");
    assert.ok(!JSON.stringify(res.body).includes("scope-token-must-not-leak"));
    assert.ok(!JSON.stringify(res.body).includes("assignment-secret-must-not-leak"));
  });

  test("customer scope governance summary rejects CustomerScope from another org or source", async () => {
    customerScopesInTest = customerScopesForTest;
    customerScopeAssignmentsInTest = customerScopeAssignmentsForTest;

    await req
      .get(`/api/cmdbs/${cmdbA.id}/customer-scopes/scope-beta-engineering/governance-summary`)
      .set("Authorization", `Bearer ${makeToken(ORG_A)}`)
      .expect(404);

    await req
      .get(`/api/cmdbs/${cmdbA.id}/customer-scopes/scope-alpha-finance-secondary/governance-summary`)
      .set("Authorization", `Bearer ${makeToken(ORG_A)}`)
      .expect(404);
  });

  test("customer scope governance summary rejects cross-org CMDB access", async () => {
    await req
      .get(`/api/cmdbs/${cmdbA.id}/customer-scopes/scope-alpha-engineering/governance-summary`)
      .set("Authorization", `Bearer ${makeToken(ORG_B)}`)
      .expect(404);
  });

  test("customer scope governance summary aggregates latest local VM evaluations", async () => {
    cachedVmsForTest = [cachedNetboxVms[0], cachedNetboxVm103];
    customerScopesInTest = customerScopesForTest;
    customerScopeAssignmentsInTest = [
      customerScopeAssignmentsForTest[0],
      {
        ...customerScopeAssignmentsForTest[0],
        id: "assignment-alpha-engineering-unevaluated",
        objectId: "cached-alpha-vm-103",
        updatedAt: new Date("2026-01-04T00:00:00.000Z"),
      },
      {
        ...customerScopeAssignmentsForTest[0],
        id: "assignment-alpha-engineering-netbox-id",
        objectId: "101",
        updatedAt: new Date("2026-01-05T00:00:00.000Z"),
      },
      {
        ...customerScopeAssignmentsForTest[0],
        id: "assignment-alpha-engineering-name",
        objectId: "alpha-app-001",
        updatedAt: new Date("2026-01-05T00:00:00.000Z"),
      },
      customerScopeAssignmentsForTest[2],
    ];
    governanceRunsInTest = [
      makeGovernanceRun("run-old"),
      makeGovernanceRun("run-new"),
      makeGovernanceRun("run-secondary", "cmdb-alpha-secondary"),
    ];
    governanceObjectEvaluationsInTest = [
      makeGovernanceEvaluation({
        id: "eval-old",
        runId: "run-old",
        objectId: "cached-alpha-vm-101",
        governanceScore: 20,
        automationReady: false,
        recommendedActions: ["block_automation"],
        findings: [{ layer: "data_management", severity: "warning", code: "OLD_FINDING", fieldKey: "tenant", message: "old", recommendedActions: ["report"] }],
        evaluatedAt: new Date("2026-01-05T00:00:00.000Z"),
      }),
      makeGovernanceEvaluation({
        id: "eval-new",
        runId: "run-new",
        objectId: "cached-alpha-vm-101",
        governanceScore: 90,
        automationReady: true,
        recommendedActions: ["report"],
        findings: [
          { layer: "automation_readiness", severity: "blocker", code: "BLOCKER_FINDING", message: "blocker", recommendedActions: ["block_automation"] },
          { layer: "data_management", severity: "warning", code: "CUSTOMER_SCOPE_MISSING", fieldKey: "customerAssignments", message: "missing", recommendedActions: ["report"] },
        ],
        evaluatedAt: new Date("2026-01-06T00:00:00.000Z"),
      }),
      makeGovernanceEvaluation({
        id: "eval-netbox-id",
        runId: "run-new",
        objectId: "101",
        governanceScore: 1,
        automationReady: false,
        recommendedActions: ["block_automation"],
        findings: [{ layer: "data_management", severity: "blocker", code: "WRONG_ID", message: "wrong", recommendedActions: ["block_automation"] }],
        evaluatedAt: new Date("2026-01-07T00:00:00.000Z"),
      }),
      makeGovernanceEvaluation({
        id: "eval-secondary",
        runId: "run-secondary",
        objectId: "cached-alpha-vm-101",
        governanceScore: 2,
        automationReady: false,
        recommendedActions: ["block_automation"],
        findings: [{ layer: "data_management", severity: "blocker", code: "WRONG_SOURCE", message: "wrong source", recommendedActions: ["block_automation"] }],
        evaluatedAt: new Date("2026-01-08T00:00:00.000Z"),
      }),
    ];

    const res = await req
      .get(`/api/cmdbs/${cmdbA.id}/customer-scopes/scope-alpha-engineering/governance-summary`)
      .set("Authorization", `Bearer ${makeToken(ORG_A)}`)
      .expect(200);

    assert.equal(res.body.sourceId, cmdbA.id);
    assert.equal(res.body.customerScopeId, "scope-alpha-engineering");
    assert.equal(res.body.customerScopeName, "Engineering Team");
    assert.equal(res.body.objectType, "netbox_vm");
    assert.equal(res.body.objectCount, 2);
    assert.equal(res.body.assignedObjectCount, 2);
    assert.equal(res.body.unassignedObjectCount, 0);
    assert.equal(res.body.evaluatedObjectCount, 1);
    assert.equal(res.body.unevaluatedObjectCount, 1);
    assert.equal(res.body.latestEvaluationRunId, "run-new");
    assert.equal(res.body.latestEvaluatedAt, "2026-01-06T00:00:00.000Z");
    assert.equal(res.body.averageGovernanceScore, 90);
    assert.equal(res.body.readyCount, 1);
    assert.equal(res.body.notReadyCount, 0);
    assert.equal(res.body.blockAutomationRecommendationCount, 0);
    assert.equal(res.body.findingCounts.CUSTOMER_SCOPE_MISSING, 1);
    assert.equal(res.body.findingCounts.OLD_FINDING, undefined);
    assert.equal(res.body.findingCounts.WRONG_ID, undefined);
    assert.equal(res.body.findingCounts.WRONG_SOURCE, undefined);
    assert.equal(res.body.topFindings[0].code, "BLOCKER_FINDING");
    assert.ok(!JSON.stringify(res.body).includes("super-secret-token"));
    assert.ok(!JSON.stringify(res.body).includes("cached-api-key-must-not-leak"));
  });

  test("unassigned governance summary aggregates null CustomerScope assignments", async () => {
    cachedVmsForTest = [cachedNetboxVms[0], cachedNetboxVm102];
    customerScopesInTest = customerScopesForTest;
    customerScopeAssignmentsInTest = customerScopeAssignmentsForTest;
    governanceRunsInTest = [makeGovernanceRun("run-unassigned")];
    governanceObjectEvaluationsInTest = [
      makeGovernanceEvaluation({
        id: "eval-unassigned",
        runId: "run-unassigned",
        objectId: "cached-alpha-vm-102",
        governanceScore: 70,
        automationReady: false,
        recommendedActions: ["block_automation", "validate"],
        findings: [
          { layer: "data_management", severity: "warning", code: "CUSTOMER_ASSIGNMENT_UNASSIGNED", fieldKey: "customerAssignments", message: "unassigned", recommendedActions: ["report", "enrich"] },
        ],
        evaluatedAt: new Date("2026-01-07T00:00:00.000Z"),
      }),
    ];

    const res = await req
      .get(`/api/cmdbs/${cmdbA.id}/customer-scopes/unassigned/governance-summary`)
      .set("Authorization", `Bearer ${makeToken(ORG_A)}`)
      .expect(200);

    assert.equal(res.body.customerScopeId, null);
    assert.equal(res.body.customerScopeName, "Unassigned");
    assert.equal(res.body.objectCount, 1);
    assert.equal(res.body.assignedObjectCount, 0);
    assert.equal(res.body.unassignedObjectCount, 1);
    assert.equal(res.body.evaluatedObjectCount, 1);
    assert.equal(res.body.unevaluatedObjectCount, 0);
    assert.equal(res.body.averageGovernanceScore, 70);
    assert.equal(res.body.readyCount, 0);
    assert.equal(res.body.notReadyCount, 1);
    assert.equal(res.body.blockAutomationRecommendationCount, 1);
    assert.equal(res.body.findingCounts.CUSTOMER_ASSIGNMENT_UNASSIGNED, 1);
  });

  test("customer scope governance summary handles duplicate assignments deterministically", async () => {
    cachedVmsForTest = cachedNetboxVms;
    customerScopesInTest = customerScopesForTest;
    customerScopeAssignmentsInTest = [
      {
        ...customerScopeAssignmentsForTest[0],
        id: "assignment-alpha-engineering-stale",
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        lastSyncedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      {
        ...customerScopeAssignmentsForTest[0],
        id: "assignment-alpha-engineering-current",
        updatedAt: new Date("2026-01-05T00:00:00.000Z"),
        lastSyncedAt: new Date("2026-01-05T00:00:00.000Z"),
      },
    ];
    governanceRunsInTest = [makeGovernanceRun("run-duplicates")];
    governanceObjectEvaluationsInTest = [
      makeGovernanceEvaluation({
        id: "eval-duplicate",
        runId: "run-duplicates",
        objectId: "cached-alpha-vm-101",
        governanceScore: 88,
        evaluatedAt: new Date("2026-01-06T00:00:00.000Z"),
      }),
    ];

    const res = await req
      .get(`/api/cmdbs/${cmdbA.id}/customer-scopes/scope-alpha-engineering/governance-summary`)
      .set("Authorization", `Bearer ${makeToken(ORG_A)}`)
      .expect(200);

    assert.equal(res.body.objectCount, 1);
    assert.equal(res.body.evaluatedObjectCount, 1);
    assert.equal(res.body.averageGovernanceScore, 88);
  });

  test("bulk customer scope governance summaries reject cross-org CMDB access", async () => {
    await req
      .get(`/api/cmdbs/${cmdbA.id}/customer-scope-governance-summaries`)
      .set("Authorization", `Bearer ${makeToken(ORG_B)}`)
      .expect(404);
  });

  test("bulk customer scope governance summaries return selected source scopes plus unassigned", async () => {
    const supportScope: CustomerScope = {
      ...customerScopesForTest[0],
      id: "scope-alpha-support-empty",
      externalId: "22",
      name: "Support",
      displayName: "Support Team",
      metadata: { provider: "netbox", token: "support-token-must-not-leak" },
    };
    cachedVmsForTest = [cachedNetboxVms[0], cachedNetboxVm102, cachedNetboxVm103];
    customerScopesInTest = [...customerScopesForTest, supportScope];
    customerScopeAssignmentsInTest = [
      customerScopeAssignmentsForTest[0],
      {
        ...customerScopeAssignmentsForTest[0],
        id: "assignment-alpha-engineering-unevaluated",
        objectId: "cached-alpha-vm-103",
        updatedAt: new Date("2026-01-04T00:00:00.000Z"),
      },
      customerScopeAssignmentsForTest[1],
      customerScopeAssignmentsForTest[2],
      customerScopeAssignmentsForTest[3],
      {
        ...customerScopeAssignmentsForTest[0],
        id: "assignment-alpha-engineering-netbox-id",
        objectId: "101",
        updatedAt: new Date("2026-01-05T00:00:00.000Z"),
      },
    ];
    governanceRunsInTest = [
      makeGovernanceRun("run-bulk-old"),
      makeGovernanceRun("run-bulk-new"),
      makeGovernanceRun("run-bulk-secondary", "cmdb-alpha-secondary"),
    ];
    governanceObjectEvaluationsInTest = [
      makeGovernanceEvaluation({
        id: "eval-bulk-old",
        runId: "run-bulk-old",
        objectId: "cached-alpha-vm-101",
        governanceScore: 10,
        automationReady: false,
        recommendedActions: ["block_automation"],
        findings: [{ layer: "data_management", severity: "warning", code: "OLD_FINDING", message: "old", recommendedActions: ["report"] }],
        evaluatedAt: new Date("2026-01-05T00:00:00.000Z"),
      }),
      makeGovernanceEvaluation({
        id: "eval-bulk-engineering",
        runId: "run-bulk-new",
        objectId: "cached-alpha-vm-101",
        governanceScore: 90,
        automationReady: true,
        recommendedActions: ["report"],
        findings: [
          { layer: "automation_readiness", severity: "blocker", code: "BLOCKER_FINDING", message: "blocker", recommendedActions: ["block_automation"] },
          { layer: "data_management", severity: "warning", code: "CUSTOMER_SCOPE_MISSING", fieldKey: "customerAssignments", message: "missing", recommendedActions: ["report"] },
        ],
        evaluatedAt: new Date("2026-01-06T00:00:00.000Z"),
      }),
      makeGovernanceEvaluation({
        id: "eval-bulk-unassigned",
        runId: "run-bulk-new",
        objectId: "cached-alpha-vm-102",
        governanceScore: 60,
        automationReady: false,
        recommendedActions: ["block_automation", "validate"],
        findings: [{ layer: "data_management", severity: "warning", code: "CUSTOMER_ASSIGNMENT_UNASSIGNED", fieldKey: "customerAssignments", message: "unassigned", recommendedActions: ["report"] }],
        evaluatedAt: new Date("2026-01-07T00:00:00.000Z"),
      }),
      makeGovernanceEvaluation({
        id: "eval-bulk-netbox-id",
        runId: "run-bulk-new",
        objectId: "101",
        governanceScore: 1,
        automationReady: false,
        recommendedActions: ["block_automation"],
        findings: [{ layer: "data_management", severity: "blocker", code: "WRONG_ID", message: "wrong id", recommendedActions: ["block_automation"] }],
        evaluatedAt: new Date("2026-01-08T00:00:00.000Z"),
      }),
      makeGovernanceEvaluation({
        id: "eval-bulk-secondary",
        runId: "run-bulk-secondary",
        objectId: "cached-alpha-vm-101",
        governanceScore: 2,
        automationReady: false,
        recommendedActions: ["block_automation"],
        findings: [{ layer: "data_management", severity: "blocker", code: "WRONG_SOURCE", message: "wrong source", recommendedActions: ["block_automation"] }],
        evaluatedAt: new Date("2026-01-09T00:00:00.000Z"),
      }),
    ];

    const res = await req
      .get(`/api/cmdbs/${cmdbA.id}/customer-scope-governance-summaries`)
      .set("Authorization", `Bearer ${makeToken(ORG_A)}`)
      .expect(200);

    assert.equal(res.body.sourceId, cmdbA.id);
    assert.equal(res.body.objectType, "netbox_vm");
    assert.deepEqual(
      res.body.summaries.map((summary: any) => summary.customerScopeName).sort(),
      ["Engineering Team", "Support Team", "Unassigned"],
    );
    assert.ok(!JSON.stringify(res.body).includes("scope-alpha-finance-secondary"));
    assert.ok(!JSON.stringify(res.body).includes("scope-beta-engineering"));
    assert.ok(!JSON.stringify(res.body).includes("super-secret-token"));
    assert.ok(!JSON.stringify(res.body).includes("support-token-must-not-leak"));
    assert.ok(!JSON.stringify(res.body).includes("cached-api-key-must-not-leak"));

    const engineering = res.body.summaries.find((summary: any) => summary.customerScopeId === "scope-alpha-engineering");
    assert.equal(engineering.objectCount, 2);
    assert.equal(engineering.assignedObjectCount, 2);
    assert.equal(engineering.unassignedObjectCount, 0);
    assert.equal(engineering.evaluatedObjectCount, 1);
    assert.equal(engineering.unevaluatedObjectCount, 1);
    assert.equal(engineering.averageGovernanceScore, 90);
    assert.equal(engineering.readyCount, 1);
    assert.equal(engineering.notReadyCount, 0);
    assert.equal(engineering.blockAutomationRecommendationCount, 0);
    assert.equal(engineering.findingCounts.CUSTOMER_SCOPE_MISSING, 1);
    assert.equal(engineering.findingCounts.WRONG_ID, undefined);
    assert.equal(engineering.findingCounts.WRONG_SOURCE, undefined);
    assert.equal(engineering.topFindings[0].code, "BLOCKER_FINDING");

    const support = res.body.summaries.find((summary: any) => summary.customerScopeId === "scope-alpha-support-empty");
    assert.equal(support.objectCount, 0);
    assert.equal(support.evaluatedObjectCount, 0);
    assert.equal(support.averageGovernanceScore, null);

    const unassigned = res.body.summaries.find((summary: any) => summary.customerScopeId === null);
    assert.equal(unassigned.customerScopeName, "Unassigned");
    assert.equal(unassigned.objectCount, 1);
    assert.equal(unassigned.assignedObjectCount, 0);
    assert.equal(unassigned.unassignedObjectCount, 1);
    assert.equal(unassigned.averageGovernanceScore, 60);
    assert.equal(unassigned.readyCount, 0);
    assert.equal(unassigned.notReadyCount, 1);
    assert.equal(unassigned.blockAutomationRecommendationCount, 1);
    assert.equal(unassigned.findingCounts.CUSTOMER_ASSIGNMENT_UNASSIGNED, 1);
  });

  test("bulk customer scope governance summaries omit unassigned when no unassigned objects exist", async () => {
    cachedVmsForTest = cachedNetboxVms;
    customerScopesInTest = customerScopesForTest;
    customerScopeAssignmentsInTest = [customerScopeAssignmentsForTest[0]];

    const res = await req
      .get(`/api/cmdbs/${cmdbA.id}/customer-scope-governance-summaries`)
      .set("Authorization", `Bearer ${makeToken(ORG_A)}`)
      .expect(200);

    assert.equal(res.body.summaries.some((summary: any) => summary.customerScopeId === null), false);
  });

  test("bulk customer scope governance summaries return empty summaries when source has no scopes or unassigned assignments", async () => {
    cachedVmsForTest = cachedNetboxVms;

    const res = await req
      .get(`/api/cmdbs/${cmdbA.id}/customer-scope-governance-summaries`)
      .set("Authorization", `Bearer ${makeToken(ORG_A)}`)
      .expect(200);

    assert.deepEqual(res.body, {
      sourceId: cmdbA.id,
      objectType: "netbox_vm",
      summaries: [],
    });
  });

  test("bulk customer scope governance summaries count shared assignment under each scope", async () => {
    const alphaScope = customerScopesForTest[0];
    const sharedScope: CustomerScope = {
      ...alphaScope,
      id: "scope-alpha-shared",
      externalId: "23",
      name: "Shared Services",
      displayName: "Shared Services",
    };
    cachedVmsForTest = cachedNetboxVms;
    customerScopesInTest = [alphaScope, sharedScope];
    customerScopeAssignmentsInTest = [
      {
        ...customerScopeAssignmentsForTest[0],
        id: "assignment-alpha-engineering-shared",
        relationship: "shared",
        updatedAt: new Date("2026-01-05T00:00:00.000Z"),
      },
      {
        ...customerScopeAssignmentsForTest[0],
        id: "assignment-alpha-shared-services",
        customerScopeId: sharedScope.id,
        relationship: "shared",
        updatedAt: new Date("2026-01-05T00:00:00.000Z"),
      },
    ];
    governanceRunsInTest = [makeGovernanceRun("run-shared")];
    governanceObjectEvaluationsInTest = [
      makeGovernanceEvaluation({
        id: "eval-shared",
        runId: "run-shared",
        objectId: "cached-alpha-vm-101",
        governanceScore: 84,
        evaluatedAt: new Date("2026-01-06T00:00:00.000Z"),
      }),
    ];

    const res = await req
      .get(`/api/cmdbs/${cmdbA.id}/customer-scope-governance-summaries`)
      .set("Authorization", `Bearer ${makeToken(ORG_A)}`)
      .expect(200);

    const engineering = res.body.summaries.find((summary: any) => summary.customerScopeId === alphaScope.id);
    const shared = res.body.summaries.find((summary: any) => summary.customerScopeId === sharedScope.id);
    assert.equal(engineering.objectCount, 1);
    assert.equal(shared.objectCount, 1);
    assert.equal(engineering.averageGovernanceScore, 84);
    assert.equal(shared.averageGovernanceScore, 84);
  });

  test("bulk customer scope governance summaries handle duplicate assignments deterministically", async () => {
    cachedVmsForTest = cachedNetboxVms;
    customerScopesInTest = customerScopesForTest;
    customerScopeAssignmentsInTest = [
      {
        ...customerScopeAssignmentsForTest[0],
        id: "assignment-alpha-engineering-bulk-stale",
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        lastSyncedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      {
        ...customerScopeAssignmentsForTest[0],
        id: "assignment-alpha-engineering-bulk-current",
        updatedAt: new Date("2026-01-05T00:00:00.000Z"),
        lastSyncedAt: new Date("2026-01-05T00:00:00.000Z"),
      },
    ];
    governanceRunsInTest = [makeGovernanceRun("run-bulk-duplicates")];
    governanceObjectEvaluationsInTest = [
      makeGovernanceEvaluation({
        id: "eval-bulk-duplicate",
        runId: "run-bulk-duplicates",
        objectId: "cached-alpha-vm-101",
        governanceScore: 88,
        evaluatedAt: new Date("2026-01-06T00:00:00.000Z"),
      }),
    ];

    const res = await req
      .get(`/api/cmdbs/${cmdbA.id}/customer-scope-governance-summaries`)
      .set("Authorization", `Bearer ${makeToken(ORG_A)}`)
      .expect(200);

    const engineering = res.body.summaries.find((summary: any) => summary.customerScopeId === "scope-alpha-engineering");
    assert.equal(engineering.objectCount, 1);
    assert.equal(engineering.evaluatedObjectCount, 1);
    assert.equal(engineering.averageGovernanceScore, 88);
  });

  test("object customer assignment route returns dedicated assignment joined with scope name", async () => {
    cachedVmsForTest = cachedNetboxVms;
    customerScopesInTest = customerScopesForTest;
    customerScopeAssignmentsInTest = customerScopeAssignmentsForTest;

    const res = await req
      .get(`/api/cmdbs/${cmdbA.id}/objects/netbox_vm/cached-alpha-vm-101/customer-assignments`)
      .set("Authorization", `Bearer ${makeToken(ORG_A)}`)
      .expect(200);

    assert.equal(res.body.objectType, "netbox_vm");
    assert.equal(res.body.objectId, "cached-alpha-vm-101");
    assert.equal(res.body.assignments.length, 1);
    assert.equal(res.body.assignments[0].relationship, "dedicated");
    assert.equal(res.body.assignments[0].derivedFrom, "provider");
    assert.equal(res.body.assignments[0].confidence, "authoritative");
    assert.equal(res.body.assignments[0].customerScope.name, "Engineering");
    assert.equal(res.body.assignments[0].customerScope.externalId, "20");
    assert.equal(res.body.assignments[0].metadata.secret, "[REDACTED]");
    assert.ok(!JSON.stringify(res.body).includes("assignment-secret-must-not-leak"));
  });

  test("object customer assignment route returns unassigned with customerScope null", async () => {
    cachedVmsForTest = [
      ...cachedNetboxVms,
      {
        ...cachedNetboxVms[0],
        id: "cached-alpha-vm-102",
        netboxId: 102,
        name: "alpha-unassigned-001",
      },
    ];
    customerScopesInTest = customerScopesForTest;
    customerScopeAssignmentsInTest = customerScopeAssignmentsForTest;

    const res = await req
      .get(`/api/cmdbs/${cmdbA.id}/objects/netbox_vm/cached-alpha-vm-102/customer-assignments`)
      .set("Authorization", `Bearer ${makeToken(ORG_A)}`)
      .expect(200);

    assert.equal(res.body.assignments.length, 1);
    assert.equal(res.body.assignments[0].relationship, "unassigned");
    assert.equal(res.body.assignments[0].customerScope, null);
  });

  test("object customer assignment route uses local cached VM id, not VM name or NetBox numeric id", async () => {
    cachedVmsForTest = cachedNetboxVms;
    customerScopesInTest = customerScopesForTest;
    customerScopeAssignmentsInTest = customerScopeAssignmentsForTest;

    await req
      .get(`/api/cmdbs/${cmdbA.id}/objects/netbox_vm/alpha-app-001/customer-assignments`)
      .set("Authorization", `Bearer ${makeToken(ORG_A)}`)
      .expect(404);

    await req
      .get(`/api/cmdbs/${cmdbA.id}/objects/netbox_vm/101/customer-assignments`)
      .set("Authorization", `Bearer ${makeToken(ORG_A)}`)
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

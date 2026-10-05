import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import supertest from "supertest";
import type { Server } from "node:http";
import { registerRoutes } from "../server/routes";
import { sanitizeInfrastructureMetadata, storage } from "../server/storage";
import type {
  DriftComparisonItem,
  DriftComparisonRun,
  DriftMatchStatus,
  DriftRunStatus,
  DriftSeverity,
  DriftStatus,
  InfrastructureObject,
  InsertDriftComparisonItem,
  InsertDriftComparisonRun,
  NetboxVm,
} from "../shared/schema";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";
const ORG_A = "org-drift-alpha";
const ORG_B = "org-drift-beta";

function makeToken(role = "operator", orgId = ORG_A): string {
  return jwt.sign(
    { userId: `${orgId}-${role}`, username: role, role, orgId },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

class DriftRoutesMemoryStore {
  netboxVms: NetboxVm[] = [];
  infrastructureObjects: InfrastructureObject[] = [];
  runs: DriftComparisonRun[] = [];
  items: DriftComparisonItem[] = [];
  cmdbSources = new Map<string, { id: string; orgId: string }>();
  providerSources = new Map<string, { id: string; orgId: string }>();
  writes = {
    driftRuns: 0,
    driftItems: 0,
    cmdb: 0,
    provider: 0,
    customerScopes: 0,
    customerScopeAssignments: 0,
    governance: 0,
    gate: 0,
  };
  private nextRunId = 1;
  private nextItemId = 1;

  async getUser(id: string) {
    const orgId = id.startsWith(ORG_B) ? ORG_B : ORG_A;
    const role = id.includes("viewer") ? "viewer" : id.includes("admin") ? "admin" : "operator";
    return { id, username: id, password: "", role, orgId, createdAt: new Date() };
  }

  addCmdbSource(id: string, orgId: string) {
    this.cmdbSources.set(id, { id, orgId });
  }

  addProviderSource(id: string, orgId: string) {
    this.providerSources.set(id, { id, orgId });
  }

  async getNetboxVms(orgId: string): Promise<NetboxVm[]> {
    const sourceIds = new Set(Array.from(this.cmdbSources.values())
      .filter((source) => source.orgId === orgId)
      .map((source) => source.id));
    return this.netboxVms.filter((vm) => vm.sourceId && sourceIds.has(vm.sourceId));
  }

  async listInfrastructureObjects(
    orgId: string,
    sourceId: string,
    filters: { providerType?: string; objectType?: string } = {},
  ): Promise<InfrastructureObject[]> {
    this.assertProviderSourceInOrg(sourceId, orgId);
    return this.infrastructureObjects.filter((object) => (
      object.orgId === orgId &&
      object.sourceId === sourceId &&
      (!filters.providerType || object.providerType === filters.providerType) &&
      (!filters.objectType || object.objectType === filters.objectType)
    ));
  }

  async createDriftComparisonRun(input: InsertDriftComparisonRun): Promise<DriftComparisonRun> {
    this.assertCmdbSourceInOrg(input.cmdbSourceId, input.orgId);
    this.assertProviderSourceInOrg(input.providerSourceId, input.orgId);
    this.writes.driftRuns++;
    const now = new Date("2026-01-01T00:00:00Z");
    const run: DriftComparisonRun = {
      id: `drift-run-${this.nextRunId++}`,
      status: "pending",
      counts: {},
      error: null,
      startedAt: null,
      completedAt: null,
      ...input,
      counts: sanitizeInfrastructureMetadata(input.counts ?? {}),
      createdAt: now,
      updatedAt: now,
    };
    this.runs.push(run);
    return run;
  }

  async updateDriftComparisonRun(
    id: string,
    orgId: string,
    patch: Partial<Pick<DriftComparisonRun, "status" | "counts" | "error" | "startedAt" | "completedAt">>,
  ): Promise<DriftComparisonRun | undefined> {
    this.writes.driftRuns++;
    const existing = await this.getDriftComparisonRun(id, orgId);
    if (!existing) return undefined;
    const updated: DriftComparisonRun = {
      ...existing,
      ...patch,
      counts: patch.counts === undefined ? existing.counts : sanitizeInfrastructureMetadata(patch.counts ?? {}),
      updatedAt: new Date("2026-01-01T00:00:01Z"),
    };
    this.runs = this.runs.map((run) => run.id === id ? updated : run);
    return updated;
  }

  async getDriftComparisonRun(id: string, orgId: string): Promise<DriftComparisonRun | undefined> {
    return this.runs.find((run) => run.id === id && run.orgId === orgId);
  }

  async listDriftComparisonRuns(
    orgId: string,
    filters: {
      cmdbSourceId?: string;
      providerSourceId?: string;
      objectType?: string;
      status?: DriftRunStatus;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<DriftComparisonRun[]> {
    const rows = this.runs.filter((run) => (
      run.orgId === orgId &&
      (!filters.cmdbSourceId || run.cmdbSourceId === filters.cmdbSourceId) &&
      (!filters.providerSourceId || run.providerSourceId === filters.providerSourceId) &&
      (!filters.objectType || run.objectType === filters.objectType) &&
      (!filters.status || run.status === filters.status)
    )).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return rows.slice(filters.offset ?? 0, filters.limit === undefined ? undefined : (filters.offset ?? 0) + filters.limit);
  }

  async createDriftComparisonItems(items: InsertDriftComparisonItem[]): Promise<DriftComparisonItem[]> {
    this.writes.driftItems += items.length;
    const created = items.map((input) => {
      this.assertItemMatchesRun(input);
      const now = new Date("2026-01-01T00:00:00Z");
      const item: DriftComparisonItem = {
        id: `drift-item-${this.nextItemId++}`,
        referenceObjectId: null,
        providerObjectId: null,
        matchConfidence: null,
        matchReason: null,
        fieldDiffs: [],
        findings: [],
        metadata: {},
        ignoredAt: null,
        acceptedAt: null,
        acceptedBy: null,
        resolutionNote: null,
        ...input,
        fieldDiffs: sanitizeInfrastructureMetadata(input.fieldDiffs ?? []),
        findings: sanitizeInfrastructureMetadata(input.findings ?? []),
        metadata: sanitizeInfrastructureMetadata(input.metadata ?? {}),
        createdAt: now,
        updatedAt: now,
      };
      this.items.push(item);
      return item;
    });
    return created;
  }

  async listDriftComparisonItems(
    runId: string,
    orgId: string,
    filters: {
      matchStatus?: DriftMatchStatus;
      driftStatus?: DriftStatus;
      driftSeverity?: DriftSeverity;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<DriftComparisonItem[]> {
    const run = await this.getDriftComparisonRun(runId, orgId);
    if (!run) return [];
    const rows = this.items.filter((item) => (
      item.orgId === orgId &&
      item.runId === runId &&
      (!filters.matchStatus || item.matchStatus === filters.matchStatus) &&
      (!filters.driftStatus || item.driftStatus === filters.driftStatus) &&
      (!filters.driftSeverity || item.driftSeverity === filters.driftSeverity)
    ));
    return rows.slice(filters.offset ?? 0, filters.limit === undefined ? undefined : (filters.offset ?? 0) + filters.limit);
  }

  async getDriftComparisonItem(id: string, orgId: string): Promise<DriftComparisonItem | undefined> {
    return this.items.find((item) => item.id === id && item.orgId === orgId);
  }

  forbiddenWriteCount() {
    return this.writes.cmdb +
      this.writes.provider +
      this.writes.customerScopes +
      this.writes.customerScopeAssignments +
      this.writes.governance +
      this.writes.gate;
  }

  private assertCmdbSourceInOrg(sourceId: string, orgId: string) {
    const source = this.cmdbSources.get(sourceId);
    if (!source || source.orgId !== orgId) {
      throw new Error("CMDB source must belong to organization");
    }
  }

  private assertProviderSourceInOrg(sourceId: string, orgId: string) {
    const source = this.providerSources.get(sourceId);
    if (!source || source.orgId !== orgId) {
      throw new Error("provider source must belong to organization");
    }
  }

  private assertItemMatchesRun(item: InsertDriftComparisonItem) {
    const run = this.runs.find((candidate) => candidate.id === item.runId && candidate.orgId === item.orgId);
    if (!run) throw new Error("item must reference a run in the same organization");
    if (
      run.cmdbSourceId !== item.cmdbSourceId ||
      run.providerSourceId !== item.providerSourceId ||
      run.objectType !== item.objectType
    ) {
      throw new Error("item must match run source pair and object type");
    }
  }
}

function makeNetboxVm(overrides: Partial<NetboxVm> = {}): NetboxVm {
  return {
    id: "netbox-vm-1",
    sourceId: "cmdb-a",
    netboxId: 101,
    name: "acme-web-01",
    ip: "10.0.0.10",
    operatingSystem: "linux",
    customFields: {},
    tags: [],
    lastImportedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeInfrastructureObject(overrides: Partial<InfrastructureObject> = {}): InfrastructureObject {
  return {
    id: "infra-vm-1",
    orgId: ORG_A,
    sourceId: "provider-a",
    providerType: "fake",
    objectType: "vm",
    externalId: "provider-vm-101",
    providerNativeId: "101",
    name: "acme-web-01",
    displayName: "acme-web-01",
    region: null,
    zone: null,
    cluster: null,
    node: null,
    lifecycleState: "running",
    powerState: "running",
    tags: [],
    labels: {},
    metadata: { primaryIp4: "10.0.0.10", platform: "linux" },
    raw: { token: "raw-token-must-not-leak" },
    lastSyncedAt: new Date("2026-01-01T00:00:00Z"),
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeRun(overrides: Partial<InsertDriftComparisonRun> = {}): InsertDriftComparisonRun {
  return {
    orgId: ORG_A,
    cmdbSourceId: "cmdb-a",
    providerSourceId: "provider-a",
    objectType: "vm",
    status: "completed",
    counts: { total: 1 },
    ...overrides,
  };
}

let server: Server;
let req: ReturnType<typeof supertest>;
let store: DriftRoutesMemoryStore;
const originals = {
  getUser: storage.getUser,
  getNetboxVms: storage.getNetboxVms,
  listInfrastructureObjects: storage.listInfrastructureObjects,
  createDriftComparisonRun: storage.createDriftComparisonRun,
  updateDriftComparisonRun: storage.updateDriftComparisonRun,
  getDriftComparisonRun: storage.getDriftComparisonRun,
  listDriftComparisonRuns: storage.listDriftComparisonRuns,
  createDriftComparisonItems: storage.createDriftComparisonItems,
  listDriftComparisonItems: storage.listDriftComparisonItems,
  getDriftComparisonItem: storage.getDriftComparisonItem,
};

before(async () => {
  const app = express();
  app.use(cookieParser());
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: false }));
  server = await registerRoutes(app);
  req = supertest(server);
});

beforeEach(() => {
  store = new DriftRoutesMemoryStore();
  store.addCmdbSource("cmdb-a", ORG_A);
  store.addCmdbSource("cmdb-b", ORG_B);
  store.addProviderSource("provider-a", ORG_A);
  store.addProviderSource("provider-b", ORG_B);
  store.netboxVms.push(makeNetboxVm());
  store.infrastructureObjects.push(makeInfrastructureObject());

  storage.getUser = store.getUser.bind(store) as any;
  storage.getNetboxVms = store.getNetboxVms.bind(store) as any;
  storage.listInfrastructureObjects = store.listInfrastructureObjects.bind(store) as any;
  storage.createDriftComparisonRun = store.createDriftComparisonRun.bind(store) as any;
  storage.updateDriftComparisonRun = store.updateDriftComparisonRun.bind(store) as any;
  storage.getDriftComparisonRun = store.getDriftComparisonRun.bind(store) as any;
  storage.listDriftComparisonRuns = store.listDriftComparisonRuns.bind(store) as any;
  storage.createDriftComparisonItems = store.createDriftComparisonItems.bind(store) as any;
  storage.listDriftComparisonItems = store.listDriftComparisonItems.bind(store) as any;
  storage.getDriftComparisonItem = store.getDriftComparisonItem.bind(store) as any;
});

after(async () => {
  storage.getUser = originals.getUser;
  storage.getNetboxVms = originals.getNetboxVms;
  storage.listInfrastructureObjects = originals.listInfrastructureObjects;
  storage.createDriftComparisonRun = originals.createDriftComparisonRun;
  storage.updateDriftComparisonRun = originals.updateDriftComparisonRun;
  storage.getDriftComparisonRun = originals.getDriftComparisonRun;
  storage.listDriftComparisonRuns = originals.listDriftComparisonRuns;
  storage.createDriftComparisonItems = originals.createDriftComparisonItems;
  storage.listDriftComparisonItems = originals.listDriftComparisonItems;
  storage.getDriftComparisonItem = originals.getDriftComparisonItem;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function createRun() {
  return req
    .post("/api/drift-runs")
    .set("Authorization", `Bearer ${makeToken()}`)
    .send({ cmdbSourceId: "cmdb-a", providerSourceId: "provider-a" })
    .expect(201);
}

describe("drift API routes", () => {
  test("POST /api/drift-runs creates a completed VM drift run", async () => {
    const response = await createRun();

    assert.equal(response.body.run.status, "completed");
    assert.equal(response.body.run.objectType, "vm");
    assert.equal(response.body.counts.total, 1);
    assert.equal(response.body.itemsCreated, 1);
    assert.equal(store.items[0].matchStatus, "matched");
    assert.equal(store.items[0].referenceObjectId, "netbox-vm-1");
    assert.equal(store.items[0].providerObjectId, "infra-vm-1");
    assert.equal(store.forbiddenWriteCount(), 0);
  });

  test("POST defaults objectType to vm", async () => {
    const response = await createRun();

    assert.equal(response.body.run.objectType, "vm");
  });

  test("POST rejects unsupported objectType", async () => {
    await req
      .post("/api/drift-runs")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ cmdbSourceId: "cmdb-a", providerSourceId: "provider-a", objectType: "database" })
      .expect(400);

    assert.equal(store.runs.length, 0);
    assert.equal(store.items.length, 0);
  });

  test("POST rejects invalid and cross-org source pairs", async () => {
    await req
      .post("/api/drift-runs")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ cmdbSourceId: "missing-cmdb", providerSourceId: "provider-a" })
      .expect(404);
    await req
      .post("/api/drift-runs")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ cmdbSourceId: "cmdb-a", providerSourceId: "provider-b" })
      .expect(404);

    assert.equal(store.runs.length, 0);
    assert.equal(store.items.length, 0);
  });

  test("GET /api/drift-runs lists only current org runs and supports filters", async () => {
    await store.createDriftComparisonRun(makeRun({ status: "completed" }));
    await store.createDriftComparisonRun(makeRun({ providerSourceId: "provider-a", status: "failed" }));
    await store.createDriftComparisonRun(makeRun({ orgId: ORG_B, cmdbSourceId: "cmdb-b", providerSourceId: "provider-b" }));

    const response = await req
      .get("/api/drift-runs?status=failed&providerSourceId=provider-a")
      .set("Authorization", `Bearer ${makeToken("viewer")}`)
      .expect(200);

    assert.equal(response.body.total, 1);
    assert.equal(response.body.runs[0].orgId, ORG_A);
    assert.equal(response.body.runs[0].status, "failed");
  });

  test("GET /api/drift-runs/:id returns one run and 404 for cross-org or missing run", async () => {
    const run = await store.createDriftComparisonRun(makeRun());
    const otherRun = await store.createDriftComparisonRun(makeRun({ orgId: ORG_B, cmdbSourceId: "cmdb-b", providerSourceId: "provider-b" }));

    const response = await req
      .get(`/api/drift-runs/${run.id}`)
      .set("Authorization", `Bearer ${makeToken("viewer")}`)
      .expect(200);
    assert.equal(response.body.id, run.id);

    await req
      .get(`/api/drift-runs/${otherRun.id}`)
      .set("Authorization", `Bearer ${makeToken("viewer")}`)
      .expect(404);
    await req
      .get("/api/drift-runs/missing-run")
      .set("Authorization", `Bearer ${makeToken("viewer")}`)
      .expect(404);
  });

  test("GET /api/drift-runs/:id/items returns and filters items", async () => {
    const run = await store.createDriftComparisonRun(makeRun());
    await store.createDriftComparisonItems([
      {
        orgId: ORG_A,
        runId: run.id,
        cmdbSourceId: "cmdb-a",
        providerSourceId: "provider-a",
        objectType: "vm",
        referenceObjectId: "netbox-vm-1",
        providerObjectId: "infra-vm-1",
        matchStatus: "matched",
        matchConfidence: "medium",
        matchReason: "Exact normalized VM name",
        driftStatus: "no_drift",
        driftSeverity: "info",
        fieldDiffs: [],
        findings: [],
        metadata: {},
      },
      {
        orgId: ORG_A,
        runId: run.id,
        cmdbSourceId: "cmdb-a",
        providerSourceId: "provider-a",
        objectType: "vm",
        referenceObjectId: "netbox-vm-2",
        providerObjectId: null,
        matchStatus: "unmatched_reference",
        matchConfidence: null,
        matchReason: "No provider candidate",
        driftStatus: "not_compared",
        driftSeverity: "warning",
        fieldDiffs: [],
        findings: [{ code: "UNMATCHED_REFERENCE", token: "secret-token" }],
        metadata: { authorization: "Bearer secret-token" },
      },
    ]);

    const response = await req
      .get(`/api/drift-runs/${run.id}/items?matchStatus=unmatched_reference&driftStatus=not_compared&driftSeverity=warning`)
      .set("Authorization", `Bearer ${makeToken("viewer")}`)
      .expect(200);

    assert.equal(response.body.total, 1);
    assert.equal(response.body.items[0].matchStatus, "unmatched_reference");
    assert.equal(JSON.stringify(response.body).includes("secret-token"), false);
  });

  test("route responses do not expose provider raw data or secrets", async () => {
    const response = await createRun();
    const serialized = JSON.stringify(response.body);

    assert.equal(serialized.includes("raw-token-must-not-leak"), false);
    assert.equal(serialized.includes("provider config"), false);
  });

  test("API does not create CustomerScope, Governance, or Gate data", async () => {
    await createRun();

    assert.equal(store.writes.driftRuns, 2);
    assert.equal(store.writes.driftItems, 1);
    assert.equal(store.writes.customerScopes, 0);
    assert.equal(store.writes.customerScopeAssignments, 0);
    assert.equal(store.writes.governance, 0);
    assert.equal(store.writes.gate, 0);
  });
});

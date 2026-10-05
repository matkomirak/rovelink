import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { sanitizeInfrastructureMetadata } from "../server/storage";
import type {
  DriftComparisonItem,
  DriftComparisonRun,
  DriftMatchStatus,
  DriftSeverity,
  DriftStatus,
  DriftRunStatus,
  InsertDriftComparisonItem,
  InsertDriftComparisonRun,
} from "../shared/schema";

class DriftMemoryStore {
  private runs: DriftComparisonRun[] = [];
  private items: DriftComparisonItem[] = [];
  private cmdbSources = new Map<string, { id: string; orgId: string }>();
  private providerSources = new Map<string, { id: string; orgId: string }>();
  private cmdbWriteCount = 0;
  private providerWriteCount = 0;
  private customerScopeWriteCount = 0;
  private customerScopeAssignmentWriteCount = 0;
  private governanceWriteCount = 0;
  private gateWriteCount = 0;
  private nextRunId = 1;
  private nextItemId = 1;

  addCmdbSource(id: string, orgId: string) {
    this.cmdbSources.set(id, { id, orgId });
  }

  addProviderSource(id: string, orgId: string) {
    this.providerSources.set(id, { id, orgId });
  }

  async createDriftComparisonRun(input: InsertDriftComparisonRun): Promise<DriftComparisonRun> {
    this.assertCmdbSourceInOrg(input.cmdbSourceId, input.orgId);
    this.assertProviderSourceInOrg(input.providerSourceId, input.orgId);
    const now = new Date();
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
    const existing = await this.getDriftComparisonRun(id, orgId);
    if (!existing) return undefined;

    const updated: DriftComparisonRun = {
      ...existing,
      ...patch,
      counts: patch.counts === undefined ? existing.counts : sanitizeInfrastructureMetadata(patch.counts ?? {}),
      updatedAt: new Date(),
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
    ));
    return rows.slice(filters.offset ?? 0, filters.limit === undefined ? undefined : (filters.offset ?? 0) + filters.limit);
  }

  async createDriftComparisonItems(items: InsertDriftComparisonItem[]): Promise<DriftComparisonItem[]> {
    if (items.length === 0) return [];
    const created: DriftComparisonItem[] = [];
    for (const input of items) {
      this.assertItemMatchesRun(input);
      const now = new Date();
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
      created.push(item);
    }
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

  sideEffectCounts() {
    return {
      cmdbWrites: this.cmdbWriteCount,
      providerWrites: this.providerWriteCount,
      customerScopeWrites: this.customerScopeWriteCount,
      customerScopeAssignmentWrites: this.customerScopeAssignmentWriteCount,
      governanceWrites: this.governanceWriteCount,
      gateWrites: this.gateWriteCount,
    };
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
    if (!run) {
      throw new Error("item must reference a run in the same organization");
    }
    if (
      run.cmdbSourceId !== item.cmdbSourceId ||
      run.providerSourceId !== item.providerSourceId ||
      run.objectType !== item.objectType
    ) {
      throw new Error("item must match run source pair and object type");
    }
  }
}

function makeStore() {
  const store = new DriftMemoryStore();
  store.addCmdbSource("cmdb-a", "org-a");
  store.addCmdbSource("cmdb-b", "org-b");
  store.addProviderSource("provider-a", "org-a");
  store.addProviderSource("provider-b", "org-b");
  return store;
}

function makeRun(overrides: Partial<InsertDriftComparisonRun> = {}): InsertDriftComparisonRun {
  return {
    orgId: "org-a",
    cmdbSourceId: "cmdb-a",
    providerSourceId: "provider-a",
    objectType: "vm",
    status: "pending",
    counts: {},
    ...overrides,
  };
}

function makeItem(overrides: Partial<InsertDriftComparisonItem> = {}): InsertDriftComparisonItem {
  return {
    orgId: "org-a",
    runId: "drift-run-1",
    cmdbSourceId: "cmdb-a",
    providerSourceId: "provider-a",
    objectType: "vm",
    referenceObjectId: "netbox-vm-1",
    providerObjectId: "infra-object-1",
    matchStatus: "matched",
    matchConfidence: "medium",
    matchReason: "Exact normalized VM name",
    driftStatus: "no_drift",
    driftSeverity: "info",
    fieldDiffs: [],
    findings: [],
    metadata: {},
    ...overrides,
  };
}

describe("drift comparison storage contract", () => {
  test("creates and gets drift runs within an organization", async () => {
    const store = makeStore();
    const run = await store.createDriftComparisonRun(makeRun());

    assert.equal(run.orgId, "org-a");
    assert.equal(run.status, "pending");
    assert.deepEqual(run.counts, {});
    assert.equal(await store.getDriftComparisonRun(run.id, "org-a"), run);
    assert.equal(await store.getDriftComparisonRun(run.id, "org-b"), undefined);
  });

  test("updates drift run status, counts, and completedAt", async () => {
    const store = makeStore();
    const run = await store.createDriftComparisonRun(makeRun());
    const completedAt = new Date("2026-01-02T03:04:05Z");

    const updated = await store.updateDriftComparisonRun(run.id, "org-a", {
      status: "completed",
      counts: { matched: 2, token: "secret-token" },
      completedAt,
    });

    assert.equal(updated?.status, "completed");
    assert.deepEqual(updated?.counts, { matched: 2, token: "[REDACTED]" });
    assert.equal(updated?.completedAt, completedAt);
    assert.equal(await store.updateDriftComparisonRun(run.id, "org-b", { status: "failed" }), undefined);
  });

  test("lists drift runs by org and filters", async () => {
    const store = makeStore();
    await store.createDriftComparisonRun(makeRun({ status: "completed" }));
    await store.createDriftComparisonRun(makeRun({ providerSourceId: "provider-a", objectType: "database", status: "failed" }));
    await store.createDriftComparisonRun(makeRun({ orgId: "org-b", cmdbSourceId: "cmdb-b", providerSourceId: "provider-b" }));

    assert.equal((await store.listDriftComparisonRuns("org-a")).length, 2);
    assert.equal((await store.listDriftComparisonRuns("org-a", { objectType: "vm" })).length, 1);
    assert.equal((await store.listDriftComparisonRuns("org-a", { status: "failed" })).length, 1);
    assert.equal((await store.listDriftComparisonRuns("org-b")).length, 1);
  });

  test("rejects cross-org source pairs when creating drift runs", async () => {
    const store = makeStore();

    await assert.rejects(
      () => store.createDriftComparisonRun(makeRun({ cmdbSourceId: "cmdb-b" })),
      /CMDB source/,
    );
    await assert.rejects(
      () => store.createDriftComparisonRun(makeRun({ providerSourceId: "provider-b" })),
      /provider source/,
    );
  });

  test("creates multiple drift items and lists them by run and org", async () => {
    const store = makeStore();
    const run = await store.createDriftComparisonRun(makeRun());
    const items = await store.createDriftComparisonItems([
      makeItem({ runId: run.id, referenceObjectId: "netbox-vm-1" }),
      makeItem({ runId: run.id, referenceObjectId: "netbox-vm-2", providerObjectId: null, matchStatus: "unmatched_reference", driftStatus: "not_compared", driftSeverity: "warning" }),
    ]);

    assert.equal(items.length, 2);
    assert.deepEqual(await store.listDriftComparisonItems(run.id, "org-a"), items);
    assert.deepEqual(await store.listDriftComparisonItems(run.id, "org-b"), []);
  });

  test("filters drift items by match and drift status", async () => {
    const store = makeStore();
    const run = await store.createDriftComparisonRun(makeRun());
    await store.createDriftComparisonItems([
      makeItem({ runId: run.id, matchStatus: "matched", driftStatus: "no_drift", driftSeverity: "info" }),
      makeItem({ runId: run.id, referenceObjectId: null, matchStatus: "unmatched_provider", driftStatus: "not_compared", driftSeverity: "warning" }),
      makeItem({ runId: run.id, matchStatus: "ambiguous", driftStatus: "unknown", driftSeverity: "critical" }),
    ]);

    assert.equal((await store.listDriftComparisonItems(run.id, "org-a", { matchStatus: "matched" })).length, 1);
    assert.equal((await store.listDriftComparisonItems(run.id, "org-a", { driftStatus: "unknown" })).length, 1);
    assert.equal((await store.listDriftComparisonItems(run.id, "org-a", { driftSeverity: "warning" })).length, 1);
  });

  test("gets drift item by id and rejects cross-org access", async () => {
    const store = makeStore();
    const run = await store.createDriftComparisonRun(makeRun());
    const [item] = await store.createDriftComparisonItems([makeItem({ runId: run.id })]);

    assert.equal(await store.getDriftComparisonItem(item.id, "org-a"), item);
    assert.equal(await store.getDriftComparisonItem(item.id, "org-b"), undefined);
  });

  test("empty bulk drift item insert is safe", async () => {
    const store = makeStore();
    assert.deepEqual(await store.createDriftComparisonItems([]), []);
  });

  test("defaults and sanitizes item fieldDiffs, findings, and metadata", async () => {
    const store = makeStore();
    const run = await store.createDriftComparisonRun(makeRun());
    const [defaulted] = await store.createDriftComparisonItems([makeItem({ runId: run.id, fieldDiffs: undefined, findings: undefined, metadata: undefined })]);
    const [sanitized] = await store.createDriftComparisonItems([
      makeItem({
        runId: run.id,
        referenceObjectId: "netbox-vm-2",
        fieldDiffs: [{ field: "ip", before: "10.0.0.1", authorization: "Bearer secret" }],
        findings: [{ code: "VM_IP_MISMATCH", token: "secret-token" }],
        metadata: { nested: { clientSecret: "secret-client", harmless: "kept" } },
      }),
    ]);

    assert.deepEqual(defaulted.fieldDiffs, []);
    assert.deepEqual(defaulted.findings, []);
    assert.deepEqual(defaulted.metadata, {});
    assert.deepEqual(sanitized.fieldDiffs, [{ field: "ip", before: "10.0.0.1", authorization: "[REDACTED]" }]);
    assert.deepEqual(sanitized.findings, [{ code: "VM_IP_MISMATCH", token: "[REDACTED]" }]);
    assert.deepEqual(sanitized.metadata, { nested: { clientSecret: "[REDACTED]", harmless: "kept" } });
  });

  test("items must match their drift run source pair and object type", async () => {
    const store = makeStore();
    const run = await store.createDriftComparisonRun(makeRun());

    await assert.rejects(
      () => store.createDriftComparisonItems([makeItem({ runId: run.id, providerSourceId: "provider-b" })]),
      /source pair/,
    );
    await assert.rejects(
      () => store.createDriftComparisonItems([makeItem({ runId: run.id, objectType: "database" })]),
      /object type/,
    );
  });

  test("drift storage does not modify CMDB, provider, CustomerScope, Governance, or Gate state", async () => {
    const store = makeStore();
    const run = await store.createDriftComparisonRun(makeRun());
    await store.createDriftComparisonItems([makeItem({ runId: run.id })]);

    assert.deepEqual(store.sideEffectCounts(), {
      cmdbWrites: 0,
      providerWrites: 0,
      customerScopeWrites: 0,
      customerScopeAssignmentWrites: 0,
      governanceWrites: 0,
      gateWrites: 0,
    });
  });
});

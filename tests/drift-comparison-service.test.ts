import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  runVmDriftComparison,
  type DriftComparisonCounts,
} from "../server/services/drift/drift-comparison-service";
import type {
  DriftComparisonItem,
  DriftComparisonRun,
  InfrastructureObject,
  InsertDriftComparisonItem,
  NetboxVm,
} from "../shared/schema";

class DriftComparisonMemoryStore {
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
    providerCustomerScopeCandidates: 0,
    customerScopes: 0,
    customerScopeAssignments: 0,
    governance: 0,
    gate: 0,
  };
  private nextRunId = 1;
  private nextItemId = 1;

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
      (!filters.objectType || object.objectType === filters.objectType) &&
      (!filters.providerType || object.providerType === filters.providerType)
    ));
  }

  async createDriftComparisonRun(input: any): Promise<DriftComparisonRun> {
    this.assertCmdbSourceInOrg(input.cmdbSourceId, input.orgId);
    this.assertProviderSourceInOrg(input.providerSourceId, input.orgId);
    this.writes.driftRuns++;
    const now = new Date("2026-01-01T00:00:00Z");
    const run: DriftComparisonRun = {
      id: `run-${this.nextRunId++}`,
      status: "pending",
      counts: {},
      error: null,
      startedAt: null,
      completedAt: null,
      ...input,
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
    const existing = this.runs.find((run) => run.id === id && run.orgId === orgId);
    if (!existing) return undefined;
    const updated = {
      ...existing,
      ...patch,
      updatedAt: new Date("2026-01-01T00:00:01Z"),
    };
    this.runs = this.runs.map((run) => run.id === id ? updated : run);
    return updated;
  }

  async createDriftComparisonItems(items: InsertDriftComparisonItem[]): Promise<DriftComparisonItem[]> {
    this.writes.driftItems += items.length;
    const created = items.map((input) => {
      const now = new Date("2026-01-01T00:00:00Z");
      const item: DriftComparisonItem = {
        id: `item-${this.nextItemId++}`,
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
        createdAt: now,
        updatedAt: now,
      };
      this.items.push(item);
      return item;
    });
    return created;
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
}

function makeStore() {
  const store = new DriftComparisonMemoryStore();
  store.addCmdbSource("cmdb-a", "org-a");
  store.addCmdbSource("cmdb-b", "org-b");
  store.addProviderSource("provider-a", "org-a");
  store.addProviderSource("provider-b", "org-b");
  return store;
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
    orgId: "org-a",
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
    raw: null,
    lastSyncedAt: new Date("2026-01-01T00:00:00Z"),
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function runInput(overrides: Record<string, unknown> = {}) {
  return {
    orgId: "org-a",
    cmdbSourceId: "cmdb-a",
    providerSourceId: "provider-a",
    ...overrides,
  };
}

function assertNoNonDriftWrites(store: DriftComparisonMemoryStore) {
  assert.equal(store.writes.cmdb, 0);
  assert.equal(store.writes.provider, 0);
  assert.equal(store.writes.providerCustomerScopeCandidates, 0);
  assert.equal(store.writes.customerScopes, 0);
  assert.equal(store.writes.customerScopeAssignments, 0);
  assert.equal(store.writes.governance, 0);
  assert.equal(store.writes.gate, 0);
}

describe("drift comparison run service", () => {
  test("creates a completed run and matched item for exact name match", async () => {
    const store = makeStore();
    store.netboxVms.push(makeNetboxVm());
    store.infrastructureObjects.push(makeInfrastructureObject());

    const result = await runVmDriftComparison(runInput(), { storage: store });

    assert.equal(result.run.status, "completed");
    assert.equal(result.itemsCreated, 1);
    assert.equal(store.items[0].matchStatus, "matched");
    assert.equal(store.items[0].referenceObjectId, "netbox-vm-1");
    assert.equal(store.items[0].providerObjectId, "infra-vm-1");
    assert.equal(store.items[0].driftStatus, "no_drift");
    assertNoNonDriftWrites(store);
  });

  test("completed run has correct summary counts", async () => {
    const store = makeStore();
    store.netboxVms.push(
      makeNetboxVm({ id: "netbox-matched", name: "matched", ip: "10.0.0.1" }),
      makeNetboxVm({ id: "netbox-missing", name: "missing", ip: "10.0.0.2" }),
    );
    store.infrastructureObjects.push(
      makeInfrastructureObject({ id: "infra-matched", name: "matched", displayName: "matched", metadata: { primaryIp4: "10.0.0.1" } }),
      makeInfrastructureObject({ id: "infra-provider-only", name: "provider-only", displayName: "provider-only", metadata: { primaryIp4: "10.0.0.3" } }),
    );

    const result = await runVmDriftComparison(runInput(), { storage: store });

    assert.deepEqual(result.counts, {
      total: 3,
      matched: 1,
      unmatchedReference: 1,
      unmatchedProvider: 1,
      ambiguous: 0,
      drift: 0,
      noDrift: 1,
      unknown: 0,
      notCompared: 2,
      warning: 2,
      critical: 0,
      info: 1,
    } satisfies DriftComparisonCounts);
    assert.deepEqual(result.run.counts, result.counts);
  });

  test("unmatched NetBox VM creates unmatched_reference item", async () => {
    const store = makeStore();
    store.netboxVms.push(makeNetboxVm({ id: "netbox-missing", name: "missing", ip: "10.0.0.20" }));

    await runVmDriftComparison(runInput(), { storage: store });

    assert.equal(store.items.length, 1);
    assert.equal(store.items[0].matchStatus, "unmatched_reference");
    assert.equal(store.items[0].referenceObjectId, "netbox-missing");
    assert.equal(store.items[0].providerObjectId, null);
  });

  test("provider-only VM creates unmatched_provider item", async () => {
    const store = makeStore();
    store.infrastructureObjects.push(makeInfrastructureObject({ id: "infra-only", name: "runtime-only", displayName: "runtime-only" }));

    await runVmDriftComparison(runInput(), { storage: store });

    assert.equal(store.items.length, 1);
    assert.equal(store.items[0].matchStatus, "unmatched_provider");
    assert.equal(store.items[0].referenceObjectId, null);
    assert.equal(store.items[0].providerObjectId, "infra-only");
  });

  test("field drift from IP, OS, and power mismatch is persisted", async () => {
    const store = makeStore();
    store.netboxVms.push(makeNetboxVm({
      ip: "10.0.0.10",
      operatingSystem: "linux",
      customFields: { provider_state: "running" },
    }));
    store.infrastructureObjects.push(makeInfrastructureObject({
      metadata: { primaryIp4: "10.0.0.99", platform: "windows" },
      powerState: "powered_off",
    }));

    await runVmDriftComparison(runInput(), { storage: store });

    assert.equal(store.items[0].driftStatus, "drift");
    assert.deepEqual(
      (store.items[0].findings as any[]).map((finding) => finding.code),
      ["VM_IP_MISMATCH", "VM_OS_MISMATCH", "VM_POWER_STATE_MISMATCH"],
    );
    assert.deepEqual(
      (store.items[0].fieldDiffs as any[]).map((diff) => diff.code),
      ["VM_IP_MISMATCH", "VM_OS_MISMATCH", "VM_POWER_STATE_MISMATCH"],
    );
  });

  test("ambiguous match is persisted with candidate metadata", async () => {
    const store = makeStore();
    store.netboxVms.push(makeNetboxVm({ id: "netbox-ambiguous", name: "duplicate", ip: null }));
    store.infrastructureObjects.push(
      makeInfrastructureObject({ id: "infra-a", name: "duplicate", displayName: "duplicate", metadata: {} }),
      makeInfrastructureObject({ id: "infra-b", name: "duplicate", displayName: "duplicate", metadata: {} }),
    );

    await runVmDriftComparison(runInput(), { storage: store });

    assert.equal(store.items[0].matchStatus, "ambiguous");
    assert.deepEqual((store.items[0].metadata as any).candidateProviderObjectIds, ["infra-a", "infra-b"]);
  });

  test("source and org isolation are enforced", async () => {
    const store = makeStore();

    await assert.rejects(
      () => runVmDriftComparison(runInput({ cmdbSourceId: "cmdb-b" }), { storage: store }),
      /CMDB source/,
    );
    await assert.rejects(
      () => runVmDriftComparison(runInput({ providerSourceId: "provider-b" }), { storage: store }),
      /provider source/,
    );
  });

  test("invalid source ids are rejected before drift writes", async () => {
    const store = makeStore();

    await assert.rejects(
      () => runVmDriftComparison(runInput({ cmdbSourceId: "missing-cmdb" }), { storage: store }),
      /CMDB source/,
    );
    await assert.rejects(
      () => runVmDriftComparison(runInput({ providerSourceId: "missing-provider" }), { storage: store }),
      /provider source/,
    );
    assert.equal(store.runs.length, 0);
    assert.equal(store.items.length, 0);
  });

  test("failed run is marked failed when matcher throws and error is sanitized", async () => {
    const store = makeStore();
    store.netboxVms.push(makeNetboxVm());
    store.infrastructureObjects.push(makeInfrastructureObject());

    await assert.rejects(
      () => runVmDriftComparison(runInput(), {
        storage: store,
        matcher: () => {
          throw new Error("token_secret=super-secret-value");
        },
      }),
      /token_secret/,
    );

    assert.equal(store.runs.length, 1);
    assert.equal(store.runs[0].status, "failed");
    assert.equal(store.runs[0].error, "token_secret=[REDACTED]");
    assert.equal(store.items.length, 0);
  });

  test("service writes only drift tables and creates no CustomerScope, Governance, or Gate data", async () => {
    const store = makeStore();
    store.netboxVms.push(makeNetboxVm());
    store.infrastructureObjects.push(makeInfrastructureObject());

    await runVmDriftComparison(runInput(), { storage: store });

    assert.equal(store.writes.driftRuns, 2);
    assert.equal(store.writes.driftItems, 1);
    assertNoNonDriftWrites(store);
  });

  test("metadata does not expose raw secrets from provider metadata", async () => {
    const store = makeStore();
    store.netboxVms.push(makeNetboxVm({ name: "secret-safe", ip: null }));
    store.infrastructureObjects.push(makeInfrastructureObject({
      name: "secret-safe",
      displayName: "secret-safe",
      metadata: {
        primaryIp4: null,
        platform: "linux",
        token_secret: "super-secret-provider-token",
        authorization: "Bearer provider-token",
      },
    }));

    await runVmDriftComparison(runInput(), { storage: store });

    const serializedItem = JSON.stringify(store.items[0]);
    assert.equal(serializedItem.includes("super-secret-provider-token"), false);
    assert.equal(serializedItem.includes("Bearer provider-token"), false);
  });
});

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { sanitizeInfrastructureMetadata } from "../server/storage";
import type {
  InfrastructureObject,
  InfrastructureRelationship,
  InsertInfrastructureObject,
  InsertInfrastructureRelationship,
  InsertProviderCustomerScopeCandidate,
  ProviderCustomerScopeCandidate,
} from "../shared/schema";

class InfrastructureMemoryStore {
  private objects: InfrastructureObject[] = [];
  private relationships: InfrastructureRelationship[] = [];
  private candidates: ProviderCustomerScopeCandidate[] = [];
  private customerScopes: unknown[] = [];
  private customerScopeAssignments: unknown[] = [];
  private providerSources = new Map<string, { id: string; orgId: string }>();
  private nextObjectId = 1;
  private nextRelationshipId = 1;
  private nextCandidateId = 1;

  addProviderSource(id: string, orgId: string) {
    this.providerSources.set(id, { id, orgId });
  }

  async upsertInfrastructureObject(input: InsertInfrastructureObject): Promise<InfrastructureObject> {
    this.assertProviderSourceInOrg(input.sourceId, input.orgId);
    const existing = await this.getInfrastructureObjectByExternalId(
      input.orgId,
      input.sourceId,
      input.objectType,
      input.externalId,
    );
    const sanitized = this.sanitizeObjectInput(input);
    const now = new Date();

    if (existing) {
      const updated: InfrastructureObject = {
        ...existing,
        ...sanitized,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: now,
        lastSyncedAt: sanitized.lastSyncedAt ?? now,
      };
      this.objects = this.objects.map((object) => object.id === existing.id ? updated : object);
      return updated;
    }

    const created: InfrastructureObject = {
      id: `infra-object-${this.nextObjectId++}`,
      providerNativeId: null,
      name: null,
      displayName: null,
      region: null,
      zone: null,
      cluster: null,
      node: null,
      lifecycleState: null,
      powerState: null,
      tags: [],
      labels: {},
      metadata: {},
      raw: null,
      lastSyncedAt: now,
      ...sanitized,
      createdAt: now,
      updatedAt: now,
    };
    this.objects.push(created);
    return created;
  }

  async listInfrastructureObjects(
    orgId: string,
    sourceId: string,
    filters: { providerType?: string; objectType?: string } = {},
  ): Promise<InfrastructureObject[]> {
    this.assertProviderSourceInOrg(sourceId, orgId);
    return this.objects.filter((object) => (
      object.orgId === orgId &&
      object.sourceId === sourceId &&
      (!filters.providerType || object.providerType === filters.providerType) &&
      (!filters.objectType || object.objectType === filters.objectType)
    ));
  }

  async getInfrastructureObject(id: string, orgId: string): Promise<InfrastructureObject | undefined> {
    return this.objects.find((object) => object.id === id && object.orgId === orgId);
  }

  async getInfrastructureObjectByExternalId(
    orgId: string,
    sourceId: string,
    objectType: string,
    externalId: string,
  ): Promise<InfrastructureObject | undefined> {
    this.assertProviderSourceInOrg(sourceId, orgId);
    return this.objects.find((object) => (
      object.orgId === orgId &&
      object.sourceId === sourceId &&
      object.objectType === objectType &&
      object.externalId === externalId
    ));
  }

  async upsertInfrastructureRelationship(input: InsertInfrastructureRelationship): Promise<InfrastructureRelationship> {
    this.assertProviderSourceInOrg(input.sourceId, input.orgId);
    await this.assertObjectInSource(input.fromObjectId, input.orgId, input.sourceId);
    await this.assertObjectInSource(input.toObjectId, input.orgId, input.sourceId);
    const existing = this.relationships.find((relationship) => (
      relationship.orgId === input.orgId &&
      relationship.sourceId === input.sourceId &&
      relationship.fromObjectId === input.fromObjectId &&
      relationship.toObjectId === input.toObjectId &&
      relationship.relationshipType === input.relationshipType
    ));
    const now = new Date();

    if (existing) {
      const updated: InfrastructureRelationship = {
        ...existing,
        ...input,
        id: existing.id,
        createdAt: existing.createdAt,
        metadata: sanitizeInfrastructureMetadata(input.metadata ?? {}),
        lastSyncedAt: input.lastSyncedAt ?? now,
        updatedAt: now,
      };
      this.relationships = this.relationships.map((relationship) => relationship.id === existing.id ? updated : relationship);
      return updated;
    }

    const created: InfrastructureRelationship = {
      id: `infra-relationship-${this.nextRelationshipId++}`,
      lastSyncedAt: now,
      ...input,
      metadata: sanitizeInfrastructureMetadata(input.metadata ?? {}),
      createdAt: now,
      updatedAt: now,
    };
    this.relationships.push(created);
    return created;
  }

  async listInfrastructureRelationships(
    orgId: string,
    sourceId: string,
    filters: { fromObjectId?: string; toObjectId?: string; relationshipType?: string } = {},
  ): Promise<InfrastructureRelationship[]> {
    this.assertProviderSourceInOrg(sourceId, orgId);
    return this.relationships.filter((relationship) => (
      relationship.orgId === orgId &&
      relationship.sourceId === sourceId &&
      (!filters.fromObjectId || relationship.fromObjectId === filters.fromObjectId) &&
      (!filters.toObjectId || relationship.toObjectId === filters.toObjectId) &&
      (!filters.relationshipType || relationship.relationshipType === filters.relationshipType)
    ));
  }

  async upsertProviderCustomerScopeCandidate(
    input: InsertProviderCustomerScopeCandidate,
  ): Promise<ProviderCustomerScopeCandidate> {
    this.assertProviderSourceInOrg(input.sourceId, input.orgId);
    await this.assertObjectInSource(input.objectId, input.orgId, input.sourceId);
    const existing = this.candidates.find((candidate) => (
      candidate.orgId === input.orgId &&
      candidate.sourceId === input.sourceId &&
      candidate.objectId === input.objectId &&
      candidate.derivedFrom === input.derivedFrom &&
      candidate.candidateValue === input.candidateValue
    ));
    const now = new Date();

    if (existing) {
      const updated: ProviderCustomerScopeCandidate = {
        ...existing,
        ...input,
        id: existing.id,
        createdAt: existing.createdAt,
        metadata: sanitizeInfrastructureMetadata(input.metadata ?? {}),
        lastSyncedAt: input.lastSyncedAt ?? now,
        updatedAt: now,
      };
      this.candidates = this.candidates.map((candidate) => candidate.id === existing.id ? updated : candidate);
      return updated;
    }

    const created: ProviderCustomerScopeCandidate = {
      id: `infra-candidate-${this.nextCandidateId++}`,
      lastSyncedAt: now,
      ...input,
      metadata: sanitizeInfrastructureMetadata(input.metadata ?? {}),
      createdAt: now,
      updatedAt: now,
    };
    this.candidates.push(created);
    return created;
  }

  async listProviderCustomerScopeCandidates(
    orgId: string,
    sourceId: string,
    filters: { objectId?: string; derivedFrom?: string; confidence?: string } = {},
  ): Promise<ProviderCustomerScopeCandidate[]> {
    this.assertProviderSourceInOrg(sourceId, orgId);
    return this.candidates.filter((candidate) => (
      candidate.orgId === orgId &&
      candidate.sourceId === sourceId &&
      (!filters.objectId || candidate.objectId === filters.objectId) &&
      (!filters.derivedFrom || candidate.derivedFrom === filters.derivedFrom) &&
      (!filters.confidence || candidate.confidence === filters.confidence)
    ));
  }

  async listProviderCustomerScopeCandidatesForObject(
    orgId: string,
    sourceId: string,
    objectId: string,
  ): Promise<ProviderCustomerScopeCandidate[]> {
    return this.listProviderCustomerScopeCandidates(orgId, sourceId, { objectId });
  }

  customerScopeCount() {
    return this.customerScopes.length;
  }

  customerScopeAssignmentCount() {
    return this.customerScopeAssignments.length;
  }

  private sanitizeObjectInput(input: InsertInfrastructureObject): InsertInfrastructureObject {
    return {
      ...input,
      tags: sanitizeInfrastructureMetadata(input.tags ?? []),
      labels: sanitizeInfrastructureMetadata(input.labels ?? {}),
      metadata: sanitizeInfrastructureMetadata(input.metadata ?? {}),
      raw: input.raw == null ? null : sanitizeInfrastructureMetadata(input.raw),
    };
  }

  private assertProviderSourceInOrg(sourceId: string, orgId: string) {
    const source = this.providerSources.get(sourceId);
    if (!source || source.orgId !== orgId) {
      throw new Error("source must belong to organization");
    }
  }

  private async assertObjectInSource(objectId: string, orgId: string, sourceId: string) {
    const object = await this.getInfrastructureObject(objectId, orgId);
    if (!object || object.sourceId !== sourceId) {
      throw new Error("object must belong to the same organization and source");
    }
  }
}

function makeStore() {
  const store = new InfrastructureMemoryStore();
  store.addProviderSource("source-a", "org-a");
  store.addProviderSource("source-b", "org-a");
  store.addProviderSource("source-other-org", "org-b");
  return store;
}

function makeObject(overrides: Partial<InsertInfrastructureObject> = {}): InsertInfrastructureObject {
  return {
    orgId: "org-a",
    sourceId: "source-a",
    providerType: "azure",
    objectType: "vm",
    externalId: "azure:sub-1:vm:/subscriptions/sub-1/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/app-1",
    providerNativeId: "/subscriptions/sub-1/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/app-1",
    name: "app-1",
    displayName: "App 1",
    region: "westeurope",
    zone: "1",
    lifecycleState: "active",
    powerState: "running",
    tags: ["production"],
    labels: { environment: "prod" },
    metadata: { resourceGroup: "rg-prod" },
    raw: null,
    ...overrides,
  };
}

function makeRelationship(overrides: Partial<InsertInfrastructureRelationship> = {}): InsertInfrastructureRelationship {
  return {
    orgId: "org-a",
    sourceId: "source-a",
    fromObjectId: "infra-object-1",
    toObjectId: "infra-object-2",
    relationshipType: "attached_to",
    metadata: {},
    ...overrides,
  };
}

function makeCandidate(overrides: Partial<InsertProviderCustomerScopeCandidate> = {}): InsertProviderCustomerScopeCandidate {
  return {
    orgId: "org-a",
    sourceId: "source-a",
    objectId: "infra-object-1",
    derivedFrom: "tag",
    candidateValue: "ACME GmbH",
    confidence: "medium",
    metadata: {},
    ...overrides,
  };
}

describe("Infrastructure object storage contract", () => {
  test("infrastructure object upsert creates and repeats idempotently", async () => {
    const store = makeStore();
    const first = await store.upsertInfrastructureObject(makeObject());
    const second = await store.upsertInfrastructureObject(makeObject());

    assert.equal(second.id, first.id);
    assert.equal((await store.listInfrastructureObjects("org-a", "source-a")).length, 1);
  });

  test("upsert updates mutable fields and refreshes timestamps", async () => {
    const store = makeStore();
    const first = await store.upsertInfrastructureObject(makeObject({
      name: "app-old",
      powerState: "stopped",
      metadata: { revision: 1 },
    }));
    const updated = await store.upsertInfrastructureObject(makeObject({
      name: "app-new",
      powerState: "running",
      metadata: { revision: 2 },
    }));

    assert.equal(updated.id, first.id);
    assert.equal(updated.name, "app-new");
    assert.equal(updated.powerState, "running");
    assert.deepEqual(updated.metadata, { revision: 2 });
    assert.ok(updated.updatedAt >= first.updatedAt);
  });

  test("same externalId dedupes within one org/source/objectType but not across sources", async () => {
    const store = makeStore();
    const sourceA = await store.upsertInfrastructureObject(makeObject({ sourceId: "source-a" }));
    const sourceB = await store.upsertInfrastructureObject(makeObject({ sourceId: "source-b" }));

    assert.notEqual(sourceA.id, sourceB.id);
    assert.equal((await store.listInfrastructureObjects("org-a", "source-a")).length, 1);
    assert.equal((await store.listInfrastructureObjects("org-a", "source-b")).length, 1);
  });

  test("same display name with different externalId creates separate objects", async () => {
    const store = makeStore();
    await store.upsertInfrastructureObject(makeObject({ externalId: "azure:vm:1", name: "shared-name" }));
    await store.upsertInfrastructureObject(makeObject({ externalId: "azure:vm:2", name: "shared-name" }));

    assert.equal((await store.listInfrastructureObjects("org-a", "source-a")).length, 2);
  });

  test("get and list methods are org-scoped and source-scoped", async () => {
    const store = makeStore();
    const object = await store.upsertInfrastructureObject(makeObject({ sourceId: "source-a" }));
    await store.upsertInfrastructureObject(makeObject({ sourceId: "source-b", externalId: "azure:vm:other-source" }));

    assert.equal((await store.listInfrastructureObjects("org-a", "source-a")).length, 1);
    assert.equal(await store.getInfrastructureObject(object.id, "org-b"), undefined);
    assert.equal(
      await store.getInfrastructureObjectByExternalId("org-a", "source-b", object.objectType, object.externalId),
      undefined,
    );
    await assert.rejects(
      () => store.listInfrastructureObjects("org-a", "source-other-org"),
      /source must belong/,
    );
  });

  test("metadata sanitizer removes obvious secret-shaped keys recursively", async () => {
    const store = makeStore();
    const object = await store.upsertInfrastructureObject(makeObject({
      tags: [{ name: "prod", token: "tag-token" }],
      labels: { owner: "ops", clientSecret: "client-secret" },
      metadata: {
        resourceGroup: "rg-prod",
        password: "password",
        nested: { accessToken: "access-token", safe: "value" },
      },
      raw: {
        authorization: "Bearer abc",
        key: "raw-key",
        nested: { refresh_token: "refresh-token" },
      },
    }));

    assert.deepEqual(object.tags, [{ name: "prod", token: "[REDACTED]" }]);
    assert.deepEqual(object.labels, { owner: "ops", clientSecret: "[REDACTED]" });
    assert.deepEqual(object.metadata, {
      resourceGroup: "rg-prod",
      password: "[REDACTED]",
      nested: { accessToken: "[REDACTED]", safe: "value" },
    });
    assert.deepEqual(object.raw, {
      authorization: "[REDACTED]",
      key: "[REDACTED]",
      nested: { refresh_token: "[REDACTED]" },
    });
  });

  test("relationship upsert is idempotent and list is org/source scoped", async () => {
    const store = makeStore();
    const vm = await store.upsertInfrastructureObject(makeObject({ externalId: "azure:vm:1", objectType: "vm" }));
    const nic = await store.upsertInfrastructureObject(makeObject({ externalId: "azure:nic:1", objectType: "network_interface" }));

    const first = await store.upsertInfrastructureRelationship(makeRelationship({
      fromObjectId: vm.id,
      toObjectId: nic.id,
      relationshipType: "has_interface",
    }));
    const second = await store.upsertInfrastructureRelationship(makeRelationship({
      fromObjectId: vm.id,
      toObjectId: nic.id,
      relationshipType: "has_interface",
      metadata: { revision: 2 },
    }));

    assert.equal(second.id, first.id);
    assert.deepEqual(second.metadata, { revision: 2 });
    assert.equal((await store.listInfrastructureRelationships("org-a", "source-a")).length, 1);
    assert.equal((await store.listInfrastructureRelationships("org-a", "source-a", { fromObjectId: vm.id })).length, 1);
    await assert.rejects(
      () => store.listInfrastructureRelationships("org-a", "source-other-org"),
      /source must belong/,
    );
  });

  test("relationship rejects objects outside the same source", async () => {
    const store = makeStore();
    const sourceAObject = await store.upsertInfrastructureObject(makeObject({ sourceId: "source-a", externalId: "azure:vm:1" }));
    const sourceBObject = await store.upsertInfrastructureObject(makeObject({ sourceId: "source-b", externalId: "azure:vm:2" }));

    await assert.rejects(
      () => store.upsertInfrastructureRelationship(makeRelationship({
        fromObjectId: sourceAObject.id,
        toObjectId: sourceBObject.id,
      })),
      /same organization and source/,
    );
  });

  test("customer scope candidate upsert is idempotent and source/object scoped", async () => {
    const store = makeStore();
    const object = await store.upsertInfrastructureObject(makeObject());

    const first = await store.upsertProviderCustomerScopeCandidate(makeCandidate({
      objectId: object.id,
      candidateValue: "ACME GmbH",
      metadata: { revision: 1 },
    }));
    const second = await store.upsertProviderCustomerScopeCandidate(makeCandidate({
      objectId: object.id,
      candidateValue: "ACME GmbH",
      metadata: { revision: 2, token: "candidate-token" },
    }));

    assert.equal(second.id, first.id);
    assert.deepEqual(second.metadata, { revision: 2, token: "[REDACTED]" });
    assert.equal((await store.listProviderCustomerScopeCandidates("org-a", "source-a")).length, 1);
    assert.equal((await store.listProviderCustomerScopeCandidatesForObject("org-a", "source-a", object.id)).length, 1);
    assert.equal((await store.listProviderCustomerScopeCandidates("org-a", "source-a", { derivedFrom: "tag" })).length, 1);
    assert.equal((await store.listProviderCustomerScopeCandidates("org-a", "source-a", { confidence: "high" })).length, 0);
  });

  test("provider customer scope candidates do not create CustomerScopes or authoritative assignments", async () => {
    const store = makeStore();
    const object = await store.upsertInfrastructureObject(makeObject());

    await store.upsertProviderCustomerScopeCandidate(makeCandidate({
      objectId: object.id,
      derivedFrom: "resource_group",
      confidence: "low",
    }));

    assert.equal(store.customerScopeCount(), 0);
    assert.equal(store.customerScopeAssignmentCount(), 0);
  });
});

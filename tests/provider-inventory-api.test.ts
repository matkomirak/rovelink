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
  InfrastructureObject,
  InsertInfrastructureObject,
  InsertProviderCustomerScopeCandidate,
  ProviderAccount,
  ProviderCustomerScopeCandidate,
} from "../shared/schema";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";
const ORG_A = "org-a";
const ORG_B = "org-b";

function makeToken(role = "operator", orgId = ORG_A): string {
  return jwt.sign(
    { userId: `${orgId}-${role}`, username: role, role, orgId },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

function makeProvider(overrides: Partial<ProviderAccount>): ProviderAccount {
  const now = new Date();
  return {
    id: "fake-provider-a",
    orgId: ORG_A,
    kind: "fake",
    name: "Fake Provider A",
    enabled: true,
    scheduleCron: null,
    config: {
      variant: "azure",
      seed: 7,
      vms: 2,
      tags: {
        customer: ["ACME GmbH"],
        wave: ["Wave1"],
        role: ["web"],
      },
      api_key: "super-secret",
    },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

class ProviderInventoryApiMemoryStore {
  providers = new Map<string, ProviderAccount>();
  objects: InfrastructureObject[] = [];
  candidates: ProviderCustomerScopeCandidate[] = [];
  private nextObjectId = 1;
  private nextCandidateId = 1;

  async getUser(id: string) {
    return {
      id,
      username: id,
      password: "",
      role: id.includes("viewer") ? "viewer" : "operator",
      orgId: id.startsWith(ORG_B) ? ORG_B : ORG_A,
      createdAt: new Date(),
    };
  }

  async getProvider(id: string, orgId: string) {
    const provider = this.providers.get(id);
    return provider && provider.orgId === orgId ? provider : undefined;
  }

  async upsertInfrastructureObject(input: InsertInfrastructureObject): Promise<InfrastructureObject> {
    const provider = this.providers.get(input.sourceId);
    if (!provider || provider.orgId !== input.orgId) {
      throw new Error("source must belong to organization");
    }

    const existing = await this.getInfrastructureObjectByExternalId(
      input.orgId,
      input.sourceId,
      input.objectType,
      input.externalId,
    );
    const now = new Date();
    const sanitized = {
      ...input,
      tags: sanitizeInfrastructureMetadata(input.tags ?? []),
      labels: sanitizeInfrastructureMetadata(input.labels ?? {}),
      metadata: sanitizeInfrastructureMetadata(input.metadata ?? {}),
      raw: input.raw == null ? null : sanitizeInfrastructureMetadata(input.raw),
    };

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

  async listInfrastructureObjectTypes(orgId: string, sourceId: string) {
    this.assertProviderSourceInOrg(sourceId, orgId);
    const grouped = new Map<string, { objectType: string; count: number; lastSyncedAt: Date | null }>();
    for (const object of this.objects.filter((candidate) => candidate.orgId === orgId && candidate.sourceId === sourceId)) {
      const existing = grouped.get(object.objectType);
      const lastSyncedAt = object.lastSyncedAt ?? null;
      if (!existing) {
        grouped.set(object.objectType, { objectType: object.objectType, count: 1, lastSyncedAt });
        continue;
      }
      existing.count += 1;
      if (lastSyncedAt && (!existing.lastSyncedAt || lastSyncedAt > existing.lastSyncedAt)) {
        existing.lastSyncedAt = lastSyncedAt;
      }
    }
    return Array.from(grouped.values()).sort((a, b) => a.objectType.localeCompare(b.objectType));
  }

  async listInfrastructureObjectsWithCandidateCounts(
    orgId: string,
    sourceId: string,
    filters: { providerType?: string; objectType?: string } = {},
  ) {
    const objects = await this.listInfrastructureObjects(orgId, sourceId, filters);
    return objects.map((object) => ({
      ...object,
      customerScopeCandidateCount: this.candidates.filter((candidate) => (
        candidate.orgId === orgId &&
        candidate.sourceId === sourceId &&
        candidate.objectId === object.id
      )).length,
    }));
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

  async getInfrastructureObjectWithCandidates(orgId: string, sourceId: string, objectId: string) {
    this.assertProviderSourceInOrg(sourceId, orgId);
    const object = await this.getInfrastructureObject(objectId, orgId);
    if (!object || object.sourceId !== sourceId) return undefined;
    return {
      ...object,
      customerScopeCandidates: await this.listProviderCustomerScopeCandidatesForObject(orgId, sourceId, object.id),
    };
  }

  async upsertProviderCustomerScopeCandidate(
    input: InsertProviderCustomerScopeCandidate,
  ): Promise<ProviderCustomerScopeCandidate> {
    const object = await this.getInfrastructureObject(input.objectId, input.orgId);
    if (!object || object.sourceId !== input.sourceId) {
      throw new Error("object must belong to the same organization and source");
    }
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

  private assertProviderSourceInOrg(sourceId: string, orgId: string) {
    const provider = this.providers.get(sourceId);
    if (!provider || provider.orgId !== orgId) {
      throw new Error("source must belong to organization");
    }
  }
}

let server: Server;
let req: ReturnType<typeof supertest>;
let store: ProviderInventoryApiMemoryStore;
const originals = {
  getUser: storage.getUser,
  getProvider: storage.getProvider,
  upsertInfrastructureObject: storage.upsertInfrastructureObject,
  listInfrastructureObjectTypes: storage.listInfrastructureObjectTypes,
  listInfrastructureObjectsWithCandidateCounts: storage.listInfrastructureObjectsWithCandidateCounts,
  listInfrastructureObjects: storage.listInfrastructureObjects,
  getInfrastructureObject: storage.getInfrastructureObject,
  getInfrastructureObjectByExternalId: storage.getInfrastructureObjectByExternalId,
  getInfrastructureObjectWithCandidates: storage.getInfrastructureObjectWithCandidates,
  upsertProviderCustomerScopeCandidate: storage.upsertProviderCustomerScopeCandidate,
  listProviderCustomerScopeCandidates: storage.listProviderCustomerScopeCandidates,
  listProviderCustomerScopeCandidatesForObject: storage.listProviderCustomerScopeCandidatesForObject,
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
  store = new ProviderInventoryApiMemoryStore();
  store.providers.set("fake-provider-a", makeProvider({ id: "fake-provider-a", orgId: ORG_A }));
  store.providers.set("fake-provider-b", makeProvider({ id: "fake-provider-b", orgId: ORG_A, name: "Fake Provider B" }));
  store.providers.set("fake-provider-other-org", makeProvider({ id: "fake-provider-other-org", orgId: ORG_B }));

  storage.getUser = store.getUser.bind(store) as any;
  storage.getProvider = store.getProvider.bind(store) as any;
  storage.upsertInfrastructureObject = store.upsertInfrastructureObject.bind(store) as any;
  storage.listInfrastructureObjectTypes = store.listInfrastructureObjectTypes.bind(store) as any;
  storage.listInfrastructureObjectsWithCandidateCounts = store.listInfrastructureObjectsWithCandidateCounts.bind(store) as any;
  storage.listInfrastructureObjects = store.listInfrastructureObjects.bind(store) as any;
  storage.getInfrastructureObject = store.getInfrastructureObject.bind(store) as any;
  storage.getInfrastructureObjectByExternalId = store.getInfrastructureObjectByExternalId.bind(store) as any;
  storage.getInfrastructureObjectWithCandidates = store.getInfrastructureObjectWithCandidates.bind(store) as any;
  storage.upsertProviderCustomerScopeCandidate = store.upsertProviderCustomerScopeCandidate.bind(store) as any;
  storage.listProviderCustomerScopeCandidates = store.listProviderCustomerScopeCandidates.bind(store) as any;
  storage.listProviderCustomerScopeCandidatesForObject = store.listProviderCustomerScopeCandidatesForObject.bind(store) as any;
});

after(async () => {
  storage.getUser = originals.getUser;
  storage.getProvider = originals.getProvider;
  storage.upsertInfrastructureObject = originals.upsertInfrastructureObject;
  storage.listInfrastructureObjectTypes = originals.listInfrastructureObjectTypes;
  storage.listInfrastructureObjectsWithCandidateCounts = originals.listInfrastructureObjectsWithCandidateCounts;
  storage.listInfrastructureObjects = originals.listInfrastructureObjects;
  storage.getInfrastructureObject = originals.getInfrastructureObject;
  storage.getInfrastructureObjectByExternalId = originals.getInfrastructureObjectByExternalId;
  storage.getInfrastructureObjectWithCandidates = originals.getInfrastructureObjectWithCandidates;
  storage.upsertProviderCustomerScopeCandidate = originals.upsertProviderCustomerScopeCandidate;
  storage.listProviderCustomerScopeCandidates = originals.listProviderCustomerScopeCandidates;
  storage.listProviderCustomerScopeCandidatesForObject = originals.listProviderCustomerScopeCandidatesForObject;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function syncFakeProvider() {
  await req
    .post("/api/providers/fake-provider-a/inventory/sync")
    .set("Authorization", `Bearer ${makeToken()}`)
    .expect(200);
}

describe("provider normalized inventory API", () => {
  test("object types route rejects cross-org provider access", async () => {
    await req
      .get("/api/providers/fake-provider-other-org/inventory/object-types")
      .set("Authorization", `Bearer ${makeToken("operator", ORG_A)}`)
      .expect(404);
  });

  test("object types route counts by objectType and returns latest lastSyncedAt", async () => {
    await syncFakeProvider();
    const later = new Date(Date.now() + 60_000);
    await store.upsertInfrastructureObject({
      orgId: ORG_A,
      sourceId: "fake-provider-a",
      providerType: "fake",
      objectType: "network",
      externalId: "fake:network:1",
      name: "demo-network",
      displayName: "Demo Network",
      metadata: {},
      lastSyncedAt: later,
    });

    const res = await req
      .get("/api/providers/fake-provider-a/inventory/object-types")
      .set("Authorization", `Bearer ${makeToken()}`)
      .expect(200);

    assert.equal(res.body.sourceId, "fake-provider-a");
    assert.equal(res.body.providerType, "fake");
    const vm = res.body.objectTypes.find((type: any) => type.objectType === "vm");
    const network = res.body.objectTypes.find((type: any) => type.objectType === "network");
    assert.equal(vm.label, "Virtual Machines");
    assert.equal(vm.count, 2);
    assert.equal(network.label, "network");
    assert.equal(network.count, 1);
    assert.equal(new Date(network.lastSyncedAt).toISOString(), later.toISOString());
  });

  test("object list route filters by objectType and includes local ids and candidate counts", async () => {
    await syncFakeProvider();
    await store.upsertInfrastructureObject({
      orgId: ORG_A,
      sourceId: "fake-provider-a",
      providerType: "fake",
      objectType: "network",
      externalId: "fake:network:1",
      name: "demo-network",
      displayName: "Demo Network",
      metadata: {},
    });

    const res = await req
      .get("/api/providers/fake-provider-a/inventory/objects?objectType=vm")
      .set("Authorization", `Bearer ${makeToken()}`)
      .expect(200);

    assert.equal(res.body.sourceId, "fake-provider-a");
    assert.equal(res.body.objectType, "vm");
    assert.equal(res.body.objects.length, 2);
    assert.ok(res.body.objects.every((object: any) => object.id.startsWith("infra-object-")));
    assert.ok(res.body.objects.every((object: any) => object.objectType === "vm"));
    assert.ok(res.body.objects.every((object: any) => object.customerScopeCandidateCount > 0));
    assert.equal(JSON.stringify(res.body).includes("super-secret"), false);
    assert.equal(JSON.stringify(res.body).includes("api_key"), false);
    assert.equal(JSON.stringify(res.body).includes("raw"), false);
  });

  test("object detail route returns sanitized metadata and CustomerScope candidate hints", async () => {
    await syncFakeProvider();
    const object = store.objects[0];
    object.metadata = sanitizeInfrastructureMetadata({
      owner: "ops",
      accessToken: "raw-token",
    }) as any;

    const res = await req
      .get(`/api/providers/fake-provider-a/inventory/objects/${object.id}`)
      .set("Authorization", `Bearer ${makeToken()}`)
      .expect(200);

    assert.equal(res.body.id, object.id);
    assert.equal(res.body.externalId, object.externalId);
    assert.equal(res.body.metadata.accessToken, "[REDACTED]");
    assert.ok(res.body.customerScopeCandidates.length > 0);
    assert.ok(res.body.customerScopeCandidates.every((candidate: any) => candidate.confidence !== "authoritative"));
    assert.deepEqual(res.body.relationships, []);
    assert.equal(res.body.raw, undefined);
    assert.equal(JSON.stringify(res.body).includes("super-secret"), false);
  });

  test("object detail route rejects objects from another source and another org", async () => {
    await syncFakeProvider();
    const wrongSourceObject = await store.upsertInfrastructureObject({
      orgId: ORG_A,
      sourceId: "fake-provider-b",
      providerType: "fake",
      objectType: "vm",
      externalId: "fake-provider-b:vm:1",
      name: "other-source-vm",
      metadata: {},
    });
    const wrongOrgObject = await store.upsertInfrastructureObject({
      orgId: ORG_B,
      sourceId: "fake-provider-other-org",
      providerType: "fake",
      objectType: "vm",
      externalId: "other-org:vm:1",
      name: "other-org-vm",
      metadata: {},
    });

    await req
      .get(`/api/providers/fake-provider-a/inventory/objects/${wrongSourceObject.id}`)
      .set("Authorization", `Bearer ${makeToken()}`)
      .expect(404);
    await req
      .get(`/api/providers/fake-provider-a/inventory/objects/${wrongOrgObject.id}`)
      .set("Authorization", `Bearer ${makeToken()}`)
      .expect(404);
  });

  test("customer-scope-candidates route returns hints only and rejects wrong source object", async () => {
    await syncFakeProvider();
    const object = store.objects[0];
    const wrongSourceObject = await store.upsertInfrastructureObject({
      orgId: ORG_A,
      sourceId: "fake-provider-b",
      providerType: "fake",
      objectType: "vm",
      externalId: "fake-provider-b:vm:1",
      name: "other-source-vm",
      metadata: {},
    });

    const res = await req
      .get(`/api/providers/fake-provider-a/inventory/objects/${object.id}/customer-scope-candidates`)
      .set("Authorization", `Bearer ${makeToken()}`)
      .expect(200);

    assert.equal(res.body.sourceId, "fake-provider-a");
    assert.equal(res.body.objectId, object.id);
    assert.ok(res.body.candidates.length > 0);
    assert.ok(res.body.candidates.every((candidate: any) => candidate.customerScope === undefined));
    assert.ok(res.body.candidates.every((candidate: any) => candidate.confidence !== "authoritative"));

    await req
      .get(`/api/providers/fake-provider-a/inventory/objects/${wrongSourceObject.id}/customer-scope-candidates`)
      .set("Authorization", `Bearer ${makeToken()}`)
      .expect(404);
  });
});

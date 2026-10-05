import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import supertest from "supertest";
import type { Server } from "node:http";
import { registerRoutes } from "../server/routes";
import { sanitizeInfrastructureMetadata, storage } from "../server/storage";
import { fakeInfrastructureNormalizer } from "../server/services/infrastructure-normalizers/fake";
import {
  ProviderInfrastructureSyncConfigError,
  ProviderInfrastructureSyncDiscoveryError,
  ProviderInfrastructureSyncNotSupportedError,
  syncProviderInfrastructureInventory,
} from "../server/services/provider-infrastructure-sync";
import type { AzureDiscoveryResult } from "../server/services/providers/azure";
import type { NormalizedVm } from "../server/services/providers/types";
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
const AZURE_SUBSCRIPTION_ID = "sub-123";
const AZURE_VM_ID = `/subscriptions/${AZURE_SUBSCRIPTION_ID}/resourceGroups/rg-acme-prod/providers/Microsoft.Compute/virtualMachines/acme-web-01`;
const AZURE_NIC_ID = `/subscriptions/${AZURE_SUBSCRIPTION_ID}/resourceGroups/rg-acme-prod/providers/Microsoft.Network/networkInterfaces/acme-web-01-nic`;
const AZURE_VNET_ID = `/subscriptions/${AZURE_SUBSCRIPTION_ID}/resourceGroups/rg-acme-prod/providers/Microsoft.Network/virtualNetworks/acme-vnet`;
const AZURE_SUBNET_ID = `${AZURE_VNET_ID}/subnets/web`;
const AZURE_PUBLIC_IP_ID = `/subscriptions/${AZURE_SUBSCRIPTION_ID}/resourceGroups/rg-acme-prod/providers/Microsoft.Network/publicIPAddresses/acme-web-01-pip`;
const PROXMOX_CLUSTER_ID = "pve-cluster-a";

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
      seed: 42,
      vms: 3,
      tags: {
        customer: ["ACME GmbH", "Beta"],
        wave: ["Wave1"],
        role: ["web"],
      },
    },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeAzureConfig(overrides: Record<string, unknown> = {}) {
  return {
    subscription_id: AZURE_SUBSCRIPTION_ID,
    tenant_id: "tenant-123",
    client_id: "client-123",
    client_secret: "super-secret-client-secret",
    ...overrides,
  };
}

function makeAzureDiscovery(vmName = "acme-web-01"): AzureDiscoveryResult {
  return {
    subscriptionId: AZURE_SUBSCRIPTION_ID,
    vms: [
      {
        id: AZURE_VM_ID,
        name: vmName,
        location: "westeurope",
        resourceGroup: "rg-acme-prod",
        subscriptionId: AZURE_SUBSCRIPTION_ID,
        status: "running",
        platform: "linux",
        computerName: vmName,
        vmSize: "Standard_D2s_v5",
        vcpus: 2,
        ramGiB: 8,
        disk: 128,
        primaryIp4: "10.42.0.4",
        nics: [
          {
            id: AZURE_NIC_ID,
            name: "acme-web-01-nic",
            resourceGroup: "rg-acme-prod",
            privateIps: ["10.42.0.4"],
            publicIps: ["20.50.60.70"],
            subnetName: "web",
            virtualNetworkName: "acme-vnet",
            primary: true,
          },
        ],
        availabilityZone: "1",
        tags: {
          customer: "ACME",
          tenant: "legacy-tenant-hint",
          environment: "prod",
        },
        raw: {
          clientSecret: "secret-from-raw",
          nested: { accessToken: "raw-token", harmless: "kept" },
        },
      },
    ],
    nics: [
      {
        id: AZURE_NIC_ID,
        name: "acme-web-01-nic",
        resourceGroup: "rg-acme-prod",
        privateIps: ["10.42.0.4"],
        publicIps: ["20.50.60.70"],
        subnetName: "web",
        virtualNetworkName: "acme-vnet",
        primary: true,
        location: "westeurope",
        tags: { customerScope: "ACME Managed" },
        subnetId: AZURE_SUBNET_ID,
        publicIpId: AZURE_PUBLIC_IP_ID,
      } as any,
    ],
    vnets: [
      {
        id: AZURE_VNET_ID,
        name: "acme-vnet",
        resourceGroup: "rg-acme-prod",
        location: "westeurope",
        addressSpaces: ["10.42.0.0/16"],
        tags: { customer_scope: "ACME Network" },
        subnets: [
          {
            id: AZURE_SUBNET_ID,
            name: "web",
            resourceGroup: "rg-acme-prod",
            virtualNetworkName: "acme-vnet",
            addressPrefix: "10.42.0.0/24",
          },
        ],
      },
    ],
    publicIps: [
      {
        id: AZURE_PUBLIC_IP_ID,
        name: "acme-web-01-pip",
        resourceGroup: "rg-acme-prod",
        location: "westeurope",
        ipAddress: "20.50.60.70",
        ipVersion: "IPv4",
        fqdn: "acme-web-01.westeurope.cloudapp.azure.com",
        associatedNicId: AZURE_NIC_ID,
        tags: { environment: "prod" },
      },
    ],
  };
}

function makeAzureCollector(discovery: AzureDiscoveryResult) {
  return {
    testConnection: async () => ({ ok: true }),
    listVms: async () => {
      throw new Error("Azure normalized sync must use discoverAll");
    },
    discoverAll: async () => discovery,
  };
}

function makeProxmoxConfig(overrides: Record<string, unknown> = {}) {
  return {
    base_url: "https://pve.example.test:8006",
    auth_method: "api_token",
    username: "root@pam",
    token_id: "rovelink",
    token_secret: "super-secret-proxmox-token",
    cluster_id: PROXMOX_CLUSTER_ID,
    ...overrides,
  };
}

function makeProxmoxVms(vmName = "acme-web-01"): NormalizedVm[] {
  return [
    {
      externalId: "pve1-101",
      name: vmName,
      provider: "proxmox",
      status: "running",
      primaryIp4: "10.20.30.40",
      vcpus: 4,
      memory: 8192,
      disk: 128,
      tags: ["customer=ACME", "tenant:legacy-tenant", "environment/prod"],
      raw: {
        vmid: 101,
        node: "pve1",
        status: "running",
        tags: "customer=ACME;tenant:legacy-tenant;environment/prod",
        pool: "customer-ACME",
        notes: "customer: ACME Notes",
        nested: {
          token_secret: "raw-proxmox-token",
          authorization: "Bearer raw-auth",
          harmless: "kept",
        },
      },
    },
    {
      externalId: "pve2-202",
      name: "beta-db-01",
      provider: "proxmox",
      status: "stopped",
      tags: ["customer/Beta"],
      raw: {
        vmid: 202,
        node: "pve2",
        status: "stopped",
        pool: "tenant-Beta",
      },
    },
  ];
}

function makeProxmoxCollector(vms: NormalizedVm[]) {
  return {
    testConnection: async () => ({ ok: true }),
    listVms: async () => vms,
  };
}

class ProviderInfrastructureMemoryStore {
  providers = new Map<string, ProviderAccount>();
  objects: InfrastructureObject[] = [];
  candidates: ProviderCustomerScopeCandidate[] = [];
  customerScopes: unknown[] = [];
  customerScopeAssignments: unknown[] = [];
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

    const existing = this.objects.find((object) => (
      object.orgId === input.orgId &&
      object.sourceId === input.sourceId &&
      object.objectType === input.objectType &&
      object.externalId === input.externalId
    ));
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

  async upsertProviderCustomerScopeCandidate(
    input: InsertProviderCustomerScopeCandidate,
  ): Promise<ProviderCustomerScopeCandidate> {
    const object = this.objects.find((candidateObject) => (
      candidateObject.id === input.objectId &&
      candidateObject.orgId === input.orgId &&
      candidateObject.sourceId === input.sourceId
    ));
    if (!object) {
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
}

let server: Server;
let req: ReturnType<typeof supertest>;
let store: ProviderInfrastructureMemoryStore;
const originals = {
  getUser: storage.getUser,
  getProvider: storage.getProvider,
  upsertInfrastructureObject: storage.upsertInfrastructureObject,
  upsertProviderCustomerScopeCandidate: storage.upsertProviderCustomerScopeCandidate,
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
  store = new ProviderInfrastructureMemoryStore();
  store.providers.set("fake-provider-a", makeProvider({ id: "fake-provider-a", orgId: ORG_A }));
  store.providers.set("fake-provider-b", makeProvider({ id: "fake-provider-b", orgId: ORG_A, name: "Fake Provider B" }));
  store.providers.set("fake-provider-other-org", makeProvider({ id: "fake-provider-other-org", orgId: ORG_B }));
  store.providers.set("azure-provider-a", makeProvider({
    id: "azure-provider-a",
    orgId: ORG_A,
    kind: "azure",
    name: "Azure Provider",
    config: makeAzureConfig(),
  }));
  store.providers.set("azure-provider-other-org", makeProvider({
    id: "azure-provider-other-org",
    orgId: ORG_B,
    kind: "azure",
    name: "Azure Other Org",
    config: makeAzureConfig(),
  }));
  store.providers.set("proxmox-provider-a", makeProvider({
    id: "proxmox-provider-a",
    orgId: ORG_A,
    kind: "proxmox",
    name: "Proxmox Provider",
    config: makeProxmoxConfig(),
  }));
  store.providers.set("proxmox-provider-other-org", makeProvider({
    id: "proxmox-provider-other-org",
    orgId: ORG_B,
    kind: "proxmox",
    name: "Proxmox Other Org",
    config: makeProxmoxConfig(),
  }));

  storage.getUser = store.getUser.bind(store) as any;
  storage.getProvider = store.getProvider.bind(store) as any;
  storage.upsertInfrastructureObject = store.upsertInfrastructureObject.bind(store) as any;
  storage.upsertProviderCustomerScopeCandidate = store.upsertProviderCustomerScopeCandidate.bind(store) as any;
});

after(async () => {
  storage.getUser = originals.getUser;
  storage.getProvider = originals.getProvider;
  storage.upsertInfrastructureObject = originals.upsertInfrastructureObject;
  storage.upsertProviderCustomerScopeCandidate = originals.upsertProviderCustomerScopeCandidate;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("fake provider normalized infrastructure sync", () => {
  test("fake normalizer produces objects, candidate hints, and no relationships", () => {
    const vm: NormalizedVm = {
      externalId: "fake-vm-1",
      name: "acme-web-01",
      provider: "fake",
      status: "running",
      primaryIp4: "10.0.0.10",
      tags: ["provider/fake", "customer/ACME", "role/web"],
      raw: {
        vm: {
          id: "native-1",
          location: "eu-west",
          resourceGroup: "rg-acme-prod",
          tags: { customer: "ACME", wave: "Wave1" },
        },
      },
    };

    const result = fakeInfrastructureNormalizer.normalize({
      provider: makeProvider({ id: "fake-provider-a" }),
      orgId: ORG_A,
      items: [vm],
      config: {},
      now: new Date("2026-01-01T00:00:00Z"),
    });

    assert.equal(result.objects.length, 1);
    assert.equal(result.objects[0].providerType, "fake");
    assert.equal(result.objects[0].objectType, "vm");
    assert.equal(result.objects[0].externalId, "fake-vm-1");
    assert.equal(result.objects[0].providerNativeId, "native-1");
    assert.equal(result.objects[0].displayName, "acme-web-01");
    assert.equal(result.relationships.length, 0);
    assert.ok(result.customerScopeCandidates.some((candidate) => (
      candidate.object.externalId === "fake-vm-1" &&
      candidate.derivedFrom === "tag" &&
      candidate.candidateValue === "ACME" &&
      candidate.confidence === "medium"
    )));
    assert.ok(result.customerScopeCandidates.some((candidate) => (
      candidate.derivedFrom === "resource_group" &&
      candidate.candidateValue === "acme" &&
      candidate.confidence === "low"
    )));
  });

  test("generic sync service supports fake provider and writes hints only", async () => {
    const provider = store.providers.get("fake-provider-a")!;

    const res = await syncProviderInfrastructureInventory(
      provider,
      ORG_A,
      provider.config as Record<string, unknown>,
      store as any,
    );

    assert.equal(res.sourceId, "fake-provider-a");
    assert.equal(res.providerType, "fake");
    assert.equal(res.objectsUpserted, 3);
    assert.equal(res.relationshipsUpserted, 0);
    assert.ok(res.customerScopeCandidatesUpserted > 0);
    assert.equal(store.objects.length, 3);
    assert.ok(store.candidates.length > 0);
    assert.equal(store.customerScopes.length, 0);
    assert.equal(store.customerScopeAssignments.length, 0);
  });

  test("generic sync service rejects unsupported providers in this slice", async () => {
    const vmwareProvider = makeProvider({ id: "vmware-provider-a", kind: "vmware", name: "VMware Provider" });

    await assert.rejects(
      syncProviderInfrastructureInventory(vmwareProvider, ORG_A, {}, store as any),
      ProviderInfrastructureSyncNotSupportedError,
    );
  });

  test("creates infrastructure objects and customer scope candidates without exposing provider config", async () => {
    const res = await req
      .post("/api/providers/fake-provider-a/inventory/sync")
      .set("Authorization", `Bearer ${makeToken()}`)
      .expect(200);

    assert.equal(res.body.sourceId, "fake-provider-a");
    assert.equal(res.body.providerType, "fake");
    assert.equal(res.body.objectsUpserted, 3);
    assert.equal(res.body.relationshipsUpserted, 0);
    assert.ok(res.body.customerScopeCandidatesUpserted > 0);
    assert.equal(res.body.config, undefined);
    assert.equal(JSON.stringify(res.body).includes("api_key"), false);
    assert.equal(store.objects.length, 3);
    assert.ok(store.objects.every((object) => object.providerType === "fake"));
    assert.ok(store.objects.every((object) => object.objectType === "vm"));
    assert.ok(store.candidates.length > 0);
  });

  test("repeated fake sync is idempotent", async () => {
    await req
      .post("/api/providers/fake-provider-a/inventory/sync")
      .set("Authorization", `Bearer ${makeToken()}`)
      .expect(200);
    await req
      .post("/api/providers/fake-provider-a/inventory/sync")
      .set("Authorization", `Bearer ${makeToken()}`)
      .expect(200);

    assert.equal(store.objects.length, 3);
    assert.equal(new Set(store.objects.map((object) => object.externalId)).size, 3);
    assert.equal(
      store.candidates.length,
      new Set(store.candidates.map((candidate) => `${candidate.sourceId}:${candidate.objectId}:${candidate.derivedFrom}:${candidate.candidateValue}`)).size,
    );
  });

  test("same fake externalId in another provider source creates separate objects", async () => {
    await req
      .post("/api/providers/fake-provider-a/inventory/sync")
      .set("Authorization", `Bearer ${makeToken()}`)
      .expect(200);
    await req
      .post("/api/providers/fake-provider-b/inventory/sync")
      .set("Authorization", `Bearer ${makeToken()}`)
      .expect(200);

    assert.equal(store.objects.length, 6);
    assert.equal(store.objects.filter((object) => object.sourceId === "fake-provider-a").length, 3);
    assert.equal(store.objects.filter((object) => object.sourceId === "fake-provider-b").length, 3);
  });

  test("object identity uses externalId instead of display name", async () => {
    const provider = store.providers.get("fake-provider-a")!;
    store.providers.set("fake-provider-a", {
      ...provider,
      config: {
        ...provider.config as Record<string, unknown>,
        vms: 2,
        tags: { customer: ["ACME"], wave: ["Wave1"], role: ["web"] },
      },
    });

    await req
      .post("/api/providers/fake-provider-a/inventory/sync")
      .set("Authorization", `Bearer ${makeToken()}`)
      .expect(200);

    store.objects[0].displayName = store.objects[1].displayName;
    await req
      .post("/api/providers/fake-provider-a/inventory/sync")
      .set("Authorization", `Bearer ${makeToken()}`)
      .expect(200);

    assert.equal(store.objects.length, 2);
  });

  test("provider customer scope candidates remain hints only", async () => {
    await req
      .post("/api/providers/fake-provider-a/inventory/sync")
      .set("Authorization", `Bearer ${makeToken()}`)
      .expect(200);

    assert.ok(store.candidates.length > 0);
    assert.equal(store.customerScopes.length, 0);
    assert.equal(store.customerScopeAssignments.length, 0);
    assert.ok(store.candidates.every((candidate) => candidate.confidence !== "authoritative"));
  });

  test("Azure sync creates normalized infrastructure objects and candidate hints", async () => {
    const provider = store.providers.get("azure-provider-a")!;

    const res = await syncProviderInfrastructureInventory(
      provider,
      ORG_A,
      provider.config as Record<string, unknown>,
      store as any,
      { collectorFactory: () => makeAzureCollector(makeAzureDiscovery()) as any },
    );

    assert.equal(res.sourceId, "azure-provider-a");
    assert.equal(res.providerType, "azure");
    assert.equal(res.objectsUpserted, 5);
    assert.equal(res.relationshipsUpserted, 0);
    assert.ok(res.customerScopeCandidatesUpserted > 0);
    assert.equal(res.errors.length, 0);
    assert.equal(store.objects.length, 5);
    assert.ok(store.objects.every((object) => object.providerType === "azure"));

    const vm = store.objects.find((object) => object.objectType === "vm")!;
    assert.equal(vm.externalId, AZURE_VM_ID);
    assert.equal(vm.providerNativeId, AZURE_VM_ID);
    assert.equal(vm.displayName, "acme-web-01");
    assert.equal((vm.metadata as any).raw.clientSecret, "[REDACTED]");
    assert.equal((vm.metadata as any).raw.nested.accessToken, "[REDACTED]");

    assert.ok(store.candidates.some((candidate) => (
      candidate.objectId === vm.id &&
      candidate.derivedFrom === "tag" &&
      candidate.candidateValue === "ACME"
    )));
    assert.ok(store.candidates.some((candidate) => (
      candidate.derivedFrom === "resource_group" &&
      candidate.candidateValue === "acme" &&
      candidate.confidence === "low"
    )));
    assert.ok(store.candidates.some((candidate) => (
      candidate.derivedFrom === "subscription" &&
      candidate.candidateValue === AZURE_SUBSCRIPTION_ID &&
      candidate.confidence === "low"
    )));
    assert.equal(store.customerScopes.length, 0);
    assert.equal(store.customerScopeAssignments.length, 0);
  });

  test("repeated Azure sync is idempotent and VM rename updates mutable fields", async () => {
    const provider = store.providers.get("azure-provider-a")!;

    await syncProviderInfrastructureInventory(
      provider,
      ORG_A,
      provider.config as Record<string, unknown>,
      store as any,
      { collectorFactory: () => makeAzureCollector(makeAzureDiscovery()) as any },
    );
    await syncProviderInfrastructureInventory(
      provider,
      ORG_A,
      provider.config as Record<string, unknown>,
      store as any,
      { collectorFactory: () => makeAzureCollector(makeAzureDiscovery("renamed-web")) as any },
    );

    assert.equal(store.objects.length, 5);
    assert.equal(new Set(store.objects.map((object) => `${object.objectType}:${object.externalId}`)).size, 5);
    const vm = store.objects.find((object) => object.objectType === "vm")!;
    assert.equal(vm.externalId, AZURE_VM_ID);
    assert.equal(vm.displayName, "renamed-web");
    assert.equal(
      store.candidates.length,
      new Set(store.candidates.map((candidate) => `${candidate.sourceId}:${candidate.objectId}:${candidate.derivedFrom}:${candidate.candidateValue}`)).size,
    );
  });

  test("Azure sync validates required config without exposing secrets", async () => {
    const provider = {
      ...store.providers.get("azure-provider-a")!,
      config: makeAzureConfig({ client_secret: "" }),
    };

    await assert.rejects(
      syncProviderInfrastructureInventory(
        provider,
        ORG_A,
        provider.config as Record<string, unknown>,
        store as any,
        { collectorFactory: () => makeAzureCollector(makeAzureDiscovery()) as any },
      ),
      (error: any) => {
        assert.ok(error instanceof ProviderInfrastructureSyncConfigError);
        assert.match(error.message, /client_secret/);
        assert.equal(JSON.stringify(error.result).includes("super-secret-client-secret"), false);
        return true;
      },
    );
  });

  test("Azure collector failures return sanitized errors", async () => {
    const provider = store.providers.get("azure-provider-a")!;

    await assert.rejects(
      syncProviderInfrastructureInventory(
        provider,
        ORG_A,
        provider.config as Record<string, unknown>,
        store as any,
        {
          collectorFactory: () => ({
            testConnection: async () => ({ ok: false }),
            listVms: async () => [],
            discoverAll: async () => {
              throw new Error("client_secret=super-secret-client-secret");
            },
          }),
        },
      ),
      (error: any) => {
        assert.ok(error instanceof ProviderInfrastructureSyncDiscoveryError);
        assert.equal(error.message, "Azure infrastructure discovery failed");
        assert.equal(JSON.stringify(error.result).includes("super-secret-client-secret"), false);
        return true;
      },
    );
  });

  test("Proxmox sync creates normalized VM infrastructure objects and candidate hints", async () => {
    const provider = store.providers.get("proxmox-provider-a")!;

    const res = await syncProviderInfrastructureInventory(
      provider,
      ORG_A,
      provider.config as Record<string, unknown>,
      store as any,
      { collectorFactory: () => makeProxmoxCollector(makeProxmoxVms()) as any },
    );

    assert.equal(res.sourceId, "proxmox-provider-a");
    assert.equal(res.providerType, "proxmox");
    assert.equal(res.objectsUpserted, 2);
    assert.equal(res.relationshipsUpserted, 0);
    assert.ok(res.customerScopeCandidatesUpserted > 0);
    assert.equal(res.errors.length, 0);
    assert.equal(store.objects.length, 2);
    assert.ok(store.objects.every((object) => object.providerType === "proxmox"));

    const vm = store.objects.find((object) => object.externalId.endsWith(":vm:101"))!;
    assert.equal(vm.objectType, "vm");
    assert.equal(vm.externalId, `proxmox:${PROXMOX_CLUSTER_ID}:node:pve1:vm:101`);
    assert.equal(vm.providerNativeId, "101");
    assert.equal(vm.displayName, "acme-web-01");
    assert.equal((vm.metadata as any).raw.nested.token_secret, "[REDACTED]");
    assert.equal((vm.metadata as any).raw.nested.authorization, "[REDACTED]");
    assert.equal((vm.metadata as any).raw.nested.harmless, "kept");

    assert.ok(store.candidates.some((candidate) => (
      candidate.objectId === vm.id &&
      candidate.derivedFrom === "tag" &&
      candidate.candidateValue === "ACME"
    )));
    assert.ok(store.candidates.some((candidate) => (
      candidate.objectId === vm.id &&
      candidate.derivedFrom === "pool" &&
      candidate.candidateValue === "ACME"
    )));
    assert.ok(store.candidates.some((candidate) => (
      candidate.objectId === vm.id &&
      candidate.derivedFrom === "notes" &&
      candidate.candidateValue === "ACME Notes"
    )));
    assert.ok(store.candidates.some((candidate) => (
      candidate.objectId === vm.id &&
      candidate.derivedFrom === "name_convention" &&
      candidate.candidateValue === "acme"
    )));
    assert.equal(store.customerScopes.length, 0);
    assert.equal(store.customerScopeAssignments.length, 0);
    assert.ok(store.candidates.every((candidate) => candidate.confidence !== "authoritative"));
  });

  test("repeated Proxmox sync is idempotent and VM rename updates mutable fields", async () => {
    const provider = store.providers.get("proxmox-provider-a")!;

    await syncProviderInfrastructureInventory(
      provider,
      ORG_A,
      provider.config as Record<string, unknown>,
      store as any,
      { collectorFactory: () => makeProxmoxCollector(makeProxmoxVms()) as any },
    );
    await syncProviderInfrastructureInventory(
      provider,
      ORG_A,
      provider.config as Record<string, unknown>,
      store as any,
      { collectorFactory: () => makeProxmoxCollector(makeProxmoxVms("renamed-web")) as any },
    );

    assert.equal(store.objects.length, 2);
    assert.equal(new Set(store.objects.map((object) => `${object.objectType}:${object.externalId}`)).size, 2);
    const vm = store.objects.find((object) => object.externalId.endsWith(":vm:101"))!;
    assert.equal(vm.displayName, "renamed-web");
    assert.equal(
      store.candidates.length,
      new Set(store.candidates.map((candidate) => `${candidate.sourceId}:${candidate.objectId}:${candidate.derivedFrom}:${candidate.candidateValue}`)).size,
    );
  });

  test("Proxmox sync validates required config without exposing secrets", async () => {
    const provider = {
      ...store.providers.get("proxmox-provider-a")!,
      config: makeProxmoxConfig({ token_secret: "" }),
    };

    await assert.rejects(
      syncProviderInfrastructureInventory(
        provider,
        ORG_A,
        provider.config as Record<string, unknown>,
        store as any,
        { collectorFactory: () => makeProxmoxCollector(makeProxmoxVms()) as any },
      ),
      (error: any) => {
        assert.ok(error instanceof ProviderInfrastructureSyncConfigError);
        assert.match(error.message, /token_secret/);
        assert.equal(JSON.stringify(error.result).includes("super-secret-proxmox-token"), false);
        return true;
      },
    );
  });

  test("Proxmox collector failures return sanitized errors", async () => {
    const provider = store.providers.get("proxmox-provider-a")!;

    await assert.rejects(
      syncProviderInfrastructureInventory(
        provider,
        ORG_A,
        provider.config as Record<string, unknown>,
        store as any,
        {
          collectorFactory: () => ({
            testConnection: async () => ({ ok: false }),
            listVms: async () => {
              throw new Error("token_secret=super-secret-proxmox-token");
            },
          }),
        },
      ),
      (error: any) => {
        assert.ok(error instanceof ProviderInfrastructureSyncDiscoveryError);
        assert.equal(error.message, "proxmox infrastructure discovery failed");
        assert.equal(JSON.stringify(error.result).includes("super-secret-proxmox-token"), false);
        return true;
      },
    );
  });

  test("unsupported provider returns not implemented for normalized infrastructure sync", async () => {
    store.providers.set("vmware-provider-a", makeProvider({
      id: "vmware-provider-a",
      orgId: ORG_A,
      kind: "vmware",
      name: "VMware Provider",
    }));

    const res = await req
      .post("/api/providers/vmware-provider-a/inventory/sync")
      .set("Authorization", `Bearer ${makeToken()}`)
      .expect(501);

    assert.equal(res.body.providerType, "vmware");
    assert.equal(res.body.objectsUpserted, 0);
    assert.match(res.body.message, /only for fake, Azure, and Proxmox providers/);
    assert.equal(store.objects.length, 0);
  });

  test("Azure provider route rejects missing config with controlled response", async () => {
    const provider = store.providers.get("azure-provider-a")!;
    store.providers.set("azure-provider-a", {
      ...provider,
      config: makeAzureConfig({ client_secret: "" }),
    });

    const res = await req
      .post("/api/providers/azure-provider-a/inventory/sync")
      .set("Authorization", `Bearer ${makeToken()}`)
      .expect(400);

    assert.equal(res.body.providerType, "azure");
    assert.match(res.body.message, /missing required fields/);
    assert.equal(JSON.stringify(res.body).includes("super-secret-client-secret"), false);
    assert.equal(store.objects.length, 0);
  });

  test("Proxmox provider route rejects missing config with controlled response", async () => {
    const provider = store.providers.get("proxmox-provider-a")!;
    store.providers.set("proxmox-provider-a", {
      ...provider,
      config: makeProxmoxConfig({ token_secret: "" }),
    });

    const res = await req
      .post("/api/providers/proxmox-provider-a/inventory/sync")
      .set("Authorization", `Bearer ${makeToken()}`)
      .expect(400);

    assert.equal(res.body.providerType, "proxmox");
    assert.match(res.body.message, /missing required fields/);
    assert.equal(JSON.stringify(res.body).includes("super-secret-proxmox-token"), false);
    assert.equal(store.objects.length, 0);
  });

  test("cross-org Azure provider access is rejected", async () => {
    await req
      .post("/api/providers/azure-provider-other-org/inventory/sync")
      .set("Authorization", `Bearer ${makeToken("operator", ORG_A)}`)
      .expect(404);

    assert.equal(store.objects.length, 0);
  });

  test("cross-org Proxmox provider access is rejected", async () => {
    await req
      .post("/api/providers/proxmox-provider-other-org/inventory/sync")
      .set("Authorization", `Bearer ${makeToken("operator", ORG_A)}`)
      .expect(404);

    assert.equal(store.objects.length, 0);
  });

  test("cross-org provider access is rejected", async () => {
    await req
      .post("/api/providers/fake-provider-other-org/inventory/sync")
      .set("Authorization", `Bearer ${makeToken("operator", ORG_A)}`)
      .expect(404);

    assert.equal(store.objects.length, 0);
  });
});

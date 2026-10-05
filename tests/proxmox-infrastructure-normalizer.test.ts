import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { proxmoxInfrastructureNormalizer } from "../server/services/infrastructure-normalizers/proxmox";
import {
  ProviderInfrastructureSyncNotSupportedError,
  syncProviderInfrastructureInventory,
} from "../server/services/provider-infrastructure-sync";
import type { NormalizedVm } from "../server/services/providers/types";
import type { ProviderAccount } from "../shared/schema";

const ORG_ID = "org-a";
const PROVIDER_ID = "proxmox-provider-a";
const CLUSTER_ID = "pve-cluster-a";

function makeProvider(): ProviderAccount {
  const now = new Date();
  return {
    id: PROVIDER_ID,
    orgId: ORG_ID,
    kind: "proxmox",
    name: "Proxmox Provider",
    enabled: true,
    scheduleCron: null,
    config: { cluster_id: CLUSTER_ID },
    createdAt: now,
    updatedAt: now,
  };
}

function makeVm(overrides: Partial<NormalizedVm> = {}): NormalizedVm {
  return {
    externalId: "pve1-101",
    name: "acme-web-01",
    provider: "proxmox",
    status: "running",
    primaryIp4: "10.20.30.40",
    vcpus: 4,
    memory: 8192,
    disk: 128,
    tags: [
      "customer=ACME",
      "tenant:legacy-tenant",
      "environment/prod",
      "apiToken=tag-secret",
    ],
    raw: {
      vmid: 101,
      node: "pve1",
      status: "running",
      tags: "customer=ACME;tenant:legacy-tenant;environment/prod;apiToken=tag-secret",
      pool: "customer-ACME",
      notes: "customer: ACME Notes\nmanaged by demo",
      template: false,
      interfaces: [
        { name: "net0", bridge: "vmbr0", mac: "52:54:00:00:00:01" },
      ],
      nested: {
        password: "raw-password",
        key: "raw-key",
        clientSecret: "raw-client-secret",
        accessToken: "raw-token",
        refreshToken: "raw-refresh-token",
        authorization: "Bearer raw-authorization",
        harmless: "kept",
      },
    },
    ...overrides,
  };
}

function normalize(items: NormalizedVm[] = [makeVm()]) {
  return proxmoxInfrastructureNormalizer.normalize({
    provider: makeProvider(),
    orgId: ORG_ID,
    items,
    config: { cluster_id: CLUSTER_ID },
    now: new Date("2026-01-01T00:00:00Z"),
  });
}

describe("Proxmox infrastructure normalizer", () => {
  test("uses cluster, node, and vmid as identity instead of VM name", () => {
    const result = normalize();
    const vm = result.objects[0];

    assert.equal(vm.providerType, "proxmox");
    assert.equal(vm.objectType, "vm");
    assert.equal(vm.externalId, `proxmox:${CLUSTER_ID}:node:pve1:vm:101`);
    assert.equal(vm.providerNativeId, "101");
    assert.equal(vm.name, "acme-web-01");
    assert.equal(vm.displayName, "acme-web-01");

    const renamed = normalize([makeVm({ name: "renamed-web" })]).objects[0];
    assert.equal(renamed.externalId, vm.externalId);
    assert.equal(renamed.displayName, "renamed-web");
  });

  test("same VM name with different VMID creates different externalId", () => {
    const result = normalize([
      makeVm(),
      makeVm({
        externalId: "pve1-102",
        raw: {
          ...(makeVm().raw as Record<string, unknown>),
          vmid: 102,
          node: "pve1",
        },
      }),
    ]);

    assert.equal(result.objects.length, 2);
    assert.equal(new Set(result.objects.map((object) => object.externalId)).size, 2);
    assert.ok(result.objects.some((object) => object.externalId.endsWith(":vm:101")));
    assert.ok(result.objects.some((object) => object.externalId.endsWith(":vm:102")));
  });

  test("maps node, cluster, status, power state, tags, labels, and sanitized metadata", () => {
    const vm = normalize().objects[0];

    assert.equal(vm.cluster, CLUSTER_ID);
    assert.equal(vm.node, "pve1");
    assert.equal(vm.lifecycleState, "running");
    assert.equal(vm.powerState, "running");
    assert.deepEqual(vm.tags, [
      "customer=ACME",
      "tenant:legacy-tenant",
      "environment/prod",
      "apiToken=[REDACTED]",
    ]);
    assert.equal((vm.labels as any).customer, "ACME");
    assert.equal((vm.labels as any).apiToken, "[REDACTED]");

    const metadata = vm.metadata as Record<string, any>;
    assert.equal(metadata.vmid, "101");
    assert.equal(metadata.primaryIp4, "10.20.30.40");
    assert.equal(metadata.vcpus, 4);
    assert.equal(metadata.memory, 8192);
    assert.equal(metadata.disk, 128);
    assert.equal(metadata.pool, "customer-ACME");
    assert.equal(metadata.template, false);
    assert.equal(metadata.raw.nested.password, "[REDACTED]");
    assert.equal(metadata.raw.nested.key, "[REDACTED]");
    assert.equal(metadata.raw.nested.clientSecret, "[REDACTED]");
    assert.equal(metadata.raw.nested.accessToken, "[REDACTED]");
    assert.equal(metadata.raw.nested.refreshToken, "[REDACTED]");
    assert.equal(metadata.raw.nested.authorization, "[REDACTED]");
    assert.equal(metadata.raw.nested.harmless, "kept");
  });

  test("extracts CustomerScope candidates as non-authoritative hints", () => {
    const result = normalize();
    const candidates = result.customerScopeCandidates;

    assert.ok(candidates.some((candidate) => (
      candidate.derivedFrom === "tag" &&
      candidate.candidateValue === "ACME" &&
      candidate.confidence === "medium"
    )));
    assert.ok(candidates.some((candidate) => (
      candidate.derivedFrom === "tag" &&
      candidate.candidateValue === "legacy-tenant" &&
      candidate.confidence === "medium"
    )));
    assert.ok(candidates.some((candidate) => (
      candidate.derivedFrom === "pool" &&
      candidate.candidateValue === "ACME" &&
      candidate.confidence === "medium"
    )));
    assert.ok(candidates.some((candidate) => (
      candidate.derivedFrom === "notes" &&
      candidate.candidateValue === "ACME Notes" &&
      candidate.confidence === "low"
    )));
    assert.ok(candidates.some((candidate) => (
      candidate.derivedFrom === "name_convention" &&
      candidate.candidateValue === "acme" &&
      candidate.confidence === "low"
    )));
    assert.ok(candidates.every((candidate) => candidate.confidence !== "authoritative"));
  });

  test("does not create CustomerScopes, assignments, or relationships", () => {
    const result = normalize();

    assert.equal(result.relationships.length, 0);
    assert.equal("customerScopes" in result, false);
    assert.equal("customerScopeObjectAssignments" in result, false);
    assert.ok(result.customerScopeCandidates.length > 0);
  });

  test("skips VM when node or vmid is missing", () => {
    const result = normalize([
      {
        ...makeVm(),
        externalId: "missing-stable-id",
        raw: { name: "missing-stable-id" },
      },
    ]);

    assert.equal(result.objects.length, 0);
    assert.equal(result.skipped.length, 1);
  });

  test("Proxmox remains disabled in generic sync service", async () => {
    await assert.rejects(
      syncProviderInfrastructureInventory(makeProvider(), ORG_ID, {}, {} as any),
      ProviderInfrastructureSyncNotSupportedError,
    );
  });
});

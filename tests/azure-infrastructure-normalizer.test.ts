import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { azureInfrastructureNormalizer } from "../server/services/infrastructure-normalizers/azure";
import {
  ProviderInfrastructureSyncNotSupportedError,
  syncProviderInfrastructureInventory,
} from "../server/services/provider-infrastructure-sync";
import type { AzureDiscoveryResult } from "../server/services/providers/azure";
import type { ProviderAccount } from "../shared/schema";

const ORG_ID = "org-a";
const PROVIDER_ID = "azure-provider-a";
const SUBSCRIPTION_ID = "sub-123";
const VM_ARM_ID = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/rg-acme-prod/providers/Microsoft.Compute/virtualMachines/acme-web-01`;
const NIC_ARM_ID = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/rg-acme-prod/providers/Microsoft.Network/networkInterfaces/acme-web-01-nic`;
const VNET_ARM_ID = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/rg-acme-prod/providers/Microsoft.Network/virtualNetworks/acme-vnet`;
const SUBNET_ARM_ID = `${VNET_ARM_ID}/subnets/web`;
const PUBLIC_IP_ARM_ID = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/rg-acme-prod/providers/Microsoft.Network/publicIPAddresses/acme-web-01-pip`;

function makeProvider(): ProviderAccount {
  const now = new Date();
  return {
    id: PROVIDER_ID,
    orgId: ORG_ID,
    kind: "azure",
    name: "Azure Provider",
    enabled: true,
    scheduleCron: null,
    config: {},
    createdAt: now,
    updatedAt: now,
  };
}

function makeDiscovery(): AzureDiscoveryResult {
  return {
    subscriptionId: SUBSCRIPTION_ID,
    vms: [
      {
        id: VM_ARM_ID,
        name: "acme-web-01",
        location: "westeurope",
        resourceGroup: "rg-acme-prod",
        subscriptionId: SUBSCRIPTION_ID,
        status: "running",
        platform: "linux",
        computerName: "acme-web-01",
        vmSize: "Standard_D2s_v5",
        vcpus: 2,
        ramGiB: 8,
        disk: 128,
        osDiskName: "acme-web-01-osdisk",
        imagePublisher: "Canonical",
        imageOffer: "0001-com-ubuntu-server-jammy",
        imagePlan: "22_04-lts",
        primaryIp4: "10.42.0.4",
        nics: [
          {
            id: NIC_ARM_ID,
            name: "acme-web-01-nic",
            resourceGroup: "rg-acme-prod",
            privateIps: ["10.42.0.4"],
            publicIps: ["20.50.60.70"],
            subnetName: "web",
            virtualNetworkName: "acme-vnet",
            primary: true,
          },
        ],
        securityType: "TrustedLaunch",
        secureBoot: true,
        vtpm: true,
        availabilityZone: "1",
        tags: {
          customer: "ACME",
          customerScope: "ACME Managed",
          tenant: "legacy-tenant-tag",
          environment: "prod",
        },
        raw: {
          clientSecret: "super-secret",
          nested: { accessToken: "token-value", harmless: "kept" },
        },
      },
    ],
    nics: [
      {
        id: NIC_ARM_ID,
        name: "acme-web-01-nic",
        resourceGroup: "rg-acme-prod",
        macAddress: "00-11-22-33-44-55",
        vmId: VM_ARM_ID,
        vmName: "acme-web-01",
        privateIps: ["10.42.0.4"],
        publicIps: ["20.50.60.70"],
        subnetName: "web",
        virtualNetworkName: "acme-vnet",
        primary: true,
        location: "westeurope",
        tags: { customer: "ACME" },
        subnetId: SUBNET_ARM_ID,
        publicIpId: PUBLIC_IP_ARM_ID,
      } as any,
    ],
    vnets: [
      {
        id: VNET_ARM_ID,
        name: "acme-vnet",
        resourceGroup: "rg-acme-prod",
        location: "westeurope",
        addressSpaces: ["10.42.0.0/16"],
        tags: { customer_scope: "ACME Network" },
        subnets: [
          {
            id: SUBNET_ARM_ID,
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
        id: PUBLIC_IP_ARM_ID,
        name: "acme-web-01-pip",
        resourceGroup: "rg-acme-prod",
        location: "westeurope",
        ipAddress: "20.50.60.70",
        ipVersion: "IPv4",
        fqdn: "acme-web-01.westeurope.cloudapp.azure.com",
        associatedNicId: NIC_ARM_ID,
        tags: { environment: "prod" },
      },
    ],
  };
}

function normalize(discovery = makeDiscovery()) {
  return azureInfrastructureNormalizer.normalize({
    provider: makeProvider(),
    orgId: ORG_ID,
    items: [discovery],
    config: {},
    now: new Date("2026-01-01T00:00:00Z"),
  });
}

describe("Azure infrastructure normalizer", () => {
  test("uses Azure ARM ids as object identity, not display names", () => {
    const result = normalize();
    const vm = result.objects.find((object) => object.objectType === "vm")!;

    assert.equal(vm.providerType, "azure");
    assert.equal(vm.externalId, VM_ARM_ID);
    assert.equal(vm.providerNativeId, VM_ARM_ID);
    assert.equal(vm.name, "acme-web-01");
    assert.equal(vm.displayName, "acme-web-01");

    const renamedDiscovery = makeDiscovery();
    renamedDiscovery.vms[0].name = "renamed-web";
    const renamedVm = normalize(renamedDiscovery).objects.find((object) => object.objectType === "vm")!;
    assert.equal(renamedVm.externalId, VM_ARM_ID);
    assert.equal(renamedVm.displayName, "renamed-web");
  });

  test("maps VM region, zone, status, tags, labels, and sanitized metadata", () => {
    const result = normalize();
    const vm = result.objects.find((object) => object.objectType === "vm")!;

    assert.equal(vm.region, "westeurope");
    assert.equal(vm.zone, "1");
    assert.equal(vm.lifecycleState, "running");
    assert.equal(vm.powerState, "running");
    assert.deepEqual(vm.tags, {
      customer: "ACME",
      customerScope: "ACME Managed",
      tenant: "legacy-tenant-tag",
      environment: "prod",
    });
    assert.deepEqual(vm.labels, vm.tags);

    const metadata = vm.metadata as Record<string, any>;
    assert.equal(metadata.vmSize, "Standard_D2s_v5");
    assert.equal(metadata.platform, "linux");
    assert.equal(metadata.primaryIp4, "10.42.0.4");
    assert.equal(metadata.securityType, "TrustedLaunch");
    assert.equal(metadata.raw.clientSecret, "[REDACTED]");
    assert.equal(metadata.raw.nested.accessToken, "[REDACTED]");
    assert.equal(metadata.raw.nested.harmless, "kept");
  });

  test("creates CustomerScope candidates as non-authoritative provider hints", () => {
    const result = normalize();
    const vmCandidates = result.customerScopeCandidates.filter((candidate) => (
      candidate.object.objectType === "vm" &&
      candidate.object.externalId === VM_ARM_ID
    ));

    assert.ok(vmCandidates.some((candidate) => (
      candidate.derivedFrom === "tag" &&
      candidate.candidateValue === "ACME" &&
      candidate.confidence === "high"
    )));
    assert.ok(vmCandidates.some((candidate) => (
      candidate.derivedFrom === "tag" &&
      candidate.candidateValue === "ACME Managed" &&
      candidate.confidence === "high"
    )));
    const tenantCandidate = vmCandidates.find((candidate) => candidate.candidateValue === "legacy-tenant-tag");
    assert.equal(tenantCandidate?.derivedFrom, "tag");
    assert.equal(tenantCandidate?.confidence, "medium");
    assert.equal((tenantCandidate?.metadata as any).azureTenantMeaning, "provider_hint_not_azure_ad_authority");
    assert.notEqual(tenantCandidate?.confidence, "authoritative");
    assert.ok(vmCandidates.some((candidate) => (
      candidate.derivedFrom === "resource_group" &&
      candidate.candidateValue === "acme" &&
      candidate.confidence === "low"
    )));
    assert.ok(vmCandidates.some((candidate) => (
      candidate.derivedFrom === "subscription" &&
      candidate.candidateValue === SUBSCRIPTION_ID &&
      candidate.confidence === "low"
    )));
  });

  test("maps NIC, VNet, subnet, and public IP objects with ARM identities", () => {
    const result = normalize();
    const nic = result.objects.find((object) => object.objectType === "network_interface")!;
    const vnet = result.objects.find((object) => object.objectType === "vnet")!;
    const subnet = result.objects.find((object) => object.objectType === "subnet")!;
    const publicIp = result.objects.find((object) => object.objectType === "public_ip")!;

    assert.equal(nic.externalId, NIC_ARM_ID);
    assert.equal(nic.region, "westeurope");
    assert.deepEqual((nic.metadata as any).subnetIds, [SUBNET_ARM_ID]);
    assert.deepEqual((nic.metadata as any).publicIpIds, [PUBLIC_IP_ARM_ID]);
    assert.equal((nic.metadata as any).macAddress, "00-11-22-33-44-55");

    assert.equal(vnet.externalId, VNET_ARM_ID);
    assert.equal(vnet.region, "westeurope");
    assert.deepEqual((vnet.metadata as any).addressSpaces, ["10.42.0.0/16"]);
    assert.deepEqual((vnet.metadata as any).subnetIds, [SUBNET_ARM_ID]);

    assert.equal(subnet.externalId, SUBNET_ARM_ID);
    assert.equal((subnet.metadata as any).vnetId, VNET_ARM_ID);
    assert.equal((subnet.metadata as any).addressPrefix, "10.42.0.0/24");

    assert.equal(publicIp.externalId, PUBLIC_IP_ARM_ID);
    assert.equal((publicIp.metadata as any).ipAddress, "20.50.60.70");
    assert.equal((publicIp.metadata as any).associatedNicId, NIC_ARM_ID);
  });

  test("does not create CustomerScopes, assignments, or relationships", () => {
    const result = normalize();

    assert.equal(result.relationships.length, 0);
    assert.equal("customerScopes" in result, false);
    assert.equal("customerScopeObjectAssignments" in result, false);
    assert.ok(result.customerScopeCandidates.length > 0);
  });

  test("Azure remains disabled in generic sync service", async () => {
    await assert.rejects(
      syncProviderInfrastructureInventory(makeProvider(), ORG_ID, {}, {} as any),
      ProviderInfrastructureSyncNotSupportedError,
    );
  });
});

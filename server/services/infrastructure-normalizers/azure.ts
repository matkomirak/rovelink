import type { ProviderAccount } from "@shared/schema";
import type {
  AzureDiscoveryResult,
  AzureNormalizedNic,
  AzureNormalizedPublicIp,
  AzureNormalizedSubnet,
  AzureNormalizedVNet,
  AzureNormalizedVm,
} from "../providers/azure";
import type {
  InfrastructureNormalizationResult,
  InfrastructureProviderNormalizer,
  NormalizedInfrastructureObjectInput,
  NormalizedProviderCustomerScopeCandidateInput,
} from "./types";

type AzureTaggedObject = {
  id?: string;
  name?: string;
  resourceGroup?: string;
  subscriptionId?: string;
  tags?: Record<string, unknown>;
};

const CUSTOMER_TAG_KEYS = new Set([
  "customer",
  "customerscope",
  "customer_scope",
  "tenant",
  "environment",
]);

export class AzureInfrastructureNormalizer implements InfrastructureProviderNormalizer<AzureDiscoveryResult> {
  providerType = "azure" as const;

  normalize(input: {
    provider: ProviderAccount;
    orgId: string;
    items: AzureDiscoveryResult[];
    config: Record<string, unknown>;
    now: Date;
  }): InfrastructureNormalizationResult {
    const result: InfrastructureNormalizationResult = {
      objects: [],
      relationships: [],
      customerScopeCandidates: [],
      skipped: [],
      errors: [],
    };

    for (const discovery of input.items) {
      if (!discovery || typeof discovery !== "object") { result.skipped.push({ reason: "Invalid Azure discovery record" }); continue; }
      const subscriptionId = discovery.subscriptionId;

      for (const vm of validRecords(discovery.vms, result)) {
        safelyNormalize(result, () => {
        addObject(result, normalizeAzureVm(vm, input.now));
        result.customerScopeCandidates.push(...buildCandidates("vm", vm.id, vm, input.now, subscriptionId));
        });
      }

      for (const nic of validRecords(discovery.nics, result)) {
        safelyNormalize(result, () => {
        addObject(result, normalizeAzureNic(nic, input.now));
        result.customerScopeCandidates.push(...buildCandidates("network_interface", nic.id, nic, input.now, subscriptionId));
        });
      }

      for (const vnet of validRecords(discovery.vnets, result)) {
        safelyNormalize(result, () => {
        addObject(result, normalizeAzureVNet(vnet, input.now));
        result.customerScopeCandidates.push(...buildCandidates("vnet", vnet.id, vnet, input.now, subscriptionId));

        for (const subnet of validRecords(vnet.subnets, result)) {
          safelyNormalize(result, () => {
          addObject(result, normalizeAzureSubnet(subnet, input.now, vnet));
          result.customerScopeCandidates.push(...buildCandidates("subnet", subnet.id, subnet, input.now, subscriptionId));
          });
        }
        });
      }

      for (const publicIp of validRecords(discovery.publicIps, result)) {
        safelyNormalize(result, () => {
        addObject(result, normalizeAzurePublicIp(publicIp, input.now));
        result.customerScopeCandidates.push(...buildCandidates("public_ip", publicIp.id, publicIp, input.now, subscriptionId));
        });
      }
    }

    return result;
  }
}

export const azureInfrastructureNormalizer = new AzureInfrastructureNormalizer();

function validRecords<T>(items: T[] | undefined, result: InfrastructureNormalizationResult): T[] {
  if (items === undefined) return [];
  if (!Array.isArray(items)) { result.skipped.push({ reason: "Invalid Azure record collection" }); return []; }
  return items.filter(item => {
    if (item && typeof item === "object" && !Array.isArray(item)) return true;
    result.skipped.push({ reason: "Invalid Azure object record" });
    return false;
  });
}

function safelyNormalize(result: InfrastructureNormalizationResult, action: () => void): void {
  try { action(); } catch { result.errors.push({ message: "Invalid Azure object record" }); }
}

function addObject(result: InfrastructureNormalizationResult, object: NormalizedInfrastructureObjectInput | null) {
  if (!object?.externalId) {
    result.skipped.push({ reason: "Azure object is missing stable ARM resource id" });
    return;
  }
  result.objects.push(object);
}

function normalizeAzureVm(vm: AzureNormalizedVm, lastSyncedAt: Date): NormalizedInfrastructureObjectInput {
  return {
    providerType: "azure",
    objectType: "vm",
    externalId: vm.id,
    providerNativeId: vm.id,
    name: vm.name,
    displayName: vm.name,
    region: vm.location ?? null,
    zone: vm.availabilityZone ?? null,
    cluster: null,
    node: null,
    lifecycleState: vm.status ?? null,
    powerState: vm.status ?? null,
    tags: vm.tags ?? {},
    labels: vm.tags ?? {},
    metadata: sanitizeMetadata({
      resourceGroup: vm.resourceGroup,
      subscriptionId: vm.subscriptionId,
      vmSize: vm.vmSize,
      platform: vm.platform,
      computerName: vm.computerName,
      vcpus: vm.vcpus,
      ramGiB: vm.ramGiB,
      osDiskName: vm.osDiskName,
      disk: vm.disk,
      diskControllerType: vm.diskControllerType,
      dataDisksCount: vm.dataDisksCount,
      imagePublisher: vm.imagePublisher,
      imageOffer: vm.imageOffer,
      imagePlan: vm.imagePlan,
      primaryIp4: vm.primaryIp4,
      nicIds: (vm.nics ?? []).map((nic) => nic.id),
      privateIps: (vm.nics ?? []).flatMap((nic) => nic.privateIps ?? []),
      publicIps: (vm.nics ?? []).flatMap((nic) => nic.publicIps ?? []),
      securityType: vm.securityType,
      secureBoot: vm.secureBoot,
      vtpm: vm.vtpm,
      availabilitySet: vm.availabilitySet,
      scaleSet: vm.scaleSet,
      spot: vm.spot,
      spotEvictionPolicy: vm.spotEvictionPolicy,
      generation: vm.generation,
      architecture: vm.architecture,
      hibernation: vm.hibernation,
      extensions: vm.extensions,
      raw: vm.raw,
    }),
    raw: null,
    lastSyncedAt,
  };
}

function normalizeAzureNic(nic: AzureNormalizedNic, lastSyncedAt: Date): NormalizedInfrastructureObjectInput {
  const rawNic = nic as AzureNormalizedNic & {
    location?: string;
    tags?: Record<string, unknown>;
    subnetId?: string;
    subnetIds?: string[];
    publicIpId?: string;
    publicIpIds?: string[];
  };

  return {
    providerType: "azure",
    objectType: "network_interface",
    externalId: nic.id,
    providerNativeId: nic.id,
    name: nic.name,
    displayName: nic.name,
    region: rawNic.location ?? null,
    zone: null,
    cluster: null,
    node: null,
    lifecycleState: null,
    powerState: null,
    tags: rawNic.tags ?? {},
    labels: rawNic.tags ?? {},
    metadata: sanitizeMetadata({
      resourceGroup: nic.resourceGroup,
      macAddress: nic.macAddress,
      vmId: nic.vmId,
      vmName: nic.vmName,
      privateIps: nic.privateIps,
      publicIps: nic.publicIps,
      subnetName: nic.subnetName,
      virtualNetworkName: nic.virtualNetworkName,
      subnetIds: rawNic.subnetIds ?? (rawNic.subnetId ? [rawNic.subnetId] : []),
      publicIpIds: rawNic.publicIpIds ?? (rawNic.publicIpId ? [rawNic.publicIpId] : []),
      primary: nic.primary,
    }),
    raw: null,
    lastSyncedAt,
  };
}

function normalizeAzureVNet(vnet: AzureNormalizedVNet, lastSyncedAt: Date): NormalizedInfrastructureObjectInput {
  return {
    providerType: "azure",
    objectType: "vnet",
    externalId: vnet.id,
    providerNativeId: vnet.id,
    name: vnet.name,
    displayName: vnet.name,
    region: vnet.location ?? null,
    zone: null,
    cluster: null,
    node: null,
    lifecycleState: null,
    powerState: null,
    tags: vnet.tags ?? {},
    labels: vnet.tags ?? {},
    metadata: sanitizeMetadata({
      resourceGroup: vnet.resourceGroup,
      addressSpaces: vnet.addressSpaces,
      subnetIds: (vnet.subnets ?? []).map((subnet) => subnet.id),
    }),
    raw: null,
    lastSyncedAt,
  };
}

function normalizeAzureSubnet(
  subnet: AzureNormalizedSubnet,
  lastSyncedAt: Date,
  vnet: AzureNormalizedVNet,
): NormalizedInfrastructureObjectInput {
  return {
    providerType: "azure",
    objectType: "subnet",
    externalId: subnet.id,
    providerNativeId: subnet.id,
    name: subnet.name,
    displayName: subnet.name,
    region: vnet.location ?? null,
    zone: null,
    cluster: null,
    node: null,
    lifecycleState: null,
    powerState: null,
    tags: {},
    labels: {},
    metadata: sanitizeMetadata({
      resourceGroup: subnet.resourceGroup,
      virtualNetworkName: subnet.virtualNetworkName,
      vnetId: vnet.id,
      addressPrefix: subnet.addressPrefix,
      addressPrefixes: subnet.addressPrefixes,
    }),
    raw: null,
    lastSyncedAt,
  };
}

function normalizeAzurePublicIp(publicIp: AzureNormalizedPublicIp, lastSyncedAt: Date): NormalizedInfrastructureObjectInput {
  return {
    providerType: "azure",
    objectType: "public_ip",
    externalId: publicIp.id,
    providerNativeId: publicIp.id,
    name: publicIp.name,
    displayName: publicIp.name,
    region: publicIp.location ?? null,
    zone: null,
    cluster: null,
    node: null,
    lifecycleState: null,
    powerState: null,
    tags: publicIp.tags ?? {},
    labels: publicIp.tags ?? {},
    metadata: sanitizeMetadata({
      resourceGroup: publicIp.resourceGroup,
      ipAddress: publicIp.ipAddress,
      ipVersion: publicIp.ipVersion,
      fqdn: publicIp.fqdn,
      associatedNicId: publicIp.associatedNicId,
    }),
    raw: null,
    lastSyncedAt,
  };
}

function buildCandidates(
  objectType: string,
  externalId: string,
  item: AzureTaggedObject,
  lastSyncedAt: Date,
  subscriptionId?: string,
): NormalizedProviderCustomerScopeCandidateInput[] {
  const candidates = new Map<string, NormalizedProviderCustomerScopeCandidateInput>();
  const addCandidate = (
    derivedFrom: NormalizedProviderCustomerScopeCandidateInput["derivedFrom"],
    value: unknown,
    confidence: NormalizedProviderCustomerScopeCandidateInput["confidence"],
    metadata: Record<string, unknown>,
  ) => {
    if (typeof value !== "string" || value.trim().length === 0) return;
    const candidateValue = value.trim();
    const key = `${derivedFrom}:${candidateValue}`;
    if (candidates.has(key)) return;
    candidates.set(key, {
      object: { objectType, externalId },
      derivedFrom,
      candidateValue,
      confidence,
      metadata: sanitizeMetadata({ provider: "azure", ...metadata }),
      lastSyncedAt,
    });
  };

  for (const [key, value] of Object.entries(item.tags ?? {})) {
    const normalizedKey = key.replace(/[-_\s]/g, "").toLowerCase();
    if (!CUSTOMER_TAG_KEYS.has(normalizedKey)) continue;

    const confidence = normalizedKey === "customer" || normalizedKey === "customerscope" || normalizedKey === "customer_scope"
      ? "high"
      : "medium";
    addCandidate("tag", value, confidence, {
      source: "azure_tag",
      key,
      azureTenantMeaning: normalizedKey === "tenant" ? "provider_hint_not_azure_ad_authority" : undefined,
    });
  }

  addCandidate("resource_group", parseResourceGroupCandidate(item.resourceGroup), "low", {
    source: "resource_group_name",
    resourceGroup: item.resourceGroup,
  });

  addCandidate("subscription", subscriptionId ?? item.subscriptionId, "low", {
    source: "subscription_id",
    subscriptionId: subscriptionId ?? item.subscriptionId,
  });

  return Array.from(candidates.values());
}

function parseResourceGroupCandidate(resourceGroup: string | undefined): string | null {
  if (!resourceGroup) return null;
  const match = /^rg-([a-z0-9-]+?)(?:-(?:prod|production|dev|test|stage|staging))?$/i.exec(resourceGroup);
  return match?.[1] ?? resourceGroup;
}

function sanitizeMetadata<T>(value: T): T {
  return sanitizeValue(value) as T;
}

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (!value || typeof value !== "object") return value;

  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (isSecretKey(key)) {
      result[key] = "[REDACTED]";
    } else {
      result[key] = sanitizeValue(entry);
    }
  }
  return result;
}

function isSecretKey(key: string): boolean {
  return /(password|token|secret|authorization|api[_-]?key|private[_-]?key|clientsecret|accesstoken|refreshtoken)/i.test(key);
}

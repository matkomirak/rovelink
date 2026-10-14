import type { ProviderAccount } from "@shared/schema";
import type { NormalizedVm } from "../providers/types";
import type {
  InfrastructureNormalizationResult,
  InfrastructureProviderNormalizer,
  NormalizedInfrastructureObjectInput,
  NormalizedProviderCustomerScopeCandidateInput,
} from "./types";

export class FakeInfrastructureNormalizer implements InfrastructureProviderNormalizer<NormalizedVm> {
  providerType = "fake" as const;

  normalize(input: {
    provider: ProviderAccount;
    orgId: string;
    items: NormalizedVm[];
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

    for (const vm of input.items) {
      if (!vm || typeof vm !== "object") { result.skipped.push({ reason: "Invalid provider VM record" }); continue; }
      if (!vm.externalId) {
        result.skipped.push({ reason: "Fake VM is missing stable externalId", item: { name: vm.name } });
        continue;
      }

      try {
        result.objects.push(normalizeFakeVm(vm, input.now));
        result.customerScopeCandidates.push(...buildCustomerScopeCandidates(vm, input.now));
      } catch (error: any) {
        result.errors.push({
          message: error?.message || "Failed to normalize fake infrastructure object",
          item: { externalId: vm.externalId, name: vm.name },
        });
      }
    }

    return result;
  }
}

export const fakeInfrastructureNormalizer = new FakeInfrastructureNormalizer();

function normalizeFakeVm(
  vm: NormalizedVm,
  lastSyncedAt: Date,
): NormalizedInfrastructureObjectInput {
  const rawVm = getRawVm(vm);
  const labels = extractLabels(vm);

  return {
    providerType: "fake",
    objectType: "vm",
    externalId: vm.externalId,
    providerNativeId: extractProviderNativeId(vm),
    name: vm.name,
    displayName: vm.name,
    region: extractRegion(vm),
    zone: null,
    cluster: extractString(rawVm?.cluster),
    node: extractString(rawVm?.node),
    lifecycleState: vm.status ?? extractString(rawVm?.status) ?? extractString(rawVm?.power_state) ?? null,
    powerState: vm.status ?? extractString(rawVm?.power_state) ?? null,
    tags: vm.tags ?? [],
    labels,
    metadata: {
      providerVariant: vm.provider,
      primaryIp4: vm.primaryIp4 ?? null,
      primaryIp6: vm.primaryIp6 ?? null,
      vcpus: vm.vcpus ?? null,
      memory: vm.memory ?? null,
      disk: vm.disk ?? null,
      platform: vm.platform ?? null,
      description: vm.description ?? null,
      site: vm.site ?? null,
      role: vm.role ?? null,
      tenantHint: vm.tenant ?? null,
    },
    raw: vm.raw ?? null,
    lastSyncedAt,
  };
}

function buildCustomerScopeCandidates(
  vm: NormalizedVm,
  lastSyncedAt: Date,
): NormalizedProviderCustomerScopeCandidateInput[] {
  const candidates = new Map<string, NormalizedProviderCustomerScopeCandidateInput>();
  const object = { objectType: "vm", externalId: vm.externalId };
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
      object,
      derivedFrom,
      candidateValue,
      confidence,
      metadata: { provider: "fake", ...metadata },
      lastSyncedAt,
    });
  };

  for (const tag of vm.tags ?? []) {
    const parsed = parseCustomerTag(tag);
    if (parsed) {
      addCandidate("tag", parsed, "medium", { source: "provider_tag", tag });
    }
  }

  const labels = extractLabels(vm);
  addCandidate("label", labels.customer, "medium", { source: "provider_label", key: "customer" });
  addCandidate("label", labels.Customer, "medium", { source: "provider_label", key: "Customer" });

  const resourceGroup = extractString(getRawVm(vm)?.resourceGroup);
  addCandidate("resource_group", parseCustomerFromResourceGroup(resourceGroup), "low", {
    source: "resource_group_name",
    resourceGroup,
  });

  addCandidate("unknown", vm.tenant, "low", { source: "provider_tenant_hint" });

  return Array.from(candidates.values());
}

function parseCustomerTag(tag: string): string | null {
  const slashMatch = /^customer\/(.+)$/i.exec(tag);
  if (slashMatch) return slashMatch[1];

  const colonMatch = /^customer:(.+)$/i.exec(tag);
  if (colonMatch) return colonMatch[1];

  const equalsMatch = /^customer=(.+)$/i.exec(tag);
  if (equalsMatch) return equalsMatch[1];

  return null;
}

function parseCustomerFromResourceGroup(resourceGroup: string | null): string | null {
  if (!resourceGroup) return null;
  const match = /^rg-([a-z0-9-]+?)(?:-(?:prod|production|dev|test|stage|staging))?$/i.exec(resourceGroup);
  return match?.[1] ?? null;
}

function extractProviderNativeId(vm: NormalizedVm): string | null {
  const rawVm = getRawVm(vm);
  const instance = (vm.raw as any)?.instance;
  return extractString(rawVm?.id)
    ?? extractString(rawVm?.instance_uuid)
    ?? extractString(instance?.InstanceId)
    ?? (rawVm?.vmid != null ? String(rawVm.vmid) : null)
    ?? vm.externalId;
}

function extractRegion(vm: NormalizedVm): string | null {
  const rawVm = getRawVm(vm);
  return extractString(rawVm?.location) ?? vm.site ?? null;
}

function extractLabels(vm: NormalizedVm): Record<string, unknown> {
  const rawVm = getRawVm(vm);
  const vmTags = rawVm?.tags;
  if (vmTags && !Array.isArray(vmTags) && typeof vmTags === "object") {
    return { ...(vmTags as Record<string, unknown>) };
  }

  const customAttributes = (vm.raw as any)?.custom_attributes;
  if (customAttributes && typeof customAttributes === "object") {
    return { ...(customAttributes as Record<string, unknown>) };
  }

  return {};
}

function getRawVm(vm: NormalizedVm): Record<string, unknown> | undefined {
  const rawVm = (vm.raw as any)?.vm;
  if (rawVm && typeof rawVm === "object") return rawVm as Record<string, unknown>;
  return undefined;
}

function extractString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

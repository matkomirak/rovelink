import type { ProviderAccount } from "@shared/schema";
import type { NormalizedVm } from "../providers/types";
import type {
  InfrastructureNormalizationResult,
  InfrastructureProviderNormalizer,
  NormalizedInfrastructureObjectInput,
  NormalizedProviderCustomerScopeCandidateInput,
} from "./types";

type ProxmoxVmInput = NormalizedVm & {
  node?: string;
  vmid?: number | string;
  pool?: string;
  notes?: string;
  interfaces?: unknown;
  template?: boolean;
};

type ProxmoxRawVm = Record<string, unknown> & {
  vmid?: number | string;
  name?: string;
  node?: string;
  status?: string;
  tags?: unknown;
  pool?: string;
  notes?: string;
  template?: boolean | number;
  interfaces?: unknown;
};

export class ProxmoxInfrastructureNormalizer implements InfrastructureProviderNormalizer<ProxmoxVmInput> {
  providerType = "proxmox" as const;

  normalize(input: {
    provider: ProviderAccount;
    orgId: string;
    items: ProxmoxVmInput[];
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
      try {
        const object = normalizeProxmoxVm(vm, input.provider, input.config, input.now);
        if (!object) {
          result.skipped.push({ reason: "Proxmox VM is missing stable node or vmid", item: { name: vm.name } });
          continue;
        }

        result.objects.push(object);
        result.customerScopeCandidates.push(...buildCustomerScopeCandidates(vm, object.externalId, input.now));
      } catch (error: any) {
        result.errors.push({
          message: error?.message || "Failed to normalize Proxmox infrastructure object",
          item: { externalId: vm.externalId, name: vm.name },
        });
      }
    }

    return result;
  }
}

export const proxmoxInfrastructureNormalizer = new ProxmoxInfrastructureNormalizer();

function normalizeProxmoxVm(
  vm: ProxmoxVmInput,
  provider: ProviderAccount,
  config: Record<string, unknown>,
  lastSyncedAt: Date,
): NormalizedInfrastructureObjectInput | null {
  const rawVm = getRawVm(vm);
  const node = extractString(vm.node)
    ?? extractString(rawVm?.node)
    ?? parseNodeFromExternalId(vm.externalId);
  const vmid = extractVmid(vm.vmid)
    ?? extractVmid(rawVm?.vmid)
    ?? parseVmidFromExternalId(vm.externalId);

  if (!node || !vmid) return null;

  const sourceKey = extractString(config.cluster_id)
    ?? extractString(config.cluster)
    ?? extractString(config.source_key)
    ?? provider.id;
  const tags = normalizeTags(rawVm?.tags ?? vm.tags);
  const labels = tagsToLabels(tags);
  const pool = extractString(vm.pool) ?? extractString(rawVm?.pool);
  const notes = extractString(vm.notes) ?? extractString(rawVm?.notes);
  const status = vm.status ?? extractString(rawVm?.status) ?? null;
  const interfaces = (vm.interfaces ?? rawVm?.interfaces) ?? null;

  return {
    providerType: "proxmox",
    objectType: "vm",
    externalId: buildExternalId(sourceKey, node, vmid),
    providerNativeId: vmid,
    name: vm.name,
    displayName: vm.name,
    region: null,
    zone: null,
    cluster: sourceKey,
    node,
    lifecycleState: status,
    powerState: status,
    tags: sanitizeMetadata(tags),
    labels: sanitizeMetadata(labels),
    metadata: sanitizeMetadata({
      vmid,
      node,
      status,
      primaryIp4: vm.primaryIp4 ?? null,
      primaryIp6: vm.primaryIp6 ?? null,
      interfaces,
      vcpus: vm.vcpus ?? extractNumber(rawVm?.cpus) ?? extractNumber(rawVm?.cpu) ?? null,
      memory: vm.memory ?? extractNumber(rawVm?.mem) ?? extractNumber(rawVm?.memory) ?? null,
      disk: vm.disk ?? extractNumber(rawVm?.disk) ?? extractNumber(rawVm?.maxdisk) ?? null,
      template: extractBoolean(vm.template) ?? extractBoolean(rawVm?.template) ?? null,
      pool,
      notes,
      raw: rawVm ?? vm.raw ?? null,
    }),
    raw: null,
    lastSyncedAt,
  };
}

function buildCustomerScopeCandidates(
  vm: ProxmoxVmInput,
  externalId: string,
  lastSyncedAt: Date,
): NormalizedProviderCustomerScopeCandidateInput[] {
  const rawVm = getRawVm(vm);
  const candidates = new Map<string, NormalizedProviderCustomerScopeCandidateInput>();
  const object = { objectType: "vm", externalId };
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
      metadata: sanitizeMetadata({ provider: "proxmox", ...metadata }),
      lastSyncedAt,
    });
  };

  for (const tag of normalizeTags(rawVm?.tags ?? vm.tags)) {
    const parsed = parseCustomerTag(tag);
    if (parsed) {
      addCandidate("tag", parsed.value, "medium", { source: "proxmox_tag", tag, key: parsed.key });
    }
  }

  const pool = extractString(vm.pool) ?? extractString(rawVm?.pool);
  addCandidate("pool", parseCustomerFromPool(pool), "medium", { source: "proxmox_pool", pool });

  const notes = extractString(vm.notes) ?? extractString(rawVm?.notes);
  addCandidate("notes", parseCustomerFromNotes(notes), "low", { source: "proxmox_notes" });

  addCandidate("name_convention", parseCustomerFromName(vm.name), "low", { source: "vm_name", name: vm.name });

  return Array.from(candidates.values());
}

function buildExternalId(sourceKey: string, node: string, vmid: string): string {
  return `proxmox:${sourceKey}:node:${node}:vm:${vmid}`;
}

function parseCustomerTag(tag: string): { key: string; value: string } | null {
  const match = /^(customer|customerscope|customer_scope|tenant|environment)(?:=|:|\/)(.+)$/i.exec(tag.trim());
  if (!match) return null;
  return { key: match[1], value: match[2].trim() };
}

function parseCustomerFromPool(pool: string | null): string | null {
  if (!pool) return null;
  const match = /^(?:customer|cust|tenant|pool)[-_:/]?(.+)$/i.exec(pool);
  return (match?.[1] ?? pool).trim() || null;
}

function parseCustomerFromNotes(notes: string | null): string | null {
  if (!notes) return null;
  const match = /(?:customer|customerScope|tenant)\s*[:=]\s*([A-Za-z0-9][A-Za-z0-9 ._-]{1,80})/i.exec(notes);
  return match?.[1]?.trim() ?? null;
}

function parseCustomerFromName(name: string | undefined): string | null {
  if (!name) return null;
  const match = /^([a-z0-9][a-z0-9-]{1,30})-(?:web|app|db|api|prod|dev|test|stage|staging)-?\d*$/i.exec(name);
  return match?.[1] ?? null;
}

function parseNodeFromExternalId(externalId: string | undefined): string | null {
  if (!externalId) return null;
  const match = /^(.+)-(\d+)$/.exec(externalId);
  return match?.[1] ?? null;
}

function parseVmidFromExternalId(externalId: string | undefined): string | null {
  if (!externalId) return null;
  const match = /^.+-(\d+)$/.exec(externalId);
  return match?.[1] ?? null;
}

function normalizeTags(tags: unknown): string[] {
  if (Array.isArray(tags)) {
    return tags
      .map((tag) => sanitizeTag(String(tag).trim()))
      .filter(Boolean);
  }

  if (typeof tags === "string") {
    return tags
      .split(/[;,]/)
      .map((tag) => sanitizeTag(tag.trim()))
      .filter(Boolean);
  }

  if (tags && typeof tags === "object") {
    return Object.entries(tags as Record<string, unknown>)
      .filter(([, value]) => value != null && String(value).trim().length > 0)
      .map(([key, value]) => sanitizeTag(`${key}=${String(value).trim()}`));
  }

  return [];
}

function sanitizeTag(tag: string): string {
  const match = /^([^=:/]+)(=|:|\/)(.*)$/.exec(tag);
  if (!match) return isSecretKey(tag) ? "[REDACTED]" : tag;
  if (isSecretKey(match[1])) return `${match[1]}${match[2]}[REDACTED]`;
  return tag;
}

function tagsToLabels(tags: string[]): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const tag of tags) {
    const match = /^([^=:/]+)(?:=|:|\/)(.+)$/.exec(tag);
    if (match) labels[match[1]] = match[2];
  }
  return labels;
}

function getRawVm(vm: ProxmoxVmInput): ProxmoxRawVm | undefined {
  const rawVm = (vm.raw as any)?.vm;
  if (rawVm && typeof rawVm === "object") return rawVm as ProxmoxRawVm;
  if (vm.raw && typeof vm.raw === "object") return vm.raw as ProxmoxRawVm;
  return undefined;
}

function extractString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function extractVmid(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return value.trim();
  return null;
}

function extractNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function extractBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1") return true;
  if (value === 0 || value === "0") return false;
  return null;
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
  return /^(key)$/i.test(key)
    || /(password|token|secret|authorization|api[_-]?key|private[_-]?key|clientsecret|accesstoken|refreshtoken)/i.test(key);
}

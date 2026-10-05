import { storage as defaultStorage } from "../../storage";
import type {
  DriftComparisonItem,
  DriftComparisonRun,
  InfrastructureObject,
  InsertDriftComparisonItem,
  NetboxVm,
} from "@shared/schema";
import {
  matchVmInventories,
  type ProviderVmInput,
  type ReferenceVmInput,
  type VmMatchResult,
} from "./vm-matcher";

export interface RunVmDriftComparisonInput {
  orgId: string;
  cmdbSourceId: string;
  providerSourceId: string;
  objectType?: "vm";
}

export interface DriftComparisonCounts {
  total: number;
  matched: number;
  unmatchedReference: number;
  unmatchedProvider: number;
  ambiguous: number;
  drift: number;
  noDrift: number;
  unknown: number;
  notCompared: number;
  warning: number;
  critical: number;
  info: number;
}

export interface RunVmDriftComparisonOutput {
  run: DriftComparisonRun;
  counts: DriftComparisonCounts;
  itemsCreated: number;
}

interface DriftComparisonStorage {
  getNetboxVms(orgId: string): Promise<NetboxVm[]>;
  listInfrastructureObjects(
    orgId: string,
    sourceId: string,
    filters?: { providerType?: string; objectType?: string },
  ): Promise<InfrastructureObject[]>;
  createDriftComparisonRun(input: {
    orgId: string;
    cmdbSourceId: string;
    providerSourceId: string;
    objectType: string;
    status: "running";
    startedAt: Date;
    counts: Record<string, unknown>;
  }): Promise<DriftComparisonRun>;
  updateDriftComparisonRun(
    id: string,
    orgId: string,
    patch: Partial<Pick<DriftComparisonRun, "status" | "counts" | "error" | "startedAt" | "completedAt">>,
  ): Promise<DriftComparisonRun | undefined>;
  createDriftComparisonItems(items: InsertDriftComparisonItem[]): Promise<DriftComparisonItem[]>;
}

interface RunVmDriftComparisonOptions {
  storage?: DriftComparisonStorage;
  matcher?: typeof matchVmInventories;
  now?: () => Date;
}

export async function runVmDriftComparison(
  input: RunVmDriftComparisonInput,
  options: RunVmDriftComparisonOptions = {},
): Promise<RunVmDriftComparisonOutput> {
  const objectType = input.objectType ?? "vm";
  if (objectType !== "vm") {
    throw new Error(`Drift comparison only supports objectType 'vm' in this slice`);
  }

  const store = options.storage ?? defaultStorage;
  const matcher = options.matcher ?? matchVmInventories;
  const now = options.now ?? (() => new Date());
  const startedAt = now();
  const run = await store.createDriftComparisonRun({
    orgId: input.orgId,
    cmdbSourceId: input.cmdbSourceId,
    providerSourceId: input.providerSourceId,
    objectType,
    status: "running",
    startedAt,
    counts: {},
  });

  try {
    const [referenceRows, providerRows] = await Promise.all([
      loadReferenceVms(store, input.orgId, input.cmdbSourceId),
      store.listInfrastructureObjects(input.orgId, input.providerSourceId, { objectType }),
    ]);
    const referenceVms = referenceRows.map(mapNetboxVmToReferenceInput);
    const providerVms = providerRows.map(mapInfrastructureObjectToProviderInput);
    const matchResults = matcher(referenceVms, providerVms);
    const items = matchResults.map((result) => mapMatchResultToDriftItem(result, {
      runId: run.id,
      orgId: input.orgId,
      cmdbSourceId: input.cmdbSourceId,
      providerSourceId: input.providerSourceId,
      objectType,
    }));
    const createdItems = await store.createDriftComparisonItems(items);
    const counts = summarizeMatchResults(matchResults);
    const storedCounts = { ...counts };
    const completedRun = await store.updateDriftComparisonRun(run.id, input.orgId, {
      status: "completed",
      completedAt: now(),
      counts: storedCounts,
    });

    return {
      run: completedRun ?? { ...run, status: "completed", completedAt: now(), counts: storedCounts },
      counts,
      itemsCreated: createdItems.length,
    };
  } catch (error) {
    await store.updateDriftComparisonRun(run.id, input.orgId, {
      status: "failed",
      completedAt: now(),
      error: sanitizeErrorMessage(error),
    });
    throw error;
  }
}

async function loadReferenceVms(
  store: Pick<DriftComparisonStorage, "getNetboxVms">,
  orgId: string,
  cmdbSourceId: string,
): Promise<NetboxVm[]> {
  const vms = await store.getNetboxVms(orgId);
  return vms.filter((vm) => vm.sourceId === cmdbSourceId);
}

export function mapNetboxVmToReferenceInput(vm: NetboxVm): ReferenceVmInput {
  const customFields = toRecord(vm.customFields);
  const ipAddresses = collectStrings([
    vm.ip,
    customFields.ip,
    customFields.primary_ip,
    customFields.primaryIp,
    customFields.primary_ip4,
    customFields.primaryIp4,
    customFields.ip_addresses,
    customFields.ipAddresses,
  ]);

  return {
    id: vm.id,
    name: vm.name,
    displayName: vm.name,
    hostname: stringOrNull(customFields.hostname),
    fqdn: stringOrNull(customFields.fqdn),
    ip: vm.ip,
    ipAddresses,
    operatingSystem: vm.operatingSystem,
    lifecycleState: stringOrNull(customFields.lifecycle_state)
      ?? stringOrNull(customFields.lifecycleState),
    powerState: stringOrNull(customFields.provider_state)
      ?? stringOrNull(customFields.power_state)
      ?? stringOrNull(customFields.powerState)
      ?? stringOrNull(customFields.status),
    tags: vm.tags ?? [],
    metadata: {
      netboxId: vm.netboxId,
    },
  };
}

export function mapInfrastructureObjectToProviderInput(object: InfrastructureObject): ProviderVmInput {
  const metadata = toRecord(object.metadata);
  const labels = toRecord(object.labels);
  const ipAddresses = collectStrings([
    metadata.primaryIp4,
    metadata.primaryIp6,
    metadata.primary_ip,
    metadata.primary_ip4,
    metadata.ip,
    metadata.ips,
    metadata.ipAddresses,
    metadata.privateIps,
    labels.ip,
    labels.primaryIp,
  ]);

  return {
    id: object.id,
    name: object.name ?? object.displayName ?? object.externalId,
    displayName: object.displayName,
    externalId: object.externalId,
    providerNativeId: object.providerNativeId,
    lifecycleState: object.lifecycleState,
    powerState: object.powerState,
    ip: ipAddresses[0] ?? null,
    ipAddresses,
    operatingSystem: stringOrNull(metadata.operatingSystem),
    platform: stringOrNull(metadata.platform),
    tags: object.tags as ProviderVmInput["tags"],
    labels: object.labels as ProviderVmInput["labels"],
    metadata: {
      hostname: metadata.hostname,
      fqdn: metadata.fqdn,
      hostName: metadata.hostName,
      dnsName: metadata.dnsName,
      providerType: object.providerType,
      region: object.region,
      zone: object.zone,
      cluster: object.cluster,
      node: object.node,
    },
  };
}

function mapMatchResultToDriftItem(
  result: VmMatchResult,
  context: {
    runId: string;
    orgId: string;
    cmdbSourceId: string;
    providerSourceId: string;
    objectType: string;
  },
): InsertDriftComparisonItem {
  return {
    ...context,
    referenceObjectId: result.referenceObjectId,
    providerObjectId: result.providerObjectId,
    matchStatus: result.matchStatus,
    matchConfidence: result.matchConfidence,
    matchReason: result.matchReason,
    driftStatus: result.driftStatus,
    driftSeverity: result.driftSeverity,
    fieldDiffs: result.fieldDiffs,
    findings: result.findings,
    metadata: {
      candidateProviderObjectIds: result.candidateProviderObjectIds,
      signals: result.signals,
    },
  };
}

export function summarizeMatchResults(results: VmMatchResult[]): DriftComparisonCounts {
  const counts: DriftComparisonCounts = {
    total: results.length,
    matched: 0,
    unmatchedReference: 0,
    unmatchedProvider: 0,
    ambiguous: 0,
    drift: 0,
    noDrift: 0,
    unknown: 0,
    notCompared: 0,
    warning: 0,
    critical: 0,
    info: 0,
  };

  for (const result of results) {
    if (result.matchStatus === "matched") counts.matched++;
    if (result.matchStatus === "unmatched_reference") counts.unmatchedReference++;
    if (result.matchStatus === "unmatched_provider") counts.unmatchedProvider++;
    if (result.matchStatus === "ambiguous") counts.ambiguous++;

    if (result.driftStatus === "drift") counts.drift++;
    if (result.driftStatus === "no_drift") counts.noDrift++;
    if (result.driftStatus === "unknown") counts.unknown++;
    if (result.driftStatus === "not_compared") counts.notCompared++;

    if (result.driftSeverity === "warning") counts.warning++;
    if (result.driftSeverity === "critical") counts.critical++;
    if (result.driftSeverity === "info") counts.info++;
  }

  return counts;
}

function collectStrings(values: unknown[]): string[] {
  const strings: string[] = [];
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      strings.push(value.trim());
    } else if (Array.isArray(value)) {
      strings.push(...collectStrings(value));
    }
  }
  return Array.from(new Set(strings)).sort();
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function sanitizeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/(authorization\s*[:=]\s*)\S+/gi, "$1[REDACTED]")
    .replace(/((?:token|password|secret|client_secret|token_secret)\s*[:=]\s*)\S+/gi, "$1[REDACTED]");
}

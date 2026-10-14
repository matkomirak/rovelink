import type { DriftMatchStatus, DriftSeverity, DriftStatus } from "@shared/schema";
import { normalizedIpSchema } from "../ingestion-validation";

export type VmMatchConfidence = "high" | "medium" | "low";
export type VmMatchSignalType = "hostname" | "fqdn" | "name" | "ip";

export interface ReferenceVmInput {
  id: string;
  name: string;
  displayName?: string | null;
  hostname?: string | null;
  fqdn?: string | null;
  ip?: string | null;
  ipAddresses?: string[] | null;
  operatingSystem?: string | null;
  powerState?: string | null;
  lifecycleState?: string | null;
  tags?: string[] | Record<string, unknown> | null;
  customerScopeId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface ProviderVmInput {
  id: string;
  name: string;
  displayName?: string | null;
  externalId?: string | null;
  providerNativeId?: string | null;
  lifecycleState?: string | null;
  powerState?: string | null;
  ip?: string | null;
  ipAddresses?: string[] | null;
  operatingSystem?: string | null;
  platform?: string | null;
  tags?: string[] | Record<string, unknown> | null;
  labels?: Record<string, unknown> | null;
  customerScopeCandidates?: unknown[] | null;
  metadata?: Record<string, unknown> | null;
}

export interface VmMatchSignal {
  type: VmMatchSignalType;
  confidence: VmMatchConfidence;
  referenceValue: string;
  providerValue: string;
}

export interface VmFieldDiff {
  field: "ip" | "operatingSystem" | "powerState";
  referenceValue: string | string[];
  providerValue: string | string[];
  code: "VM_IP_MISMATCH" | "VM_OS_MISMATCH" | "VM_POWER_STATE_MISMATCH";
}

export interface VmMatchFinding {
  code:
    | "VM_IP_MISMATCH"
    | "VM_OS_MISMATCH"
    | "VM_POWER_STATE_MISMATCH"
    | "AMBIGUOUS_MATCH"
    | "UNMATCHED_REFERENCE"
    | "UNMATCHED_PROVIDER";
  message: string;
  severity: DriftSeverity;
}

export interface VmMatchResult {
  referenceObjectId: string | null;
  providerObjectId: string | null;
  matchStatus: DriftMatchStatus;
  matchConfidence: VmMatchConfidence | null;
  matchReason: string;
  candidateProviderObjectIds: string[];
  signals: VmMatchSignal[];
  fieldDiffs: VmFieldDiff[];
  findings: VmMatchFinding[];
  driftStatus: DriftStatus;
  driftSeverity: DriftSeverity;
}

export interface VmMatchCandidate {
  referenceObjectId: string;
  providerObjectId: string;
  confidence: VmMatchConfidence;
  reason: string;
  signals: VmMatchSignal[];
}

export interface VmMatcherOptions {
  ipMatchConfidence?: VmMatchConfidence;
}

interface CandidateBundle {
  reference: ReferenceVmInput;
  candidates: VmMatchCandidate[];
}

const CONFIDENCE_RANK: Record<VmMatchConfidence, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

export function normalizeVmName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ").replace(/\.$/, "").toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

export function normalizeIpList(value: unknown): string[] {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,\s]+/)
      : [];
  return Array.from(new Set(
    values
      .map((entry) => typeof entry === "string" ? entry.trim() : "")
      .filter(entry => normalizedIpSchema.safeParse(entry).success),
  )).sort();
}

export function buildVmMatchCandidates(
  referenceVms: ReferenceVmInput[],
  providerVms: ProviderVmInput[],
  options: VmMatcherOptions = {},
): VmMatchCandidate[] {
  const candidates: VmMatchCandidate[] = [];
  const providerIndexes = buildProviderIndexes(providerVms);

  for (const reference of referenceVms) {
    const byProviderId = new Map<string, VmMatchCandidate>();
    for (const signal of getReferenceSignals(reference, options)) {
      const providerIds = providerIndexes.get(signal.key)?.get(signal.value) ?? [];
      for (const providerId of providerIds) {
        const provider = providerVms.find((vm) => vm.id === providerId);
        if (!provider) continue;
        addCandidateSignal(byProviderId, reference, provider, signal.type, signal.confidence, signal.value);
      }
    }
    candidates.push(...Array.from(byProviderId.values()));
  }

  return candidates.sort(compareCandidates);
}

export function matchVmInventories(
  referenceVms: ReferenceVmInput[],
  providerVms: ProviderVmInput[],
  options: VmMatcherOptions = {},
): VmMatchResult[] {
  const sortedReferences = [...referenceVms].sort(compareReferenceVms);
  const sortedProviders = [...providerVms].sort(compareProviderVms);
  const allCandidates = buildVmMatchCandidates(sortedReferences, sortedProviders, options);
  const candidatesByReference = new Map<string, VmMatchCandidate[]>();
  for (const candidate of allCandidates) {
    const current = candidatesByReference.get(candidate.referenceObjectId) ?? [];
    current.push(candidate);
    candidatesByReference.set(candidate.referenceObjectId, current);
  }

  const bundles: CandidateBundle[] = sortedReferences.map((reference) => ({
    reference,
    candidates: sortCandidatesByStrength(candidatesByReference.get(reference.id) ?? []),
  }));
  const selectedProviderUsage = new Map<string, number>();
  for (const bundle of bundles) {
    if (bundle.candidates.length === 1) {
      const providerId = bundle.candidates[0].providerObjectId;
      selectedProviderUsage.set(providerId, (selectedProviderUsage.get(providerId) ?? 0) + 1);
    }
  }

  const results: VmMatchResult[] = [];
  const resolvedProviderIds = new Set<string>();
  const candidateProviderIds = new Set<string>();

  for (const bundle of bundles) {
    for (const candidate of bundle.candidates) candidateProviderIds.add(candidate.providerObjectId);

    if (bundle.candidates.length === 0) {
      results.push(buildUnmatchedReferenceResult(bundle.reference));
      continue;
    }

    if (bundle.candidates.length > 1 || selectedProviderUsage.get(bundle.candidates[0].providerObjectId)! > 1) {
      results.push(buildAmbiguousResult(bundle.reference, bundle.candidates));
      continue;
    }

    const candidate = bundle.candidates[0];
    const provider = providerVms.find((vm) => vm.id === candidate.providerObjectId)!;
    resolvedProviderIds.add(provider.id);
    results.push(buildMatchedResult(bundle.reference, provider, candidate));
  }

  for (const provider of sortedProviders) {
    if (resolvedProviderIds.has(provider.id) || candidateProviderIds.has(provider.id)) continue;
    results.push(buildUnmatchedProviderResult(provider));
  }

  return results;
}

function buildProviderIndexes(providerVms: ProviderVmInput[]) {
  const indexes = new Map<string, Map<string, string[]>>();
  for (const provider of providerVms) {
    for (const signal of getProviderSignals(provider)) {
      const index = indexes.get(signal.key) ?? new Map<string, string[]>();
      const ids = index.get(signal.value) ?? [];
      ids.push(provider.id);
      ids.sort();
      index.set(signal.value, ids);
      indexes.set(signal.key, index);
    }
  }
  return indexes;
}

function getReferenceSignals(reference: ReferenceVmInput, options: VmMatcherOptions) {
  const signals: Array<{ key: string; type: VmMatchSignalType; confidence: VmMatchConfidence; value: string }> = [];
  const fqdn = normalizeVmName(reference.fqdn);
  if (fqdn) signals.push({ key: "hostname", type: "fqdn", confidence: "high", value: fqdn });
  const hostname = normalizeVmName(reference.hostname);
  if (hostname) signals.push({ key: "hostname", type: "hostname", confidence: "high", value: hostname });
  for (const value of [reference.name, reference.displayName]) {
    const normalized = normalizeVmName(value);
    if (normalized) signals.push({ key: "name", type: "name", confidence: "medium", value: normalized });
  }
  for (const ip of getVmIps(reference)) {
    signals.push({ key: "ip", type: "ip", confidence: options.ipMatchConfidence ?? "medium", value: ip });
  }
  return dedupeSignals(signals);
}

function getProviderSignals(provider: ProviderVmInput) {
  const signals: Array<{ key: string; type: VmMatchSignalType; confidence: VmMatchConfidence; value: string }> = [];
  for (const value of [provider.name, provider.displayName]) {
    const normalized = normalizeVmName(value);
    if (normalized) signals.push({ key: "name", type: "name", confidence: "medium", value: normalized });
  }
  for (const hostname of getProviderHostnames(provider)) {
    signals.push({ key: "hostname", type: "hostname", confidence: "high", value: hostname });
  }
  for (const ip of getVmIps(provider)) {
    signals.push({ key: "ip", type: "ip", confidence: "medium", value: ip });
  }
  return dedupeSignals(signals);
}

function getProviderHostnames(provider: ProviderVmInput): string[] {
  const metadata = provider.metadata ?? {};
  const values = [
    metadata.hostname,
    metadata.fqdn,
    metadata.hostName,
    metadata.dnsName,
    provider.name?.includes(".") ? provider.name : null,
    provider.displayName?.includes(".") ? provider.displayName : null,
  ];
  return Array.from(new Set(values.map(normalizeVmName).filter((value): value is string => Boolean(value)))).sort();
}

function getVmIps(vm: ReferenceVmInput | ProviderVmInput): string[] {
  return normalizeIpList([
    ...normalizeIpList(vm.ip),
    ...normalizeIpList(vm.ipAddresses ?? []),
  ]);
}

function dedupeSignals<T extends { key: string; value: string; confidence: VmMatchConfidence; type: VmMatchSignalType }>(signals: T[]): T[] {
  const seen = new Set<string>();
  return signals.filter((signal) => {
    const dedupeKey = `${signal.key}:${signal.value}:${signal.confidence}:${signal.type}`;
    if (seen.has(dedupeKey)) return false;
    seen.add(dedupeKey);
    return true;
  });
}

function addCandidateSignal(
  byProviderId: Map<string, VmMatchCandidate>,
  reference: ReferenceVmInput,
  provider: ProviderVmInput,
  type: VmMatchSignalType,
  confidence: VmMatchConfidence,
  value: string,
) {
  const existing = byProviderId.get(provider.id);
  const signal: VmMatchSignal = {
    type,
    confidence,
    referenceValue: value,
    providerValue: value,
  };
  if (!existing) {
    byProviderId.set(provider.id, {
      referenceObjectId: reference.id,
      providerObjectId: provider.id,
      confidence,
      reason: matchReasonForSignal(type),
      signals: [signal],
    });
    return;
  }

  existing.signals.push(signal);
  existing.signals.sort(compareSignals);
  if (CONFIDENCE_RANK[confidence] > CONFIDENCE_RANK[existing.confidence]) {
    existing.confidence = confidence;
    existing.reason = matchReasonForSignal(type);
  }
}

function buildMatchedResult(reference: ReferenceVmInput, provider: ProviderVmInput, candidate: VmMatchCandidate): VmMatchResult {
  const fieldDiffs = compareVmFields(reference, provider);
  const findings = fieldDiffs.map((diff): VmMatchFinding => ({
    code: diff.code,
    message: fieldDiffMessage(diff),
    severity: "warning",
  }));
  return {
    referenceObjectId: reference.id,
    providerObjectId: provider.id,
    matchStatus: "matched",
    matchConfidence: candidate.confidence,
    matchReason: candidate.reason,
    candidateProviderObjectIds: [provider.id],
    signals: candidate.signals.sort(compareSignals),
    fieldDiffs,
    findings,
    driftStatus: findings.length > 0 ? "drift" : "no_drift",
    driftSeverity: findings.length > 0 ? "warning" : "info",
  };
}

function buildAmbiguousResult(reference: ReferenceVmInput, candidates: VmMatchCandidate[]): VmMatchResult {
  const candidateProviderObjectIds = Array.from(new Set(candidates.map((candidate) => candidate.providerObjectId))).sort();
  return {
    referenceObjectId: reference.id,
    providerObjectId: null,
    matchStatus: "ambiguous",
    matchConfidence: null,
    matchReason: "Multiple provider VMs matched this reference VM; no automatic match was selected.",
    candidateProviderObjectIds,
    signals: candidates.flatMap((candidate) => candidate.signals).sort(compareSignals),
    fieldDiffs: [],
    findings: [{
      code: "AMBIGUOUS_MATCH",
      message: "Multiple provider VMs matched this reference VM.",
      severity: "warning",
    }],
    driftStatus: "unknown",
    driftSeverity: "warning",
  };
}

function buildUnmatchedReferenceResult(reference: ReferenceVmInput): VmMatchResult {
  return {
    referenceObjectId: reference.id,
    providerObjectId: null,
    matchStatus: "unmatched_reference",
    matchConfidence: null,
    matchReason: "No provider VM candidate matched this CMDB/reference VM.",
    candidateProviderObjectIds: [],
    signals: [],
    fieldDiffs: [],
    findings: [{
      code: "UNMATCHED_REFERENCE",
      message: "CMDB/reference VM was not found in provider/runtime inventory.",
      severity: "warning",
    }],
    driftStatus: "not_compared",
    driftSeverity: "warning",
  };
}

function buildUnmatchedProviderResult(provider: ProviderVmInput): VmMatchResult {
  return {
    referenceObjectId: null,
    providerObjectId: provider.id,
    matchStatus: "unmatched_provider",
    matchConfidence: null,
    matchReason: "Provider/runtime VM did not match any CMDB/reference VM.",
    candidateProviderObjectIds: [provider.id],
    signals: [],
    fieldDiffs: [],
    findings: [{
      code: "UNMATCHED_PROVIDER",
      message: "Provider/runtime VM was not found in CMDB/reference inventory.",
      severity: "warning",
    }],
    driftStatus: "not_compared",
    driftSeverity: "warning",
  };
}

function compareVmFields(reference: ReferenceVmInput, provider: ProviderVmInput): VmFieldDiff[] {
  const diffs: VmFieldDiff[] = [];
  const referenceIps = getVmIps(reference);
  const providerIps = getVmIps(provider);
  if (referenceIps.length > 0 && providerIps.length > 0 && !arraysEqual(referenceIps, providerIps)) {
    diffs.push({
      field: "ip",
      referenceValue: referenceIps,
      providerValue: providerIps,
      code: "VM_IP_MISMATCH",
    });
  }

  const referenceOs = normalizeComparableString(reference.operatingSystem);
  const providerOs = normalizeComparableString(provider.operatingSystem ?? provider.platform);
  if (referenceOs && providerOs && referenceOs !== providerOs) {
    diffs.push({
      field: "operatingSystem",
      referenceValue: referenceOs,
      providerValue: providerOs,
      code: "VM_OS_MISMATCH",
    });
  }

  const referencePower = normalizePowerState(reference.powerState ?? reference.lifecycleState);
  const providerPower = normalizePowerState(provider.powerState ?? provider.lifecycleState);
  if (referencePower && providerPower && referencePower !== providerPower) {
    diffs.push({
      field: "powerState",
      referenceValue: referencePower,
      providerValue: providerPower,
      code: "VM_POWER_STATE_MISMATCH",
    });
  }

  return diffs;
}

function normalizeComparableString(value: unknown): string | null {
  return normalizeVmName(value)?.replace(/[^a-z0-9]+/g, "") ?? null;
}

function normalizePowerState(value: unknown): "running" | "stopped" | null {
  const normalized = normalizeComparableString(value);
  if (!normalized) return null;
  if (["running", "on", "poweredon", "powerstaterunning", "started", "active"].includes(normalized)) return "running";
  if (["stopped", "off", "poweredoff", "powerstatestopped", "deallocated", "inactive"].includes(normalized)) return "stopped";
  return null;
}

function matchReasonForSignal(type: VmMatchSignalType): string {
  if (type === "fqdn" || type === "hostname") return "Exact normalized hostname/FQDN match";
  if (type === "name") return "Exact normalized VM name/displayName match";
  return "IP address overlap match";
}

function fieldDiffMessage(diff: VmFieldDiff): string {
  if (diff.code === "VM_IP_MISMATCH") return "CMDB/reference VM IP addresses differ from provider/runtime VM IP addresses.";
  if (diff.code === "VM_OS_MISMATCH") return "CMDB/reference VM operating system differs from provider/runtime VM platform.";
  return "CMDB/reference VM power state differs from provider/runtime VM power state.";
}

function arraysEqual(first: string[], second: string[]): boolean {
  if (first.length !== second.length) return false;
  return first.every((value, index) => value === second[index]);
}

function sortCandidatesByStrength(candidates: VmMatchCandidate[]): VmMatchCandidate[] {
  return [...candidates].sort((first, second) => (
    CONFIDENCE_RANK[second.confidence] - CONFIDENCE_RANK[first.confidence] ||
    first.providerObjectId.localeCompare(second.providerObjectId)
  ));
}

function compareCandidates(first: VmMatchCandidate, second: VmMatchCandidate): number {
  return first.referenceObjectId.localeCompare(second.referenceObjectId) ||
    first.providerObjectId.localeCompare(second.providerObjectId);
}

function compareSignals(first: VmMatchSignal, second: VmMatchSignal): number {
  return CONFIDENCE_RANK[second.confidence] - CONFIDENCE_RANK[first.confidence] ||
    first.type.localeCompare(second.type) ||
    first.referenceValue.localeCompare(second.referenceValue);
}

function compareReferenceVms(first: ReferenceVmInput, second: ReferenceVmInput): number {
  return first.id.localeCompare(second.id) || first.name.localeCompare(second.name);
}

function compareProviderVms(first: ProviderVmInput, second: ProviderVmInput): number {
  return first.id.localeCompare(second.id) || first.name.localeCompare(second.name);
}

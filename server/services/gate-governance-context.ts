import type { IStorage } from "../storage";
import type { GateDecision } from "./gate-store";
import type { GovernanceObjectEvaluation, NetboxVm } from "../../shared/schema";

export interface GateGovernanceMetadata {
  governanceScore: number;
  automationReadiness: boolean;
  governanceFindingCount: number;
  recommendedActions: string[];
  latestGovernanceEvaluationId: string;
  latestGovernanceEvaluationRunId: string;
  latestGovernanceEvaluatedAt: string;
}

export interface GateDecisionWithGovernance extends GateDecision {
  governance: GateGovernanceMetadata | null;
}

export type GovernanceAwareHost<T extends Record<string, any> = Record<string, any>> = T & {
  governance?: GateGovernanceMetadata | null;
};

export interface GovernanceObjectIdentity {
  governanceObjectType?: "netbox_vm";
  governanceObjectId?: string;
  netboxVmId?: string;
  sourceNetboxId?: number;
}

type GovernanceStorage = Pick<IStorage, "getNetboxVms" | "getLatestGovernanceEvaluationForObject">;

export async function enrichGateDecisionsWithGovernance(
  storage: GovernanceStorage,
  orgId: string,
  decisions: GateDecision[],
): Promise<GateDecisionWithGovernance[]> {
  const cachedVms = await storage.getNetboxVms(orgId);

  return Promise.all(decisions.map(async (decision) => ({
    ...decision,
    governance: await getGovernanceForGateDecision(storage, orgId, decision, cachedVms),
  })));
}

export async function enrichInventoryHostsWithGovernance<T extends { name: string }>(
  storage: GovernanceStorage,
  orgId: string,
  hosts: T[],
): Promise<Array<GovernanceAwareHost<T>>> {
  const cachedVms = await storage.getNetboxVms(orgId);

  return Promise.all(hosts.map(async (host) => {
    const direct = await getGovernanceByExplicitIdentity(storage, orgId, host);
    if (direct) {
      return {
        ...host,
        governance: direct,
      };
    }

    const vm = findCachedVmForHost(host, cachedVms);
    return {
      ...host,
      governance: vm ? await getGovernanceForCachedVm(storage, orgId, vm) : null,
    };
  }));
}

async function getGovernanceForGateDecision(
  storage: GovernanceStorage,
  orgId: string,
  decision: GateDecision,
  cachedVms: NetboxVm[],
): Promise<GateGovernanceMetadata | null> {
  const direct = await getGovernanceByExplicitIdentity(storage, orgId, decision);
  if (direct) return direct;

  const vm = findCachedVmForGateDecision(decision, cachedVms);
  return vm ? getGovernanceForCachedVm(storage, orgId, vm) : null;
}

async function getGovernanceForCachedVm(
  storage: GovernanceStorage,
  orgId: string,
  vm: NetboxVm,
): Promise<GateGovernanceMetadata | null> {
  const latest = await storage.getLatestGovernanceEvaluationForObject(orgId, "netbox_vm", vm.id);
  return latest ? toGateGovernanceMetadata(latest.evaluation) : null;
}

function findCachedVmForGateDecision(decision: GateDecision, cachedVms: NetboxVm[]): NetboxVm | null {
  const localId = getLocalNetboxVmId(decision);
  if (localId) {
    const vm = cachedVms.find((candidate) => candidate.id === localId);
    if (vm) return vm;
  }

  const sourceNetboxId = decision.sourceNetboxId ?? decision.netboxVmId;
  if (sourceNetboxId == null) return null;

  // Legacy/best-effort display compatibility only. Enforcement must require
  // governanceObjectType + governanceObjectId and must not rely on names.
  const matchingNetboxId = cachedVms.filter((vm) => vm.netboxId === sourceNetboxId);
  if (matchingNetboxId.length === 0) return null;

  const exactName = matchingNetboxId.find((vm) => vm.name === decision.vmName);
  return exactName ?? (matchingNetboxId.length === 1 ? matchingNetboxId[0] : null);
}

function findCachedVmForHost<T extends { name: string }>(host: T, cachedVms: NetboxVm[]): NetboxVm | null {
  const localId = getLocalNetboxVmId(host);
  if (localId) {
    const vm = cachedVms.find((candidate) => candidate.id === localId);
    if (vm) return vm;
  }

  const sourceNetboxId = getSourceNetboxId(host);
  if (sourceNetboxId != null) {
    // Legacy/best-effort display compatibility only. Enforcement must require
    // governanceObjectType + governanceObjectId and must not rely on names.
    const matchingNetboxId = cachedVms.filter((vm) => vm.netboxId === sourceNetboxId);
    const exactName = matchingNetboxId.find((vm) => vm.name === host.name);
    return exactName ?? (matchingNetboxId.length === 1 ? matchingNetboxId[0] : null);
  }

  // Legacy/best-effort display compatibility for old cached inventory data.
  // Names are not stable enough for future governance enforcement.
  const matchingName = cachedVms.filter((vm) => vm.name === host.name);
  return matchingName.length === 1 ? matchingName[0] : null;
}

async function getGovernanceByExplicitIdentity(
  storage: GovernanceStorage,
  orgId: string,
  source: Record<string, any>,
): Promise<GateGovernanceMetadata | null> {
  if (source.governanceObjectType !== "netbox_vm") return null;
  const objectId = typeof source.governanceObjectId === "string" && source.governanceObjectId.trim()
    ? source.governanceObjectId.trim()
    : null;
  if (!objectId) return null;

  const latest = await storage.getLatestGovernanceEvaluationForObject(orgId, "netbox_vm", objectId);
  return latest ? toGateGovernanceMetadata(latest.evaluation) : null;
}

function getLocalNetboxVmId(source: Record<string, any>): string | null {
  const candidate = source.governanceObjectType === "netbox_vm"
    ? (source.governanceObjectId ?? source.netboxVmId ?? source.vars?.rovelink_governance_object_id)
    : (source.netboxVmId ?? source.vars?.rovelink_governance_object_id);
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
}

function getSourceNetboxId(host: Record<string, any>): number | null {
  const candidate = host.sourceNetboxId ?? host.netboxId ?? host.netbox_vm_id ?? host.vars?.rovelink_netbox_id;
  if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
  if (typeof candidate === "string" && candidate.trim() !== "") {
    const parsed = Number(candidate);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toGateGovernanceMetadata(evaluation: GovernanceObjectEvaluation): GateGovernanceMetadata {
  const recommendedActions = Array.isArray(evaluation.recommendedActions)
    ? evaluation.recommendedActions.map((action) => String(action))
    : [];
  const findings = Array.isArray(evaluation.findings) ? evaluation.findings : [];

  return {
    governanceScore: evaluation.governanceScore,
    automationReadiness: evaluation.automationReady,
    governanceFindingCount: findings.length,
    recommendedActions,
    latestGovernanceEvaluationId: evaluation.id,
    latestGovernanceEvaluationRunId: evaluation.runId,
    latestGovernanceEvaluatedAt: evaluation.evaluatedAt.toISOString(),
  };
}

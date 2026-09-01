import { apiRequest } from "@/lib/queryClient";
import type {
  GovernanceBlueprint,
  GovernanceBlueprintVersion,
  GovernanceEvaluationRun,
  GovernanceObjectEvaluation,
} from "@shared/schema";
import type { GovernanceBlueprintRules } from "@shared/governance";

export interface CreateDefaultBlueprintResponse {
  blueprint: GovernanceBlueprint;
  activeVersion: GovernanceBlueprintVersion;
}

export interface CachedNetBoxEvaluationResponse {
  evaluationRunId: string;
  evaluatedCount: number;
  compliantCount: number;
  warningCount: number;
  blockedCount: number;
  averageGovernanceScore: number;
  topFindings: Array<{ code: string; count: number; message: string }>;
}

export interface SyncGovernanceCachedNetBoxVmsResponse {
  sourceId: string;
  importedCount: number;
  cachedVmCount: number;
  lastImportAt: string | null;
}

export interface GovernanceNetBoxSourceSummary {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  cachedVmCount: number;
  lastImportAt: string | null;
  createdAt: string;
  sourceType: "netbox_inventory_source";
  cmdbAccountId: string | null;
  cmdbAccountName: string | null;
}

export interface LatestGovernanceObjectEvaluationResponse {
  evaluation: GovernanceObjectEvaluation;
  run: GovernanceEvaluationRun | null;
}

function humanizeApiError(status: number, body: unknown, fallback: string): string {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const message = (body as Record<string, unknown>).message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }
  if (status === 401) return "You need to sign in to continue.";
  if (status === 403) return "You do not have permission to perform this action.";
  if (status === 404) return "The requested governance resource was not found.";
  return fallback;
}

export function formatGovernanceError(error: unknown): Error {
  if (!(error instanceof Error)) return new Error("Governance request failed");

  const raw = error.message;
  const match = raw.match(/^(\d{3}):\s*([\s\S]*)$/);
  if (!match) return error;

  const status = Number(match[1]);
  const bodyText = match[2];
  let body: unknown;
  if (bodyText) {
    try {
      body = JSON.parse(bodyText);
    } catch {
      body = undefined;
    }
  }
  return new Error(humanizeApiError(status, body, `Governance request failed with status ${status}`));
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(humanizeApiError(response.status, body, `Request failed with status ${response.status}`));
  }
  return response.json();
}

async function postJson<T>(url: string, data: unknown = {}): Promise<T> {
  try {
    const response = await apiRequest("POST", url, data);
    return response.json();
  } catch (error) {
    throw formatGovernanceError(error);
  }
}

export const governanceKeys = {
  blueprints: ["/api/governance/blueprints"] as const,
  netboxSources: ["/api/governance/netbox-sources"] as const,
  blueprint: (id: string) => ["/api/governance/blueprints", id] as const,
  versions: (id: string) => ["/api/governance/blueprints", id, "versions"] as const,
  evaluationRuns: ["/api/governance/evaluation-runs"] as const,
  evaluationRun: (id: string) => ["/api/governance/evaluation-runs", id] as const,
  evaluationObjects: (id: string) => ["/api/governance/evaluation-runs", id, "objects"] as const,
  latestObjectEvaluation: (objectType: string, objectId: string) => [
    "/api/governance/objects",
    objectType,
    objectId,
    "latest-evaluation",
  ] as const,
};

export function listGovernanceBlueprints() {
  return fetchJson<GovernanceBlueprint[]>("/api/governance/blueprints");
}

export function listGovernanceNetBoxSources() {
  return fetchJson<GovernanceNetBoxSourceSummary[]>("/api/governance/netbox-sources");
}

export function getGovernanceBlueprint(id: string) {
  return fetchJson<GovernanceBlueprint>(`/api/governance/blueprints/${id}`);
}

export function listGovernanceBlueprintVersions(id: string) {
  return fetchJson<GovernanceBlueprintVersion[]>(`/api/governance/blueprints/${id}/versions`);
}

export function createGovernanceBlueprintVersion(blueprintId: string, rules: GovernanceBlueprintRules) {
  return postJson<GovernanceBlueprintVersion>(`/api/governance/blueprints/${blueprintId}/versions`, { rules });
}

export function createDefaultNetboxVmBlueprint(netboxSourceId: string) {
  return postJson<CreateDefaultBlueprintResponse>("/api/governance/defaults/netbox-vm", { netboxSourceId });
}

export function syncGovernanceCachedNetBoxVms(sourceId: string) {
  return postJson<SyncGovernanceCachedNetBoxVmsResponse>(
    `/api/governance/netbox-sources/${encodeURIComponent(sourceId)}/sync-cached-vms`,
  );
}

export function activateGovernanceBlueprintVersion(blueprintId: string, versionId: string) {
  return postJson<GovernanceBlueprint>(`/api/governance/blueprints/${blueprintId}/activate`, { versionId });
}

export function runCachedNetboxVmEvaluation(blueprintId: string, options: { netboxSourceId?: string } = {}) {
  return postJson<CachedNetBoxEvaluationResponse>(
    `/api/governance/blueprints/${blueprintId}/evaluate-cached-netbox-vms`,
    options.netboxSourceId ? { netboxSourceId: options.netboxSourceId } : {},
  );
}

export function listGovernanceEvaluationRuns() {
  return fetchJson<GovernanceEvaluationRun[]>("/api/governance/evaluation-runs");
}

export function getGovernanceEvaluationRun(id: string) {
  return fetchJson<GovernanceEvaluationRun>(`/api/governance/evaluation-runs/${id}`);
}

export function listGovernanceEvaluationObjects(id: string) {
  return fetchJson<GovernanceObjectEvaluation[]>(`/api/governance/evaluation-runs/${id}/objects`);
}

export function getLatestGovernanceEvaluationForObject(objectType: string, objectId: string) {
  return fetchJson<LatestGovernanceObjectEvaluationResponse | null>(
    `/api/governance/objects/${encodeURIComponent(objectType)}/${encodeURIComponent(objectId)}/latest-evaluation`
  );
}

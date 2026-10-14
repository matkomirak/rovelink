import { createHash, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import type { IStorage } from "../storage";
import type { AutomationInventory, GovernanceEvaluationRun, GovernanceObjectEvaluation } from "../../shared/schema";
import { eligibilityPolicySchema } from "../../shared/schema";
import { type GateDecisionRequest, type GateDecisionResponse, type PreflightReason, preflightReasonMessages } from "../../shared/gate-decision";
import { hasRoleAtLeast } from "../auth/roles";
import { evaluateGovernanceObject } from "./governance-blueprint-evaluator";
import { governanceBlueprintRulesSchema, governanceEvaluationResultSchema } from "../../shared/governance";
import { loadCustomerScopeContextByObjectId, normalizeCachedNetboxVm } from "./governance-object-context";
import { applyGovernanceGateEnforcement } from "./governance-gate-enforcement";
import { assessInventoryHostSignals } from "./automation-readiness-report";
import { hasUsableSshCredential, inspectLocalPrerequisites } from "./preflight-local-prerequisites";
import { normalizedIpSchema } from "./ingestion-validation";

export interface PreflightPrincipal { id: string; orgId: string; role: string }
export class PreflightPermissionError extends Error {}
export type PreflightDependencies = Pick<IStorage, "getUser" | "getJobTemplate" | "getCmdbAccount" | "getNetboxVms" |
  "getGovernanceBlueprint" | "getGovernanceBlueprintVersion" | "listAssignmentsForObject" | "getCustomerScope" |
  "getProject" | "getCredential"> & {
    getInventory(id: string, orgId: string): Promise<AutomationInventory | undefined>;
    getCompletedEvaluations(orgId: string, sourceId: string, objectId: string, blueprintId: string, versionId: string): Promise<Array<{ evaluation: GovernanceObjectEvaluation; run: GovernanceEvaluationRun }>>;
    inspectLocal?: typeof inspectLocalPrerequisites;
    now?: () => number;
  };

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}
export function evidenceFingerprint(value: unknown): string {
  const canonical = (input: any): any => input instanceof Date ? input.toISOString() : Array.isArray(input) ? input.map(canonical) :
    input && typeof input === "object" ? Object.fromEntries(Object.keys(input).sort().map(key => [key, canonical(input[key])])) : input;
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

/** Read-only action-specific authorization. No writes, launches, live discovery or persisted evaluation. */
export async function evaluatePreflight(request: GateDecisionRequest, principal: PreflightPrincipal, deps: PreflightDependencies): Promise<GateDecisionResponse> {
  if (!hasRoleAtLeast(principal.role, "operator")) throw new PreflightPermissionError();
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const response: GateDecisionResponse = {
    correlationId: randomUUID(), evaluatedAt: new Date(startedAt).toISOString(), decision: "unknown",
    validUntil: null, reasons: [], evidence: {}, warnings: ["Decision only; not an execution token. Revalidate before any future launch. Drift is analysis-only."],
  };
  const finish = (reason?: PreflightReason, decision: "block" | "unknown" = "unknown") => {
    response.evaluatedAt = new Date(now()).toISOString();
    if (reason) { response.reasons.push(reason); response.decision = decision; }
    response.explanation = response.reasons.length ? response.reasons.map(code => preflightReasonMessages[code]).join(" ") : "All configured conditions are verified for this target and action at evaluation time.";
    return response;
  };
  if (!request.automation.templateId) return finish("action_policy_missing");
  const orgId = principal.orgId;
  const template = await deps.getJobTemplate(request.automation.templateId, orgId);
  if (!template || template.orgId !== orgId) return finish("invalid_template");
  if (!template.inventoryId) return finish("missing_inventory_target");
  const inventory = await deps.getInventory(template.inventoryId, orgId);
  if (!inventory || inventory.orgId !== orgId) return finish("missing_inventory_target");
  const parsed = eligibilityPolicySchema.safeParse(inventory.eligibilityPolicy ?? {});
  if (!parsed.success) return finish("invalid_action_policy");
  const action = parsed.data.preflightActions?.find(policy => policy.templateId === template.id);
  if (!action) return finish("action_policy_missing");
  // Check the explicit action grant before reading or exposing target information. No admin rank bypass.
  if (!action.allowedRoles.some(role => role === principal.role)) throw new PreflightPermissionError();
  if (request.automation.adapter !== "local" || template.runnerMode !== "local") return finish("unsupported_automation");
  if (inventory.type !== "linked" || inventory.sourceType !== "netbox" || inventory.sourceRef !== request.target.sourceId) return finish("unsupported_inventory");

  const source = await deps.getCmdbAccount(request.target.sourceId, orgId);
  if (!source || source.orgId !== orgId || source.kind !== "netbox" || !source.enabled) return finish("unsupported_target");
  const vms = await deps.getNetboxVms(orgId);
  const matches = vms.filter(vm => vm.id === request.target.objectId && vm.sourceId === source.id);
  if (!matches.length) return finish("unsupported_target");
  if (matches.length !== 1) return finish("ambiguous_target");
  const vm = matches[0];
  if (!Number.isInteger(vm.netboxId) || vm.netboxId <= 0) return finish("inconsistent_evidence");
  if (vms.filter(row => row.sourceId === source.id && row.netboxId === vm.netboxId).length !== 1) return finish("ambiguous_target");
  response.target = request.target;
  response.automation = request.automation;
  response.evidence.targetId = vm.id;
  response.evidence.inventoryId = inventory.id;
  response.evidence.policyFingerprint = evidenceFingerprint(action);
  response.evidence.actionFingerprint = evidenceFingerprint(template);

  const blueprint = await deps.getGovernanceBlueprint(action.blueprintId, orgId);
  if (!blueprint || blueprint.orgId !== orgId || blueprint.status !== "active" || blueprint.objectType !== "netbox_vm" ||
      !blueprint.activeVersionId || (blueprint.sourceType && blueprint.sourceType !== "netbox_inventory_source") ||
      (blueprint.sourceId && blueprint.sourceId !== source.id)) return finish("inconsistent_evidence");
  const version = await deps.getGovernanceBlueprintVersion(blueprint.activeVersionId, orgId);
  if (!version || version.orgId !== orgId || version.blueprintId !== blueprint.id) return finish("inconsistent_evidence");
  const rules = governanceBlueprintRulesSchema.safeParse(version.rules);
  if (!rules.success) return finish("inconsistent_evidence");
  const rows = await deps.getCompletedEvaluations(orgId, source.id, vm.id, blueprint.id, version.id);
  if (!rows.length) return finish("missing_governance_evaluation");
  const { evaluation, run } = rows[0];
  if (rows.length > 1 && new Date(rows[1].evaluation.evaluatedAt).getTime() === new Date(evaluation.evaluatedAt).getTime()) return finish("ambiguous_target");
  if (evaluation.orgId !== orgId || run.orgId !== orgId || run.status !== "ok" || !run.completedAt ||
      evaluation.objectId !== vm.id || evaluation.objectType !== "netbox_vm" || evaluation.externalId !== String(vm.netboxId) ||
      evaluation.runId !== run.id || evaluation.blueprintId !== blueprint.id || run.blueprintId !== blueprint.id ||
      evaluation.blueprintVersionId !== version.id || run.blueprintVersionId !== version.id ||
      ![run.cmdbAccountId, run.netboxSourceId].includes(source.id) ||
      (run.cmdbAccountId && run.cmdbAccountId !== source.id) || (run.netboxSourceId && run.netboxSourceId !== source.id)) return finish("inconsistent_evidence");
  response.evidence.governanceEvaluationId = evaluation.id;
  response.evidence.governanceRunId = run.id;
  response.evidence.blueprintId = blueprint.id;
  response.evidence.blueprintVersionId = version.id;
  response.evidence.governanceReady = evaluation.automationReady;

  const assignments = await deps.listAssignmentsForObject(orgId, "netbox_inventory_source", source.id, "netbox_vm", vm.id);
  if (assignments.some(row => row.orgId !== orgId || row.sourceId !== source.id || row.objectId !== vm.id || row.objectType !== "netbox_vm" || row.sourceType !== "netbox_inventory_source")) return finish("inconsistent_evidence");
  if (assignments.length > 1) return finish("ambiguous_target");
  const assignment = assignments[0];
  if (!assignment?.customerScopeId || assignment.relationship === "unassigned") return finish("customer_assignment_missing", "block");
  if (assignment.relationship !== "dedicated" || assignment.derivedFrom !== "provider" || assignment.confidence !== "authoritative") return finish("customer_scope_blocked", "block");
  const scope = await deps.getCustomerScope(assignment.customerScopeId, orgId);
  if (!scope || scope.orgId !== orgId || scope.sourceType !== "netbox_inventory_source" || scope.sourceId !== source.id) return finish("inconsistent_evidence");
  if (!action.allowedCustomerScopeIds.includes(scope.id)) return finish("customer_scope_blocked", "block");
  response.evidence.customerScopeId = scope.id;
  response.evidence.customerAssignmentId = assignment.id;
  const context = await loadCustomerScopeContextByObjectId({ listCustomerScopeObjectAssignments: async () => assignments, listCustomerScopes: async () => [scope] }, orgId, source.id);
  const expires: number[] = [];
  const checkAge = (value: Date | null | undefined, seconds: number, reason: PreflightReason) => {
    const stamp = value ? new Date(value).getTime() : NaN;
    const age = now() - stamp;
    if (!Number.isFinite(stamp) || age < 0) { finish("inconsistent_evidence"); return false; }
    if (age > seconds * 1000) { finish(reason); return false; }
    expires.push(stamp + seconds * 1000);
    return true;
  };
  if (!checkAge(evaluation.evaluatedAt, Math.min(action.maxGovernanceAgeSeconds, request.freshness?.maxGovernanceAgeSeconds ?? Infinity), "stale_governance_evaluation") ||
      !checkAge(vm.lastImportedAt, action.maxSourceAgeSeconds, "stale_source") ||
      !checkAge(inventory.lastRefreshedAt, action.maxInventoryAgeSeconds, "stale_inventory") ||
      !checkAge(assignment.lastSyncedAt, action.maxAssignmentAgeSeconds, "stale_source") ||
      !checkAge(scope.lastSyncedAt, action.maxAssignmentAgeSeconds, "stale_source")) return finish();
  if (inventory.lastRefreshedAt!.getTime() < vm.lastImportedAt.getTime()) return finish("evidence_invalidated");
  const evaluatedAt = new Date(evaluation.evaluatedAt).getTime();
  const completeAt = new Date(run.completedAt).getTime();
  if (!Number.isFinite(completeAt) || completeAt > evaluatedAt || completeAt > now()) return finish("inconsistent_evidence");
  if ([vm.lastImportedAt, assignment.lastSyncedAt, assignment.updatedAt, scope.lastSyncedAt, scope.updatedAt, blueprint.updatedAt, version.createdAt]
      .some(time => !time || !Number.isFinite(new Date(time).getTime()) || new Date(time).getTime() > evaluatedAt)) return finish("evidence_invalidated");
  const snapshot = record(evaluation.objectSnapshot);
  const snapshotFields = ["id", "sourceId", "netboxId", "name", "ip", "operatingSystem", "customFields", "tags"] as const;
  if (snapshotFields.some(key => evidenceFingerprint(snapshot[key] ?? null) !== evidenceFingerprint(vm[key] ?? null))) return finish("evidence_invalidated");
  response.evidence.governanceEvaluatedAt = new Date(evaluation.evaluatedAt).toISOString();
  response.evidence.sourceImportedAt = vm.lastImportedAt.toISOString();
  response.evidence.inventoryRefreshedAt = inventory.lastRefreshedAt!.toISOString();
  response.evidence.customerAssignmentSyncedAt = assignment.lastSyncedAt!.toISOString();

  // Pure reuse of the blueprint evaluator over current cached data; no run is created.
  const current = evaluateGovernanceObject(normalizeCachedNetboxVm(vm, context.get(vm.id)), rules.data, new Date(now()));
  if (!evaluation.automationReady || evaluation.findings.some(finding => finding.severity === "blocker") ||
      evaluation.recommendedActions.includes("block_automation") || current.recommendedActions.includes("block_automation") ||
      !current.automationReadiness.ready || current.findings.some(finding => finding.severity === "blocker")) return finish("governance_not_ready", "block");
  const storedResult = governanceEvaluationResultSchema.safeParse(evaluation.result);
  if (!storedResult.success || storedResult.data.automationReadiness.ready !== evaluation.automationReady ||
      storedResult.data.scores.governance !== evaluation.governanceScore ||
      evidenceFingerprint(storedResult.data.findings) !== evidenceFingerprint(evaluation.findings) ||
      evidenceFingerprint(storedResult.data.recommendedActions) !== evidenceFingerprint(evaluation.recommendedActions)) return finish("inconsistent_evidence");
  if (evaluation.governanceScore < action.minimumGovernanceScore || current.scores.governance < action.minimumGovernanceScore) return finish("governance_policy_blocked", "block");
  const enforcement = await applyGovernanceGateEnforcement({ allowed: true, missing: [] as string[] },
    { governanceObjectType: "netbox_vm", governanceObjectId: vm.id }, parsed.data.governance, async () => evaluation);
  if (!enforcement.allowed) return finish("governance_policy_blocked", "block");


  const hosts = record(inventory.cachedData).hosts;
  if (!Array.isArray(hosts)) return finish("missing_inventory_target");
  const matchingHosts = hosts.filter(host => record(host).governanceObjectType === "netbox_vm" && record(host).governanceObjectId === vm.id);
  if (!matchingHosts.length) return finish("missing_inventory_target");
  if (matchingHosts.length !== 1) return finish("ambiguous_target");
  const host = record(matchingHosts[0]);
  if (hosts.filter(row => record(row).name === host.name).length !== 1 || !host.name || typeof host.name !== "string" || !/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(host.name)) return finish("ambiguous_target");
  if (!assessInventoryHostSignals({ address: host.ansible_host, governanceReady: evaluation.automationReady }).addressPresent ||
      typeof vm.ip !== "string" || !normalizedIpSchema.safeParse(vm.ip).success || !isIP(vm.ip.split("/")[0])) return finish("missing_connection_data", "block");
  if (host.ansible_host !== vm.ip.split("/")[0] || (host.sourceNetboxId !== undefined && host.sourceNetboxId !== vm.netboxId)) return finish("inconsistent_evidence");
  response.evidence.inventoryTargetPresent = true;
  const inventoryStatus = record(host.vars).status;
  if (inventoryStatus === undefined || inventoryStatus === "") return finish("unknown_readiness");
  if (inventoryStatus !== "active") return finish("eligibility_blocked", "block");
  if (template.limitExpr && !["all", host.name].includes(template.limitExpr)) return finish("unsupported_template_limit");
  if (parsed.data.requireContacts) return finish("unknown_readiness"); // Cached contacts are not verified today.
  const fields = record(vm.customFields);
  if (!fields._netboxStatus) return finish("unknown_readiness"); // Old caches need an explicit refresh.
  if (fields._netboxStatus !== "active" || fields.provider_state !== "active" || fields.automatable !== true || vm.operatingSystem !== "Linux") return finish("eligibility_blocked", "block");
  if (parsed.data.requireRole && !fields._netboxRole && !fields.role) return finish("eligibility_blocked", "block");

  const project = await deps.getProject(template.projectId, orgId);
  if (!project || project.orgId !== orgId) return finish("missing_execution_prerequisites");
  if (!template.credentialId) return finish("missing_credential");
  const credential = await deps.getCredential(template.credentialId, orgId);
  if (!credential || credential.orgId !== orgId || !hasUsableSshCredential(credential)) return finish("missing_credential");
  const local = await (deps.inspectLocal ?? inspectLocalPrerequisites)(project, template, credential, vm);
  if (!local.configured || !local.playbookSha256) return finish("missing_execution_prerequisites");
  if (local.playbookSha256 !== action.playbookSha256) return finish("evidence_invalidated");
  response.evidence.playbookSha256 = local.playbookSha256;
  const finalLocal = await (deps.inspectLocal ?? inspectLocalPrerequisites)(project, template, credential, vm);
  if (!finalLocal.configured || finalLocal.playbookSha256 !== local.playbookSha256) return finish("evidence_invalidated");

  // Optimistic re-read: detect changes across the asynchronous evidence/prerequisite reads.
  const [userNow, templateNow, inventoryNow, sourceNow, vmsNow, blueprintNow, versionNow, assignmentsNow, scopeNow, projectNow, credentialNow, evaluationsNow] = await Promise.all([
    deps.getUser(principal.id), deps.getJobTemplate(template.id, orgId), deps.getInventory(inventory.id, orgId), deps.getCmdbAccount(source.id, orgId),
    deps.getNetboxVms(orgId), deps.getGovernanceBlueprint(blueprint.id, orgId), deps.getGovernanceBlueprintVersion(version.id, orgId),
    deps.listAssignmentsForObject(orgId, "netbox_inventory_source", source.id, "netbox_vm", vm.id), deps.getCustomerScope(scope.id, orgId),
    deps.getProject(project.id, orgId), deps.getCredential(credential.id, orgId), deps.getCompletedEvaluations(orgId, source.id, vm.id, blueprint.id, version.id),
  ]);
  if (!userNow || userNow.id !== principal.id || userNow.role !== principal.role || (userNow.role !== "platform_admin" && userNow.orgId !== orgId)) throw new PreflightPermissionError();
  const original = { template, inventory, source, vms, blueprint, version, assignments, scope, project, credential, rows };
  const reread = { template: templateNow, inventory: inventoryNow, source: sourceNow, vms: vmsNow, blueprint: blueprintNow, version: versionNow,
    assignments: assignmentsNow, scope: scopeNow, project: projectNow, credential: credentialNow, rows: evaluationsNow };
  if (evidenceFingerprint(original) !== evidenceFingerprint(reread)) return finish("evidence_invalidated");
  if (now() < startedAt) return finish("inconsistent_evidence");
  const validUntil = Math.min(now() + action.decisionTtlSeconds * 1000, ...expires);
  if (validUntil <= now()) return finish("evidence_invalidated");
  response.decision = "allow";
  response.validUntil = new Date(validUntil).toISOString();
  response.evidence.automationEligible = true;
  return finish();
}

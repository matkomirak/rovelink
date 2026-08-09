import express, { type Request, type Response } from "express";
import { z } from "zod";
import type { IStorage } from "../storage";
import { storage as defaultStorage } from "../storage";
import { hasRoleAtLeast } from "../auth/roles";
import { sendClientError, sendInternalError } from "../services/api-errors";
import {
  STANDARD_NETBOX_VM_GOVERNANCE_BLUEPRINT,
  evaluateGovernanceObject,
  type NormalizedGovernanceObject,
} from "../services/governance-blueprint-evaluator";
import { governanceBlueprintRulesSchema } from "@shared/governance";
import type {
  GovernanceBlueprint,
  GovernanceBlueprintVersion,
  GovernanceEvaluationResult,
  NetboxVm,
} from "@shared/schema";

interface AuthRequest extends Request {
  user?: { id?: string; role?: string; orgId?: string | null };
  orgId?: string;
}

const createBlueprintSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  objectType: z.literal("netbox_vm"),
  status: z.enum(["draft", "active", "archived"]).optional(),
}).strict();

const updateBlueprintSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  status: z.enum(["draft", "active", "archived"]).optional(),
}).strict();

const createVersionSchema = z.object({
  rules: governanceBlueprintRulesSchema,
}).strict();

const activateSchema = z.object({
  versionId: z.string().min(1),
}).strict();

const evaluateCachedNetboxVmsSchema = z.object({
  netboxSourceId: z.string().min(1).optional(),
}).strict();

function resolveOrgId(req: AuthRequest): string {
  return req.orgId || req.user?.orgId || "";
}

function requireMinimumRole(req: AuthRequest, res: Response, role: "viewer" | "operator" | "admin"): boolean {
  if (hasRoleAtLeast(req.user?.role, role)) return true;
  res.status(403).json({ message: "Forbidden" });
  return false;
}

function rejectDirectActivation(res: Response, status?: string): boolean {
  if (status !== "active") return false;
  sendClientError(res, 400, "Governance blueprint status cannot be set to active directly. Use the activate endpoint.");
  return true;
}

export function createGovernanceRouter(storage: IStorage = defaultStorage) {
  const router = express.Router();

  router.get("/netbox-sources", async (req: AuthRequest, res: Response) => {
    if (!requireMinimumRole(req, res, "viewer")) return;

    try {
      const orgId = resolveOrgId(req);
      const [sources, vms] = await Promise.all([
        storage.getNetboxInventorySources(orgId),
        storage.getNetboxVms(orgId),
      ]);
      const vmCounts = new Map<string, number>();
      const lastImported = new Map<string, Date>();

      for (const vm of vms) {
        if (!vm.sourceId) continue;
        vmCounts.set(vm.sourceId, (vmCounts.get(vm.sourceId) ?? 0) + 1);
        const current = lastImported.get(vm.sourceId);
        if (!current || vm.lastImportedAt > current) {
          lastImported.set(vm.sourceId, vm.lastImportedAt);
        }
      }

      res.json(sources.map((source) => ({
        id: source.id,
        name: source.name,
        url: source.url,
        enabled: source.enabled,
        cachedVmCount: vmCounts.get(source.id) ?? 0,
        lastImportAt: source.lastImportAt ?? lastImported.get(source.id) ?? null,
        createdAt: source.createdAt,
      })));
    } catch (error) {
      sendInternalError(res, error, "governance.netbox-sources.list", "Failed to list governance NetBox sources");
    }
  });

  router.get("/blueprints", async (req: AuthRequest, res: Response) => {
    if (!requireMinimumRole(req, res, "viewer")) return;

    try {
      const blueprints = await storage.listGovernanceBlueprints(resolveOrgId(req));
      res.json(blueprints);
    } catch (error) {
      sendInternalError(res, error, "governance.blueprints.list", "Failed to list governance blueprints");
    }
  });

  router.post("/blueprints", async (req: AuthRequest, res: Response) => {
    if (!requireMinimumRole(req, res, "admin")) return;

    try {
      const orgId = resolveOrgId(req);
      const body = createBlueprintSchema.parse(req.body);
      if (rejectDirectActivation(res, body.status)) return;
      const blueprint = await storage.createGovernanceBlueprint({
        ...body,
        orgId,
        createdBy: req.user?.id,
        status: body.status ?? "draft",
      });
      res.status(201).json(blueprint);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return sendClientError(res, 400, "Invalid governance blueprint payload", { issues: error.issues });
      }
      sendInternalError(res, error, "governance.blueprints.create", "Failed to create governance blueprint");
    }
  });

  router.get("/blueprints/:id", async (req: AuthRequest, res: Response) => {
    if (!requireMinimumRole(req, res, "viewer")) return;

    try {
      const blueprint = await storage.getGovernanceBlueprint(req.params.id, resolveOrgId(req));
      if (!blueprint) return sendClientError(res, 404, "Governance blueprint not found");
      res.json(blueprint);
    } catch (error) {
      sendInternalError(res, error, "governance.blueprints.get", "Failed to read governance blueprint");
    }
  });

  router.patch("/blueprints/:id", async (req: AuthRequest, res: Response) => {
    if (!requireMinimumRole(req, res, "admin")) return;

    try {
      const orgId = resolveOrgId(req);
      const body = updateBlueprintSchema.parse(req.body);
      if (rejectDirectActivation(res, body.status)) return;
      const blueprint = await storage.updateGovernanceBlueprint(req.params.id, body, orgId);
      if (!blueprint) return sendClientError(res, 404, "Governance blueprint not found");
      res.json(blueprint);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return sendClientError(res, 400, "Invalid governance blueprint payload", { issues: error.issues });
      }
      sendInternalError(res, error, "governance.blueprints.update", "Failed to update governance blueprint");
    }
  });

  router.post("/blueprints/:id/versions", async (req: AuthRequest, res: Response) => {
    if (!requireMinimumRole(req, res, "admin")) return;

    try {
      const orgId = resolveOrgId(req);
      const blueprint = await storage.getGovernanceBlueprint(req.params.id, orgId);
      if (!blueprint) return sendClientError(res, 404, "Governance blueprint not found");

      const body = createVersionSchema.parse(req.body);
      const versions = await storage.listGovernanceBlueprintVersions(blueprint.id, orgId);
      const nextVersion = versions.reduce((max, version) => Math.max(max, version.version), 0) + 1;
      const version = await storage.createGovernanceBlueprintVersion({
        orgId,
        blueprintId: blueprint.id,
        version: nextVersion,
        rules: body.rules,
        createdBy: req.user?.id,
      });

      res.status(201).json(version);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return sendClientError(res, 400, "Invalid governance blueprint version payload", { issues: error.issues });
      }
      sendInternalError(res, error, "governance.versions.create", "Failed to create governance blueprint version");
    }
  });

  router.get("/blueprints/:id/versions", async (req: AuthRequest, res: Response) => {
    if (!requireMinimumRole(req, res, "viewer")) return;

    try {
      const versions = await storage.listGovernanceBlueprintVersions(req.params.id, resolveOrgId(req));
      res.json(versions);
    } catch (error) {
      sendInternalError(res, error, "governance.versions.list", "Failed to list governance blueprint versions");
    }
  });

  router.post("/blueprints/:id/activate", async (req: AuthRequest, res: Response) => {
    if (!requireMinimumRole(req, res, "admin")) return;

    try {
      const orgId = resolveOrgId(req);
      const body = activateSchema.parse(req.body);
      const blueprint = await storage.activateGovernanceBlueprintVersion(req.params.id, body.versionId, orgId);
      if (!blueprint) {
        return sendClientError(res, 404, "Governance blueprint version not found for this blueprint");
      }
      res.json(blueprint);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return sendClientError(res, 400, "Invalid governance activation payload", { issues: error.issues });
      }
      sendInternalError(res, error, "governance.versions.activate", "Failed to activate governance blueprint version");
    }
  });

  router.post("/defaults/netbox-vm", async (req: AuthRequest, res: Response) => {
    if (!requireMinimumRole(req, res, "admin")) return;

    try {
      const orgId = resolveOrgId(req);
      const existing = (await storage.listGovernanceBlueprints(orgId)).find(
        (blueprint) =>
          blueprint.objectType === "netbox_vm" &&
          blueprint.name === STANDARD_NETBOX_VM_GOVERNANCE_BLUEPRINT.name
      );

      let blueprint = existing;
      if (!blueprint) {
        blueprint = await storage.createGovernanceBlueprint({
          orgId,
          name: STANDARD_NETBOX_VM_GOVERNANCE_BLUEPRINT.name,
          description: "Default governance blueprint for cached NetBox virtual machines.",
          objectType: "netbox_vm",
          status: "draft",
          createdBy: req.user?.id,
        });
      }

      let activeVersion = blueprint.activeVersionId
        ? await storage.getGovernanceBlueprintVersion(blueprint.activeVersionId, orgId)
        : undefined;

      if (!activeVersion || activeVersion.blueprintId !== blueprint.id) {
        const versions = await storage.listGovernanceBlueprintVersions(blueprint.id, orgId);
        activeVersion = versions.find((version) => version.version === 1);
        if (!activeVersion) {
          activeVersion = await storage.createGovernanceBlueprintVersion({
            orgId,
            blueprintId: blueprint.id,
            version: 1,
            rules: STANDARD_NETBOX_VM_GOVERNANCE_BLUEPRINT.rules,
            createdBy: req.user?.id,
          });
        }
        blueprint = await storage.activateGovernanceBlueprintVersion(blueprint.id, activeVersion.id, orgId);
      }

      res.status(existing ? 200 : 201).json({ blueprint, activeVersion });
    } catch (error) {
      sendInternalError(res, error, "governance.defaults.netbox-vm", "Failed to create default governance blueprint");
    }
  });

  router.post("/blueprints/:id/evaluate-cached-netbox-vms", async (req: AuthRequest, res: Response) => {
    if (!requireMinimumRole(req, res, "operator")) return;

    try {
      const orgId = resolveOrgId(req);
      const payload = evaluateCachedNetboxVmsSchema.parse(req.body ?? {});
      const blueprint = await storage.getGovernanceBlueprint(req.params.id, orgId);
      if (!blueprint) return sendClientError(res, 404, "Governance blueprint not found");
      if (!blueprint.activeVersionId) return sendClientError(res, 400, "Governance blueprint has no active version");

      const version = await storage.getGovernanceBlueprintVersion(blueprint.activeVersionId, orgId);
      if (!version || version.blueprintId !== blueprint.id) {
        return sendClientError(res, 400, "Governance blueprint active version is invalid");
      }

      const selectedSourceId = payload.netboxSourceId;
      if (selectedSourceId) {
        const source = await storage.getNetboxInventorySource(selectedSourceId, orgId);
        if (!source) return sendClientError(res, 404, "NetBox inventory source not found");
      }

      const allVms = await storage.getNetboxVms(orgId);
      const vms = selectedSourceId
        ? allVms.filter((vm) => vm.sourceId === selectedSourceId)
        : allVms;
      const evaluated = vms.map((vm) => ({
        vm,
        result: evaluateGovernanceObject(normalizeCachedNetboxVm(vm), version.rules),
      }));
      const summary = summarizeEvaluationResults(evaluated.map((entry) => entry.result));
      const now = new Date();

      const run = await storage.createGovernanceEvaluationRun({
        orgId,
        blueprintId: blueprint.id,
        blueprintVersionId: version.id,
        netboxSourceId: selectedSourceId ?? firstSourceId(vms),
        status: "ok",
        counts: {
          evaluated: evaluated.length,
          compliant: summary.compliantCount,
          warning: summary.warningCount,
          blocked: summary.blockedCount,
        },
        startedAt: now,
        completedAt: now,
      });

      for (const { vm, result } of evaluated) {
        await storage.storeGovernanceObjectEvaluation({
          orgId,
          runId: run.id,
          blueprintId: blueprint.id,
          blueprintVersionId: version.id,
          objectType: "netbox_vm",
          objectId: vm.id,
          externalId: String(vm.netboxId),
          objectName: vm.name,
          governanceScore: result.scores.governance,
          dataManagementScore: result.scores.dataManagement,
          ownershipScore: result.scores.ownership,
          relevanceWeightedPriority: result.scores.relevanceWeightedPriority,
          automationReady: result.automationReadiness.ready,
          findings: result.findings,
          recommendedActions: result.recommendedActions,
          result,
          objectSnapshot: buildNetboxVmSnapshot(vm),
        });
      }

      res.json({
        evaluationRunId: run.id,
        evaluatedCount: evaluated.length,
        compliantCount: summary.compliantCount,
        warningCount: summary.warningCount,
        blockedCount: summary.blockedCount,
        averageGovernanceScore: summary.averageGovernanceScore,
        topFindings: summary.topFindings,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return sendClientError(res, 400, "Invalid governance evaluation payload", { issues: error.issues });
      }
      sendInternalError(res, error, "governance.evaluate.cached-netbox-vms", "Failed to evaluate cached NetBox VMs");
    }
  });

  router.get("/evaluation-runs", async (req: AuthRequest, res: Response) => {
    if (!requireMinimumRole(req, res, "viewer")) return;

    try {
      const limit = req.query.limit ? Number(req.query.limit) : 50;
      const runs = await storage.listGovernanceEvaluationRuns(resolveOrgId(req), Number.isFinite(limit) ? limit : 50);
      res.json(runs);
    } catch (error) {
      sendInternalError(res, error, "governance.evaluation-runs.list", "Failed to list governance evaluation runs");
    }
  });

  router.get("/evaluation-runs/:id", async (req: AuthRequest, res: Response) => {
    if (!requireMinimumRole(req, res, "viewer")) return;

    try {
      const run = await storage.getGovernanceEvaluationRun(req.params.id, resolveOrgId(req));
      if (!run) return sendClientError(res, 404, "Governance evaluation run not found");
      res.json(run);
    } catch (error) {
      sendInternalError(res, error, "governance.evaluation-runs.get", "Failed to read governance evaluation run");
    }
  });

  router.get("/evaluation-runs/:id/objects", async (req: AuthRequest, res: Response) => {
    if (!requireMinimumRole(req, res, "viewer")) return;

    try {
      const orgId = resolveOrgId(req);
      const run = await storage.getGovernanceEvaluationRun(req.params.id, orgId);
      if (!run) return sendClientError(res, 404, "Governance evaluation run not found");
      const evaluations = await storage.listGovernanceObjectEvaluations(run.id, orgId);
      res.json(evaluations);
    } catch (error) {
      sendInternalError(res, error, "governance.evaluation-runs.objects", "Failed to list governance object evaluations");
    }
  });

  router.get("/objects/:objectType/:objectId/latest-evaluation", async (req: AuthRequest, res: Response) => {
    if (!requireMinimumRole(req, res, "viewer")) return;

    try {
      const result = await storage.getLatestGovernanceEvaluationForObject(
        resolveOrgId(req),
        req.params.objectType,
        req.params.objectId,
      );
      res.json(result ?? null);
    } catch (error) {
      sendInternalError(res, error, "governance.objects.latest-evaluation", "Failed to read latest governance evaluation");
    }
  });

  return router;
}

function normalizeCachedNetboxVm(vm: NetboxVm): NormalizedGovernanceObject {
  const customFields = isRecord(vm.customFields) ? vm.customFields : {};

  return {
    objectType: "netbox_vm",
    objectId: vm.id,
    objectName: vm.name,
    fields: {
      tenant: customFields.tenant,
      role: customFields.role,
      platform: vm.operatingSystem,
      primaryIp: vm.ip,
      automatable: customFields.automatable,
      providerState: customFields.provider_state,
    },
    owners: {
      technical_owner: customFields.technical_owner,
      service_owner: customFields.service_owner,
      data_owner: customFields.data_owner,
      operations_team: customFields.operations_team,
      business_owner: customFields.business_owner,
    },
  };
}

function summarizeEvaluationResults(results: GovernanceEvaluationResult[]) {
  const compliantCount = results.filter((result) => result.findings.length === 0).length;
  const blockedCount = results.filter((result) => !result.automationReadiness.ready).length;
  const warningCount = results.length - compliantCount - blockedCount;
  const averageGovernanceScore = results.length
    ? Math.round(results.reduce((sum, result) => sum + result.scores.governance, 0) / results.length)
    : 0;
  const findingCounts = new Map<string, { code: string; count: number; message: string }>();

  for (const result of results) {
    for (const finding of result.findings) {
      const existing = findingCounts.get(finding.code);
      if (existing) existing.count += 1;
      else findingCounts.set(finding.code, { code: finding.code, count: 1, message: finding.message });
    }
  }

  return {
    compliantCount,
    warningCount,
    blockedCount,
    averageGovernanceScore,
    topFindings: Array.from(findingCounts.values()).sort((a, b) => b.count - a.count).slice(0, 5),
  };
}

function firstSourceId(vms: NetboxVm[]): string | null {
  const sourceIds = new Set(vms.map((vm) => vm.sourceId).filter((sourceId): sourceId is string => Boolean(sourceId)));
  return sourceIds.size === 1 ? Array.from(sourceIds)[0] : null;
}

function buildNetboxVmSnapshot(vm: NetboxVm) {
  return {
    id: vm.id,
    sourceId: vm.sourceId,
    netboxId: vm.netboxId,
    name: vm.name,
    ip: vm.ip,
    operatingSystem: vm.operatingSystem,
    customFields: vm.customFields,
    tags: vm.tags,
    lastImportedAt: vm.lastImportedAt,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export default createGovernanceRouter();

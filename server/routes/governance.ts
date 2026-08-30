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
import { NetBoxAdapter } from "../services/netbox-adapter";
import { netboxCustomerScopeResolver } from "../services/customer-scope-netbox-resolver";
import { governanceBlueprintRulesSchema } from "@shared/governance";
import type {
  CmdbAccount,
  GovernanceBlueprint,
  GovernanceBlueprintVersion,
  GovernanceEvaluationResult,
  InsertNetboxVm,
  InsertNetboxInventorySource,
  CustomerScope,
  CustomerScopeObjectAssignment,
  NetboxInventorySource,
  NetboxVm,
} from "@shared/schema";
import type { ResolvedCustomerScopeAssignment } from "@shared/customer-scope";
import { decryptNetboxToken, encryptNetboxToken } from "../services/secrets";

interface AuthRequest extends Request {
  user?: { id?: string; role?: string; orgId?: string | null };
  orgId?: string;
}

type GovernanceRouterDeps = {
  listNetboxVmsForSource?: (source: NetboxInventorySource) => Promise<unknown[]>;
};

const createBlueprintSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  objectType: z.literal("netbox_vm"),
  sourceType: z.literal("netbox_inventory_source").optional().nullable(),
  sourceId: z.string().min(1).optional().nullable(),
  status: z.enum(["draft", "active", "archived"]).optional(),
}).strict();

const updateBlueprintSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  sourceType: z.literal("netbox_inventory_source").optional().nullable(),
  sourceId: z.string().min(1).optional().nullable(),
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

const createDefaultNetboxVmBlueprintSchema = z.object({
  netboxSourceId: z.string().min(1),
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

async function validateBlueprintSourceBinding(
  storage: IStorage,
  orgId: string,
  sourceType?: string | null,
  sourceId?: string | null,
): Promise<string | null> {
  if (!sourceType && !sourceId) return null;
  if (sourceType !== "netbox_inventory_source" || !sourceId) {
    return "Governance blueprint source binding requires sourceType netbox_inventory_source and sourceId.";
  }
  const source = await storage.getNetboxInventorySource(sourceId, orgId);
  return source ? null : "NetBox inventory source not found";
}

async function listGovernanceNetboxSources(storage: IStorage, orgId: string): Promise<NetboxInventorySource[]> {
  await materializeNetboxSourcesFromCmdbAccounts(storage, orgId);
  return storage.getNetboxInventorySources(orgId);
}

async function materializeNetboxSourcesFromCmdbAccounts(storage: IStorage, orgId: string): Promise<void> {
  const [existingSources, cmdbAccounts] = await Promise.all([
    storage.getNetboxInventorySources(orgId),
    storage.getCmdbAccounts(orgId),
  ]);
  const existingSourceIds = new Set(existingSources.map((source) => source.id));

  for (const account of cmdbAccounts) {
    if (!isNetboxCmdbAccountWithCredentials(account) || existingSourceIds.has(account.id)) continue;

    await storage.createNetboxInventorySource({
      id: account.id,
      orgId,
      name: account.name,
      url: account.config.url,
      token: encryptNetboxToken(account.config.token),
      enabled: account.enabled,
    } as InsertNetboxInventorySource & { id: string });
    existingSourceIds.add(account.id);
  }
}

function isNetboxCmdbAccountWithCredentials(
  account: CmdbAccount,
): account is CmdbAccount & { config: { url: string; token: string } } {
  const config = isRecord(account.config) ? account.config : {};
  return (
    account.kind === "netbox" &&
    typeof config.url === "string" &&
    config.url.trim().length > 0 &&
    typeof config.token === "string" &&
    config.token.trim().length > 0
  );
}

async function listLiveNetboxVmsForSource(source: NetboxInventorySource): Promise<unknown[]> {
  const token = decryptNetboxToken(source.token);
  const adapter = new NetBoxAdapter({ url: source.url, token });
  return adapter.listAllVms();
}

function toCachedNetboxVm(sourceId: string, vm: unknown): InsertNetboxVm {
  const record = isRecord(vm) ? vm : {};
  const customFields = isRecord(record.custom_fields)
    ? record.custom_fields
    : isRecord(record.customFields)
      ? record.customFields
      : {};
  const platform = isRecord(record.platform) ? record.platform : {};

  return {
    sourceId,
    netboxId: Number(record.id),
    name: typeof record.name === "string" && record.name.trim() ? record.name : String(record.id),
    ip: extractVmIp(record),
    operatingSystem: normalizeOperatingSystem(
      stringValue(customFields.operating_system) ?? stringValue(platform.name),
    ),
    customFields,
    tags: Array.isArray(record.tags)
      ? record.tags.map((tag) => (
        isRecord(tag) ? stringValue(tag.name) ?? stringValue(tag.slug) : stringValue(tag)
      )).filter((tag): tag is string => Boolean(tag))
      : [],
  };
}

function extractVmIp(record: Record<string, unknown>): string | null {
  const primaryIp4 = isRecord(record.primary_ip4) ? record.primary_ip4 : {};
  const primaryIp = isRecord(record.primary_ip) ? record.primary_ip : {};
  const address = stringValue(primaryIp4.address) ?? stringValue(primaryIp.address);
  return address ? address.split("/")[0] : null;
}

function normalizeOperatingSystem(value?: string): string | null {
  if (!value) return null;
  const lower = value.toLowerCase();
  if (lower.includes("linux") || lower.includes("ubuntu") || lower.includes("debian") || lower.includes("centos") || lower.includes("rhel") || lower.includes("fedora")) {
    return "Linux";
  }
  if (lower.includes("windows")) return "Windows";
  return value === "Unknown" ? null : "Other";
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function defaultNetboxVmBlueprintName(sourceName: string): string {
  return `${STANDARD_NETBOX_VM_GOVERNANCE_BLUEPRINT.name} — ${sourceName}`;
}

async function upsertResolvedCustomerScopeAssignment(
  storage: IStorage,
  orgId: string,
  sourceId: string,
  cachedVm: NetboxVm,
  resolved: ResolvedCustomerScopeAssignment,
  syncedAt: Date,
): Promise<{ scopesUpserted: number; assignmentsUpserted: number; unassignedCount: number }> {
  let scopesUpserted = 0;
  let assignmentsUpserted = 0;

  if (resolved.relationship === "unassigned") {
    await storage.upsertCustomerScopeObjectAssignment({
      orgId,
      sourceType: "netbox_inventory_source",
      sourceId,
      objectType: "netbox_vm",
      objectId: cachedVm.id,
      customerScopeId: null,
      relationship: "unassigned",
      derivedFrom: resolved.derivedFrom,
      confidence: resolved.confidence,
      metadata: resolved.metadata ?? null,
      lastSyncedAt: syncedAt,
    });
    return { scopesUpserted, assignmentsUpserted: 1, unassignedCount: 1 };
  }

  for (const scope of resolved.customerScopes) {
    const persistedScope = await storage.upsertCustomerScope({
      orgId,
      sourceType: "netbox_inventory_source",
      sourceId,
      externalId: scope.externalId,
      name: scope.name,
      displayName: scope.displayName ?? null,
      strategy: scope.strategy,
      isolation: scope.isolation ?? null,
      parentExternalId: scope.parentExternalId ?? null,
      metadata: scope.metadata ?? null,
      lastSyncedAt: syncedAt,
    });
    scopesUpserted += 1;

    await storage.upsertCustomerScopeObjectAssignment({
      orgId,
      sourceType: "netbox_inventory_source",
      sourceId,
      objectType: "netbox_vm",
      objectId: cachedVm.id,
      customerScopeId: persistedScope.id,
      relationship: resolved.relationship,
      derivedFrom: resolved.derivedFrom,
      confidence: resolved.confidence,
      metadata: resolved.metadata ?? null,
      lastSyncedAt: syncedAt,
    });
    assignmentsUpserted += 1;
  }

  return { scopesUpserted, assignmentsUpserted, unassignedCount: 0 };
}

export function createGovernanceRouter(storage: IStorage = defaultStorage, deps: GovernanceRouterDeps = {}) {
  const router = express.Router();

  router.get("/netbox-sources", async (req: AuthRequest, res: Response) => {
    if (!requireMinimumRole(req, res, "viewer")) return;

    try {
      const orgId = resolveOrgId(req);
      const [sources, vms, cmdbAccounts] = await Promise.all([
        listGovernanceNetboxSources(storage, orgId),
        storage.getNetboxVms(orgId),
        storage.getCmdbAccounts(orgId),
      ]);
      const vmCounts = new Map<string, number>();
      const lastImported = new Map<string, Date>();
      const cmdbAccountsById = new Map(cmdbAccounts.map((account) => [account.id, account]));

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
        sourceType: "netbox_inventory_source",
        cmdbAccountId: cmdbAccountsById.has(source.id) ? source.id : null,
        cmdbAccountName: cmdbAccountsById.get(source.id)?.name ?? null,
      })));
    } catch (error) {
      sendInternalError(res, error, "governance.netbox-sources.list", "Failed to list governance NetBox sources");
    }
  });

  router.post("/netbox-sources/:id/sync-cached-vms", async (req: AuthRequest, res: Response) => {
    if (!requireMinimumRole(req, res, "operator")) return;

    try {
      const orgId = resolveOrgId(req);
      await materializeNetboxSourcesFromCmdbAccounts(storage, orgId);
      const source = await storage.getNetboxInventorySource(req.params.id, orgId);
      if (!source) return sendClientError(res, 404, "NetBox inventory source not found");

      const liveVms = await (deps.listNetboxVmsForSource ?? listLiveNetboxVmsForSource)(source);
      let importedCount = 0;
      let customerScopesUpserted = 0;
      let customerAssignmentsUpserted = 0;
      let customerUnassignedCount = 0;
      let customerScopeResolutionErrors = 0;
      for (const liveVm of liveVms) {
        const cachedVm = toCachedNetboxVm(source.id, liveVm);
        if (!Number.isFinite(cachedVm.netboxId)) continue;
        const persistedVm = await storage.upsertNetboxVm(cachedVm);
        importedCount += 1;

        try {
          const resolved = await netboxCustomerScopeResolver.resolveCiScopes({
            orgId,
            sourceType: "netbox_inventory_source",
            sourceId: source.id,
            providerKey: "netbox",
            objectType: "netbox_vm",
            objectId: persistedVm.id,
            externalId: String(cachedVm.netboxId),
            name: persistedVm.name,
            raw: liveVm,
          });
          const summary = await upsertResolvedCustomerScopeAssignment(
            storage,
            orgId,
            source.id,
            persistedVm,
            resolved,
            new Date(),
          );
          customerScopesUpserted += summary.scopesUpserted;
          customerAssignmentsUpserted += summary.assignmentsUpserted;
          customerUnassignedCount += summary.unassignedCount;
        } catch (error) {
          customerScopeResolutionErrors += 1;
          console.warn("Failed to resolve CustomerScope for cached NetBox VM", {
            sourceId: source.id,
            netboxId: cachedVm.netboxId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const updatedSource = await storage.updateNetboxInventorySource(
        source.id,
        { lastImportAt: new Date() },
        orgId,
      );

      res.json({
        sourceId: source.id,
        importedCount,
        cachedVmCount: importedCount,
        customerScopesUpserted,
        customerAssignmentsUpserted,
        customerUnassignedCount,
        customerScopeResolutionErrors,
        lastImportAt: updatedSource?.lastImportAt ?? null,
      });
    } catch (error) {
      sendInternalError(res, error, "governance.netbox-sources.sync-cached-vms", "Failed to sync cached NetBox VMs");
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
      const sourceError = await validateBlueprintSourceBinding(storage, orgId, body.sourceType, body.sourceId);
      if (sourceError) return sendClientError(res, sourceError.includes("not found") ? 404 : 400, sourceError);
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
      const sourceError = await validateBlueprintSourceBinding(storage, orgId, body.sourceType, body.sourceId);
      if (sourceError) return sendClientError(res, sourceError.includes("not found") ? 404 : 400, sourceError);
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
      const body = createDefaultNetboxVmBlueprintSchema.parse(req.body ?? {});
      await materializeNetboxSourcesFromCmdbAccounts(storage, orgId);
      const source = await storage.getNetboxInventorySource(body.netboxSourceId, orgId);
      if (!source) return sendClientError(res, 404, "NetBox inventory source not found");
      const blueprintName = defaultNetboxVmBlueprintName(source.name);
      const existing = (await storage.listGovernanceBlueprints(orgId)).find(
        (blueprint) =>
          blueprint.objectType === "netbox_vm" &&
          blueprint.sourceType === "netbox_inventory_source" &&
          blueprint.sourceId === source.id
      );

      let blueprint = existing;
      if (!blueprint) {
        blueprint = await storage.createGovernanceBlueprint({
          orgId,
          name: blueprintName,
          description: `Default governance blueprint for cached NetBox virtual machines from ${source.name}.`,
          objectType: "netbox_vm",
          sourceType: "netbox_inventory_source",
          sourceId: source.id,
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
      if (error instanceof z.ZodError) {
        return sendClientError(res, 400, "Invalid default governance blueprint payload", { issues: error.issues });
      }
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

      const boundSourceId = blueprint.sourceType === "netbox_inventory_source" && blueprint.sourceId
        ? blueprint.sourceId
        : undefined;
      const selectedSourceId = payload.netboxSourceId ?? boundSourceId;
      if (selectedSourceId) {
        const source = await storage.getNetboxInventorySource(selectedSourceId, orgId);
        if (!source) return sendClientError(res, 404, "NetBox inventory source not found");
      }

      const allVms = await storage.getNetboxVms(orgId);
      const vms = selectedSourceId
        ? allVms.filter((vm) => vm.sourceId === selectedSourceId)
        : allVms;
      if (selectedSourceId && vms.length === 0) {
        return sendClientError(
          res,
          400,
          "No cached NetBox VMs found for this source. Sync/import this CMDB source before running governance evaluation.",
        );
      }
      const customerScopeContextByObjectId = await loadCustomerScopeContextByObjectId(
        storage,
        orgId,
        selectedSourceId,
      );
      const evaluated = vms.map((vm) => ({
        vm,
        result: evaluateGovernanceObject(
          normalizeCachedNetboxVm(vm, customerScopeContextByObjectId.get(vm.id)),
          version.rules,
        ),
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

interface NormalizedCustomerScopeReference {
  id: string;
  externalId: string;
  name: string;
  displayName: string | null;
  strategy: string;
  isolation: string | null;
}

interface NormalizedCustomerScopeAssignment {
  id: string;
  customerScopeId: string | null;
  relationship: string;
  derivedFrom: string;
  confidence: string;
  lastSyncedAt: Date | null;
  customerScope: NormalizedCustomerScopeReference | null;
}

interface CustomerScopeGovernanceContext {
  customerAssignments: NormalizedCustomerScopeAssignment[];
  customerAssignmentRelationship: string | null;
  customerScopeCount: number;
  hasCustomerScope: boolean;
  isCustomerUnassigned: boolean;
  customerAssignmentConfidence: string | null;
  customerAssignmentDerivedFrom: string | null;
}

async function loadCustomerScopeContextByObjectId(
  storage: IStorage,
  orgId: string,
  sourceId?: string,
): Promise<Map<string, CustomerScopeGovernanceContext>> {
  const [assignments, scopes] = await Promise.all([
    storage.listCustomerScopeObjectAssignments(orgId, "netbox_inventory_source", sourceId),
    storage.listCustomerScopes(orgId, "netbox_inventory_source", sourceId),
  ]);
  const scopesById = new Map(scopes.map((scope) => [scope.id, scope]));
  const assignmentsByObjectId = new Map<string, NormalizedCustomerScopeAssignment[]>();

  for (const assignment of assignments) {
    if (assignment.objectType !== "netbox_vm") continue;
    const current = assignmentsByObjectId.get(assignment.objectId) ?? [];
    current.push(normalizeCustomerScopeAssignmentForGovernance(assignment, scopesById));
    assignmentsByObjectId.set(assignment.objectId, current);
  }

  const contextByObjectId = new Map<string, CustomerScopeGovernanceContext>();
  for (const [objectId, objectAssignments] of Array.from(assignmentsByObjectId.entries())) {
    const customerScopeCount = objectAssignments.filter((assignment: NormalizedCustomerScopeAssignment) => assignment.customerScope).length;
    contextByObjectId.set(objectId, {
      customerAssignments: objectAssignments,
      customerAssignmentRelationship: objectAssignments[0]?.relationship ?? null,
      customerScopeCount,
      hasCustomerScope: customerScopeCount > 0,
      isCustomerUnassigned: objectAssignments.some((assignment: NormalizedCustomerScopeAssignment) => assignment.relationship === "unassigned"),
      customerAssignmentConfidence: objectAssignments[0]?.confidence ?? null,
      customerAssignmentDerivedFrom: objectAssignments[0]?.derivedFrom ?? null,
    });
  }

  return contextByObjectId;
}

function normalizeCustomerScopeAssignmentForGovernance(
  assignment: CustomerScopeObjectAssignment,
  scopesById: Map<string, CustomerScope>,
): NormalizedCustomerScopeAssignment {
  const scope = assignment.customerScopeId ? scopesById.get(assignment.customerScopeId) ?? null : null;
  return {
    id: assignment.id,
    customerScopeId: assignment.customerScopeId,
    relationship: assignment.relationship,
    derivedFrom: assignment.derivedFrom,
    confidence: assignment.confidence,
    lastSyncedAt: assignment.lastSyncedAt,
    customerScope: scope ? {
      id: scope.id,
      externalId: scope.externalId,
      name: scope.name,
      displayName: scope.displayName,
      strategy: scope.strategy,
      isolation: scope.isolation,
    } : null,
  };
}

function emptyCustomerScopeGovernanceContext(): CustomerScopeGovernanceContext {
  return {
    customerAssignments: [],
    customerAssignmentRelationship: null,
    customerScopeCount: 0,
    hasCustomerScope: false,
    isCustomerUnassigned: false,
    customerAssignmentConfidence: null,
    customerAssignmentDerivedFrom: null,
  };
}

function normalizeCachedNetboxVm(
  vm: NetboxVm,
  customerScopeContext: CustomerScopeGovernanceContext = emptyCustomerScopeGovernanceContext(),
): NormalizedGovernanceObject {
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
      customerAssignments: customerScopeContext.customerAssignments,
      customerAssignmentRelationship: customerScopeContext.customerAssignmentRelationship,
      customerScopeCount: customerScopeContext.customerScopeCount,
      hasCustomerScope: customerScopeContext.hasCustomerScope,
      isCustomerUnassigned: customerScopeContext.isCustomerUnassigned,
      customerAssignmentConfidence: customerScopeContext.customerAssignmentConfidence,
      customerAssignmentDerivedFrom: customerScopeContext.customerAssignmentDerivedFrom,
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
  const findingCounts = new Map<string, { code: string; count: number; message: string; severityRank: number }>();

  for (const result of results) {
    for (const finding of result.findings) {
      const existing = findingCounts.get(finding.code);
      const severityRank = findingSeverityRank(finding.severity);
      if (existing) {
        existing.count += 1;
        existing.severityRank = Math.max(existing.severityRank, severityRank);
      } else {
        findingCounts.set(finding.code, { code: finding.code, count: 1, message: finding.message, severityRank });
      }
    }
  }

  return {
    compliantCount,
    warningCount,
    blockedCount,
    averageGovernanceScore,
    topFindings: Array.from(findingCounts.values())
      .sort((a, b) => b.severityRank - a.severityRank || b.count - a.count || a.code.localeCompare(b.code))
      .slice(0, 5)
      .map(({ severityRank: _severityRank, ...finding }) => finding),
  };
}

function findingSeverityRank(severity: string): number {
  if (severity === "blocker") return 3;
  if (severity === "warning") return 2;
  if (severity === "info") return 1;
  return 0;
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

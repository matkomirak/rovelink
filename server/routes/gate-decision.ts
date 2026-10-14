import { Router, type Request } from "express";
import { and, desc, eq, or } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { automationInventories, governanceEvaluationRuns, governanceObjectEvaluations } from "../../shared/schema";
import { gateDecisionRequestSchema } from "../../shared/gate-decision";
import { evaluatePreflight, PreflightPermissionError, type PreflightDependencies } from "../services/preflight-gate";
import { sendInternalError } from "../services/api-errors";
import { hasRoleAtLeast } from "../auth/roles";

export function defaultPreflightDependencies(): PreflightDependencies {
  return {
    getUser: storage.getUser.bind(storage), getJobTemplate: storage.getJobTemplate.bind(storage),
    getCmdbAccount: storage.getCmdbAccount.bind(storage), getNetboxVms: storage.getNetboxVms.bind(storage),
    getGovernanceBlueprint: storage.getGovernanceBlueprint.bind(storage), getGovernanceBlueprintVersion: storage.getGovernanceBlueprintVersion.bind(storage),
    listAssignmentsForObject: storage.listAssignmentsForObject.bind(storage), getCustomerScope: storage.getCustomerScope.bind(storage),
    getProject: storage.getProject.bind(storage), getCredential: storage.getCredential.bind(storage),
    getInventory: async (id, orgId) => {
      const [inventory] = await db.select().from(automationInventories).where(and(eq(automationInventories.id, id), eq(automationInventories.orgId, orgId))).limit(1);
      return inventory;
    },
    getCompletedEvaluations: (orgId, sourceId, objectId, blueprintId, versionId) => db
      .select({ evaluation: governanceObjectEvaluations, run: governanceEvaluationRuns })
      .from(governanceObjectEvaluations).innerJoin(governanceEvaluationRuns, eq(governanceObjectEvaluations.runId, governanceEvaluationRuns.id))
      .where(and(eq(governanceObjectEvaluations.orgId, orgId), eq(governanceEvaluationRuns.orgId, orgId),
        eq(governanceObjectEvaluations.objectType, "netbox_vm"), eq(governanceObjectEvaluations.objectId, objectId),
        eq(governanceObjectEvaluations.blueprintId, blueprintId), eq(governanceObjectEvaluations.blueprintVersionId, versionId),
        eq(governanceEvaluationRuns.blueprintId, blueprintId), eq(governanceEvaluationRuns.blueprintVersionId, versionId), eq(governanceEvaluationRuns.status, "ok"),
        or(eq(governanceEvaluationRuns.netboxSourceId, sourceId), eq(governanceEvaluationRuns.cmdbAccountId, sourceId))))
      .orderBy(desc(governanceObjectEvaluations.evaluatedAt), desc(governanceObjectEvaluations.id)).limit(2),
  };
}

export function createGateDecisionRouter(deps: PreflightDependencies = defaultPreflightDependencies()) {
  const router = Router();
  router.post("/evaluate", async (req: Request & { userId?: string; orgId?: string; user?: { role?: string } }, res) => {
    if (!req.userId) return res.status(401).json({ message: "Authentication required" });
    if (!req.orgId) return res.status(403).json({ message: "Organization context required" });
    if (!hasRoleAtLeast(req.user?.role, "operator")) return res.status(403).json({ message: "Forbidden" });
    const parsed = gateDecisionRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid pre-flight request" });
    try {
      return res.json(await evaluatePreflight(parsed.data, { id: req.userId, orgId: req.orgId, role: req.user!.role! }, deps));
    } catch (error) {
      if (error instanceof PreflightPermissionError) return res.status(403).json({ message: "Forbidden" });
      return sendInternalError(res, error, "gate-decision", "Failed to evaluate pre-flight decision");
    }
  });
  return router;
}

import { Router, type Request } from "express";
import { randomUUID } from "node:crypto";
import { gateDecisionRequestSchema, type GateDecisionResponse } from "../../shared/gate-decision";
import { storage, type IStorage } from "../storage";
import { sendInternalError } from "../services/api-errors";

type Dependencies = Pick<IStorage, "getCmdbAccount" | "getNetboxVms" |
  "getLatestGovernanceEvaluationForObject" | "getJobTemplate">;

export function createGateDecisionRouter(deps: Dependencies = storage) {
  const router = Router();
  router.post("/evaluate", async (req: Request & { userId?: string; orgId?: string }, res) => {
    if (!req.userId) return res.status(401).json({ message: "Authentication required" });
    if (!req.orgId) return res.status(403).json({ message: "Organization context required" });
    const parsed = gateDecisionRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid pre-flight request" });
    const response: GateDecisionResponse = {
      correlationId: randomUUID(), evaluatedAt: new Date().toISOString(), decision: "unknown",
      reasons: [], evidence: {}, warnings: ["Advisory evidence only; execution authorization is not established."],
    };
    try {
      const { target, automation, freshness } = parsed.data;
      const orgId = req.orgId;
      const source = await deps.getCmdbAccount(target.sourceId, orgId);
      if (!source || source.orgId !== orgId || source.kind !== "netbox") {
        response.reasons.push("unsupported_target");
        return res.json(response);
      }
      const vm = (await deps.getNetboxVms(orgId)).find(row => row.id === target.objectId && row.sourceId === source.id);
      if (!vm) {
        response.reasons.push("unsupported_target");
        return res.json(response);
      }
      response.evidence.targetId = vm.id;
      if (automation.templateId && !await deps.getJobTemplate(automation.templateId, orgId)) {
        response.reasons.push("unsupported_automation");
        return res.json(response);
      }
      const latest = await deps.getLatestGovernanceEvaluationForObject(orgId, "netbox_vm", vm.id);
      const evaluation = latest?.evaluation;
      const run = latest?.run;
      if (evaluation && run && evaluation.orgId === orgId && run.orgId === orgId && run.status === "ok" &&
          evaluation.objectId === vm.id && evaluation.objectType === "netbox_vm" &&
          evaluation.runId === run.id && (run.cmdbAccountId === source.id || run.netboxSourceId === source.id)) {
        const evaluated = new Date(evaluation.evaluatedAt);
        const age = Date.now() - evaluated.getTime();
        if (!Number.isFinite(age) || age < 0 || (freshness && age > freshness.maxGovernanceAgeSeconds * 1000)) {
          response.reasons.push("stale_governance_evaluation");
        } else {
          response.evidence.governanceRunId = run.id;
          response.evidence.blueprintId = run.blueprintId;
          response.evidence.governanceReady = evaluation.automationReady;
          response.evidence.governanceEvaluatedAt = evaluated.toISOString();
          if (!evaluation.automationReady) {
            response.decision = "block";
            response.reasons.push("governance_not_ready");
          }
        }
      }
      if (!vm.ip?.trim()) {
        response.decision = "block";
        response.reasons.push("missing_connection_data");
      }
      // Cached posture cannot establish credential, adapter, inventory or launch authorization.
      response.reasons.push("unknown_readiness");
      return res.json(response);
    } catch (error) {
      return sendInternalError(res, error, "gate-decision", "Failed to evaluate pre-flight decision");
    }
  });
  return router;
}

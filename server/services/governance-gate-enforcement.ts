import type { GovernanceObjectEvaluation } from "../../shared/schema";
import {
  DEFAULT_GOVERNANCE_ENFORCEMENT_POLICY,
  type GovernanceEnforcementPolicy,
} from "../../shared/schema";

export interface GovernanceEnforcementIdentity {
  governanceObjectType?: "netbox_vm";
  governanceObjectId?: string;
}

export interface GovernanceEnforcementDecision {
  allowed: boolean;
  missing: string[];
  reason?: string;
  failureType?: "governance" | "invariant";
}

export interface GovernanceEnforcementMetadata {
  mode: GovernanceEnforcementPolicy["mode"];
  enforced: boolean;
  wouldBlock: boolean;
  status: "not_evaluated" | "passed" | "warning" | "blocked";
  reason: string | null;
  evaluationId: string | null;
  evaluationRunId: string | null;
  governanceScore: number | null;
  automationReadiness: "ready" | "not_ready" | null;
  recommendedActions: string[];
}

export type GovernanceEnforcedDecision<T extends GovernanceEnforcementDecision> = T & {
  governanceEnforcement?: GovernanceEnforcementMetadata;
};

export type GovernanceEvaluationLoader = (
  identity: Required<GovernanceEnforcementIdentity>
) => Promise<GovernanceObjectEvaluation | null | undefined>;

export async function applyGovernanceGateEnforcement<T extends GovernanceEnforcementDecision>(
  decision: T,
  identity: GovernanceEnforcementIdentity,
  policy: GovernanceEnforcementPolicy | null | undefined,
  loadLatestEvaluation: GovernanceEvaluationLoader,
): Promise<GovernanceEnforcedDecision<T>> {
  const effectivePolicy = policy ?? DEFAULT_GOVERNANCE_ENFORCEMENT_POLICY;

  if (effectivePolicy.mode === "observe_only") {
    return { ...decision };
  }

  const existingBlocked = decision.allowed === false;
  const blockAssessment = await assessGovernanceBlock(identity, effectivePolicy, loadLatestEvaluation);

  if (effectivePolicy.mode === "warn_only") {
    return {
      ...decision,
      governanceEnforcement: {
        ...blockAssessment.metadata,
        mode: "warn_only",
        enforced: false,
        status: blockAssessment.wouldBlock ? "warning" : blockAssessment.metadata.status,
      },
    };
  }

  if (!blockAssessment.wouldBlock) {
    return {
      ...decision,
      governanceEnforcement: {
        ...blockAssessment.metadata,
        mode: "enforce",
        enforced: true,
      },
    };
  }

  if (existingBlocked) {
    return {
      ...decision,
      governanceEnforcement: {
        ...blockAssessment.metadata,
        mode: "enforce",
        enforced: true,
      },
    };
  }

  return {
    ...decision,
    allowed: false,
    missing: [...decision.missing, "governance_enforcement"],
    reason: blockAssessment.reason,
    failureType: "governance",
    governanceEnforcement: {
      ...blockAssessment.metadata,
      mode: "enforce",
      enforced: true,
    },
  };
}

async function assessGovernanceBlock(
  identity: GovernanceEnforcementIdentity,
  policy: GovernanceEnforcementPolicy,
  loadLatestEvaluation: GovernanceEvaluationLoader,
): Promise<{ wouldBlock: boolean; reason: string | null; metadata: Omit<GovernanceEnforcementMetadata, "mode" | "enforced"> }> {
  const rawGovernanceObjectId = identity.governanceObjectId;
  const missingIdentity = identity.governanceObjectType !== "netbox_vm"
    || typeof rawGovernanceObjectId !== "string"
    || rawGovernanceObjectId.trim().length === 0;
  if (missingIdentity) {
    return buildAssessment(true, "Governance enforcement: missing governance object identity", null);
  }

  const governanceObjectId = rawGovernanceObjectId.trim();
  const evaluation = await loadLatestEvaluation({
    governanceObjectType: "netbox_vm",
    governanceObjectId,
  });

  if (!evaluation) {
    const reason = policy.requireGovernanceEvaluation
      ? "Governance enforcement: no governance evaluation found"
      : null;
    return buildAssessment(Boolean(reason), reason, null);
  }

  const readiness = evaluation.automationReady ? "ready" : "not_ready";
  if (!policy.allowedReadinessStates.includes(readiness)) {
    return buildAssessment(
      true,
      `Governance enforcement: readiness ${readiness} is not allowed`,
      evaluation,
    );
  }

  if (policy.minimumGovernanceScore !== null && evaluation.governanceScore < policy.minimumGovernanceScore) {
    return buildAssessment(
      true,
      `Governance enforcement: score ${evaluation.governanceScore} below required ${policy.minimumGovernanceScore}`,
      evaluation,
    );
  }

  const recommendedActions = getRecommendedActions(evaluation);
  if (policy.blockOnRecommendedAction && recommendedActions.includes("block_automation")) {
    return buildAssessment(
      true,
      "Governance enforcement: block_automation recommended",
      evaluation,
    );
  }

  return buildAssessment(false, null, evaluation);
}

function buildAssessment(
  wouldBlock: boolean,
  reason: string | null,
  evaluation: GovernanceObjectEvaluation | null,
): { wouldBlock: boolean; reason: string | null; metadata: Omit<GovernanceEnforcementMetadata, "mode" | "enforced"> } {
  const recommendedActions = evaluation ? getRecommendedActions(evaluation) : [];
  return {
    wouldBlock,
    reason,
    metadata: {
      wouldBlock,
      status: wouldBlock ? "blocked" : evaluation ? "passed" : "not_evaluated",
      reason,
      evaluationId: evaluation?.id ?? null,
      evaluationRunId: evaluation?.runId ?? null,
      governanceScore: evaluation?.governanceScore ?? null,
      automationReadiness: evaluation ? (evaluation.automationReady ? "ready" : "not_ready") : null,
      recommendedActions,
    },
  };
}

function getRecommendedActions(evaluation: GovernanceObjectEvaluation): string[] {
  return Array.isArray(evaluation.recommendedActions)
    ? evaluation.recommendedActions.map((action) => String(action))
    : [];
}

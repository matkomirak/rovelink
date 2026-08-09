import {
  type GovernanceBlueprintRules,
  type GovernanceEvaluationResult,
  type GovernanceFinding,
  type RecommendedGovernanceAction,
  governanceBlueprintRulesSchema,
} from "@shared/governance";

export interface NormalizedGovernanceObject {
  objectType: "netbox_vm";
  objectId?: string;
  objectName?: string;
  fields: Record<string, unknown>;
  owners?: Partial<Record<string, unknown>>;
}

export const STANDARD_NETBOX_VM_GOVERNANCE_BLUEPRINT = {
  name: "Standard NetBox VM Governance",
  objectType: "netbox_vm" as const,
  rules: governanceBlueprintRulesSchema.parse({
    objectType: "netbox_vm",
    dataManagement: [
      {
        fieldKey: "tenant",
        label: "Tenant",
        required: true,
        managementMode: "owned_by_cmdb",
        weight: 1,
      },
      {
        fieldKey: "role",
        label: "Role",
        required: true,
        managementMode: "owned_by_cmdb",
        weight: 1,
      },
      {
        fieldKey: "platform",
        label: "Platform",
        required: true,
        managementMode: "owned_by_cmdb",
        weight: 1,
      },
      {
        fieldKey: "primaryIp",
        label: "Primary IP",
        required: true,
        managementMode: "owned_by_cmdb",
        weight: 1,
      },
      {
        fieldKey: "automatable",
        label: "Automation approval",
        required: true,
        managementMode: "owned_by_cmdb",
        weight: 1,
      },
      {
        fieldKey: "providerState",
        label: "Provider state",
        required: true,
        managementMode: "imported_from_provider",
        weight: 1,
      },
    ],
    ownership: [
      {
        role: "technical_owner",
        label: "Technical owner",
        required: true,
        sourceField: "owners.technical_owner",
        weight: 1,
      },
      {
        role: "service_owner",
        label: "Service owner",
        required: true,
        sourceField: "owners.service_owner",
        weight: 1,
      },
      {
        role: "data_owner",
        label: "Data owner",
        required: false,
        sourceField: "owners.data_owner",
        weight: 0.5,
      },
      {
        role: "operations_team",
        label: "Operations team",
        required: false,
        sourceField: "owners.operations_team",
        weight: 0.5,
      },
      {
        role: "business_owner",
        label: "Business owner",
        required: false,
        sourceField: "owners.business_owner",
        weight: 0.5,
      },
    ],
    relevance: {
      support: 3,
      audit: 2,
      billing: 1,
      reporting: 2,
      compliance: 2,
    },
    reporting: {
      minimumGovernanceScoreForAutomation: 70,
      highPriorityRelevanceScore: 10,
    },
  }),
};

const ACTION_ORDER: RecommendedGovernanceAction[] = [
  "ignore",
  "report",
  "validate",
  "enrich",
  "remediate",
  "archive_candidate",
  "block_automation",
];

export function evaluateGovernanceObject(
  object: NormalizedGovernanceObject,
  rawRules: GovernanceBlueprintRules
): GovernanceEvaluationResult {
  const rules = governanceBlueprintRulesSchema.parse(rawRules);

  if (object.objectType !== rules.objectType) {
    throw new Error(`Governance blueprint object type ${rules.objectType} cannot evaluate ${object.objectType}`);
  }

  const findings: GovernanceFinding[] = [];
  const actions = new Set<RecommendedGovernanceAction>();
  const relevanceTotal = Object.values(rules.relevance).reduce((sum, value) => sum + value, 0);
  const highRelevance = relevanceTotal >= rules.reporting.highPriorityRelevanceScore;

  const dataManagementScore = scoreWeightedRules(rules.dataManagement, (rule) => {
    const value = getFieldValue(object, rule.fieldKey);
    const present = hasGovernanceValue(value);

    if (!present && rule.required) {
      addFinding(findings, actions, {
        layer: "data_management",
        severity: highRelevance ? "blocker" : "warning",
        code: "required_data_missing",
        fieldKey: rule.fieldKey,
        message: `${rule.label} is required but missing.`,
        recommendedActions: highRelevance ? ["enrich", "block_automation"] : ["enrich", "report"],
      });
      return 0;
    }

    if (!present && !rule.required) {
      addFinding(findings, actions, {
        layer: "data_management",
        severity: "info",
        code: "optional_data_missing",
        fieldKey: rule.fieldKey,
        message: `${rule.label} is optional but missing.`,
        recommendedActions: ["report"],
      });
      return 1;
    }

    if (rule.managementMode === "unknown") {
      addFinding(findings, actions, {
        layer: "data_management",
        severity: "warning",
        code: "management_mode_unknown",
        fieldKey: rule.fieldKey,
        message: `${rule.label} has an unknown data management mode.`,
        recommendedActions: ["validate"],
      });
      return 0.5;
    }

    return 1;
  });

  const ownershipScore = scoreWeightedRules(rules.ownership, (rule) => {
    const value = getOwnerValue(object, rule.role, rule.sourceField);
    const present = hasGovernanceValue(value);

    if (!present && rule.required) {
      addFinding(findings, actions, {
        layer: "ownership",
        severity: "warning",
        code: "required_owner_missing",
        role: rule.role,
        message: `${rule.label} is required but missing.`,
        recommendedActions: ["enrich"],
      });
      return 0;
    }

    if (!present && !rule.required) {
      addFinding(findings, actions, {
        layer: "ownership",
        severity: "info",
        code: "optional_owner_missing",
        role: rule.role,
        message: `${rule.label} is optional but missing.`,
        recommendedActions: ["report"],
      });
      return 1;
    }

    return 1;
  });

  const governanceScore = roundScore((dataManagementScore + ownershipScore) / 2);
  const relevanceWeightedPriority = calculatePriority(relevanceTotal, governanceScore);
  const readinessReasons: string[] = [];
  let automationReady = true;

  if (getFieldValue(object, "automatable") === false) {
    automationReady = false;
    addFinding(findings, actions, {
      layer: "automation_readiness",
      severity: "blocker",
      code: "automation_not_approved",
      fieldKey: "automatable",
      message: "Object is explicitly not approved for automation.",
      recommendedActions: ["block_automation", "validate"],
    });
    readinessReasons.push("Object is explicitly not approved for automation.");
  }

  if (findings.some((finding) => finding.severity === "blocker")) {
    automationReady = false;
  }

  if (governanceScore < rules.reporting.minimumGovernanceScoreForAutomation) {
    automationReady = false;
    readinessReasons.push(
      `Governance score ${governanceScore} is below automation threshold ${rules.reporting.minimumGovernanceScoreForAutomation}.`
    );
    if (highRelevance) actions.add("block_automation");
  }

  if (readinessReasons.length === 0) {
    readinessReasons.push("Governance blueprint checks passed.");
  }

  if (findings.length === 0) {
    actions.add("ignore");
  }

  return {
    objectType: object.objectType,
    objectId: object.objectId,
    objectName: object.objectName,
    scores: {
      governance: governanceScore,
      dataManagement: dataManagementScore,
      ownership: ownershipScore,
      relevanceWeightedPriority,
    },
    automationReadiness: {
      ready: automationReady,
      reasons: readinessReasons,
    },
    findings,
    recommendedActions: sortActions(actions),
  };
}

function scoreWeightedRules<T extends { weight?: number }>(
  rules: T[],
  evaluateRule: (rule: T) => number
): number {
  const totalWeight = rules.reduce((sum, rule) => sum + (rule.weight ?? 1), 0);
  if (totalWeight === 0) return 100;

  const weightedScore = rules.reduce((sum, rule) => {
    const weight = rule.weight ?? 1;
    return sum + weight * evaluateRule(rule);
  }, 0);

  return roundScore((weightedScore / totalWeight) * 100);
}

function calculatePriority(relevanceTotal: number, governanceScore: number): number {
  const relevancePercent = (relevanceTotal / 15) * 100;
  const governanceGap = 100 - governanceScore;
  return roundScore((relevancePercent * 0.7) + (governanceGap * 0.3));
}

function roundScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function addFinding(
  findings: GovernanceFinding[],
  actions: Set<RecommendedGovernanceAction>,
  finding: GovernanceFinding
): void {
  findings.push(finding);
  for (const action of finding.recommendedActions) {
    actions.add(action);
  }
}

function sortActions(actions: Set<RecommendedGovernanceAction>): RecommendedGovernanceAction[] {
  return ACTION_ORDER.filter((action) => actions.has(action));
}

function getOwnerValue(
  object: NormalizedGovernanceObject,
  role: string,
  sourceField?: string
): unknown {
  if (sourceField) {
    const sourceValue = getPath({ fields: object.fields, owners: object.owners ?? {} }, sourceField);
    if (hasGovernanceValue(sourceValue)) return sourceValue;
  }

  return object.owners?.[role];
}

function getFieldValue(object: NormalizedGovernanceObject, fieldKey: string): unknown {
  return getPath(object.fields, fieldKey);
}

function getPath(source: unknown, path: string): unknown {
  if (!source || typeof source !== "object") return undefined;

  return path.split(".").reduce<unknown>((current, segment) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[segment];
  }, source);
}

function hasGovernanceValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

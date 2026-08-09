import { z } from "zod";

export const dataManagementModeSchema = z.enum([
  "manual",
  "synchronized_by_rovelink",
  "synchronized_by_another_system",
  "imported_from_provider",
  "owned_by_cmdb",
  "unknown",
]);

export const ownershipRoleSchema = z.enum([
  "technical_owner",
  "service_owner",
  "data_owner",
  "operations_team",
  "business_owner",
]);

export const recommendedGovernanceActionSchema = z.enum([
  "ignore",
  "report",
  "validate",
  "enrich",
  "remediate",
  "archive_candidate",
  "block_automation",
]);

const ruleWeightSchema = z.number().min(0.1).max(10).default(1);

export const relevanceRuleSchema = z.object({
  support: z.number().int().min(0).max(3),
  audit: z.number().int().min(0).max(3),
  billing: z.number().int().min(0).max(3),
  reporting: z.number().int().min(0).max(3),
  compliance: z.number().int().min(0).max(3),
}).strict();

export const dataManagementRuleSchema = z.object({
  fieldKey: z.string().min(1),
  label: z.string().min(1),
  required: z.boolean().default(true),
  managementMode: dataManagementModeSchema,
  weight: ruleWeightSchema,
}).strict();

export const ownershipRuleSchema = z.object({
  role: ownershipRoleSchema,
  label: z.string().min(1),
  required: z.boolean().default(true),
  sourceField: z.string().min(1).optional(),
  weight: ruleWeightSchema,
}).strict();

const reportingRulesSchema = z.object({
  minimumGovernanceScoreForAutomation: z.number().int().min(0).max(100).default(70),
  highPriorityRelevanceScore: z.number().int().min(0).max(15).default(10),
}).strict();

export const governanceBlueprintRulesSchema = z.object({
  objectType: z.literal("netbox_vm"),
  dataManagement: z.array(dataManagementRuleSchema),
  ownership: z.array(ownershipRuleSchema),
  relevance: relevanceRuleSchema,
  reporting: reportingRulesSchema.default({
    minimumGovernanceScoreForAutomation: 70,
    highPriorityRelevanceScore: 10,
  }),
}).strict().superRefine((rules, ctx) => {
  const fieldKeys = new Set<string>();
  for (let index = 0; index < rules.dataManagement.length; index += 1) {
    const rule = rules.dataManagement[index];
    if (fieldKeys.has(rule.fieldKey)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dataManagement", index, "fieldKey"],
        message: `Duplicate data management fieldKey: ${rule.fieldKey}`,
      });
    }
    fieldKeys.add(rule.fieldKey);
  }

  const ownershipRoles = new Set<string>();
  for (let index = 0; index < rules.ownership.length; index += 1) {
    const rule = rules.ownership[index];
    if (ownershipRoles.has(rule.role)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ownership", index, "role"],
        message: `Duplicate ownership role: ${rule.role}`,
      });
    }
    ownershipRoles.add(rule.role);
  }
});

export const governanceFindingSchema = z.object({
  layer: z.enum(["data_management", "ownership", "relevance", "automation_readiness"]),
  severity: z.enum(["info", "warning", "blocker"]),
  code: z.string().min(1),
  fieldKey: z.string().min(1).optional(),
  role: ownershipRoleSchema.optional(),
  message: z.string().min(1),
  recommendedActions: z.array(recommendedGovernanceActionSchema),
}).strict();

export const governanceEvaluationResultSchema = z.object({
  objectType: z.literal("netbox_vm"),
  objectId: z.string().optional(),
  objectName: z.string().optional(),
  scores: z.object({
    governance: z.number().min(0).max(100),
    dataManagement: z.number().min(0).max(100),
    ownership: z.number().min(0).max(100),
    relevanceWeightedPriority: z.number().min(0).max(100),
  }).strict(),
  automationReadiness: z.object({
    ready: z.boolean(),
    reasons: z.array(z.string()),
  }).strict(),
  findings: z.array(governanceFindingSchema),
  recommendedActions: z.array(recommendedGovernanceActionSchema),
}).strict();

export type DataManagementMode = z.infer<typeof dataManagementModeSchema>;
export type OwnershipRole = z.infer<typeof ownershipRoleSchema>;
export type RecommendedGovernanceAction = z.infer<typeof recommendedGovernanceActionSchema>;
export type RelevanceRule = z.infer<typeof relevanceRuleSchema>;
export type DataManagementRule = z.infer<typeof dataManagementRuleSchema>;
export type OwnershipRule = z.infer<typeof ownershipRuleSchema>;
export type GovernanceBlueprintRules = z.infer<typeof governanceBlueprintRulesSchema>;
export type GovernanceFinding = z.infer<typeof governanceFindingSchema>;
export type GovernanceEvaluationResult = z.infer<typeof governanceEvaluationResultSchema>;

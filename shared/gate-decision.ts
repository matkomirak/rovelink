import { z } from "zod";

const id = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
export const gateDecisionRequestSchema = z.object({
  target: z.object({ sourceType: z.literal("cmdb"), sourceId: id,
    objectType: z.literal("netbox_vm"), objectId: id }).strict(),
  automation: z.object({ templateId: id.optional(), adapter: z.enum(["local", "awx", "rhaap", "webhook"]) }).strict(),
  freshness: z.object({ maxGovernanceAgeSeconds: z.number().int().min(1).max(86400 * 30) }).strict().optional(),
}).strict();
export type GateDecisionRequest = z.infer<typeof gateDecisionRequestSchema>;
export const preflightReasonMessages = {
  unsupported_target: "Target is unavailable or unsupported in this organization.",
  unsupported_automation: "Requested adapter is not supported for verified pre-flight authorization.",
  invalid_template: "Requested template is unavailable or invalid.",
  action_policy_missing: "No explicit action policy is configured for this template.",
  invalid_action_policy: "The configured action policy cannot be verified.",
  governance_not_ready: "Relevant governance evidence or current blueprint checks block this target.",
  governance_policy_blocked: "The configured governance threshold or enforcement policy blocks this action.",
  missing_governance_evaluation: "No relevant completed governance evaluation is available.",
  stale_governance_evaluation: "Governance evidence exceeds the configured age limit.",
  inconsistent_evidence: "Referenced identities, versions or evidence do not agree.",
  evidence_invalidated: "Source or policy state changed after the evaluation or during this request.",
  stale_source: "Source or customer evidence exceeds its configured freshness limit.",
  stale_inventory: "Inventory evidence exceeds its configured freshness limit.",
  missing_inventory_target: "Target is absent from the template's linked inventory.",
  ambiguous_target: "Target or inventory identity is ambiguous.",
  missing_connection_data: "Required connection information is missing or invalid.",
  eligibility_blocked: "Known technical prerequisites block this target.",
  customer_assignment_missing: "A verified dedicated CustomerScope assignment is required.",
  customer_scope_blocked: "The current customer assignment is outside this action's allowed scopes.",
  missing_credential: "A usable organization-owned SSH credential is required.",
  missing_execution_prerequisites: "Required local execution configuration cannot be verified.",
  unsupported_inventory: "Only linked NetBox inventories support positive authorization.",
  unsupported_template_limit: "The template limit cannot be bound safely to this target.",
  unknown_readiness: "Required readiness evidence cannot be verified.",
} as const;
export type PreflightReason = keyof typeof preflightReasonMessages;
export interface GateDecisionResponse {
  correlationId: string;
  evaluatedAt: string;
  decision: "allow" | "block" | "pending" | "unknown";
  explanation?: string;
  validUntil?: string | null;
  target?: GateDecisionRequest["target"];
  automation?: GateDecisionRequest["automation"];
  reasons: PreflightReason[];
  evidence: {
    targetId?: string;
    governanceRunId?: string;
    blueprintId?: string;
    governanceReady?: boolean;
    governanceEvaluatedAt?: string;
    inventoryTargetPresent?: boolean;
    governanceEvaluationId?: string;
    blueprintVersionId?: string;
    inventoryId?: string;
    inventoryRefreshedAt?: string;
    sourceImportedAt?: string;
    customerScopeId?: string;
    customerAssignmentId?: string;
    customerAssignmentSyncedAt?: string;
    automationEligible?: boolean;
    policyFingerprint?: string;
    actionFingerprint?: string;
    playbookSha256?: string;
  };
  warnings: string[];
}

import { z } from "zod";

const id = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
export const gateDecisionRequestSchema = z.object({
  target: z.object({ sourceType: z.literal("cmdb"), sourceId: id,
    objectType: z.literal("netbox_vm"), objectId: id }).strict(),
  automation: z.object({ templateId: id.optional(), adapter: z.enum(["local", "awx", "rhaap", "webhook"]) }).strict(),
  freshness: z.object({ maxGovernanceAgeSeconds: z.number().int().min(1).max(86400 * 30) }).strict().optional(),
}).strict();
export type GateDecisionRequest = z.infer<typeof gateDecisionRequestSchema>;
export type PreflightReason = "unsupported_target" | "unknown_readiness" | "governance_not_ready" |
  "stale_governance_evaluation" | "missing_connection_data" | "missing_inventory_target" | "unsupported_automation";
export interface GateDecisionResponse {
  correlationId: string;
  evaluatedAt: string;
  decision: "allow" | "block" | "pending" | "unknown";
  reasons: PreflightReason[];
  evidence: {
    targetId?: string;
    governanceRunId?: string;
    blueprintId?: string;
    governanceReady?: boolean;
    governanceEvaluatedAt?: string;
    inventoryTargetPresent?: boolean;
  };
  warnings: string[];
}

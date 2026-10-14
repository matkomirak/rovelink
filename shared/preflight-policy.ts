import { z } from "zod";

const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
const age = z.number().int().min(1).max(30 * 86400);
/** Explicit admin-managed grants; no default role, scope, freshness or allow. */
export const preflightActionPolicySchema = z.object({
  templateId: id,
  blueprintId: id,
  playbookSha256: z.string().regex(/^[a-f0-9]{64}$/),
  allowedRoles: z.array(z.enum(["operator", "admin", "platform_admin"])).nonempty(),
  allowedCustomerScopeIds: z.array(id).nonempty(),
  minimumGovernanceScore: z.number().int().min(0).max(100),
  maxGovernanceAgeSeconds: age,
  maxSourceAgeSeconds: age,
  maxInventoryAgeSeconds: age,
  maxAssignmentAgeSeconds: age,
  decisionTtlSeconds: z.number().int().min(1).max(3600),
}).strict();
export const preflightActionsSchema = z.array(preflightActionPolicySchema).max(100).superRefine((actions, ctx) => {
  const templates = new Set<string>();
  for (const action of actions) {
    if (templates.has(action.templateId)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Duplicate pre-flight template policy" });
    templates.add(action.templateId);
  }
});
export type PreflightActionPolicy = z.infer<typeof preflightActionPolicySchema>;

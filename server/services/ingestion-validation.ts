import { z } from "zod";
import { isIP } from "node:net";
import { providerCustomerScopeCandidateConfidenceSchema, providerCustomerScopeCandidateDerivedFromSchema } from "../../shared/schema";

const stableText = z.string().trim().min(1).max(2048).refine(value => !/[\0-\x1f\x7f]/.test(value));
export const normalizedIpSchema = z.string().refine(value => {
  const [address, prefix, ...extra] = value.split("/");
  const version = isIP(address);
  return !!version && extra.length === 0 && (prefix === undefined ||
    (/^\d+$/.test(prefix) && Number(prefix) <= (version === 4 ? 32 : 128)));
});
export const normalizedNetboxVmSchema = z.object({
  netboxId: z.number().int().positive(), name: stableText,
  sourceId: stableText, ip: normalizedIpSchema.nullish(), operatingSystem: z.string().nullish(),
  customFields: z.record(z.unknown()).optional(), tags: z.array(z.string().max(512)).optional(),
}).passthrough();
export const normalizedInfrastructureSchema = z.object({
  providerType: z.enum(["fake", "azure", "proxmox", "vmware", "aws", "gcp", "generic"]),
  objectType: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), externalId: stableText,
  name: stableText.nullish(), tags: z.union([z.array(z.unknown()), z.record(z.unknown())]).optional(),
  labels: z.record(z.unknown()).optional(), metadata: z.record(z.unknown()).optional(),
}).passthrough().superRefine((object, ctx) => {
  for (const key of ["primaryIp4", "primaryIp6"]) {
    const value = object.metadata?.[key];
    if (value !== undefined && value !== null && !normalizedIpSchema.safeParse(value).success) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["metadata", key], message: "Invalid IP address" });
    }
  }
});
export const customerScopeCandidateSchema = z.object({
  object: z.object({ objectType: stableText, externalId: stableText }),
  candidateValue: stableText, derivedFrom: providerCustomerScopeCandidateDerivedFromSchema, confidence: providerCustomerScopeCandidateConfidenceSchema,
}).passthrough();

/** Bounded JSON projection; redacts secret-shaped keys without logging values. */
export function sanitizeIngestionMetadata(value: unknown, depth = 0): unknown {
  if (depth > 8) return null;
  if (Array.isArray(value)) return value.slice(0, 10000).map(child => sanitizeIngestionMetadata(child, depth + 1));
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value).slice(0, 10000)) {
      if (/^(?:__proto__|constructor|prototype)$/.test(key)) continue;
      if (/password|secret|token|private.?key|authorization|api.?key|credential/i.test(key)) { result[key] = "[REDACTED]"; continue; }
      result[key] = sanitizeIngestionMetadata(child, depth + 1);
    }
    return result;
  }
  if (typeof value === "string") {
    if (/-----BEGIN .*PRIVATE KEY|(?:Bearer|Token)\s+\S+|(?:password|secret|token|api.?key)\s*[:=]|enc:v1:/i.test(value)) return "[REDACTED]";
    return value.slice(0, 65536);
  }
  return value === null || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)) ? value : null;
}

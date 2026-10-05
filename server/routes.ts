import type { Express, Request, Response, NextFunction } from "express";
import { requireRole } from "./auth/roles";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import { storage } from "./storage";
import { netboxService } from "./services/netbox";
import { dispatchRun } from "./services/runner-dispatcher";
import { notificationService } from "./services/notificationService";
import { ProxmoxCollector } from "./services/proxmox-collector";
import { NetBoxAdapter } from "./services/netbox-adapter";
import { runProviderSyncWithWorker } from "./services/syncWorker";
import {
  ProviderInfrastructureSyncConfigError,
  ProviderInfrastructureSyncDiscoveryError,
  ProviderInfrastructureSyncNotSupportedError,
  syncProviderInfrastructureInventory,
} from "./services/provider-infrastructure-sync";
import { runVmDriftComparison } from "./services/drift/drift-comparison-service";
import { sanitizeGitSyncError, syncGitProject } from "./services/git-project-sync";
import { insertUserSchema, insertProjectSchema, insertJobTemplateSchema, insertJobRunSchema, insertNetboxInventorySourceSchema, insertProviderAccountSchema, insertCmdbAccountSchema, netboxVms, organizations, insertOrganizationSchema, type CustomerScope, type CustomerScopeObjectAssignment, type DriftMatchStatus, type DriftRunStatus, type DriftSeverity, type DriftStatus, type GovernanceObjectEvaluation } from "@shared/schema";
import { db } from "./db";
import { eq, sql } from "drizzle-orm";
import {
  sanitizeProviderForResponse,
  sanitizeCmdbForResponse,
  sanitizeNetboxSourceForResponse,
  encryptProviderConfig,
  decryptProviderConfig,
  encryptCmdbConfig,
  decryptCmdbConfig,
  encryptNetboxToken,
  decryptNetboxToken,
} from "./services/secrets";
import { getSafeErrorMessage, sanitizeErrorForLog, sendClientError, sendInternalError } from "./services/api-errors";
import {
  buildCredentialCreate,
  buildCredentialUpdate,
  sanitizeCredentialForResponse,
} from "./services/credential-secrets";

// Import modular RDP routes
import pipelineRoutes from "./routes/pipelines";
import pipelineMappingRoutes from "./routes/pipeline-mappings";
import providerDiscoveryRoutes from "./routes/provider-discovery";
import automationInventoryRoutes from "./routes/automation-inventories";
import gateRoutes from "./routes/gate";
import templateRoutes from "./routes/templates";
import runsRoutes from "./routes/runs";
import notificationRoutes from "./routes/notifications";
import settingsRoutes from "./routes/settings";
import netboxRoutes from "./routes/netbox-sources";
import orgRoutes from "./routes/organizations";
import governanceRoutes from "./routes/governance";
import { isLocalDevRuntime, validateProductionRuntimeConfig } from "./services/runtime-config";

// ─── JWT setup ────────────────────────────────────────────────────────────────
const isProduction = process.env.NODE_ENV === "production";
const runtimeConfigErrors = validateProductionRuntimeConfig();

if (runtimeConfigErrors.length > 0) {
  for (const error of runtimeConfigErrors) {
    console.error(`FATAL: ${error}`);
  }
  process.exit(1);
}

if (isProduction && isLocalDevRuntime()) {
  console.warn("ROVELINK_LOCAL_DEV=true is enabled while NODE_ENV=production. This is intended only for local Docker development.");
}

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";
const JWT_EXPIRES_IN = "24h";

export function shouldFallbackToJwtClaimsOnDbLookupError(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === "test";
}

export function buildAuthUserResponse(user: { id: string; username: string; role: string; orgId?: string | null }) {
  return { user: { id: user.id, username: user.username, role: user.role, orgId: user.orgId ?? null } };
}

export function buildRunFailureLog(error: unknown): string {
  const message = getSafeErrorMessage(error, "Run failed");
  return `[rovelink] Run failed: ${message}\n`;
}

function infrastructureObjectTypeLabel(objectType: string): string {
  const labels: Record<string, string> = {
    vm: "Virtual Machines",
    subscription: "Subscriptions",
    resource_group: "Resource Groups",
    network_interface: "Network Interfaces",
    vnet: "Virtual Networks",
    subnet: "Subnets",
    disk: "Disks",
    public_ip: "Public IPs",
    cluster: "Clusters",
    node: "Nodes",
    template: "Templates",
    storage: "Storage",
    network_bridge: "Network Bridges",
    pool: "Pools",
    tag: "Tags",
  };
  return labels[objectType] ?? objectType;
}

function serializeInfrastructureObjectForList(object: any) {
  return {
    id: object.id,
    objectType: object.objectType,
    externalId: object.externalId,
    providerNativeId: object.providerNativeId ?? null,
    name: object.name ?? null,
    displayName: object.displayName ?? null,
    region: object.region ?? null,
    zone: object.zone ?? null,
    cluster: object.cluster ?? null,
    node: object.node ?? null,
    lifecycleState: object.lifecycleState ?? null,
    powerState: object.powerState ?? null,
    tags: object.tags ?? [],
    labels: object.labels ?? {},
    lastSyncedAt: object.lastSyncedAt ?? null,
    customerScopeCandidateCount: object.customerScopeCandidateCount ?? 0,
  };
}

function serializeProviderCustomerScopeCandidate(candidate: any) {
  return {
    id: candidate.id,
    derivedFrom: candidate.derivedFrom,
    candidateValue: candidate.candidateValue,
    confidence: candidate.confidence,
    metadata: candidate.metadata ?? {},
    lastSyncedAt: candidate.lastSyncedAt ?? null,
  };
}

class DriftQueryValidationError extends Error {}

const DRIFT_RUN_STATUSES = new Set<DriftRunStatus>(["pending", "running", "completed", "failed"]);
const DRIFT_MATCH_STATUSES = new Set<DriftMatchStatus>(["matched", "unmatched_reference", "unmatched_provider", "ambiguous"]);
const DRIFT_STATUSES = new Set<DriftStatus>(["no_drift", "drift", "unknown", "not_compared"]);
const DRIFT_SEVERITIES = new Set<DriftSeverity>(["info", "warning", "critical"]);

function queryStringValue(value: unknown): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}

function parseOptionalPositiveInteger(value: unknown, field: string): number | undefined {
  const raw = queryStringValue(value);
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new DriftQueryValidationError(`${field} must be a non-negative integer`);
  }
  return parsed;
}

function parseDriftRunFilters(query: Record<string, unknown>) {
  const filters: {
    cmdbSourceId?: string;
    providerSourceId?: string;
    objectType?: string;
    status?: DriftRunStatus;
    limit?: number;
    offset?: number;
  } = {};
  const cmdbSourceId = queryStringValue(query.cmdbSourceId);
  const providerSourceId = queryStringValue(query.providerSourceId);
  const objectType = queryStringValue(query.objectType);
  const status = queryStringValue(query.status);
  if (cmdbSourceId) filters.cmdbSourceId = cmdbSourceId;
  if (providerSourceId) filters.providerSourceId = providerSourceId;
  if (objectType) filters.objectType = objectType;
  if (status) {
    if (!DRIFT_RUN_STATUSES.has(status as DriftRunStatus)) {
      throw new DriftQueryValidationError("Unsupported drift run status filter");
    }
    filters.status = status as DriftRunStatus;
  }
  filters.limit = parseOptionalPositiveInteger(query.limit, "limit");
  filters.offset = parseOptionalPositiveInteger(query.offset, "offset");
  return filters;
}

function parseDriftItemFilters(query: Record<string, unknown>) {
  const filters: {
    matchStatus?: DriftMatchStatus;
    driftStatus?: DriftStatus;
    driftSeverity?: DriftSeverity;
    limit?: number;
    offset?: number;
  } = {};
  const matchStatus = queryStringValue(query.matchStatus);
  const driftStatus = queryStringValue(query.driftStatus);
  const driftSeverity = queryStringValue(query.driftSeverity);
  if (matchStatus) {
    if (!DRIFT_MATCH_STATUSES.has(matchStatus as DriftMatchStatus)) {
      throw new DriftQueryValidationError("Unsupported drift match status filter");
    }
    filters.matchStatus = matchStatus as DriftMatchStatus;
  }
  if (driftStatus) {
    if (!DRIFT_STATUSES.has(driftStatus as DriftStatus)) {
      throw new DriftQueryValidationError("Unsupported drift status filter");
    }
    filters.driftStatus = driftStatus as DriftStatus;
  }
  if (driftSeverity) {
    if (!DRIFT_SEVERITIES.has(driftSeverity as DriftSeverity)) {
      throw new DriftQueryValidationError("Unsupported drift severity filter");
    }
    filters.driftSeverity = driftSeverity as DriftSeverity;
  }
  filters.limit = parseOptionalPositiveInteger(query.limit, "limit");
  filters.offset = parseOptionalPositiveInteger(query.offset, "offset");
  return filters;
}

function isDriftSourceValidationError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /source.*(organization|org)|not found in organization|must belong to organization/i.test(error.message);
}

function serializeInfrastructureObjectDetail(object: any) {
  return {
    id: object.id,
    sourceId: object.sourceId,
    providerType: object.providerType,
    objectType: object.objectType,
    externalId: object.externalId,
    providerNativeId: object.providerNativeId ?? null,
    name: object.name ?? null,
    displayName: object.displayName ?? null,
    region: object.region ?? null,
    zone: object.zone ?? null,
    cluster: object.cluster ?? null,
    node: object.node ?? null,
    lifecycleState: object.lifecycleState ?? null,
    powerState: object.powerState ?? null,
    tags: object.tags ?? [],
    labels: object.labels ?? {},
    metadata: object.metadata ?? {},
    lastSyncedAt: object.lastSyncedAt ?? null,
    customerScopeCandidates: (object.customerScopeCandidates ?? []).map(serializeProviderCustomerScopeCandidate),
    relationships: [],
  };
}

// ─── Rate limiter for login ───────────────────────────────────────────────────
const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many login attempts, please try again later" },
});

// Auth middleware
interface AuthRequest extends Request {
  userId?: string;
  orgId?: string;
  user?: any;
}

const CMDB_OBJECT_TYPES = {
  netbox_vm: {
    objectType: "netbox_vm",
    name: "Virtual Machines",
    description: "Virtual machine records from NetBox virtualization inventory.",
    status: "live",
    mode: "live",
  },
} as const;

type CmdbObjectType = keyof typeof CMDB_OBJECT_TYPES;
type CmdbObjectMode = "cached" | "live";
type CountMap = Record<string, number>;

const SENSITIVE_OBJECT_KEYS = new Set([
  "authorization",
  "api_key",
  "apiKey",
  "password",
  "secret",
  "token",
]);

function isSupportedCmdbObjectType(value: string): value is CmdbObjectType {
  return Object.prototype.hasOwnProperty.call(CMDB_OBJECT_TYPES, value);
}

function sanitizeCmdbObjectPayload(value: unknown, depth = 0): unknown {
  if (depth > 8 || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeCmdbObjectPayload(item, depth + 1));
  if (typeof value !== "object") return value;

  const sanitized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_OBJECT_KEYS.has(key) || SENSITIVE_OBJECT_KEYS.has(key.toLowerCase())) {
      sanitized[key] = "[REDACTED]";
    } else {
      sanitized[key] = sanitizeCmdbObjectPayload(child, depth + 1);
    }
  }
  return sanitized;
}

function getNetboxVmDisplayFields(vm: any) {
  const customFields = vm.custom_fields ?? vm.customFields ?? {};
  const safeCustomFields = sanitizeCmdbObjectPayload(customFields) as Record<string, unknown>;
  const primaryIp = vm.primary_ip ?? (
    vm.ip
      ? { address: vm.ip }
      : null
  );
  const status = vm.status ?? (
    typeof customFields.provider_state === "string"
      ? { value: customFields.provider_state, label: customFields.provider_state }
      : null
  );

  return {
    id: vm.netboxId ?? vm.id,
    localObjectId: vm.netboxId !== undefined && vm.netboxId !== null ? vm.id : null,
    cachedVmId: vm.netboxId !== undefined && vm.netboxId !== null ? vm.id : null,
    name: vm.name,
    status,
    platform: vm.platform ?? (vm.operatingSystem ? { name: vm.operatingSystem } : null),
    primary_ip: primaryIp,
    primary_ip4: vm.primary_ip4 ?? primaryIp,
    tenant: vm.tenant ?? (customFields.tenant ? { name: customFields.tenant } : null),
    role: vm.role ?? vm.device_role ?? (customFields.role ? { name: customFields.role } : null),
    cluster: vm.cluster ?? null,
    site: vm.site ?? null,
    vcpus: vm.vcpus ?? null,
    memory: vm.memory ?? null,
    disk: vm.disk ?? null,
    tags: vm.tags ?? [],
    custom_fields: safeCustomFields,
    last_synced: vm.last_updated ?? vm.updated ?? vm.lastImportedAt ?? null,
  };
}

function buildCmdbObjectResponse(cmdb: any, objectType: CmdbObjectType, objects: any[], mode: CmdbObjectMode) {
  const safeObjects = objects.map((object) => ({
    ...getNetboxVmDisplayFields(object),
    raw: sanitizeCmdbObjectPayload(object),
  }));

  return {
    source: {
      id: cmdb.id,
      name: cmdb.name,
      kind: cmdb.kind,
    },
    objectType,
    objectTypeName: CMDB_OBJECT_TYPES[objectType].name,
    mode,
    objects: safeObjects,
    total: safeObjects.length,
  };
}

async function getCachedNetboxVmsForCmdb(cmdbId: string, orgId: string) {
  const cachedVms = await storage.getNetboxVms(orgId).catch(() => []);
  return cachedVms.filter((vm: any) => vm.sourceId === cmdbId);
}

function incrementCount(counts: CountMap, key?: string | null) {
  if (!key) return;
  counts[key] = (counts[key] ?? 0) + 1;
}

function latestDate(...values: Array<Date | string | null | undefined>): Date | null {
  let latest: Date | null = null;
  for (const value of values) {
    if (!value) continue;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) continue;
    if (!latest || date > latest) latest = date;
  }
  return latest;
}

function sanitizeCustomerScope(scope: CustomerScope) {
  return {
    id: scope.id,
    name: scope.name,
    displayName: scope.displayName,
    externalId: scope.externalId,
    strategy: scope.strategy,
    isolation: scope.isolation,
    parentExternalId: scope.parentExternalId,
    metadata: sanitizeCmdbObjectPayload(scope.metadata),
    lastSyncedAt: scope.lastSyncedAt,
    createdAt: scope.createdAt,
    updatedAt: scope.updatedAt,
  };
}

function sanitizeCustomerScopeForAssignment(scope: CustomerScope | undefined) {
  if (!scope) return null;
  return {
    id: scope.id,
    name: scope.name,
    displayName: scope.displayName,
    externalId: scope.externalId,
    strategy: scope.strategy,
    isolation: scope.isolation,
  };
}

function serializeCustomerScopeAssignment(
  assignment: CustomerScopeObjectAssignment,
  scopesById: Map<string, CustomerScope>,
) {
  return {
    id: assignment.id,
    objectType: assignment.objectType,
    objectId: assignment.objectId,
    relationship: assignment.relationship,
    derivedFrom: assignment.derivedFrom,
    confidence: assignment.confidence,
    metadata: sanitizeCmdbObjectPayload(assignment.metadata),
    lastSyncedAt: assignment.lastSyncedAt,
    customerScope: assignment.customerScopeId
      ? sanitizeCustomerScopeForAssignment(scopesById.get(assignment.customerScopeId))
      : null,
  };
}

function summarizeCustomerScopeAssignments(assignments: CustomerScopeObjectAssignment[]) {
  const relationshipCounts: CountMap = {};
  const derivedFromCounts: CountMap = {};
  const confidenceCounts: CountMap = {};
  const assignedObjectIds = new Set<string>();
  const unassignedObjectIds = new Set<string>();
  let latestLastSyncedAt: Date | null = null;

  for (const assignment of assignments) {
    incrementCount(relationshipCounts, assignment.relationship);
    incrementCount(derivedFromCounts, assignment.derivedFrom);
    incrementCount(confidenceCounts, assignment.confidence);
    if (assignment.relationship === "unassigned") {
      unassignedObjectIds.add(assignment.objectId);
    } else {
      assignedObjectIds.add(assignment.objectId);
    }
    latestLastSyncedAt = latestDate(latestLastSyncedAt, assignment.lastSyncedAt);
  }

  return {
    assignedObjectCount: assignedObjectIds.size,
    unassignedObjectCount: unassignedObjectIds.size,
    relationshipCounts,
    derivedFromCounts,
    confidenceCounts,
    latestLastSyncedAt,
  };
}

function assignmentFreshness(assignment: CustomerScopeObjectAssignment): number {
  return latestDate(assignment.updatedAt, assignment.lastSyncedAt, assignment.createdAt)?.getTime() ?? 0;
}

function selectCurrentCustomerScopeAssignments(assignments: CustomerScopeObjectAssignment[]) {
  const selectedByObjectId = new Map<string, CustomerScopeObjectAssignment[]>();

  for (const assignment of [...assignments].sort((a, b) => assignmentFreshness(b) - assignmentFreshness(a))) {
    const current = selectedByObjectId.get(assignment.objectId);
    if (!current) {
      selectedByObjectId.set(assignment.objectId, [assignment]);
      continue;
    }
    if (assignment.relationship === "shared" && current.every((existing) => existing.relationship === "shared")) {
      current.push(assignment);
    }
  }

  return Array.from(selectedByObjectId.values()).flat();
}

function findingSeverityRank(severity?: string): number {
  if (severity === "blocker") return 3;
  if (severity === "warning") return 2;
  if (severity === "info") return 1;
  return 0;
}

function summarizeCustomerScopeGovernance(
  params: {
    sourceId: string;
    customerScopeId: string | null;
    customerScopeName: string;
    objectIds: string[];
    evaluations: GovernanceObjectEvaluation[];
    unassigned: boolean;
  },
) {
  const findingCounts: CountMap = {};
  const topFindingCounts = new Map<string, { code: string; count: number; message: string; severity?: string; severityRank: number }>();
  let latestEvaluationRunId: string | null = null;
  let latestEvaluatedAt: Date | null = null;
  let governanceScoreTotal = 0;
  let readyCount = 0;
  let notReadyCount = 0;
  let blockAutomationRecommendationCount = 0;

  for (const evaluation of params.evaluations) {
    governanceScoreTotal += evaluation.governanceScore;
    if (evaluation.automationReady) {
      readyCount += 1;
    } else {
      notReadyCount += 1;
    }
    if (Array.isArray(evaluation.recommendedActions) && evaluation.recommendedActions.includes("block_automation")) {
      blockAutomationRecommendationCount += 1;
    }
    if (!latestEvaluatedAt || evaluation.evaluatedAt > latestEvaluatedAt) {
      latestEvaluatedAt = evaluation.evaluatedAt;
      latestEvaluationRunId = evaluation.runId;
    }

    const findings = Array.isArray(evaluation.findings) ? evaluation.findings : [];
    for (const finding of findings) {
      if (!finding || typeof finding !== "object") continue;
      const code = typeof finding.code === "string" ? finding.code : undefined;
      if (!code) continue;
      const message = typeof finding.message === "string" ? finding.message : code;
      const severity = typeof finding.severity === "string" ? finding.severity : undefined;
      const severityRank = findingSeverityRank(severity);
      findingCounts[code] = (findingCounts[code] ?? 0) + 1;
      const existing = topFindingCounts.get(code);
      if (existing) {
        existing.count += 1;
        if (severityRank > existing.severityRank) {
          existing.severity = severity;
          existing.severityRank = severityRank;
        }
      } else {
        topFindingCounts.set(code, { code, count: 1, message, severity, severityRank });
      }
    }
  }

  const evaluatedObjectCount = params.evaluations.length;
  const objectCount = params.objectIds.length;

  return {
    sourceId: params.sourceId,
    customerScopeId: params.customerScopeId,
    customerScopeName: params.customerScopeName,
    objectType: "netbox_vm",
    objectCount,
    assignedObjectCount: params.unassigned ? 0 : objectCount,
    unassignedObjectCount: params.unassigned ? objectCount : 0,
    evaluatedObjectCount,
    unevaluatedObjectCount: Math.max(0, objectCount - evaluatedObjectCount),
    latestEvaluationRunId,
    latestEvaluatedAt,
    averageGovernanceScore: evaluatedObjectCount > 0 ? Math.round(governanceScoreTotal / evaluatedObjectCount) : null,
    readyCount,
    notReadyCount,
    blockAutomationRecommendationCount,
    findingCounts,
    topFindings: Array.from(topFindingCounts.values())
      .sort((a, b) => b.severityRank - a.severityRank || b.count - a.count || a.code.localeCompare(b.code))
      .slice(0, 5)
      .map(({ severityRank: _severityRank, ...finding }) => finding),
  };
}

type CustomerScopeGovernanceSummaryInput = {
  customerScopeId: string | null;
  customerScopeName: string;
  objectIds: string[];
  unassigned: boolean;
};

function buildCustomerScopeGovernanceSummaryInputs(
  scopes: CustomerScope[],
  assignments: CustomerScopeObjectAssignment[],
  cachedVms: Array<{ id: string }>,
): CustomerScopeGovernanceSummaryInput[] {
  const cachedVmIds = new Set(cachedVms.map((vm) => vm.id));
  const sourceAssignments = assignments.filter((assignment) => (
    assignment.objectType === "netbox_vm" &&
    cachedVmIds.has(assignment.objectId)
  ));
  const inputs: CustomerScopeGovernanceSummaryInput[] = scopes.map((scope) => {
    const currentAssignments = selectCurrentCustomerScopeAssignments(
      sourceAssignments.filter((assignment) => assignment.customerScopeId === scope.id),
    );
    return {
      customerScopeId: scope.id,
      customerScopeName: scope.displayName ?? scope.name,
      objectIds: Array.from(new Set(currentAssignments.map((assignment) => assignment.objectId))),
      unassigned: false,
    };
  });
  const unassignedAssignments = selectCurrentCustomerScopeAssignments(
    sourceAssignments.filter((assignment) => (
      assignment.customerScopeId === null &&
      assignment.relationship === "unassigned"
    )),
  );
  const unassignedObjectIds = Array.from(new Set(unassignedAssignments.map((assignment) => assignment.objectId)));
  if (unassignedObjectIds.length > 0) {
    inputs.push({
      customerScopeId: null,
      customerScopeName: "Unassigned",
      objectIds: unassignedObjectIds,
      unassigned: true,
    });
  }
  return inputs;
}

async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  // Extract token from Authorization header or HttpOnly cookie
  let token: string | undefined;
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    token = authHeader.substring(7);
  } else if (req.cookies?.auth_token) {
    token = req.cookies.auth_token;
  }

  if (!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  // Step 1: Verify the token — this is the only hard failure path.
  let decoded: { userId: string; role?: string; username?: string; orgId?: string };
  try {
    decoded = jwt.verify(token, JWT_SECRET) as any;
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }

  // Step 2: Set fallback identity from JWT claims immediately so that tests
  // using synthetic tokens work even if no DB is reachable.
  req.userId = decoded.userId;
  req.orgId = decoded.orgId ?? undefined;
  req.user = decoded.role
    ? ({
        id: decoded.userId,
        username: decoded.username ?? "",
        role: decoded.role,
        orgId: decoded.orgId ?? null,
      } as any)
    : undefined;

  // Step 3: Hydrate from DB. In production, a missing/unreachable DB user is unauthorized;
  // JWT-claim fallback is allowed only in DB-free tests.
  try {
    const dbUser = await storage.getUser(decoded.userId);
    if (!dbUser) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    req.user = dbUser;
    req.orgId = dbUser.orgId ?? undefined;
  } catch (error) {
    if (!shouldFallbackToJwtClaimsOnDbLookupError()) {
      console.error("[auth] DB user lookup failed:", JSON.stringify(sanitizeErrorForLog(error)));
      return res.status(401).json({ message: "Unauthorized" });
    }
  }

  if (!req.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  next();
}

/**
 * Org-context guard — ensures tenant-owned routes always have req.orgId set.
 *
 * - Non-platform_admin users without an orgId in their token receive 403 ORG_CONTEXT_REQUIRED.
 * - platform_admin users MUST supply an X-Org-Id header (or ?orgId= query param) to scope
 *   themselves to a tenant. Without it they receive 400 ORG_SELECTION_REQUIRED.
 * - If the selected org does not exist, they receive 404 ORGANIZATION_NOT_FOUND.
 *   This prevents silent req.orgId=undefined or a phantom orgId from leaking into DB queries.
 * - DB unavailability during the org check is treated as fail-open: the downstream route
 *   will encounter and surface the DB error instead of failing here with a misleading 404.
 */
async function requireOrgContext(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.user?.role === "platform_admin") {
    const selectedOrg =
      (req.headers["x-org-id"] as string | undefined) ??
      (req.query.orgId as string | undefined);
    if (!selectedOrg) {
      return res.status(400).json({
        code: "ORG_SELECTION_REQUIRED",
        message: "platform_admin must specify X-Org-Id header or ?orgId= query param for tenant routes",
      });
    }
    // Verify the selected org exists. Fail open on DB errors (DB unavailable in test suite)
    // so downstream routes can surface DB connectivity issues with appropriate context.
    try {
      const org = await storage.getOrganization(selectedOrg);
      if (!org) {
        return res.status(404).json({
          code: "ORGANIZATION_NOT_FOUND",
          message: `Organization '${selectedOrg}' not found`,
        });
      }
    } catch {
      // DB unavailable — continue and let the downstream route fail naturally.
    }
    req.orgId = selectedOrg;
    return next();
  }
  if (!req.orgId) {
    return res.status(403).json({
      message: "Organization context required — contact your platform administrator.",
      code: "ORG_CONTEXT_REQUIRED",
    });
  }
  next();
}

// Role middleware — see server/auth/roles.ts for the full hierarchy.

export async function registerRoutes(app: Express): Promise<Server> {
  // ─── Health endpoints (no auth required) ───────────────────────────────────
  app.get("/api/health", (_req, res) => {
    res.status(200).json({ ok: true, service: "rovelink", timestamp: new Date().toISOString() });
  });

  app.get("/api/health/db", async (_req, res) => {
    try {
      await db.execute(sql`select 1`);
      res.status(200).json({ ok: true, database: "ok", timestamp: new Date().toISOString() });
    } catch {
      res.status(503).json({ ok: false, database: "error", timestamp: new Date().toISOString() });
    }
  });

  // Mount RDP modular routes with auth + org-context middleware
  app.use("/api/pipelines", authMiddleware, requireOrgContext, pipelineRoutes);
  app.use("/api/pipelines", authMiddleware, requireOrgContext, pipelineMappingRoutes);
  app.use("/api/providers", authMiddleware, requireOrgContext, providerDiscoveryRoutes);
  app.use("/api/inventories", authMiddleware, requireOrgContext, automationInventoryRoutes);
  app.use("/api/gate", authMiddleware, requireOrgContext, gateRoutes);
  app.use("/api/templates", authMiddleware, requireOrgContext, templateRoutes);
  app.use("/api/runs", authMiddleware, requireOrgContext, runsRoutes);
  app.use("/api/notifications", authMiddleware, requireOrgContext, notificationRoutes);
  app.use("/api/settings", authMiddleware, settingsRoutes);
  app.use("/api/netbox", authMiddleware, requireOrgContext, netboxRoutes);
  app.use("/api/netbox-sources", authMiddleware, requireOrgContext, netboxRoutes);
  app.use("/api/governance", authMiddleware, requireOrgContext, governanceRoutes);
  app.use("/api/organizations", authMiddleware, orgRoutes);
  app.use("/api/admin/organizations", authMiddleware, orgRoutes);
  app.use("/api/org", authMiddleware, requireOrgContext, orgRoutes);

  // Org-context guard for inline tenant-owned route prefixes.
  // authMiddleware runs here first so req.orgId is set before the guard.
  // Inline route handlers below also call authMiddleware (idempotent).
  for (const prefix of [
    "/api/inventory", "/api/reports", "/api/projects",
    "/api/credentials", "/api/providers", "/api/cmdbs", "/api/cmdb", "/api/drift-runs", "/api/stats",
  ] as const) {
    app.use(prefix, authMiddleware, requireOrgContext);
  }

  // ─── Auth routes ────────────────────────────────────────────────────────────

  function setAuthCookie(res: Response, token: string) {
    res.cookie("auth_token", token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: "strict",
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    });
  }

  app.post("/api/auth/signup", loginRateLimiter, async (req, res) => {
    // Open signup is disabled in production. Users must be created by a platform_admin
    // via POST /api/users, which assigns orgId and role explicitly.
    if (isProduction) {
      return res.status(403).json({
        message: "Open signup is disabled. Contact your platform administrator to create an account.",
        code: "SIGNUP_DISABLED",
      });
    }
    try {
      const { username, password } = insertUserSchema.parse(req.body);
      
      const existing = await storage.getUserByUsername(username);
      if (existing) {
        return res.status(400).json({ message: "Username already exists" });
      }

      const hashedPassword = await bcrypt.hash(password, 12);
      const user = await storage.createUser({
        username,
        password: hashedPassword,
        role: "viewer",
      });

      const token = jwt.sign({ userId: user.id, username: user.username, role: user.role, orgId: user.orgId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
      setAuthCookie(res, token);
      res.json(buildAuthUserResponse(user));
    } catch (error: any) {
      res.status(400).json({ message: error.message || "Signup failed" });
    }
  });

  app.post("/api/auth/login", loginRateLimiter, async (req, res) => {
    try {
      // AUTH_DISABLE: dev-only bypass. Hard-fails in production.
      if (process.env.AUTH_DISABLE === "true") {
        if (isProduction) {
          console.error("SECURITY ALERT: AUTH_DISABLE=true detected in production — request rejected.");
          return res.status(403).json({ message: "AUTH_DISABLE is not permitted in production." });
        }
        // Development-only stub login
        const stubUser = { id: "stub-admin-id", username: "admin", role: "admin", orgId: null as null };
        const token = jwt.sign({ userId: stubUser.id, username: stubUser.username, role: stubUser.role, orgId: stubUser.orgId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
        setAuthCookie(res, token);
        return res.json(buildAuthUserResponse(stubUser));
      }

      const { username, password } = insertUserSchema.parse(req.body);
      
      const user = await storage.getUserByUsername(username);
      if (!user) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      const validPassword = await bcrypt.compare(password, user.password);
      if (!validPassword) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      const token = jwt.sign({ userId: user.id, username: user.username, role: user.role, orgId: user.orgId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
      setAuthCookie(res, token);
      res.json(buildAuthUserResponse(user));
    } catch (error: any) {
      res.status(400).json({ message: error.message || "Login failed" });
    }
  });

  app.post("/api/auth/logout", (_req, res) => {
    res.clearCookie("auth_token", { httpOnly: true, sameSite: "strict" });
    res.json({ message: "Logged out" });
  });

  app.get("/api/auth/me", authMiddleware, async (req: AuthRequest, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    res.json({ id: req.user.id, username: req.user.username, role: req.user.role, orgId: req.user.orgId ?? null });
  });

  // platform_admin-only: create a user with explicit orgId and role assignment.
  // This is the production path for onboarding users (open signup is blocked in production).
  app.post("/api/users", authMiddleware, requireRole("platform_admin"), async (req: AuthRequest, res) => {
    try {
      const { username, password, role, orgId } = req.body;
      if (!username || !password) {
        return res.status(400).json({ message: "username and password are required" });
      }
      const allowedRoles = ["viewer", "operator", "admin", "platform_admin"];
      const effectiveRole = role ?? "viewer";
      if (!allowedRoles.includes(effectiveRole)) {
        return res.status(400).json({ message: `role must be one of: ${allowedRoles.join(", ")}` });
      }
      // Tenant roles require an orgId — platform_admin operates globally without one.
      if (effectiveRole !== "platform_admin" && !orgId) {
        return res.status(400).json({ message: "orgId is required for viewer, operator, and admin users" });
      }
      // Verify the org actually exists — prevent orphaned users referencing a phantom org.
      if (effectiveRole !== "platform_admin" && orgId) {
        const org = await storage.getOrganization(orgId);
        if (!org) {
          return res.status(404).json({ message: `Organization '${orgId}' not found` });
        }
      }
      const existing = await storage.getUserByUsername(username);
      if (existing) {
        return res.status(400).json({ message: "Username already exists" });
      }
      const hashedPassword = await bcrypt.hash(password, 12);
      const user = await storage.createUser({
        username,
        password: hashedPassword,
        role: effectiveRole,
        orgId: orgId ?? null,
      });
      res.status(201).json({
        id: user.id,
        username: user.username,
        role: user.role,
        orgId: user.orgId,
      });
    } catch (error: any) {
      // All explicit validation paths return 400 above; reaching here means an unexpected
      // server-side error (DB connection, bcrypt failure, etc.) which is 500.
      sendInternalError(res, error, "users.create", "Failed to create user");
    }
  });

  // Inventory routes (NetBox integration)
  // DEMO-ONLY: returns hardcoded mock groups — not org-scoped.
  // Production use: derive groups from org-scoped automation inventory or NetBox VM data.
  app.get("/api/inventory/groups", authMiddleware, async (req, res) => {
    try {
      const groups = await netboxService.getGroups();
      res.json({
        _demo: true,
        _note: "Demo data only — not org-scoped. Use automation inventory endpoints in production.",
        groups,
      });
    } catch (error: any) {
      sendInternalError(res, error, "inventory.groups", "Failed to fetch groups");
    }
  });

  // DEMO-ONLY: returns hardcoded mock hosts — not org-scoped.
  // Production use: replace with automation inventory or org-scoped NetBox VM data.
  app.get("/api/inventory/hosts", authMiddleware, async (req, res) => {
    try {
      const group = req.query.group as string | undefined;
      const hosts = await netboxService.getHosts(group);
      res.json({
        _demo: true,
        _note: "Demo data only — not org-scoped. Use automation inventory endpoints in production.",
        hosts,
      });
    } catch (error: any) {
      sendInternalError(res, error, "inventory.hosts", "Failed to fetch hosts");
    }
  });

  // DEMO-ONLY: preflight evaluated against mock hosts — not org-scoped.
  app.post("/api/inventory/preflight", authMiddleware, async (req, res) => {
    try {
      const { limitExpr } = req.body;
      const result = await netboxService.preflightCheck(limitExpr);
      res.json({
        ...result,
        _demo: true,
        _note: "Demo data only — limit expression evaluated against mock hosts, not real org inventory.",
      });
    } catch (error: any) {
      sendInternalError(res, error, "inventory.preflight", "Preflight check failed");
    }
  });

  app.get("/api/inventory/suggest", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const query = req.query.q as string || "";
      const suggestions = await netboxService.getSuggestions(query, storage, req.orgId!);
      res.json(suggestions);
    } catch (error: any) {
      sendInternalError(res, error, "inventory.suggest", "Failed to get suggestions");
    }
  });

  // Projects routes
  app.get("/api/projects", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const projects = await storage.getProjects(req.orgId!);
      res.json(projects);
    } catch (error: any) {
      sendInternalError(res, error, "projects.list", "Failed to fetch projects");
    }
  });

  app.post("/api/projects", authMiddleware, requireRole("admin"), async (req: AuthRequest, res) => {
    try {
      const { orgId: _o, id: _i, checkoutPath: _c, ...safeBody } = req.body;
      const data = insertProjectSchema.parse({ ...safeBody, orgId: req.orgId! });
      const project = await storage.createProject(data);
      res.json(project);
    } catch (error: any) {
      res.status(400).json({ message: error.message || "Failed to create project" });
    }
  });

  app.post("/api/projects/:id/sync", authMiddleware, requireRole("operator", "admin"), async (req: AuthRequest, res) => {
    try {
      const project = await storage.getProject(req.params.id, req.orgId!);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      if (project.syncStatus === "syncing") {
        return res.status(409).json({ message: "Project sync is already running" });
      }

      await storage.updateProject(req.params.id, { syncStatus: "syncing", syncError: null }, req.orgId!);

      try {
        const result = await syncGitProject(project);
        const updated = await storage.updateProject(req.params.id, {
          syncStatus: "success",
          syncError: null,
          lastSyncAt: new Date(),
          checkoutPath: result.checkoutPath,
          playbooks: result.playbooks,
        }, req.orgId!);
        res.json({ message: "Project synced successfully", project: updated });
      } catch (syncError: any) {
        const message = sanitizeGitSyncError(syncError);
        await storage.updateProject(req.params.id, {
          syncStatus: "error",
          syncError: message,
        }, req.orgId!);
        sendClientError(res, 400, message);
      }
    } catch (error: any) {
      sendInternalError(res, error, "projects.sync", "Sync failed");
    }
  });

  app.patch("/api/projects/:id", authMiddleware, requireRole("admin"), async (req: AuthRequest, res) => {
    try {
      const { orgId: _o, id: _i, checkoutPath: _c, ...safeBody } = req.body;
      const data = insertProjectSchema.partial().parse(safeBody);
      const project = await storage.updateProject(req.params.id, data, req.orgId!);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      res.json(project);
    } catch (error: any) {
      res.status(400).json({ message: error.message || "Failed to update project" });
    }
  });

  app.delete("/api/projects/:id", authMiddleware, requireRole("admin"), async (req: AuthRequest, res) => {
    try {
      await storage.deleteProject(req.params.id, req.orgId!);
      res.json({ message: "Project deleted successfully" });
    } catch (error: any) {
      sendInternalError(res, error, "projects.delete", "Failed to delete project");
    }
  });

  // Credentials routes
  app.get("/api/credentials", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const credentials = await storage.getCredentials(req.orgId!);
      res.json(credentials.map(sanitizeCredentialForResponse));
    } catch (error: any) {
      sendInternalError(res, error, "credentials.list", "Failed to fetch credentials");
    }
  });

  app.post("/api/credentials", authMiddleware, requireRole("admin"), async (req: AuthRequest, res) => {
    try {
      const { orgId: _o, id: _i, ...safeBody } = req.body;
      const data = buildCredentialCreate(req.orgId!, safeBody);
      const credential = await storage.createCredential(data as any);
      res.json(sanitizeCredentialForResponse(credential));
    } catch (error: any) {
      res.status(400).json({ message: error.message || "Failed to create credential" });
    }
  });

  app.get("/api/credentials/:id", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const credential = await storage.getCredential(req.params.id, req.orgId!);
      if (!credential) {
        return res.status(404).json({ message: "Credential not found" });
      }
      res.json(sanitizeCredentialForResponse(credential));
    } catch (error: any) {
      sendInternalError(res, error, "credentials.get", "Failed to fetch credential");
    }
  });

  app.patch("/api/credentials/:id", authMiddleware, requireRole("admin"), async (req: AuthRequest, res) => {
    try {
      const existing = await storage.getCredential(req.params.id, req.orgId!);
      if (!existing) {
        return res.status(404).json({ message: "Credential not found" });
      }
      const data = buildCredentialUpdate(existing, req.body);
      const credential = await storage.updateCredential(req.params.id, data, req.orgId!);
      if (!credential) {
        return res.status(404).json({ message: "Credential not found" });
      }
      res.json(sanitizeCredentialForResponse(credential));
    } catch (error: any) {
      res.status(400).json({ message: error.message || "Failed to update credential" });
    }
  });

  app.delete("/api/credentials/:id", authMiddleware, requireRole("admin"), async (req: AuthRequest, res) => {
    try {
      await storage.deleteCredential(req.params.id, req.orgId!);
      res.json({ message: "Credential deleted successfully" });
    } catch (error: any) {
      sendInternalError(res, error, "credentials.delete", "Failed to delete credential");
    }
  });

  // Reports routes
  // Org-scoped inventory health — computed from real NetBox VMs imported for this org.
  app.get("/api/reports/inventory-health", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const vms = await storage.getNetboxVms(req.orgId!);
      const total = vms.length;
      const withIP = vms.filter(v => !!v.ip).length;
      const withUser = vms.filter(v => !!(v.customFields as Record<string, any>)?.ansible_user).length;
      const coverage = total > 0 ? Math.round((Math.min(withIP, withUser) / total) * 100) : 0;

      res.json({ total, withIP, withUser, coverage });
    } catch (error: any) {
      sendInternalError(res, error, "reports.inventory-health", "Failed to fetch inventory health");
    }
  });

  app.post("/api/drift-runs", authMiddleware, requireRole("admin", "operator"), async (req: AuthRequest, res) => {
    try {
      const objectType = req.body?.objectType ?? "vm";
      if (objectType !== "vm") {
        return sendClientError(res, 400, "Drift comparison only supports objectType 'vm'");
      }
      if (typeof req.body?.cmdbSourceId !== "string" || !req.body.cmdbSourceId.trim()) {
        return sendClientError(res, 400, "cmdbSourceId is required");
      }
      if (typeof req.body?.providerSourceId !== "string" || !req.body.providerSourceId.trim()) {
        return sendClientError(res, 400, "providerSourceId is required");
      }

      const result = await runVmDriftComparison({
        orgId: req.orgId!,
        cmdbSourceId: req.body.cmdbSourceId.trim(),
        providerSourceId: req.body.providerSourceId.trim(),
        objectType,
      });
      res.status(201).json(result);
    } catch (error: any) {
      if (isDriftSourceValidationError(error)) {
        return sendClientError(res, 404, "Drift comparison source not found");
      }
      sendInternalError(res, error, "drift-runs.create", "Failed to run drift comparison");
    }
  });

  app.get("/api/drift-runs", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const filters = parseDriftRunFilters(req.query);
      const runs = await storage.listDriftComparisonRuns(req.orgId!, filters);
      res.json({ runs, total: runs.length });
    } catch (error: any) {
      if (error instanceof DriftQueryValidationError) {
        return sendClientError(res, 400, error.message);
      }
      sendInternalError(res, error, "drift-runs.list", "Failed to fetch drift runs");
    }
  });

  app.get("/api/drift-runs/:id", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const run = await storage.getDriftComparisonRun(req.params.id, req.orgId!);
      if (!run) return sendClientError(res, 404, "Drift comparison run not found");
      res.json(run);
    } catch (error: any) {
      sendInternalError(res, error, "drift-runs.get", "Failed to fetch drift run");
    }
  });

  app.get("/api/drift-runs/:id/items", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const run = await storage.getDriftComparisonRun(req.params.id, req.orgId!);
      if (!run) return sendClientError(res, 404, "Drift comparison run not found");

      const filters = parseDriftItemFilters(req.query);
      const items = await storage.listDriftComparisonItems(run.id, req.orgId!, filters);
      res.json({ runId: run.id, items, total: items.length });
    } catch (error: any) {
      if (error instanceof DriftQueryValidationError) {
        return sendClientError(res, 400, error.message);
      }
      sendInternalError(res, error, "drift-runs.items", "Failed to fetch drift run items");
    }
  });

  app.get("/api/providers", authMiddleware, async (req, res) => {
    try {
      const providers = await storage.getProviders((req as AuthRequest).orgId!);
      res.json(providers.map(sanitizeProviderForResponse));
    } catch (error: any) {
      sendInternalError(res, error, "providers.list", "Failed to get providers");
    }
  });

  app.get("/api/providers/:id", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const provider = await storage.getProvider(req.params.id, req.orgId!);
      if (!provider) {
        return res.status(404).json({ message: "Provider not found" });
      }
      res.json(sanitizeProviderForResponse(provider));
    } catch (error: any) {
      sendInternalError(res, error, "providers.get", "Failed to get provider");
    }
  });

  // Get VMs discovered by a provider
  app.get("/api/providers/:id/vms", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const provider = await storage.getProvider(req.params.id, req.orgId!);
      if (!provider) {
        return res.status(404).json({ message: "Provider not found" });
      }

      const { getProviderCollector } = await import("./services/providers/registry");
      const decryptedConfig = decryptProviderConfig(provider.config as Record<string, any>);
      const collector = getProviderCollector(provider.kind, decryptedConfig);
      const vms = await collector.listVms();
      
      res.json({ 
        provider: { id: provider.id, name: provider.name, kind: provider.kind },
        vms 
      });
    } catch (error: any) {
      sendInternalError(res, error, "providers.vms", "Failed to get provider VMs");
    }
  });

  app.post("/api/providers", authMiddleware, requireRole("admin"), async (req: AuthRequest, res) => {
    try {
      const { orgId: _o, id: _i, ...safeBody } = req.body;
      const body = { ...safeBody, orgId: req.orgId! };
      if (body.config && typeof body.config === "object") {
        body.config = encryptProviderConfig(body.config);
      }
      const provider = await storage.createProvider(body);
      res.json(sanitizeProviderForResponse(provider));
    } catch (error: any) {
      sendInternalError(res, error, "providers.create", "Failed to create provider");
    }
  });

  app.patch("/api/providers/:id", authMiddleware, requireRole("admin"), async (req: AuthRequest, res) => {
    try {
      const body = { ...req.body };
      if (body.config && typeof body.config === "object") {
        // Merge with existing encrypted config so blank secret fields don't wipe stored secrets
        const existing = await storage.getProvider(req.params.id, req.orgId!);
        if (existing) {
          const existingConfig = existing.config as Record<string, any>;
          const incoming = body.config as Record<string, any>;
          const merged: Record<string, any> = { ...existingConfig };
          for (const [k, v] of Object.entries(incoming)) {
            if (v !== "" && v !== null && v !== undefined) {
              merged[k] = v;
            }
          }
          body.config = encryptProviderConfig(merged);
        } else {
          body.config = encryptProviderConfig(body.config);
        }
      }
      const provider = await storage.updateProvider(req.params.id, body, req.orgId!);
      if (!provider) {
        return res.status(404).json({ message: "Provider not found" });
      }
      res.json(sanitizeProviderForResponse(provider));
    } catch (error: any) {
      sendInternalError(res, error, "providers.update", "Failed to update provider");
    }
  });

  app.post("/api/providers/:id/test", authMiddleware, requireRole("admin", "operator"), async (req: AuthRequest, res) => {
    try {
      const provider = await storage.getProvider(req.params.id, req.orgId!);
      if (!provider) {
        return res.status(404).json({ message: "Provider not found" });
      }

      const { getProviderCollector } = await import("./services/providers/registry");
      const decryptedConfig = decryptProviderConfig(provider.config as Record<string, any>);
      const collector = getProviderCollector(provider.kind, decryptedConfig);
      const result = await collector.testConnection();
      
      res.json(result);
    } catch (error: any) {
      sendInternalError(res, error, "providers.test", "Failed to test connection");
    }
  });

  app.post("/api/providers/:id/sync", authMiddleware, requireRole("admin", "operator"), async (req: AuthRequest, res) => {
    try {
      const provider = await storage.getProvider(req.params.id, req.orgId!);
      if (!provider) {
        return res.status(404).json({ message: "Provider not found" });
      }

      // Start provider sync
      const runId = await runProviderSyncWithWorker(provider.id);

      res.json({ runId });
    } catch (error: any) {
      sendInternalError(res, error, "providers.sync", "Failed to start sync");
    }
  });

  app.get("/api/providers/:id/inventory/object-types", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const provider = await storage.getProvider(req.params.id, req.orgId!);
      if (!provider) {
        return res.status(404).json({ message: "Provider not found" });
      }

      const objectTypes = await storage.listInfrastructureObjectTypes(req.orgId!, provider.id);
      res.json({
        sourceId: provider.id,
        providerType: provider.kind,
        objectTypes: objectTypes.map((type) => ({
          objectType: type.objectType,
          label: infrastructureObjectTypeLabel(type.objectType),
          count: type.count,
          lastSyncedAt: type.lastSyncedAt ?? null,
        })),
      });
    } catch (error: any) {
      sendInternalError(res, error, "providers.inventory.object-types", "Failed to get provider inventory object types");
    }
  });

  app.get("/api/providers/:id/inventory/objects", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const provider = await storage.getProvider(req.params.id, req.orgId!);
      if (!provider) {
        return res.status(404).json({ message: "Provider not found" });
      }

      const objectType = typeof req.query.objectType === "string" && req.query.objectType.trim()
        ? req.query.objectType.trim()
        : undefined;
      const objects = await storage.listInfrastructureObjectsWithCandidateCounts(
        req.orgId!,
        provider.id,
        objectType ? { objectType } : {},
      );

      res.json({
        sourceId: provider.id,
        providerType: provider.kind,
        objectType: objectType ?? null,
        objects: objects.map(serializeInfrastructureObjectForList),
      });
    } catch (error: any) {
      sendInternalError(res, error, "providers.inventory.objects", "Failed to get provider inventory objects");
    }
  });

  app.get("/api/providers/:id/inventory/objects/:objectId/customer-scope-candidates", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const provider = await storage.getProvider(req.params.id, req.orgId!);
      if (!provider) {
        return res.status(404).json({ message: "Provider not found" });
      }

      const object = await storage.getInfrastructureObject(req.params.objectId, req.orgId!);
      if (!object || object.sourceId !== provider.id) {
        return res.status(404).json({ message: "Infrastructure object not found" });
      }

      const candidates = await storage.listProviderCustomerScopeCandidatesForObject(req.orgId!, provider.id, object.id);
      res.json({
        sourceId: provider.id,
        objectId: object.id,
        candidates: candidates.map(serializeProviderCustomerScopeCandidate),
      });
    } catch (error: any) {
      sendInternalError(res, error, "providers.inventory.object-candidates", "Failed to get provider customer scope candidates");
    }
  });

  app.get("/api/providers/:id/inventory/objects/:objectId", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const provider = await storage.getProvider(req.params.id, req.orgId!);
      if (!provider) {
        return res.status(404).json({ message: "Provider not found" });
      }

      const object = await storage.getInfrastructureObjectWithCandidates(req.orgId!, provider.id, req.params.objectId);
      if (!object) {
        return res.status(404).json({ message: "Infrastructure object not found" });
      }

      res.json(serializeInfrastructureObjectDetail(object));
    } catch (error: any) {
      sendInternalError(res, error, "providers.inventory.object-detail", "Failed to get provider inventory object");
    }
  });

  app.post("/api/providers/:id/inventory/sync", authMiddleware, requireRole("admin", "operator"), async (req: AuthRequest, res) => {
    try {
      const provider = await storage.getProvider(req.params.id, req.orgId!);
      if (!provider) {
        return res.status(404).json({ message: "Provider not found" });
      }

      const decryptedConfig = decryptProviderConfig(provider.config as Record<string, any>);
      const result = await syncProviderInfrastructureInventory(provider, req.orgId!, decryptedConfig);
      res.json(result);
    } catch (error: any) {
      if (error instanceof ProviderInfrastructureSyncNotSupportedError) {
        return res.status(501).json({
          message: error.message,
          ...error.result,
        });
      }
      if (error instanceof ProviderInfrastructureSyncConfigError) {
        return res.status(400).json({
          message: error.message,
          ...error.result,
        });
      }
      if (error instanceof ProviderInfrastructureSyncDiscoveryError) {
        return res.status(502).json({
          message: error.message,
          ...error.result,
        });
      }
      sendInternalError(res, error, "providers.inventory.sync", "Failed to sync provider infrastructure inventory");
    }
  });

  app.delete("/api/providers/:id", authMiddleware, requireRole("admin"), async (req: AuthRequest, res) => {
    try {
      const existing = await storage.getProvider(req.params.id, req.orgId!);
      if (!existing) {
        return res.status(404).json({ message: "Provider not found" });
      }
      await storage.deleteProvider(req.params.id, req.orgId!);
      res.json({ message: "Provider deleted successfully" });
    } catch (error: any) {
      sendInternalError(res, error, "providers.delete", "Failed to delete provider");
    }
  });

  app.get("/api/providers/:id/runs", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      // Verify the provider belongs to the requesting org before returning runs
      const provider = await storage.getProvider(req.params.id, req.orgId!);
      if (!provider) {
        return res.status(404).json({ message: "Provider not found" });
      }
      const runs = await storage.getProviderRuns(req.params.id, limit, req.orgId!);
      res.json(runs);
    } catch (error: any) {
      sendInternalError(res, error, "providers.runs", "Failed to get provider runs");
    }
  });

  // ─── CMDB routes ─────────────────────────────────────────────────────────────
  app.get("/api/cmdbs", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const cmdbs = await storage.getCmdbAccounts(req.orgId!);
      res.json(cmdbs.map(sanitizeCmdbForResponse));
    } catch (error: any) {
      sendInternalError(res, error, "cmdbs.list", "Failed to get CMDBs");
    }
  });

  app.post("/api/cmdbs", authMiddleware, requireRole("admin"), async (req: AuthRequest, res) => {
    try {
      const { orgId: _o, id: _i, ...safeReqBody } = req.body;
      const data = insertCmdbAccountSchema.parse({ ...safeReqBody, orgId: req.orgId! });
      const body = { ...data };
      if (body.config && typeof body.config === "object") {
        body.config = encryptCmdbConfig(body.config as Record<string, any>);
      }
      const cmdb = await storage.createCmdbAccount(body);
      res.json(sanitizeCmdbForResponse(cmdb));
    } catch (error: any) {
      sendInternalError(res, error, "cmdbs.create", "Failed to create CMDB account");
    }
  });

  app.get("/api/cmdbs/:id", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const cmdb = await storage.getCmdbAccount(req.params.id, req.orgId!);
      if (!cmdb) {
        return res.status(404).json({ message: "CMDB account not found" });
      }
      res.json(sanitizeCmdbForResponse(cmdb));
    } catch (error: any) {
      sendInternalError(res, error, "cmdbs.get", "Failed to fetch CMDB account");
    }
  });

  app.get("/api/cmdbs/:id/customer-scope-summary", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const cmdb = await storage.getCmdbAccount(req.params.id, req.orgId!);
      if (!cmdb) {
        return res.status(404).json({ message: "CMDB account not found" });
      }

      const [scopes, assignments] = await Promise.all([
        storage.listCustomerScopes(req.orgId!, "netbox_inventory_source", cmdb.id),
        storage.listCustomerScopeObjectAssignments(req.orgId!, "netbox_inventory_source", cmdb.id),
      ]);
      const summary = summarizeCustomerScopeAssignments(assignments);

      res.json({
        customerScopeCount: scopes.length,
        ...summary,
      });
    } catch (error: any) {
      sendInternalError(res, error, "cmdbs.customer-scope-summary", "Failed to fetch CMDB customer scope summary");
    }
  });

  app.get("/api/cmdbs/:id/customer-scopes", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const cmdb = await storage.getCmdbAccount(req.params.id, req.orgId!);
      if (!cmdb) {
        return res.status(404).json({ message: "CMDB account not found" });
      }

      const [scopes, assignments] = await Promise.all([
        storage.listCustomerScopes(req.orgId!, "netbox_inventory_source", cmdb.id),
        storage.listCustomerScopeObjectAssignments(req.orgId!, "netbox_inventory_source", cmdb.id),
      ]);
      const assignmentsByScopeId = new Map<string, CustomerScopeObjectAssignment[]>();
      for (const assignment of assignments) {
        if (!assignment.customerScopeId) continue;
        const current = assignmentsByScopeId.get(assignment.customerScopeId) ?? [];
        current.push(assignment);
        assignmentsByScopeId.set(assignment.customerScopeId, current);
      }

      res.json(scopes.map((scope) => {
        const scopeAssignments = assignmentsByScopeId.get(scope.id) ?? [];
        return {
          ...sanitizeCustomerScope(scope),
          assignmentCount: scopeAssignments.length,
          relationshipCounts: summarizeCustomerScopeAssignments(scopeAssignments).relationshipCounts,
        };
      }));
    } catch (error: any) {
      sendInternalError(res, error, "cmdbs.customer-scopes.list", "Failed to fetch CMDB customer scopes");
    }
  });

  app.get("/api/cmdbs/:id/customer-scope-governance-summaries", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const cmdb = await storage.getCmdbAccount(req.params.id, req.orgId!);
      if (!cmdb) {
        return res.status(404).json({ message: "CMDB account not found" });
      }
      if (cmdb.kind !== "netbox") {
        return sendClientError(res, 400, "CustomerScope governance summaries are only supported for NetBox CMDBs");
      }

      const sourceType = "netbox_inventory_source";
      const sourceId = cmdb.id;
      const [scopes, assignments, cachedVms] = await Promise.all([
        storage.listCustomerScopes(req.orgId!, sourceType, sourceId),
        storage.listCustomerScopeObjectAssignments(req.orgId!, sourceType, sourceId),
        getCachedNetboxVmsForCmdb(sourceId, req.orgId!),
      ]);
      const summaryInputs = buildCustomerScopeGovernanceSummaryInputs(scopes, assignments, cachedVms);
      const objectIds = Array.from(new Set(summaryInputs.flatMap((input) => input.objectIds)));
      const latestEvaluations = await storage.listLatestGovernanceEvaluationsForSourceObjects(
        req.orgId!,
        sourceId,
        "netbox_vm",
        objectIds,
      );
      const evaluationsByObjectId = new Map<string, GovernanceObjectEvaluation>();
      for (const { evaluation } of latestEvaluations) {
        if (evaluation.objectId) evaluationsByObjectId.set(evaluation.objectId, evaluation);
      }

      res.json({
        sourceId,
        objectType: "netbox_vm",
        summaries: summaryInputs.map((input) => summarizeCustomerScopeGovernance({
          sourceId,
          customerScopeId: input.customerScopeId,
          customerScopeName: input.customerScopeName,
          objectIds: input.objectIds,
          evaluations: input.objectIds
            .map((objectId) => evaluationsByObjectId.get(objectId))
            .filter((evaluation): evaluation is GovernanceObjectEvaluation => Boolean(evaluation)),
          unassigned: input.unassigned,
        })),
      });
    } catch (error: any) {
      sendInternalError(res, error, "cmdbs.customer-scope-governance-summaries", "Failed to fetch CustomerScope governance summaries");
    }
  });

  app.get("/api/cmdbs/:id/customer-scopes/:scopeId/governance-summary", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const cmdb = await storage.getCmdbAccount(req.params.id, req.orgId!);
      if (!cmdb) {
        return res.status(404).json({ message: "CMDB account not found" });
      }
      if (cmdb.kind !== "netbox") {
        return sendClientError(res, 400, "CustomerScope governance summaries are only supported for NetBox CMDBs");
      }

      const sourceType = "netbox_inventory_source";
      const sourceId = cmdb.id;
      const scopeId = req.params.scopeId;
      const isUnassigned = scopeId === "unassigned";
      let scope: CustomerScope | undefined;

      if (!isUnassigned) {
        scope = await storage.getCustomerScope(scopeId, req.orgId!);
        if (!scope || scope.sourceType !== sourceType || scope.sourceId !== sourceId) {
          return res.status(404).json({ message: "Customer scope not found" });
        }
      }

      const [cachedVms, sourceAssignments] = await Promise.all([
        getCachedNetboxVmsForCmdb(sourceId, req.orgId!),
        storage.listCustomerScopeObjectAssignments(req.orgId!, sourceType, sourceId),
      ]);
      const cachedVmIds = new Set(cachedVms.map((vm) => vm.id));
      const matchingAssignments = sourceAssignments.filter((assignment) => (
        assignment.objectType === "netbox_vm" &&
        cachedVmIds.has(assignment.objectId) &&
        (isUnassigned
          ? assignment.customerScopeId === null && assignment.relationship === "unassigned"
          : assignment.customerScopeId === scopeId)
      ));
      const currentAssignments = selectCurrentCustomerScopeAssignments(matchingAssignments);
      const objectIds = Array.from(new Set(currentAssignments.map((assignment) => assignment.objectId)));
      const latestEvaluations = await storage.listLatestGovernanceEvaluationsForSourceObjects(
        req.orgId!,
        sourceId,
        "netbox_vm",
        objectIds,
      );

      res.json(summarizeCustomerScopeGovernance({
        sourceId,
        customerScopeId: isUnassigned ? null : scopeId,
        customerScopeName: isUnassigned ? "Unassigned" : scope?.displayName ?? scope?.name ?? scopeId,
        objectIds,
        evaluations: latestEvaluations.map((entry) => entry.evaluation),
        unassigned: isUnassigned,
      }));
    } catch (error: any) {
      sendInternalError(res, error, "cmdbs.customer-scopes.governance-summary", "Failed to fetch CustomerScope governance summary");
    }
  });

  app.get("/api/cmdbs/:id/customer-scopes/:scopeId", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const cmdb = await storage.getCmdbAccount(req.params.id, req.orgId!);
      if (!cmdb) {
        return res.status(404).json({ message: "CMDB account not found" });
      }

      const scope = await storage.getCustomerScope(req.params.scopeId, req.orgId!);
      if (!scope || scope.sourceType !== "netbox_inventory_source" || scope.sourceId !== cmdb.id) {
        return res.status(404).json({ message: "Customer scope not found" });
      }

      const assignments = await storage.listAssignmentsForCustomerScope(req.orgId!, scope.id);
      res.json({
        scope: sanitizeCustomerScope(scope),
        assignments: assignments
          .filter((assignment) => (
            assignment.sourceType === "netbox_inventory_source" &&
            assignment.sourceId === cmdb.id
          ))
          .map((assignment) => ({
            id: assignment.id,
            objectId: assignment.objectId,
            objectType: assignment.objectType,
            relationship: assignment.relationship,
            derivedFrom: assignment.derivedFrom,
            confidence: assignment.confidence,
            metadata: sanitizeCmdbObjectPayload(assignment.metadata),
            lastSyncedAt: assignment.lastSyncedAt,
          })),
      });
    } catch (error: any) {
      sendInternalError(res, error, "cmdbs.customer-scopes.get", "Failed to fetch CMDB customer scope");
    }
  });

  app.patch("/api/cmdbs/:id", authMiddleware, requireRole("admin"), async (req: AuthRequest, res) => {
    try {
      const body = { ...req.body };
      if (body.config && typeof body.config === "object") {
        // Preserve existing encrypted secrets when blank fields submitted
        const existing = await storage.getCmdbAccount(req.params.id, req.orgId!);
        if (existing) {
          const existingConfig = (existing.config as Record<string, any>) || {};
          const incoming = body.config as Record<string, any>;
          const merged: Record<string, any> = { ...existingConfig };
          for (const [k, v] of Object.entries(incoming)) {
            if (v !== "" && v !== null && v !== undefined) {
              merged[k] = v;
            }
          }
          body.config = encryptCmdbConfig(merged);
        } else {
          body.config = encryptCmdbConfig(body.config);
        }
      }
      const cmdb = await storage.updateCmdbAccount(req.params.id, body, req.orgId!);
      if (!cmdb) {
        return res.status(404).json({ message: "CMDB account not found" });
      }
      res.json(sanitizeCmdbForResponse(cmdb));
    } catch (error: any) {
      sendInternalError(res, error, "cmdbs.update", "Failed to update CMDB account");
    }
  });

  app.delete("/api/cmdbs/:id", authMiddleware, requireRole("admin"), async (req: AuthRequest, res) => {
    try {
      const existing = await storage.getCmdbAccount(req.params.id, req.orgId!);
      if (!existing) {
        return res.status(404).json({ message: "CMDB account not found" });
      }
      await storage.deleteCmdbAccount(req.params.id, req.orgId!);
      res.json({ message: "CMDB account deleted successfully" });
    } catch (error: any) {
      sendInternalError(res, error, "cmdbs.delete", "Failed to delete CMDB account");
    }
  });

  app.post("/api/cmdbs/:id/test", authMiddleware, requireRole("admin", "operator"), async (req: AuthRequest, res) => {
    try {
      const cmdb = await storage.getCmdbAccount(req.params.id, req.orgId!);
      if (!cmdb) {
        return res.status(404).json({ message: "CMDB account not found" });
      }

      if (cmdb.kind === "netbox") {
        const decryptedConfig = decryptCmdbConfig(cmdb.config as Record<string, any>);
        const adapter = new NetBoxAdapter(decryptedConfig as any);
        const result = await adapter.test();
        
        if (result.ok) {
          await storage.updateCmdbAccount(req.params.id, { lastValidatedAt: new Date() }, req.orgId!);
        }
        
        res.json(result);
      } else {
        res.status(400).json({ error: "Unsupported CMDB kind" });
      }
    } catch (error: any) {
      sendInternalError(res, error, "cmdbs.test", "Failed to test connection");
    }
  });

  app.get(["/api/cmdbs/:id/object-types", "/api/cmdb/:id/object-types"], authMiddleware, async (req: AuthRequest, res) => {
    try {
      const cmdb = await storage.getCmdbAccount(req.params.id, req.orgId!);
      if (!cmdb) {
        return res.status(404).json({ message: "CMDB account not found" });
      }
      if (cmdb.kind !== "netbox") {
        return res.json({ objectTypes: [] });
      }

      const cachedVms = await getCachedNetboxVmsForCmdb(cmdb.id, req.orgId!);
      const cachedVmCount = cachedVms.length;
      res.json({
        source: sanitizeCmdbForResponse(cmdb),
        objectTypes: [
          {
            ...CMDB_OBJECT_TYPES.netbox_vm,
            count: cachedVmCount > 0 ? cachedVmCount : null,
            status: cachedVmCount > 0 ? "cached" : "live",
            mode: cachedVmCount > 0 ? "cached" : "live",
          },
        ],
      });
    } catch (error: any) {
      sendInternalError(res, error, "cmdbs.object-types", "Failed to fetch CMDB object types");
    }
  });

  app.get(["/api/cmdbs/:id/objects/:objectType", "/api/cmdb/:id/objects/:objectType"], authMiddleware, async (req: AuthRequest, res) => {
    try {
      const objectType = req.params.objectType;
      if (!isSupportedCmdbObjectType(objectType)) {
        return sendClientError(res, 400, `Unsupported CMDB object type: ${objectType}`);
      }

      const cmdb = await storage.getCmdbAccount(req.params.id, req.orgId!);
      if (!cmdb) {
        return res.status(404).json({ message: "CMDB account not found" });
      }
      if (cmdb.kind !== "netbox") {
        return sendClientError(res, 400, "Object browsing is only supported for NetBox CMDBs");
      }

      const cachedVms = await getCachedNetboxVmsForCmdb(cmdb.id, req.orgId!);
      if (cachedVms.length > 0) {
        return res.json(buildCmdbObjectResponse(cmdb, objectType, cachedVms, "cached"));
      }

      const decryptedConfig = decryptCmdbConfig(cmdb.config as Record<string, any>);
      const adapter = new NetBoxAdapter(decryptedConfig as any);
      const vms = await adapter.listAllVms();
      res.json(buildCmdbObjectResponse(cmdb, objectType, vms, "live"));
    } catch (error: any) {
      sendInternalError(res, error, "cmdbs.objects.list", "Failed to fetch CMDB objects");
    }
  });

  app.get(["/api/cmdbs/:id/objects/:objectType/:objectId/customer-assignments", "/api/cmdb/:id/objects/:objectType/:objectId/customer-assignments"], authMiddleware, async (req: AuthRequest, res) => {
    try {
      const objectType = req.params.objectType;
      if (!isSupportedCmdbObjectType(objectType)) {
        return sendClientError(res, 400, `Unsupported CMDB object type: ${objectType}`);
      }

      const cmdb = await storage.getCmdbAccount(req.params.id, req.orgId!);
      if (!cmdb) {
        return res.status(404).json({ message: "CMDB account not found" });
      }
      if (cmdb.kind !== "netbox") {
        return sendClientError(res, 400, "Customer assignments are only supported for NetBox CMDB objects");
      }

      const cachedVms = await getCachedNetboxVmsForCmdb(cmdb.id, req.orgId!);
      const cachedVm = cachedVms.find((vm: any) => String(vm.id) === String(req.params.objectId));
      if (!cachedVm) {
        return res.status(404).json({ message: "CMDB object not found" });
      }

      const [assignments, scopes] = await Promise.all([
        storage.listAssignmentsForObject(
          req.orgId!,
          "netbox_inventory_source",
          cmdb.id,
          objectType,
          cachedVm.id,
        ),
        storage.listCustomerScopes(req.orgId!, "netbox_inventory_source", cmdb.id),
      ]);
      const scopesById = new Map(scopes.map((scope) => [scope.id, scope]));

      res.json({
        objectType,
        objectId: cachedVm.id,
        assignments: assignments.map((assignment) => serializeCustomerScopeAssignment(assignment, scopesById)),
      });
    } catch (error: any) {
      sendInternalError(res, error, "cmdbs.objects.customer-assignments", "Failed to fetch CMDB object customer assignments");
    }
  });

  app.get(["/api/cmdbs/:id/objects/:objectType/:objectId", "/api/cmdb/:id/objects/:objectType/:objectId"], authMiddleware, async (req: AuthRequest, res) => {
    try {
      const objectType = req.params.objectType;
      if (!isSupportedCmdbObjectType(objectType)) {
        return sendClientError(res, 400, `Unsupported CMDB object type: ${objectType}`);
      }

      const cmdb = await storage.getCmdbAccount(req.params.id, req.orgId!);
      if (!cmdb) {
        return res.status(404).json({ message: "CMDB account not found" });
      }
      if (cmdb.kind !== "netbox") {
        return sendClientError(res, 400, "Object browsing is only supported for NetBox CMDBs");
      }

      const cachedVms = await getCachedNetboxVmsForCmdb(cmdb.id, req.orgId!);
      const mode: CmdbObjectMode = cachedVms.length > 0 ? "cached" : "live";
      const vms = cachedVms.length > 0
        ? cachedVms
        : await (async () => {
          const decryptedConfig = decryptCmdbConfig(cmdb.config as Record<string, any>);
          const adapter = new NetBoxAdapter(decryptedConfig as any);
          return adapter.listAllVms();
        })();
      const vm = vms.find((candidate: any) => (
        String(candidate.id) === String(req.params.objectId) ||
        String(candidate.netboxId) === String(req.params.objectId)
      ));
      if (!vm) {
        return res.status(404).json({ message: "CMDB object not found" });
      }

      res.json({
        source: {
          id: cmdb.id,
          name: cmdb.name,
          kind: cmdb.kind,
        },
        objectType,
        objectTypeName: CMDB_OBJECT_TYPES[objectType].name,
        mode,
        object: {
          ...getNetboxVmDisplayFields(vm),
          raw: sanitizeCmdbObjectPayload(vm),
        },
      });
    } catch (error: any) {
      sendInternalError(res, error, "cmdbs.objects.get", "Failed to fetch CMDB object");
    }
  });

  app.get("/api/cmdbs/:id/vms", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const cmdb = await storage.getCmdbAccount(req.params.id, req.orgId!);
      if (!cmdb) {
        return res.status(404).json({ message: "CMDB account not found" });
      }
      if (cmdb.kind !== "netbox") {
        return res.status(400).json({ message: "VM listing is only supported for NetBox CMDBs" });
      }
      const decryptedConfig = decryptCmdbConfig(cmdb.config as Record<string, any>);
      const adapter = new NetBoxAdapter(decryptedConfig as any);
      const vms = await adapter.listAllVms();
      res.json({ vms: buildCmdbObjectResponse(cmdb, "netbox_vm", vms, "live").objects, total: vms.length, mode: "live" });
    } catch (error: any) {
      sendInternalError(res, error, "cmdbs.vms", "Failed to fetch VMs");
    }
  });

  // Housekeeping routes
  // platform_admin only — this rebuilds the GLOBAL group cache from ALL orgs' VMs.
  // A normal org admin must not trigger a global cache rebuild that affects other tenants.
  app.post("/api/housekeeping/rebuild-groups-cache", authMiddleware, requireRole("platform_admin"), async (req, res) => {
    try {
      const { netboxService } = await import("./services/netbox");
      const groups = await netboxService.listAllGroups(storage);
      
      await storage.clearGroupCache();
      for (const group of groups) {
        await storage.addGroupCache(group);
      }
      
      res.json({ message: `Rebuilt cache with ${groups.length} groups` });
    } catch (error: any) {
      sendInternalError(res, error, "cmdbs.rebuild-cache", "Failed to rebuild cache");
    }
  });

  // platform_admin only — writes custom fields to the shared NetBox instance
  // configured via the global NETBOX_URL / NETBOX_TOKEN env vars. This is a
  // platform-wide schema change that affects all tenants sharing the NetBox.
  app.post("/api/housekeeping/ensure-netbox-schema", authMiddleware, requireRole("platform_admin"), async (req, res) => {
    try {
      const netboxUrl = process.env.NETBOX_URL || '';
      const netboxToken = process.env.NETBOX_TOKEN || '';

      if (!netboxUrl || !netboxToken) {
        return res.status(400).json({ message: "NetBox URL or Token not configured" });
      }

      const adapter = new NetBoxAdapter({ url: netboxUrl, token: netboxToken });
      await adapter.ensureCustomFields();
      
      res.json({
        message: "Ensured NetBox custom fields (ext_id, ext_provider, patch_wave, patch_subwave, ansible_user)",
      });
    } catch (error: any) {
      sendInternalError(res, error, "cmdbs.ensure-schema", "Failed to ensure schema");
    }
  });

  // platform_admin only — deletes externalObjects rows globally across all orgs.
  app.post("/api/housekeeping/prune-stale", authMiddleware, requireRole("platform_admin"), async (req, res) => {
    try {
      const days = parseInt(req.body.days as string) || 30;
      const count = await storage.pruneStaleObjects(days);
      
      res.json({ message: `Pruned ${count} stale objects (not seen in ${days} days)` });
    } catch (error: any) {
      sendInternalError(res, error, "cmdbs.prune-stale", "Failed to prune stale objects");
    }
  });

  // admin — org-scoped: only retries failed syncs for providers belonging to req.orgId.
  app.post("/api/housekeeping/retry-last-failed", authMiddleware, requireRole("admin"), async (req: AuthRequest, res) => {
    try {
      const failedRuns = await storage.getLastFailedSyncRuns(req.orgId!);
      const retried: string[] = [];
      
      const { SyncWorker } = await import("./services/syncWorker");
      
      for (const run of failedRuns) {
        const newRun = await storage.createSyncRun({
          providerAccountId: run.providerAccountId,
          type: "provider-sync",
          status: "queued",
        });
        
        const worker = new SyncWorker();
        worker.executeSyncRun(newRun.id).catch(console.error);
        retried.push(newRun.id);
      }
      
      res.json({ message: `Retried ${retried.length} failed syncs`, runs: retried });
    } catch (error: any) {
      sendInternalError(res, error, "sync.retry", "Failed to retry syncs");
    }
  });

  // Token rotation — not yet implemented.
  app.post("/api/housekeeping/rotate-tokens", authMiddleware, requireRole("admin"), async (req, res) => {
    res.status(501).json({
      message: "Token rotation is not yet implemented.",
      planned: "Per-org credential rotation for admin; platform-token rotation for platform_admin.",
    });
  });

  // Stats routes
  app.get("/api/stats/providers", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const stats = await storage.getProviderStats(req.orgId!);
      res.json(stats);
    } catch (error: any) {
      sendInternalError(res, error, "stats.providers", "Failed to get provider stats");
    }
  });

  // Create HTTP server
  const httpServer = createServer(app);

  // WebSocket server for live logs (from javascript_websocket blueprint)
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  // Store WebSocket clients per run ID
  (global as any).wsClients = new Map();

  wss.on('connection', (ws, req) => {
    const url = req.url || "";
    const match = url.match(/\/ws\/runs\/([^/]+)/);
    
    if (match) {
      const runId = match[1];
      
      if (!(global as any).wsClients.has(runId)) {
        (global as any).wsClients.set(runId, new Set());
      }
      (global as any).wsClients.get(runId).add(ws);

      ws.on('close', () => {
        const clients = (global as any).wsClients.get(runId);
        if (clients) {
          clients.delete(ws);
          if (clients.size === 0) {
            (global as any).wsClients.delete(runId);
          }
        }
      });

      // Send initial connection message
      if (ws.readyState === WebSocket.OPEN) {
        ws.send("Connected to run stream\n");
      }
    }
  });

  return httpServer;
}

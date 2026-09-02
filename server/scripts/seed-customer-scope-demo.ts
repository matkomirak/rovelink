import { and, desc, eq, sql } from "drizzle-orm";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { db } from "../db";
import {
  cmdbAccounts,
  customerScopeObjectAssignments,
  customerScopes,
  governanceBlueprints,
  governanceBlueprintVersions,
  governanceEvaluationRuns,
  governanceObjectEvaluations,
  netboxInventorySources,
  netboxVms,
  organizations,
  type CustomerScope,
  type GovernanceFinding,
  type GovernanceObjectEvaluation,
  type NetboxVm,
} from "../../shared/schema";
import type { GovernanceBlueprintRules, GovernanceEvaluationResult, RecommendedGovernanceAction } from "../../shared/governance";

const SOURCE_TYPE = "netbox_inventory_source";
const OBJECT_TYPE = "netbox_vm";
const DEMO_MARKER = "customer-scope-demo";
const REQUIRED_DEMO_VM_COUNT = 5;

export const CUSTOMER_SCOPE_DEMO_SEED_FLAG = "ROVELINK_DEMO_DATA";

export type CustomerScopeDemoScenarioKey = "healthy" | "notReady" | "blocked" | "unassigned" | "unevaluated";

export type CustomerScopeDemoVmSelection = Record<CustomerScopeDemoScenarioKey, NetboxVm>;

export const CUSTOMER_SCOPE_DEMO_SCOPES = [
  { key: "healthy", externalId: "demo-acme-gmbh", name: "ACME GmbH" },
  { key: "notReady", externalId: "demo-customer-b", name: "Customer B" },
  { key: "blocked", externalId: "demo-customer-c", name: "Customer C" },
  { key: "unevaluated", externalId: "demo-customer-d", name: "Customer D" },
] as const;

function requireExplicitDemoOptIn(env: NodeJS.ProcessEnv = process.env): void {
  if (env[CUSTOMER_SCOPE_DEMO_SEED_FLAG] !== "true") {
    throw new Error(`${CUSTOMER_SCOPE_DEMO_SEED_FLAG}=true is required. This seed is demo-only and never runs automatically.`);
  }
}

function demoId(kind: string, sourceId: string, suffix: string): string {
  return `${DEMO_MARKER}:${kind}:${sourceId}:${suffix}`;
}

function byName(a: NetboxVm, b: NetboxVm): number {
  return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

export function selectCustomerScopeDemoVms(
  cachedVms: NetboxVm[],
  latestEvaluations: GovernanceObjectEvaluation[],
): CustomerScopeDemoVmSelection | null {
  if (cachedVms.length < REQUIRED_DEMO_VM_COUNT) return null;

  const sorted = [...cachedVms].sort(byName);
  const evaluatedObjectIds = new Set(latestEvaluations.map((evaluation) => evaluation.objectId).filter(Boolean));
  const unevaluated = sorted.find((vm) => !evaluatedObjectIds.has(vm.id));
  if (!unevaluated) return null;

  const selected = sorted.filter((vm) => vm.id !== unevaluated.id).slice(0, REQUIRED_DEMO_VM_COUNT - 1);
  if (selected.length < REQUIRED_DEMO_VM_COUNT - 1) return null;

  return {
    healthy: selected[0],
    notReady: selected[1],
    blocked: selected[2],
    unassigned: selected[3],
    unevaluated,
  };
}

function safeJson(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function makeFinding(
  code: string,
  message: string,
  severity: "info" | "warning" | "blocker",
  recommendedActions: RecommendedGovernanceAction[],
): GovernanceFinding {
  return {
    layer: severity === "blocker" ? "automation_readiness" : "data_management",
    severity,
    code,
    message,
    recommendedActions,
  };
}

function makeEvaluationResult(
  vm: NetboxVm,
  score: number,
  automationReady: boolean,
  findings: GovernanceFinding[],
  recommendedActions: RecommendedGovernanceAction[],
): GovernanceEvaluationResult {
  return {
    objectType: OBJECT_TYPE,
    objectId: vm.id,
    objectName: vm.name,
    scores: {
      governance: score,
      dataManagement: score,
      ownership: score,
      relevanceWeightedPriority: Math.max(0, Math.min(100, 100 - score)),
    },
    automationReadiness: {
      ready: automationReady,
      reasons: automationReady ? [] : ["CustomerScope demo validation scenario marks this object not ready."],
    },
    findings,
    recommendedActions,
  };
}

async function findDemoOrg() {
  const requestedOrgId = process.env.ROVELINK_DEMO_ORG_ID;
  if (requestedOrgId) {
    const [org] = await db.select().from(organizations).where(eq(organizations.id, requestedOrgId));
    if (!org) throw new Error(`ROVELINK_DEMO_ORG_ID '${requestedOrgId}' was not found.`);
    return org;
  }

  const [org] = await db.select().from(organizations).where(eq(organizations.slug, "default"));
  if (!org) throw new Error("Default organization was not found. Run npm run db:seed first.");
  return org;
}

async function findDemoCmdb(orgId: string) {
  const requestedCmdbId = process.env.ROVELINK_DEMO_CMDB_ID;
  if (requestedCmdbId) {
    const [cmdb] = await db.select().from(cmdbAccounts).where(and(
      eq(cmdbAccounts.id, requestedCmdbId),
      eq(cmdbAccounts.orgId, orgId),
    ));
    if (!cmdb) throw new Error(`ROVELINK_DEMO_CMDB_ID '${requestedCmdbId}' was not found in org '${orgId}'.`);
    if (cmdb.kind !== "netbox") throw new Error(`ROVELINK_DEMO_CMDB_ID '${requestedCmdbId}' is not a NetBox CMDB.`);
    return cmdb;
  }

  const rows = await db.select().from(cmdbAccounts).where(and(
    eq(cmdbAccounts.orgId, orgId),
    eq(cmdbAccounts.kind, "netbox"),
  )).orderBy(desc(cmdbAccounts.updatedAt), desc(cmdbAccounts.createdAt));
  const local = rows.find((cmdb) => /local|docker|demo/i.test(cmdb.name));
  const cmdb = local ?? rows[0];
  if (!cmdb) {
    throw new Error("No NetBox CMDB source found. Set ROVELINK_DEMO_CMDB_ID or create a local NetBox CMDB first.");
  }
  return cmdb;
}

async function listCachedVmsForSource(sourceId: string): Promise<NetboxVm[]> {
  return await db.select().from(netboxVms).where(eq(netboxVms.sourceId, sourceId)).orderBy(netboxVms.name);
}

async function createMissingDemoCachedVms(sourceId: string, existingCount: number): Promise<void> {
  const [source] = await db.select().from(netboxInventorySources).where(eq(netboxInventorySources.id, sourceId));
  if (!source) {
    throw new Error(
      `Found only ${existingCount} cached VMs and cannot create local demo VMs because NetBox inventory source '${sourceId}' does not exist.`,
    );
  }

  for (let index = 1; index <= REQUIRED_DEMO_VM_COUNT; index += 1) {
    const netboxId = 990_000 + index;
    const name = `${DEMO_MARKER}-vm-${String(index).padStart(3, "0")}`;
    const values = {
      sourceId,
      netboxId,
      name,
      ip: null,
      operatingSystem: "Linux",
      customFields: {
        demo: true,
        demoPurpose: "CustomerScope governance summary smoke validation",
      },
      tags: [DEMO_MARKER],
      lastImportedAt: new Date(),
    };
    const [existing] = await db.select().from(netboxVms).where(and(
      eq(netboxVms.sourceId, sourceId),
      eq(netboxVms.netboxId, netboxId),
    ));

    if (existing) {
      await db.update(netboxVms).set({
        name,
        operatingSystem: "Linux",
        customFields: {
          demo: true,
          demoPurpose: "CustomerScope governance summary smoke validation",
        },
        tags: [DEMO_MARKER],
        lastImportedAt: new Date(),
      }).where(eq(netboxVms.id, existing.id));
    } else {
      await db.insert(netboxVms).values(values);
    }
  }
}

async function ensureDemoBlueprint(orgId: string, sourceId: string) {
  const blueprintId = demoId("blueprint", sourceId, "customer-scope-summary");
  const versionId = demoId("blueprint-version", sourceId, "v1");
  const rules: GovernanceBlueprintRules = {
    objectType: OBJECT_TYPE,
    dataManagement: [],
    ownership: [],
    relevance: { support: 1, audit: 1, billing: 1, reporting: 1, compliance: 1 },
    reporting: {
      minimumGovernanceScoreForAutomation: 70,
      highPriorityRelevanceScore: 10,
    },
    customerScope: {
      mode: "visibility_only",
      requireCustomerScopeAssignment: true,
      allowUnassigned: false,
      allowInternal: true,
      allowShared: true,
      requireAuthoritativeConfidence: false,
      requireProviderDerivedAssignment: false,
      treatMissingScopeReferenceAsBlocker: false,
      maxAllowedCustomerScopeCount: null,
      staleAssignmentMaxAgeDays: null,
      scoreWeight: 0,
    },
  };

  await db.insert(governanceBlueprints).values({
    id: blueprintId,
    orgId,
    name: "CustomerScope Demo Governance",
    description: "Demo-only blueprint for CustomerScope governance summary smoke validation.",
    objectType: OBJECT_TYPE,
    sourceType: SOURCE_TYPE,
    sourceId,
    status: "draft",
    activeVersionId: null,
    createdBy: null,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: governanceBlueprints.id,
    set: {
      description: "Demo-only blueprint for CustomerScope governance summary smoke validation.",
      sourceType: SOURCE_TYPE,
      sourceId,
      updatedAt: new Date(),
    },
  });

  await db.insert(governanceBlueprintVersions).values({
    id: versionId,
    orgId,
    blueprintId,
    version: 1,
    rules,
    createdBy: null,
  }).onConflictDoUpdate({
    target: governanceBlueprintVersions.id,
    set: { rules },
  });

  return { blueprintId, versionId };
}

async function upsertDemoScope(orgId: string, sourceId: string, externalId: string, name: string): Promise<CustomerScope> {
  const [scope] = await db.insert(customerScopes).values({
    orgId,
    sourceType: SOURCE_TYPE,
    sourceId,
    externalId,
    name,
    displayName: name,
    strategy: "tenant",
    isolation: "assignment",
    parentExternalId: null,
    metadata: {
      demo: true,
      provider: "netbox",
      demoPurpose: "CustomerScope governance summary smoke validation",
    },
    lastSyncedAt: new Date(),
  }).onConflictDoUpdate({
    target: [
      customerScopes.orgId,
      customerScopes.sourceType,
      customerScopes.sourceId,
      customerScopes.externalId,
    ],
    set: {
      name,
      displayName: name,
      strategy: "tenant",
      isolation: "assignment",
      metadata: {
        demo: true,
        provider: "netbox",
        demoPurpose: "CustomerScope governance summary smoke validation",
      },
      lastSyncedAt: new Date(),
      updatedAt: new Date(),
    },
  }).returning();
  return scope;
}

async function upsertDemoAssignment(
  orgId: string,
  sourceId: string,
  objectId: string,
  customerScopeId: string | null,
  relationship: "dedicated" | "unassigned",
) {
  const existingCondition = customerScopeId
    ? eq(customerScopeObjectAssignments.customerScopeId, customerScopeId)
    : sql`${customerScopeObjectAssignments.customerScopeId} is null`;

  const [existing] = await db.select().from(customerScopeObjectAssignments).where(and(
    eq(customerScopeObjectAssignments.orgId, orgId),
    eq(customerScopeObjectAssignments.sourceType, SOURCE_TYPE),
    eq(customerScopeObjectAssignments.sourceId, sourceId),
    eq(customerScopeObjectAssignments.objectType, OBJECT_TYPE),
    eq(customerScopeObjectAssignments.objectId, objectId),
    existingCondition,
    eq(customerScopeObjectAssignments.relationship, relationship),
  ));

  const values = {
    orgId,
    sourceType: SOURCE_TYPE,
    sourceId,
    objectType: OBJECT_TYPE,
    objectId,
    customerScopeId,
    relationship,
    derivedFrom: "manual" as const,
    confidence: "manual" as const,
    metadata: {
      demo: true,
      demoPurpose: "CustomerScope governance summary smoke validation",
    },
    lastSyncedAt: new Date(),
  };

  if (existing) {
    await db.update(customerScopeObjectAssignments)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(customerScopeObjectAssignments.id, existing.id));
    return;
  }

  await db.insert(customerScopeObjectAssignments).values(values);
}

async function upsertDemoRun(orgId: string, sourceId: string, blueprintId: string, versionId: string) {
  const runId = demoId("evaluation-run", sourceId, "customer-scope-summary");
  await db.insert(governanceEvaluationRuns).values({
    id: runId,
    orgId,
    blueprintId,
    blueprintVersionId: versionId,
    cmdbAccountId: sourceId,
    netboxSourceId: sourceId,
    status: "ok",
    counts: {
      demo: true,
      evaluatedObjects: 3,
      skippedObjects: 2,
      purpose: "CustomerScope governance summary smoke validation",
    },
    error: null,
    startedAt: new Date(),
    completedAt: new Date(),
  }).onConflictDoUpdate({
    target: governanceEvaluationRuns.id,
    set: {
      status: "ok",
      counts: {
        demo: true,
        evaluatedObjects: 3,
        skippedObjects: 2,
        purpose: "CustomerScope governance summary smoke validation",
      },
      error: null,
      startedAt: new Date(),
      completedAt: new Date(),
    },
  });
  return runId;
}

async function upsertDemoEvaluation(
  orgId: string,
  runId: string,
  blueprintId: string,
  versionId: string,
  vm: NetboxVm,
  score: number,
  automationReady: boolean,
  findings: GovernanceFinding[],
  recommendedActions: RecommendedGovernanceAction[],
) {
  const evaluationId = demoId("object-evaluation", vm.sourceId ?? "source", vm.id);
  const result = makeEvaluationResult(vm, score, automationReady, findings, recommendedActions);

  await db.insert(governanceObjectEvaluations).values({
    id: evaluationId,
    orgId,
    runId,
    blueprintId,
    blueprintVersionId: versionId,
    objectType: OBJECT_TYPE,
    objectId: vm.id,
    externalId: String(vm.netboxId),
    objectName: vm.name,
    governanceScore: score,
    dataManagementScore: score,
    ownershipScore: score,
    relevanceWeightedPriority: result.scores.relevanceWeightedPriority,
    automationReady,
    findings,
    recommendedActions,
    result,
    objectSnapshot: {
      id: vm.id,
      netboxId: vm.netboxId,
      name: vm.name,
      demo: true,
    },
    evaluatedAt: new Date(),
  }).onConflictDoUpdate({
    target: governanceObjectEvaluations.id,
    set: {
      runId,
      governanceScore: score,
      dataManagementScore: score,
      ownershipScore: score,
      relevanceWeightedPriority: result.scores.relevanceWeightedPriority,
      automationReady,
      findings,
      recommendedActions,
      result,
      objectSnapshot: {
        id: vm.id,
        netboxId: vm.netboxId,
        name: vm.name,
        demo: true,
      },
      evaluatedAt: new Date(),
    },
  });
}

async function main() {
  requireExplicitDemoOptIn();

  const org = await findDemoOrg();
  const cmdb = await findDemoCmdb(org.id);
  let cachedVms = await listCachedVmsForSource(cmdb.id);
  if (cachedVms.length < REQUIRED_DEMO_VM_COUNT) {
    await createMissingDemoCachedVms(cmdb.id, cachedVms.length);
    cachedVms = await listCachedVmsForSource(cmdb.id);
  }

  const latestEvaluations = await db
    .select()
    .from(governanceObjectEvaluations)
    .where(and(
      eq(governanceObjectEvaluations.orgId, org.id),
      eq(governanceObjectEvaluations.objectType, OBJECT_TYPE),
    ))
    .orderBy(desc(governanceObjectEvaluations.evaluatedAt));

  let selected = selectCustomerScopeDemoVms(cachedVms, latestEvaluations);
  if (!selected) {
    await createMissingDemoCachedVms(cmdb.id, cachedVms.length);
    cachedVms = await listCachedVmsForSource(cmdb.id);
    selected = selectCustomerScopeDemoVms(
      cachedVms,
      latestEvaluations.filter((evaluation) => !String(evaluation.id).startsWith(`${DEMO_MARKER}:`)),
    );
  }
  if (!selected) {
    throw new Error("Could not select five cached VMs with one unevaluated VM for the demo scenario.");
  }

  const { blueprintId, versionId } = await ensureDemoBlueprint(org.id, cmdb.id);
  const scopes = new Map<string, CustomerScope>();
  for (const definition of CUSTOMER_SCOPE_DEMO_SCOPES) {
    scopes.set(definition.key, await upsertDemoScope(org.id, cmdb.id, definition.externalId, definition.name));
  }

  await upsertDemoAssignment(org.id, cmdb.id, selected.healthy.id, scopes.get("healthy")!.id, "dedicated");
  await upsertDemoAssignment(org.id, cmdb.id, selected.notReady.id, scopes.get("notReady")!.id, "dedicated");
  await upsertDemoAssignment(org.id, cmdb.id, selected.blocked.id, scopes.get("blocked")!.id, "dedicated");
  await upsertDemoAssignment(org.id, cmdb.id, selected.unassigned.id, null, "unassigned");
  await upsertDemoAssignment(org.id, cmdb.id, selected.unevaluated.id, scopes.get("unevaluated")!.id, "dedicated");

  const runId = await upsertDemoRun(org.id, cmdb.id, blueprintId, versionId);
  await upsertDemoEvaluation(org.id, runId, blueprintId, versionId, selected.healthy, 96, true, [], ["report"]);
  await upsertDemoEvaluation(
    org.id,
    runId,
    blueprintId,
    versionId,
    selected.notReady,
    78,
    false,
    [makeFinding("demo_customer_scope_not_ready", "Demo finding: Customer B has a governance issue for smoke validation.", "warning", ["validate", "report"])],
    ["validate", "report"],
  );
  await upsertDemoEvaluation(
    org.id,
    runId,
    blueprintId,
    versionId,
    selected.blocked,
    88,
    false,
    [makeFinding("demo_customer_scope_block_recommendation", "Demo finding: Customer C has a block automation recommendation for smoke validation.", "blocker", ["block_automation", "validate"])],
    ["block_automation", "validate"],
  );

  console.log("CustomerScope demo data seeded.");
  console.log(`Organization: ${org.name} (${org.id})`);
  console.log(`CMDB source: ${cmdb.name} (${cmdb.id})`);
  console.log(`Healthy: ACME GmbH -> ${selected.healthy.name} (${selected.healthy.id})`);
  console.log(`Not ready: Customer B -> ${selected.notReady.name} (${selected.notReady.id})`);
  console.log(`Block recommendation: Customer C -> ${selected.blocked.name} (${selected.blocked.id})`);
  console.log(`Unassigned: ${selected.unassigned.name} (${selected.unassigned.id})`);
  console.log(`Unevaluated: Customer D -> ${selected.unevaluated.name} (${selected.unevaluated.id})`);
  console.log(`Open: http://localhost:5000/cmdbs/${cmdb.id}`);
  console.log(JSON.stringify({
    sourceId: cmdb.id,
    customerScopesUpserted: scopes.size,
    assignmentsUpserted: 5,
    evaluationsUpserted: 3,
  }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`CustomerScope demo seed failed: ${message}`);
    process.exitCode = 1;
  });
}

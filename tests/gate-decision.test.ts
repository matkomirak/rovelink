import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import supertest from "supertest";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import { createGateDecisionRouter } from "../server/routes/gate-decision";
import { evaluatePreflight, type PreflightDependencies } from "../server/services/preflight-gate";
import { gateDecisionRequestSchema, type GateDecisionRequest } from "../shared/gate-decision";
import { preflightActionPolicySchema } from "../shared/preflight-policy";
import { eligibilityPolicySchema, mergeEligibilityPolicyPatch } from "../shared/schema";
import { STANDARD_NETBOX_VM_GOVERNANCE_BLUEPRINT, evaluateGovernanceObject } from "../server/services/governance-blueprint-evaluator";
import { loadCustomerScopeContextByObjectId, normalizeCachedNetboxVm } from "../server/services/governance-object-context";
import { registerRoutes } from "../server/routes";
import { storage } from "../server/storage";
import { encryptSecret } from "../server/services/secrets";
import { hasUsableSshCredential, isPreflightLocalRunnerEnabled } from "../server/services/preflight-local-prerequisites";

const request: GateDecisionRequest = { target: { sourceType: "cmdb", sourceId: "source-a", objectType: "netbox_vm", objectId: "vm-a" }, automation: { templateId: "template-a", adapter: "local" } };
const principal = { id: "user-a", orgId: "a", role: "operator" };
const playbook = "- hosts: all\n  gather_facts: false\n  tasks: []\n";
const playbookSha256 = createHash("sha256").update(playbook).digest("hex");
const fixtureRoot = mkdtempSync(path.join(tmpdir(), "rovelink-preflight-fixture-"));
writeFileSync(path.join(fixtureRoot, "site.yml"), playbook);
const previousKey = process.env.ENCRYPTION_KEY;
process.env.ENCRYPTION_KEY = randomBytes(32).toString("hex");
const encryptedFixtureKey = encryptSecret(generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString());
after(() => {
  if (previousKey === undefined) delete process.env.ENCRYPTION_KEY; else process.env.ENCRYPTION_KEY = previousKey;
  assert.ok(path.resolve(fixtureRoot).startsWith(path.resolve(tmpdir()) + path.sep + "rovelink-preflight-fixture-"));
  rmSync(fixtureRoot, { recursive: true, force: true });
});
const SECRET = "synthetic-credential-marker";
async function fixture(role = "operator") {
  const time = Date.now();
  const older = new Date(time - 60000), evaluated = new Date(time - 30000), refreshed = new Date(time - 10000);
  const action = { templateId: "template-a", blueprintId: "blueprint-a", playbookSha256, allowedRoles: ["operator"], allowedCustomerScopeIds: ["scope-a"], minimumGovernanceScore: 70,
    maxGovernanceAgeSeconds: 3600, maxSourceAgeSeconds: 3600, maxInventoryAgeSeconds: 1800, maxAssignmentAgeSeconds: 3600, decisionTtlSeconds: 60 };
  const state: any = {
    user: { id: "user-a", orgId: "a", role },
    source: { id: "source-a", orgId: "a", kind: "netbox", enabled: true, config: { token: SECRET } },
    template: { id: "template-a", orgId: "a", inventoryId: "inventory-a", projectId: "project-a", playbook: "site.yml", runnerMode: "local", credentialId: "credential-a", limitExpr: null, extraVars: {}, checkMode: false, diffMode: false },
    inventory: { id: "inventory-a", orgId: "a", type: "linked", sourceType: "netbox", sourceRef: "source-a", lastRefreshedAt: refreshed, updatedAt: refreshed,
      eligibilityPolicy: { preflightActions: [action] }, cachedData: { hosts: [{ name: "demo", ansible_host: "192.0.2.1", governanceObjectType: "netbox_vm", governanceObjectId: "vm-a", sourceNetboxId: 1, vars: { status: "active", password: SECRET } }] } },
    vm: { id: "vm-a", sourceId: "source-a", netboxId: 1, name: "demo", ip: "192.0.2.1", operatingSystem: "Linux", tags: [], lastImportedAt: older,
      customFields: { _netboxStatus: "active", _netboxRole: "web", automatable: true, provider_state: "active", technical_owner: "team", service_owner: "team" } },
    blueprint: { id: "blueprint-a", orgId: "a", status: "active", objectType: "netbox_vm", sourceType: "netbox_inventory_source", sourceId: "source-a", activeVersionId: "version-a", updatedAt: older },
    version: { id: "version-a", orgId: "a", blueprintId: "blueprint-a", createdAt: older, rules: structuredClone(STANDARD_NETBOX_VM_GOVERNANCE_BLUEPRINT.rules) },
    assignments: [{ id: "assignment-a", orgId: "a", sourceType: "netbox_inventory_source", sourceId: "source-a", objectId: "vm-a", objectType: "netbox_vm", customerScopeId: "scope-a", relationship: "dedicated", derivedFrom: "provider", confidence: "authoritative", lastSyncedAt: older, updatedAt: older }],
    scope: { id: "scope-a", orgId: "a", sourceType: "netbox_inventory_source", sourceId: "source-a", externalId: "1", name: "Demo", displayName: "Demo", strategy: "tenant", isolation: "assignment", lastSyncedAt: older, updatedAt: older },
    project: { id: "project-a", orgId: "a", syncStatus: "success", checkoutPath: fixtureRoot, playbooks: ["site.yml"], lastSyncAt: older },
    credential: { id: "credential-a", orgId: "a", kind: "ssh_key", metadata: { username: "demo", strictHostKeyChecking: true }, secretConfig: { privateKey: encryptedFixtureKey }, updatedAt: older },
  };
  const context = await loadCustomerScopeContextByObjectId({ listCustomerScopeObjectAssignments: async () => state.assignments, listCustomerScopes: async () => [state.scope] }, "a", "source-a");
  const result = evaluateGovernanceObject(normalizeCachedNetboxVm(state.vm, context.get("vm-a")), state.version.rules);
  assert.equal(result.automationReadiness.ready, true);
  state.rows = [{ evaluation: { id: "evaluation-a", orgId: "a", objectId: "vm-a", objectType: "netbox_vm", externalId: "1", runId: "run-a", blueprintId: "blueprint-a", blueprintVersionId: "version-a", automationReady: result.automationReadiness.ready, governanceScore: result.scores.governance,
      findings: result.findings, recommendedActions: result.recommendedActions, evaluatedAt: evaluated, objectSnapshot: structuredClone(state.vm), result },
    run: { id: "run-a", orgId: "a", status: "ok", netboxSourceId: "source-a", cmdbAccountId: null, blueprintId: "blueprint-a", blueprintVersionId: "version-a", completedAt: evaluated } }];
  const calls: string[] = [];
  const copy = (value: any) => structuredClone(value);
  const read = (name: string, value: () => any) => async (...args: any[]) => { calls.push(name + ":" + args.join(":")); return copy(value()); };
  const deps: PreflightDependencies = {
    now: () => time,
    getUser: read("user", () => state.user), getJobTemplate: async (id, orgId) => { calls.push("template:" + orgId); return copy(state.templates?.[id] ?? (id === state.template?.id ? state.template : undefined)); },
    getInventory: read("inventory", () => state.inventory), getCmdbAccount: read("source", () => state.source), getNetboxVms: read("vms", () => state.vm ? [state.vm, ...(state.extraVms ?? [])] : []),
    getGovernanceBlueprint: read("blueprint", () => state.blueprint), getGovernanceBlueprintVersion: read("version", () => state.version),
    getCompletedEvaluations: read("evaluations", () => state.rows), listAssignmentsForObject: read("assignments", () => state.assignments), getCustomerScope: read("scope", () => state.scope),
    getProject: read("project", () => state.project), getCredential: read("credential", () => state.credential),
    inspectLocal: async () => ({ configured: true, playbookSha256 }),
  };
  const app = express(); app.use(express.json());
  app.use((req: any, _res, next) => { if (state.authenticated !== false) req.userId = "user-a"; req.orgId = state.orgId ?? "a"; req.user = { role: state.user?.role ?? role }; next(); });
  app.use("/api/v1/gate", createGateDecisionRouter(deps));
  return { state, deps, app, calls, action, time };
}

test("verified governance, scope, action and prerequisites allow with bounded validity and no secrets", async () => {
  const f = await fixture();
  const response = await supertest(f.app).post("/api/v1/gate/evaluate").send(request).expect(200);
  assert.equal(response.body.decision, "allow"); assert.deepEqual(response.body.reasons, []);
  assert.equal(response.body.evidence.customerScopeId, "scope-a");
  assert.equal(response.body.evidence.blueprintVersionId, "version-a");
  assert.equal(response.body.evidence.automationEligible, true);
  assert.equal(response.body.validUntil, new Date(f.time + 60000).toISOString());
  assert.ok(!JSON.stringify(response.body).match(new RegExp(SECRET + "|customFields|privateKey|secretConfig|ansible_host")));
  assert.ok(f.calls.includes("evaluations:a:source-a:vm-a:blueprint-a:version-a"));
});

test("different actions have different CustomerScope grants on the same target", async () => {
  const f = await fixture();
  f.state.templates = { "upgrade": { ...f.state.template, id: "upgrade" } };
  f.state.inventory.eligibilityPolicy.preflightActions.push({ ...f.action, templateId: "upgrade", allowedCustomerScopeIds: ["different-scope"] });
  assert.equal((await evaluatePreflight(request, principal, f.deps)).decision, "allow");
  const result = await evaluatePreflight({ ...request, automation: { templateId: "upgrade", adapter: "local" } }, principal, f.deps);
  assert.equal(result.decision, "block"); assert.ok(result.reasons.includes("customer_scope_blocked"));
});

const negativeCases: Array<[string, (f: Awaited<ReturnType<typeof fixture>>) => void, string, string]> = [
  ["not ready", f => { f.state.rows[0].evaluation.automationReady = false; }, "block", "governance_not_ready"],
  ["explicit blocker despite high score", f => { f.state.rows[0].evaluation.findings.push({ severity: "blocker", code: "BLOCK", message: SECRET }); }, "block", "governance_not_ready"],
  ["missing evaluation", f => { f.state.rows = []; }, "unknown", "missing_governance_evaluation"],
  ["stale evaluation", f => { f.state.rows[0].evaluation.evaluatedAt = new Date(f.time - 7200000); }, "unknown", "stale_governance_evaluation"],
  ["stale source", f => { f.state.vm.lastImportedAt = new Date(f.time - 7200000); }, "unknown", "stale_source"],
  ["stale inventory", f => { f.state.inventory.lastRefreshedAt = new Date(f.time - 7200000); }, "unknown", "stale_inventory"],
  ["inventory predates source", f => { f.state.inventory.lastRefreshedAt = new Date(f.time - 120000); }, "unknown", "evidence_invalidated"],
  ["missing source timestamp", f => { f.state.vm.lastImportedAt = null; }, "unknown", "inconsistent_evidence"],
  ["missing assignment", f => { f.state.assignments = []; }, "block", "customer_assignment_missing"],
  ["blocked assignment", f => { f.state.assignments[0].relationship = "shared"; }, "block", "customer_scope_blocked"],
  ["current enforced blueprint rejects scope", f => { f.state.version.rules.customerScope.mode = "enforce"; f.state.version.rules.customerScope.maxAllowedCustomerScopeCount = 0; }, "block", "governance_not_ready"],
  ["inventory target absent", f => { f.state.inventory.cachedData.hosts = []; }, "unknown", "missing_inventory_target"],
  ["ambiguous inventory identity", f => { f.state.inventory.cachedData.hosts.push(structuredClone(f.state.inventory.cachedData.hosts[0])); }, "unknown", "ambiguous_target"],
  ["duplicate source identity", f => { f.state.extraVms = [{ ...f.state.vm, id: "vm-other" }]; }, "unknown", "ambiguous_target"],
  ["missing connection", f => { f.state.inventory.cachedData.hosts[0].ansible_host = ""; }, "block", "missing_connection_data"],
  ["credential reference missing", f => { f.state.template.credentialId = null; }, "unknown", "missing_credential"],
  ["credential belongs to another org", f => { f.state.credential.orgId = "b"; }, "unknown", "missing_credential"],
  ["unusable key material", f => { f.state.credential.secretConfig.privateKey = "enc:v1:bad"; }, "unknown", "missing_credential"],
  ["invalid action", f => { f.state.template = undefined; }, "unknown", "invalid_template"],
  ["no action grant", f => { f.state.inventory.eligibilityPolicy.preflightActions = []; }, "unknown", "action_policy_missing"],
  ["unknown target", f => { f.state.vm = undefined; }, "unknown", "unsupported_target"],
  ["foreign target", f => { f.state.vm.sourceId = "foreign"; }, "unknown", "unsupported_target"],
  ["foreign source", f => { f.state.source.orgId = "b"; }, "unknown", "unsupported_target"],
  ["inconsistent evaluation", f => { f.state.rows[0].evaluation.blueprintVersionId = "old-version"; }, "unknown", "inconsistent_evidence"],
  ["inconsistent stored result", f => { f.state.rows[0].evaluation.result.automationReadiness.ready = false; }, "unknown", "inconsistent_evidence"],
  ["invalidated source", f => { f.state.vm.lastImportedAt = new Date(f.time - 1000); }, "unknown", "evidence_invalidated"],
  ["changed source snapshot", f => { f.state.vm.name = "renamed"; }, "unknown", "evidence_invalidated"],
  ["changed customer assignment", f => { f.state.assignments[0].updatedAt = new Date(f.time - 1000); }, "unknown", "evidence_invalidated"],
  ["future evidence", f => { f.state.rows[0].evaluation.evaluatedAt = new Date(f.time + 60000); }, "unknown", "inconsistent_evidence"],
  ["old cache lacks native status", f => { delete f.state.vm.customFields._netboxStatus; delete f.state.rows[0].evaluation.objectSnapshot.customFields._netboxStatus; }, "unknown", "unknown_readiness"],
  ["known inactive target", f => { f.state.vm.customFields._netboxStatus = "offline"; f.state.rows[0].evaluation.objectSnapshot.customFields._netboxStatus = "offline"; }, "block", "eligibility_blocked"],
  ["unverified contacts requirement", f => { f.state.inventory.eligibilityPolicy.requireContacts = true; }, "unknown", "unknown_readiness"],
];
for (const [name, modify, decision, reason] of negativeCases) test("preflight fails closed: " + name, async () => {
  const f = await fixture(); modify(f);
  const response = await supertest(f.app).post("/api/v1/gate/evaluate").send(request).expect(200);
  assert.equal(response.body.decision, decision); assert.ok(response.body.reasons.includes(reason), JSON.stringify(response.body));
  assert.equal(response.body.validUntil, null); assert.ok(!JSON.stringify(response.body).includes(SECRET));
});

test("authentication and role denials occur before target reads; admin has no implicit action bypass", async () => {
  const f = await fixture(); f.state.authenticated = false;
  await supertest(f.app).post("/api/v1/gate/evaluate").send(request).expect(401); assert.deepEqual(f.calls, []);
  const noOrg = await fixture(); noOrg.state.orgId = "";
  await supertest(noOrg.app).post("/api/v1/gate/evaluate").send(request).expect(403); assert.deepEqual(noOrg.calls, []);
  for (const role of ["viewer", "admin", "platform_admin"]) {
    const denied = await fixture(role);
    const response = await supertest(denied.app).post("/api/v1/gate/evaluate").send(request).expect(403);
    assert.deepEqual(response.body, { message: "Forbidden" });
    assert.ok(!denied.calls.some(call => call.startsWith("vms:") || call.startsWith("source:")));
  }
});

test("caller cannot supply policy, org, score, context, approval or requester bypasses", async () => {
  const f = await fixture();
  for (const field of ["policy", "orgId", "governanceReady", "context", "approval", "requester", "persist", "dryRun"]) {
    assert.equal(gateDecisionRequestSchema.safeParse({ ...request, [field]: true }).success, false);
    await supertest(f.app).post("/api/v1/gate/evaluate").send({ ...request, [field]: true }).expect(400);
  }
  await supertest(f.app).post("/api/v1/gate/evaluate").send({ ...request, target: { ...request.target, objectType: "provider_vm" } }).expect(400);
  assert.deepEqual(f.calls, []);
});

test("freshness overrides can only tighten admin policy and expiry is bounded by evidence deadlines", async () => {
  const f = await fixture(); f.state.rows[0].evaluation.evaluatedAt = new Date(f.time - 3600000 + 15000); f.state.rows[0].run.completedAt = f.state.rows[0].evaluation.evaluatedAt;
  f.state.vm.lastImportedAt = new Date(f.time - 3600000); f.state.assignments[0].lastSyncedAt = f.state.vm.lastImportedAt;
  f.state.assignments[0].updatedAt = f.state.vm.lastImportedAt; f.state.scope.lastSyncedAt = f.state.vm.lastImportedAt; f.state.scope.updatedAt = f.state.vm.lastImportedAt;
  f.state.blueprint.updatedAt = f.state.vm.lastImportedAt; f.state.version.createdAt = f.state.vm.lastImportedAt;
  // Keep source/assignment expiry beyond governance expiry for this case.
  f.state.inventory.eligibilityPolicy.preflightActions[0].maxSourceAgeSeconds = 7200; f.state.inventory.eligibilityPolicy.preflightActions[0].maxAssignmentAgeSeconds = 7200;
  const allowed = await evaluatePreflight({ ...request, freshness: { maxGovernanceAgeSeconds: 7200 } }, principal, f.deps);
  assert.equal(allowed.decision, "allow"); assert.equal(allowed.validUntil, new Date(f.time + 15000).toISOString());
  const tight = await evaluatePreflight({ ...request, freshness: { maxGovernanceAgeSeconds: 10 } }, principal, f.deps);
  assert.equal(tight.decision, "unknown"); assert.ok(tight.reasons.includes("stale_governance_evaluation"));
});

test("state, requester and playbook changes during evaluation invalidate positive decisions", async () => {
  for (const kind of ["policy", "scope", "user", "playbook"]) {
    const f = await fixture(); let checks = 0;
    f.deps.inspectLocal = async () => {
      checks++;
      if (checks === 1 && kind === "policy") f.state.inventory.eligibilityPolicy.preflightActions[0].allowedRoles = ["admin"];
      if (checks === 1 && kind === "scope") f.state.scope.updatedAt = new Date(f.time);
      if (checks === 1 && kind === "user") f.state.user.role = "viewer";
      return { configured: true, playbookSha256: checks === 2 && kind === "playbook" ? "b".repeat(64) : playbookSha256 };
    };
    const response = await supertest(f.app).post("/api/v1/gate/evaluate").send(request).expect(kind === "user" ? 403 : 200);
    if (kind !== "user") { assert.equal(response.body.decision, "unknown"); assert.ok(response.body.reasons.includes("evidence_invalidated")); }
  }
});

test("unsupported adapters, unverified runner and pin mismatch cannot allow", async () => {
  const f = await fixture();
  for (const adapter of ["awx", "rhaap", "webhook"] as const) assert.equal((await evaluatePreflight({ ...request, automation: { ...request.automation, adapter } }, principal, f.deps)).decision, "unknown");
  f.deps.inspectLocal = async () => ({ configured: false });
  assert.ok((await evaluatePreflight(request, principal, f.deps)).reasons.includes("missing_execution_prerequisites"));
  f.deps.inspectLocal = async () => ({ configured: true, playbookSha256: "b".repeat(64) });
  assert.ok((await evaluatePreflight(request, principal, f.deps)).reasons.includes("evidence_invalidated"));
});

test("strict action policies require explicit freshness, grants and pin; duplicates are rejected", async () => {
  const f = await fixture();
  assert.equal(preflightActionPolicySchema.safeParse(f.action).success, true);
  assert.equal(preflightActionPolicySchema.safeParse({ ...f.action, maxGovernanceAgeSeconds: undefined }).success, false);
  assert.equal(preflightActionPolicySchema.safeParse({ ...f.action, allowedRoles: [] }).success, false);
  assert.equal(preflightActionPolicySchema.safeParse({ ...f.action, bypass: true }).success, false);
  assert.equal(eligibilityPolicySchema.safeParse({ preflightActions: [f.action, f.action] }).success, false);
  const patched = mergeEligibilityPolicyPatch({ governance: { mode: "warn_only" } }, { preflightActions: [f.action] });
  assert.equal(patched.governance.mode, "warn_only"); assert.equal(patched.preflightActions?.length, 1);
});

test("real route registration enforces cookie authentication and org scope without launching or persisting", async () => {
  const original = storage.getUser; const originalTemplate = storage.getJobTemplate;
  let templateReads = 0;
  storage.getUser = async id => ({ id, username: "operator", role: "operator", orgId: "a" }) as any;
  storage.getJobTemplate = async (_id, orgId) => { assert.equal(orgId, "a"); templateReads++; return undefined; };
  const app = express(); app.use(express.json()); app.use(cookieParser());
  const server = await registerRoutes(app);
  try {
    await supertest(app).post("/api/v1/gate/evaluate").send(request).expect(401);
    const token = jwt.sign({ userId: "user-a", orgId: "b", role: "admin" }, process.env.JWT_SECRET || "dev-secret-change-in-production");
    const response = await supertest(app).post("/api/v1/gate/evaluate").set("Cookie", "auth_token=" + token).send(request).expect(200);
    assert.equal(response.body.decision, "unknown"); assert.ok(response.body.reasons.includes("invalid_template")); assert.equal(templateReads, 1);
  } finally { storage.getUser = original; storage.getJobTemplate = originalTemplate; server.close(); }
});


test("declared CustomerScope count, origin and age policies use the shared evaluator", async () => {
  const f = await fixture();
  const context = await loadCustomerScopeContextByObjectId({ listCustomerScopeObjectAssignments: async () => f.state.assignments, listCustomerScopes: async () => [f.state.scope] }, "a", "source-a");
  const object = normalizeCachedNetboxVm(f.state.vm, context.get("vm-a"));
  for (const mode of ["visibility_only", "score_only", "readiness", "enforce"] as const) {
    const rules = { ...f.state.version.rules, customerScope: { ...f.state.version.rules.customerScope, mode, maxAllowedCustomerScopeCount: 0, scoreWeight: 20 } };
    const result = evaluateGovernanceObject(object, rules, new Date(f.time));
    assert.equal(result.automationReadiness.ready, mode === "visibility_only" || mode === "score_only");
    assert.equal(result.recommendedActions.includes("block_automation"), mode === "enforce");
    if (mode === "score_only") assert.ok(result.scores.governance < 100);
  }
  for (const patch of [{ requireProviderDerivedAssignment: true }, { staleAssignmentMaxAgeDays: 0 }]) {
    const altered = structuredClone(object);
    if (patch.requireProviderDerivedAssignment) (altered.fields.customerAssignments as any[])[0].derivedFrom = "manual";
    const result = evaluateGovernanceObject(altered, { ...f.state.version.rules, customerScope: { ...f.state.version.rules.customerScope, mode: "enforce", ...patch } }, new Date(f.time));
    assert.equal(result.automationReadiness.ready, false);
    assert.ok(result.recommendedActions.includes("block_automation"));
  }
});

test("positive preflight invokes only reads and leaves domain evidence unchanged", async () => {
  const f = await fixture(); const before = structuredClone(f.state);
  const result = await evaluatePreflight(request, principal, f.deps);
  assert.equal(result.decision, "allow"); assert.deepEqual(f.state, before);
  assert.ok(f.calls.every(call => !/launch|insert|update|snapshot|create|dispatch/.test(call)));
});

test("credential readiness verifies real encrypted throwaway key material without disclosure", async () => {
  const f = await fixture();
  assert.equal(hasUsableSshCredential(f.state.credential), true);
  for (const changes of [{ secretConfig: { privateKey: "plaintext-placeholder" } }, { metadata: { username: "demo", strictHostKeyChecking: false } }, { metadata: { username: "$(whoami)" } }]) {
    assert.equal(hasUsableSshCredential({ ...f.state.credential, ...changes }), false);
  }
});

test("positive preflight requires explicit local runner enablement with no local-dev fallback", () => {
  assert.equal(isPreflightLocalRunnerEnabled({ NODE_ENV: "development", ROVELINK_LOCAL_DEV: "true", ROVELINK_LOCAL_RUNNER_ENABLED: "false" }), false);
  assert.equal(isPreflightLocalRunnerEnabled({ NODE_ENV: "development" }), false);
  assert.equal(isPreflightLocalRunnerEnabled({ ROVELINK_LOCAL_RUNNER_ENABLED: "true" }), true);
});

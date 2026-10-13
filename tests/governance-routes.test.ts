import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import express from "express";
import supertest from "supertest";
import { createGovernanceRouter } from "../server/routes/governance";
import { STANDARD_NETBOX_VM_GOVERNANCE_BLUEPRINT } from "../server/services/governance-blueprint-evaluator";
import type { IStorage } from "../server/storage";
import type {
  CmdbAccount,
  CustomerScope,
  CustomerScopeObjectAssignment,
  GovernanceBlueprint,
  GovernanceBlueprintVersion,
  GovernanceEvaluationRun,
  GovernanceObjectEvaluation,
  InsertCustomerScope,
  InsertCustomerScopeObjectAssignment,
  NetboxInventorySource,
  NetboxVm,
} from "../shared/schema";

const ORG_A = "org-alpha";
const ORG_B = "org-beta";

type FakeStorage = ReturnType<typeof createFakeGovernanceStorage>;

function makeRequest(storage: FakeStorage, deps?: Parameters<typeof createGovernanceRouter>[1]) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.orgId = req.header("x-org-id") || ORG_A;
    req.user = {
      id: req.header("x-user-id") || "user-test",
      role: req.header("x-role") || "viewer",
      orgId: req.orgId,
    };
    next();
  });
  app.use("/api/governance", createGovernanceRouter(storage as unknown as IStorage, deps));
  return supertest(app);
}

function createFakeGovernanceStorage() {
  const blueprints: GovernanceBlueprint[] = [];
  const versions: GovernanceBlueprintVersion[] = [];
  const runs: GovernanceEvaluationRun[] = [];
  const objectEvaluations: GovernanceObjectEvaluation[] = [];
  const cmdbAccounts: CmdbAccount[] = [];
  const sources: NetboxInventorySource[] = [
    {
      id: `${ORG_A}-source`,
      orgId: ORG_A,
      name: "Alpha NetBox",
      url: "http://alpha-netbox.local",
      token: "encrypted-token",
      enabled: true,
      lastImportAt: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    },
    {
      id: `${ORG_A}-secondary-source`,
      orgId: ORG_A,
      name: "Alpha Secondary NetBox",
      url: "http://alpha-secondary-netbox.local",
      token: "encrypted-token",
      enabled: true,
      lastImportAt: null,
      createdAt: new Date("2026-01-02T00:00:00.000Z"),
    },
    {
      id: `${ORG_B}-source`,
      orgId: ORG_B,
      name: "Beta NetBox",
      url: "http://beta-netbox.local",
      token: "encrypted-token",
      enabled: true,
      lastImportAt: null,
      createdAt: new Date("2026-01-03T00:00:00.000Z"),
    },
  ];
  const vms: NetboxVm[] = [];
  const customerScopes: CustomerScope[] = [];
  const customerScopeObjectAssignments: CustomerScopeObjectAssignment[] = [];
  let netboxVmReadCount = 0;
  let customerScopeReadCount = 0;
  let customerScopeAssignmentReadCount = 0;
  let sequence = 0;

  const nextId = (prefix: string) => `${prefix}-${++sequence}`;
  const now = () => new Date();

  return {
    blueprints,
    versions,
    runs,
    objectEvaluations,
    cmdbAccounts,
    sources,
    vms,
    customerScopes,
    customerScopeObjectAssignments,
    get netboxVmReadCount() {
      return netboxVmReadCount;
    },
    get customerScopeReadCount() {
      return customerScopeReadCount;
    },
    get customerScopeAssignmentReadCount() {
      return customerScopeAssignmentReadCount;
    },

    async createGovernanceBlueprint(input: any) {
      const blueprint: GovernanceBlueprint = {
        id: nextId("blueprint"),
        activeVersionId: null,
        createdAt: now(),
        updatedAt: now(),
        description: null,
        createdBy: null,
        sourceType: null,
        sourceId: null,
        ...input,
      };
      blueprints.push(blueprint);
      return blueprint;
    },

    async listGovernanceBlueprints(orgId: string) {
      return blueprints.filter((blueprint) => blueprint.orgId === orgId);
    },

    async getGovernanceBlueprint(id: string, orgId: string) {
      return blueprints.find((blueprint) => blueprint.id === id && blueprint.orgId === orgId);
    },

    async updateGovernanceBlueprint(id: string, data: Partial<GovernanceBlueprint>, orgId: string) {
      const blueprint = await this.getGovernanceBlueprint(id, orgId);
      if (!blueprint) return undefined;
      Object.assign(blueprint, {
        ...data,
        id: blueprint.id,
        orgId: blueprint.orgId,
        activeVersionId: blueprint.activeVersionId,
        updatedAt: now(),
      });
      return blueprint;
    },

    async createGovernanceBlueprintVersion(input: any) {
      const parent = await this.getGovernanceBlueprint(input.blueprintId, input.orgId);
      if (!parent) throw new Error("Governance blueprint not found");
      if (versions.some((version) => version.blueprintId === input.blueprintId && version.version === input.version)) {
        throw new Error("Governance blueprint version already exists");
      }
      const version: GovernanceBlueprintVersion = {
        id: nextId("version"),
        createdAt: now(),
        createdBy: null,
        ...input,
      };
      versions.push(version);
      return version;
    },

    async getGovernanceBlueprintVersion(id: string, orgId: string) {
      return versions.find((version) => version.id === id && version.orgId === orgId);
    },

    async listGovernanceBlueprintVersions(blueprintId: string, orgId: string) {
      const parent = await this.getGovernanceBlueprint(blueprintId, orgId);
      if (!parent) return [];
      return versions.filter((version) => version.blueprintId === blueprintId && version.orgId === orgId);
    },

    async activateGovernanceBlueprintVersion(blueprintId: string, versionId: string, orgId: string) {
      const blueprint = await this.getGovernanceBlueprint(blueprintId, orgId);
      const version = await this.getGovernanceBlueprintVersion(versionId, orgId);
      if (!blueprint || !version || version.blueprintId !== blueprintId) return undefined;
      blueprint.activeVersionId = version.id;
      blueprint.status = "active";
      blueprint.updatedAt = now();
      return blueprint;
    },

    async getActiveGovernanceBlueprintForObjectType(objectType: string, orgId: string) {
      const blueprint = blueprints.find((item) => (
        item.orgId === orgId &&
        item.objectType === objectType &&
        item.activeVersionId
      ));
      const version = blueprint
        ? versions.find((item) => item.id === blueprint.activeVersionId && item.blueprintId === blueprint.id)
        : undefined;
      return blueprint && version ? { blueprint, version } : undefined;
    },

    async createGovernanceEvaluationRun(input: any) {
      const blueprint = await this.getGovernanceBlueprint(input.blueprintId, input.orgId);
      const version = await this.getGovernanceBlueprintVersion(input.blueprintVersionId, input.orgId);
      if (!blueprint || !version || version.blueprintId !== blueprint.id) {
        throw new Error("Governance blueprint version not found");
      }
      if (input.netboxSourceId && !sources.some((source) => source.id === input.netboxSourceId && source.orgId === input.orgId)) {
        throw new Error("NetBox inventory source not found");
      }
      if (input.cmdbAccountId && input.cmdbAccountId !== `${input.orgId}-cmdb`) {
        throw new Error("CMDB account not found");
      }
      const run: GovernanceEvaluationRun = {
        id: nextId("run"),
        cmdbAccountId: null,
        netboxSourceId: null,
        counts: {},
        error: null,
        startedAt: null,
        completedAt: null,
        createdAt: now(),
        ...input,
      };
      runs.push(run);
      return run;
    },

    async storeGovernanceObjectEvaluation(input: any) {
      if (!input.runId) throw new Error("Governance object evaluation requires runId");
      const run = await this.getGovernanceEvaluationRun(input.runId, input.orgId);
      if (!run) throw new Error("Governance evaluation run not found");
      if (run && (run.blueprintId !== input.blueprintId || run.blueprintVersionId !== input.blueprintVersionId)) {
        throw new Error("Governance object evaluation does not match its run");
      }
      const evaluation: GovernanceObjectEvaluation = {
        id: nextId("object-evaluation"),
        objectId: null,
        externalId: null,
        objectName: null,
        objectSnapshot: {},
        evaluatedAt: now(),
        ...input,
      };
      objectEvaluations.push(evaluation);
      return evaluation;
    },

    async listGovernanceEvaluationRuns(orgId: string, limit = 50) {
      return runs.filter((run) => run.orgId === orgId).slice(0, limit);
    },

    async getGovernanceEvaluationRun(id: string, orgId: string) {
      return runs.find((run) => run.id === id && run.orgId === orgId);
    },

    async listGovernanceObjectEvaluations(runId: string, orgId: string) {
      const run = await this.getGovernanceEvaluationRun(runId, orgId);
      if (!run) return [];
      return objectEvaluations.filter((evaluation) => evaluation.runId === runId && evaluation.orgId === orgId);
    },

    async getLatestGovernanceEvaluationForObject(orgId: string, objectType: string, objectId: string) {
      const evaluation = objectEvaluations
        .filter((item) => item.orgId === orgId && item.objectType === objectType && item.objectId === objectId)
        .sort((a, b) => b.evaluatedAt.getTime() - a.evaluatedAt.getTime())[0];
      if (!evaluation) return undefined;

      return {
        evaluation,
        run: await this.getGovernanceEvaluationRun(evaluation.runId, orgId) ?? null,
      };
    },

    async getNetboxInventorySources(orgId: string) {
      return sources.filter((source) => source.orgId === orgId);
    },

    async getNetboxInventorySource(id: string, orgId: string) {
      return sources.find((source) => source.id === id && source.orgId === orgId);
    },

    async createNetboxInventorySource(input: any) {
      const source: NetboxInventorySource = {
        id: input.id ?? nextId("source"),
        lastImportAt: null,
        createdAt: now(),
        ...input,
      };
      sources.push(source);
      return source;
    },

    async updateNetboxInventorySource(id: string, data: Partial<NetboxInventorySource>, orgId: string) {
      const source = await this.getNetboxInventorySource(id, orgId);
      if (!source) return undefined;
      Object.assign(source, data);
      return source;
    },

    async getCmdbAccounts(orgId: string) {
      return cmdbAccounts.filter((account) => account.orgId === orgId);
    },

    async upsertNetboxVm(input: any) {
      const existing = vms.find((vm) => vm.sourceId === input.sourceId && vm.netboxId === input.netboxId);
      if (existing) {
        Object.assign(existing, input, { id: existing.id, lastImportedAt: now() });
        return existing;
      }

      const vm: NetboxVm = {
        id: input.id ?? nextId("vm"),
        ip: null,
        operatingSystem: null,
        customFields: {},
        tags: [],
        lastImportedAt: now(),
        ...input,
      };
      vms.push(vm);
      return vm;
    },

    async getNetboxVms(orgId: string) {
      netboxVmReadCount += 1;
      const orgSourceIds = new Set(sources.filter((source) => source.orgId === orgId).map((source) => source.id));
      return vms.filter((vm) => vm.sourceId && orgSourceIds.has(vm.sourceId));
    },

    async createCustomerScope(input: InsertCustomerScope) {
      const existing = await this.getCustomerScopeByExternalId(
        input.orgId,
        input.sourceType,
        input.sourceId,
        input.externalId,
      );
      if (existing) throw new Error("duplicate customer scope external identity");

      const scope: CustomerScope = {
        id: input.id ?? nextId("customer-scope"),
        displayName: null,
        isolation: null,
        parentExternalId: null,
        metadata: null,
        lastSyncedAt: null,
        createdAt: now(),
        updatedAt: now(),
        ...input,
      };
      customerScopes.push(scope);
      return scope;
    },

    async upsertCustomerScope(input: InsertCustomerScope) {
      const existing = await this.getCustomerScopeByExternalId(
        input.orgId,
        input.sourceType,
        input.sourceId,
        input.externalId,
      );
      if (!existing) return this.createCustomerScope(input);

      Object.assign(existing, {
        ...input,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: now(),
      });
      return existing;
    },

    async listCustomerScopes(orgId: string, sourceType?: string, sourceId?: string) {
      customerScopeReadCount += 1;
      return customerScopes.filter((scope) => (
        scope.orgId === orgId &&
        (!sourceType || scope.sourceType === sourceType) &&
        (!sourceId || scope.sourceId === sourceId)
      ));
    },

    async getCustomerScope(id: string, orgId: string) {
      return customerScopes.find((scope) => scope.id === id && scope.orgId === orgId);
    },

    async getCustomerScopeByExternalId(
      orgId: string,
      sourceType: string,
      sourceId: string,
      externalId: string,
    ) {
      return customerScopes.find((scope) => (
        scope.orgId === orgId &&
        scope.sourceType === sourceType &&
        scope.sourceId === sourceId &&
        scope.externalId === externalId
      ));
    },

    async createCustomerScopeObjectAssignment(input: InsertCustomerScopeObjectAssignment) {
      if (input.customerScopeId) {
        const scope = await this.getCustomerScope(input.customerScopeId, input.orgId);
        if (!scope || scope.sourceType !== input.sourceType || scope.sourceId !== input.sourceId) {
          throw new Error("CustomerScope assignment must reference a scope in the same organization and source");
        }
      }

      const existing = findCustomerScopeObjectAssignment(input);
      if (existing) throw new Error("duplicate customer scope object assignment");

      const assignment: CustomerScopeObjectAssignment = {
        id: input.id ?? nextId("customer-assignment"),
        customerScopeId: null,
        metadata: null,
        lastSyncedAt: null,
        createdAt: now(),
        updatedAt: now(),
        ...input,
      };
      customerScopeObjectAssignments.push(assignment);
      return assignment;
    },

    async upsertCustomerScopeObjectAssignment(input: InsertCustomerScopeObjectAssignment) {
      const existing = findCustomerScopeObjectAssignment(input);
      if (!existing) return this.createCustomerScopeObjectAssignment(input);

      Object.assign(existing, {
        ...input,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: now(),
      });
      return existing;
    },

    async listCustomerScopeObjectAssignments(orgId: string, sourceType?: string, sourceId?: string) {
      customerScopeAssignmentReadCount += 1;
      return customerScopeObjectAssignments.filter((assignment) => (
        assignment.orgId === orgId &&
        (!sourceType || assignment.sourceType === sourceType) &&
        (!sourceId || assignment.sourceId === sourceId)
      ));
    },

    async listAssignmentsForObject(
      orgId: string,
      sourceType: string,
      sourceId: string,
      objectType: string,
      objectId: string,
    ) {
      return customerScopeObjectAssignments.filter((assignment) => (
        assignment.orgId === orgId &&
        assignment.sourceType === sourceType &&
        assignment.sourceId === sourceId &&
        assignment.objectType === objectType &&
        assignment.objectId === objectId
      ));
    },

    async listAssignmentsForCustomerScope(orgId: string, customerScopeId: string) {
      const scope = await this.getCustomerScope(customerScopeId, orgId);
      if (!scope) return [];
      return customerScopeObjectAssignments.filter((assignment) => (
        assignment.orgId === orgId &&
        assignment.customerScopeId === customerScopeId
      ));
    },
  };

  function findCustomerScopeObjectAssignment(input: InsertCustomerScopeObjectAssignment) {
    return customerScopeObjectAssignments.find((assignment) => (
      assignment.orgId === input.orgId &&
      assignment.sourceType === input.sourceType &&
      assignment.sourceId === input.sourceId &&
      assignment.objectType === input.objectType &&
      assignment.objectId === input.objectId &&
      assignment.customerScopeId === (input.customerScopeId ?? null) &&
      assignment.relationship === input.relationship
    ));
  }
}

async function createDefaultBlueprint(req: ReturnType<typeof supertest>, orgId = ORG_A) {
  const response = await req
    .post("/api/governance/defaults/netbox-vm")
    .set("x-role", "admin")
    .set("x-org-id", orgId)
    .send({ netboxSourceId: `${orgId}-source` })
    .expect((res) => {
      assert.ok([200, 201].includes(res.status));
    });
  return response.body as { blueprint: GovernanceBlueprint; activeVersion: GovernanceBlueprintVersion };
}

function addDedicatedCustomerScopeAssignment(storage: FakeStorage, vm: NetboxVm, sourceId = `${ORG_A}-source`, orgId = ORG_A) {
  const scope: CustomerScope = {
    id: `${vm.id}-scope`,
    orgId,
    sourceType: "netbox_inventory_source",
    sourceId,
    externalId: "scope-20",
    name: "Engineering",
    displayName: "Engineering",
    strategy: "tenant",
    isolation: "assignment",
    parentExternalId: null,
    metadata: null,
    lastSyncedAt: new Date("2026-01-04T00:00:00.000Z"),
    createdAt: new Date("2026-01-04T00:00:00.000Z"),
    updatedAt: new Date("2026-01-04T00:00:00.000Z"),
  };
  storage.customerScopes.push(scope);
  storage.customerScopeObjectAssignments.push({
    id: `${vm.id}-assignment`,
    orgId,
    sourceType: "netbox_inventory_source",
    sourceId,
    objectType: "netbox_vm",
    objectId: vm.id,
    customerScopeId: scope.id,
    relationship: "dedicated",
    derivedFrom: "provider",
    confidence: "authoritative",
    metadata: null,
    lastSyncedAt: new Date("2026-01-04T00:00:00.000Z"),
    createdAt: new Date("2026-01-04T00:00:00.000Z"),
    updatedAt: new Date("2026-01-04T00:00:00.000Z"),
  });
}

describe("governance routes", () => {
  let storage: FakeStorage;
  let req: ReturnType<typeof supertest>;

  beforeEach(() => {
    storage = createFakeGovernanceStorage();
    req = makeRequest(storage);
  });

  it("admin can create the default NetBox VM blueprint for a source", async () => {
    const response = await req
      .post("/api/governance/defaults/netbox-vm")
      .set("x-role", "admin")
      .set("x-org-id", ORG_A)
      .send({ netboxSourceId: `${ORG_A}-source` })
      .expect(201);

    assert.equal(response.body.blueprint.orgId, ORG_A);
    assert.equal(response.body.blueprint.name, `${STANDARD_NETBOX_VM_GOVERNANCE_BLUEPRINT.name} — Alpha NetBox`);
    assert.equal(response.body.blueprint.sourceType, "netbox_inventory_source");
    assert.equal(response.body.blueprint.sourceId, `${ORG_A}-source`);
    assert.equal(response.body.activeVersion.version, 1);
    assert.equal(response.body.blueprint.activeVersionId, response.body.activeVersion.id);
  });

  it("default NetBox VM blueprint requires a source", async () => {
    await req
      .post("/api/governance/defaults/netbox-vm")
      .set("x-role", "admin")
      .set("x-org-id", ORG_A)
      .expect(400);

    assert.equal(storage.blueprints.length, 0);
  });

  it("default NetBox VM blueprint creation dedupes per org source object type", async () => {
    const first = await req
      .post("/api/governance/defaults/netbox-vm")
      .set("x-role", "admin")
      .set("x-org-id", ORG_A)
      .send({ netboxSourceId: `${ORG_A}-source` })
      .expect(201);
    const second = await req
      .post("/api/governance/defaults/netbox-vm")
      .set("x-role", "admin")
      .set("x-org-id", ORG_A)
      .send({ netboxSourceId: `${ORG_A}-source` })
      .expect(200);
    const third = await req
      .post("/api/governance/defaults/netbox-vm")
      .set("x-role", "admin")
      .set("x-org-id", ORG_A)
      .send({ netboxSourceId: `${ORG_A}-secondary-source` })
      .expect(201);

    assert.equal(first.body.blueprint.id, second.body.blueprint.id);
    assert.notEqual(first.body.blueprint.id, third.body.blueprint.id);
    assert.equal(storage.blueprints.length, 2);
  });

  it("viewer can list blueprints", async () => {
    await createDefaultBlueprint(req, ORG_A);

    const response = await req
      .get("/api/governance/blueprints")
      .set("x-role", "viewer")
      .set("x-org-id", ORG_A)
      .expect(200);

    assert.equal(response.body.length, 1);
    assert.equal(response.body[0].orgId, ORG_A);
  });

  it("viewer cannot create blueprint", async () => {
    await req
      .post("/api/governance/blueprints")
      .set("x-role", "viewer")
      .set("x-org-id", ORG_A)
      .send({ name: "Nope", objectType: "netbox_vm" })
      .expect(403);
  });

  it("admin cannot create blueprint as active directly", async () => {
    const response = await req
      .post("/api/governance/blueprints")
      .set("x-role", "admin")
      .set("x-org-id", ORG_A)
      .send({ name: "Direct Active", objectType: "netbox_vm", status: "active" })
      .expect(400);

    assert.match(response.body.message, /activate endpoint/i);
    assert.equal(storage.blueprints.length, 0);
  });

  it("admin cannot patch blueprint to active directly", async () => {
    const createResponse = await req
      .post("/api/governance/blueprints")
      .set("x-role", "admin")
      .set("x-org-id", ORG_A)
      .send({ name: "Draft Blueprint", objectType: "netbox_vm" })
      .expect(201);

    const response = await req
      .patch(`/api/governance/blueprints/${createResponse.body.id}`)
      .set("x-role", "admin")
      .set("x-org-id", ORG_A)
      .send({ status: "active" })
      .expect(400);

    assert.match(response.body.message, /activate endpoint/i);
    assert.equal(storage.blueprints[0].status, "draft");
  });

  it("malformed blueprint rules are rejected and do not create versions", async () => {
    const { blueprint } = await createDefaultBlueprint(req, ORG_A);
    const initialVersionCount = storage.versions.filter((version) => version.blueprintId === blueprint.id).length;
    const baseRules = STANDARD_NETBOX_VM_GOVERNANCE_BLUEPRINT.rules;
    const malformedRules = [
      {
        ...baseRules,
        unexpectedLayer: {},
      },
      {
        ...baseRules,
        dataManagement: [
          ...baseRules.dataManagement,
          { ...baseRules.dataManagement[0] },
        ],
      },
      {
        ...baseRules,
        relevance: {
          ...baseRules.relevance,
          audit: 4,
        },
      },
      {
        ...baseRules,
        dataManagement: baseRules.dataManagement.map((rule, index) => (
          index === 0 ? { ...rule, weight: 10.1 } : rule
        )),
      },
      {
        ...baseRules,
        ownership: baseRules.ownership.map((rule, index) => (
          index === 0 ? { ...rule, weight: 0.05 } : rule
        )),
      },
    ];

    for (const rules of malformedRules) {
      await req
        .post(`/api/governance/blueprints/${blueprint.id}/versions`)
        .set("x-role", "admin")
        .set("x-org-id", ORG_A)
        .send({ rules })
        .expect(400);
    }

    assert.equal(storage.versions.filter((version) => version.blueprintId === blueprint.id).length, initialVersionCount);
  });

  it("operator can run cached NetBox VM evaluation without live NetBox", async () => {
    const { blueprint } = await createDefaultBlueprint(req, ORG_A);
    const vm: NetboxVm = {
      id: "vm-alpha-1",
      sourceId: `${ORG_A}-source`,
      netboxId: 101,
      name: "alpha-vm",
      ip: "192.0.2.10",
      operatingSystem: "linux",
      customFields: {
        tenant: "alpha",
        role: "app",
        automatable: true,
        provider_state: "present",
        technical_owner: "platform",
        service_owner: "payments",
        data_owner: "cmdb",
        operations_team: "ops",
        business_owner: "finance",
      },
      tags: [],
      lastImportedAt: new Date(),
    };
    storage.vms.push(vm);
    addDedicatedCustomerScopeAssignment(storage, vm);

    const response = await req
      .post(`/api/governance/blueprints/${blueprint.id}/evaluate-cached-netbox-vms`)
      .set("x-role", "operator")
      .set("x-org-id", ORG_A)
      .expect(200);

    assert.equal(response.body.evaluatedCount, 1);
    assert.equal(response.body.compliantCount, 1);
    assert.equal(storage.runs.length, 1);
    assert.equal(storage.objectEvaluations.length, 1);
    assert.equal(storage.objectEvaluations[0].objectId, "vm-alpha-1");
    assert.equal(storage.objectEvaluations[0].externalId, "101");
  });

  it("cached VM evaluation loads CustomerScope assignments and scopes once for the selected source", async () => {
    const { blueprint } = await createDefaultBlueprint(req, ORG_A);
    const firstVm: NetboxVm = {
      id: "vm-alpha-customer-one",
      sourceId: `${ORG_A}-source`,
      netboxId: 151,
      name: "alpha-customer-one",
      ip: "192.0.2.151",
      operatingSystem: "linux",
      customFields: {
        role: "app",
        automatable: true,
        provider_state: "present",
        technical_owner: "platform",
        service_owner: "payments",
      },
      tags: [],
      lastImportedAt: new Date(),
    };
    const secondVm: NetboxVm = {
      ...firstVm,
      id: "vm-alpha-customer-two",
      netboxId: 152,
      name: "alpha-customer-two",
    };
    storage.vms.push(firstVm, secondVm);
    addDedicatedCustomerScopeAssignment(storage, firstVm);
    addDedicatedCustomerScopeAssignment(storage, secondVm);

    await req
      .post(`/api/governance/blueprints/${blueprint.id}/evaluate-cached-netbox-vms`)
      .set("x-role", "operator")
      .set("x-org-id", ORG_A)
      .expect(200);

    assert.equal(storage.customerScopeAssignmentReadCount, 1);
    assert.equal(storage.customerScopeReadCount, 1);
    assert.equal(storage.objectEvaluations.length, 2);
    assert.ok(storage.objectEvaluations.every(e => e.governanceScore === 100 && e.automationReady));
    assert.ok(storage.objectEvaluations.every(e => !e.findings.some((f: any) => f.code === "required_data_missing" && ["tenant", "customerAssignment"].includes(f.fieldKey))));
    assert.ok(storage.objectEvaluations.every((evaluation) => (
      !evaluation.findings.some((finding: any) => String(finding.code).startsWith("CUSTOMER_"))
    )));
  });

  it("cached VM evaluation persists CUSTOMER_SCOPE_MISSING when no assignment exists", async () => {
    const { blueprint } = await createDefaultBlueprint(req, ORG_A);
    storage.vms.push({
      id: "vm-alpha-no-customer-assignment",
      sourceId: `${ORG_A}-source`,
      netboxId: 153,
      name: "alpha-no-customer-assignment",
      ip: "192.0.2.153",
      operatingSystem: "linux",
      customFields: {
        tenant: "alpha",
        role: "app",
        automatable: true,
        provider_state: "present",
        technical_owner: "platform",
        service_owner: "payments",
      },
      tags: [],
      lastImportedAt: new Date(),
    });

    const response = await req
      .post(`/api/governance/blueprints/${blueprint.id}/evaluate-cached-netbox-vms`)
      .set("x-role", "operator")
      .set("x-org-id", ORG_A)
      .expect(200);

    assert.ok(storage.objectEvaluations[0].findings.some((finding: any) => finding.fieldKey === "customerAssignment" && finding.message === "Customer assignment is required but missing."));
    assert.equal(response.body.evaluatedCount, 1);
    assert.equal(storage.objectEvaluations[0].objectId, "vm-alpha-no-customer-assignment");
    assert.equal(storage.objectEvaluations[0].governanceScore, 92);
    assert.equal(storage.objectEvaluations[0].automationReady, false);
    assert.ok(storage.objectEvaluations[0].findings.some((finding: any) => (
      finding.code === "CUSTOMER_SCOPE_MISSING"
    )));
  });

  it("CustomerScope assignment lookup uses local VM id, not NetBox numeric id or VM name", async () => {
    const { blueprint } = await createDefaultBlueprint(req, ORG_A);
    storage.vms.push({
      id: "vm-alpha-local-identity",
      sourceId: `${ORG_A}-source`,
      netboxId: 154,
      name: "alpha-local-identity",
      ip: "192.0.2.154",
      operatingSystem: "linux",
      customFields: {
        tenant: "alpha",
        role: "app",
        automatable: true,
        provider_state: "present",
        technical_owner: "platform",
        service_owner: "payments",
      },
      tags: [],
      lastImportedAt: new Date(),
    });
    storage.customerScopeObjectAssignments.push({
      id: "assignment-netbox-id",
      orgId: ORG_A,
      sourceType: "netbox_inventory_source",
      sourceId: `${ORG_A}-source`,
      objectType: "netbox_vm",
      objectId: "154",
      customerScopeId: null,
      relationship: "unassigned",
      derivedFrom: "provider",
      confidence: "authoritative",
      metadata: null,
      lastSyncedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    }, {
      id: "assignment-vm-name",
      orgId: ORG_A,
      sourceType: "netbox_inventory_source",
      sourceId: `${ORG_A}-source`,
      objectType: "netbox_vm",
      objectId: "alpha-local-identity",
      customerScopeId: null,
      relationship: "unassigned",
      derivedFrom: "provider",
      confidence: "authoritative",
      metadata: null,
      lastSyncedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await req
      .post(`/api/governance/blueprints/${blueprint.id}/evaluate-cached-netbox-vms`)
      .set("x-role", "operator")
      .set("x-org-id", ORG_A)
      .expect(200);

    assert.ok(storage.objectEvaluations[0].findings.some((finding: any) => (
      finding.code === "CUSTOMER_SCOPE_MISSING"
    )));
    assert.ok(!storage.objectEvaluations[0].findings.some((finding: any) => (
      finding.code === "CUSTOMER_ASSIGNMENT_UNASSIGNED"
    )));
  });

  it("CustomerScope lookup is scoped to the evaluated source", async () => {
    const { blueprint } = await createDefaultBlueprint(req, ORG_A);
    storage.vms.push({
      id: "vm-alpha-source-scoped",
      sourceId: `${ORG_A}-source`,
      netboxId: 155,
      name: "alpha-source-scoped",
      ip: "192.0.2.155",
      operatingSystem: "linux",
      customFields: {
        tenant: "alpha",
        role: "app",
        automatable: true,
        provider_state: "present",
        technical_owner: "platform",
        service_owner: "payments",
      },
      tags: [],
      lastImportedAt: new Date(),
    });
    storage.customerScopeObjectAssignments.push({
      id: "assignment-wrong-source",
      orgId: ORG_A,
      sourceType: "netbox_inventory_source",
      sourceId: `${ORG_A}-secondary-source`,
      objectType: "netbox_vm",
      objectId: "vm-alpha-source-scoped",
      customerScopeId: null,
      relationship: "unassigned",
      derivedFrom: "provider",
      confidence: "authoritative",
      metadata: null,
      lastSyncedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await req
      .post(`/api/governance/blueprints/${blueprint.id}/evaluate-cached-netbox-vms`)
      .set("x-role", "operator")
      .set("x-org-id", ORG_A)
      .expect(200);

    assert.ok(storage.objectEvaluations[0].findings.some((finding: any) => (
      finding.code === "CUSTOMER_SCOPE_MISSING"
    )));
    assert.ok(!storage.objectEvaluations[0].findings.some((finding: any) => (
      finding.code === "CUSTOMER_ASSIGNMENT_UNASSIGNED"
    )));
  });

  it("top findings prioritize severe blockers over higher-volume CustomerScope warnings", async () => {
    const { blueprint } = await createDefaultBlueprint(req, ORG_A);
    for (let index = 0; index < 3; index += 1) {
      storage.vms.push({
        id: `vm-alpha-top-findings-${index}`,
        sourceId: `${ORG_A}-source`,
        netboxId: 170 + index,
        name: `alpha-top-findings-${index}`,
        ip: `192.0.2.17${index}`,
        operatingSystem: "linux",
        customFields: {
          tenant: "alpha",
          role: index === 0 ? "" : "app",
          automatable: true,
          provider_state: "present",
          technical_owner: "platform",
          service_owner: "payments",
        },
        tags: [],
        lastImportedAt: new Date(),
      });
    }

    const response = await req
      .post(`/api/governance/blueprints/${blueprint.id}/evaluate-cached-netbox-vms`)
      .set("x-role", "operator")
      .set("x-org-id", ORG_A)
      .expect(200);

    assert.equal(response.body.topFindings[0].code, "required_data_missing");
    assert.equal(response.body.topFindings.find((finding: any) => finding.code === "CUSTOMER_SCOPE_MISSING").count, 3);
    assert.match(
      response.body.topFindings.find((finding: any) => finding.code === "CUSTOMER_SCOPE_MISSING").message,
      /visibility-only governance issue/,
    );
  });

  it("viewer can list governance NetBox sources without tokens", async () => {
    storage.vms.push({
      id: "vm-alpha-source-summary",
      sourceId: `${ORG_A}-source`,
      netboxId: 111,
      name: "alpha-source-summary",
      ip: "192.0.2.11",
      operatingSystem: "linux",
      customFields: {},
      tags: [],
      lastImportedAt: new Date("2026-01-04T00:00:00.000Z"),
    });

    const response = await req
      .get("/api/governance/netbox-sources")
      .set("x-role", "viewer")
      .set("x-org-id", ORG_A)
      .expect(200);

    assert.equal(response.body.length, 2);
    assert.equal(response.body[0].token, undefined);
    assert.equal(response.body.find((source: any) => source.id === `${ORG_A}-source`).cachedVmCount, 1);
  });

  it("materializes NetBox CMDB accounts as governance sources without exposing tokens", async () => {
    storage.sources.length = 0;
    storage.cmdbAccounts.push({
      id: "cmdb-netbox-alpha",
      orgId: ORG_A,
      kind: "netbox",
      name: "Docker NetBox",
      enabled: true,
      config: {
        url: "http://host.docker.internal:8000",
        token: "encrypted-token",
      },
      lastValidatedAt: null,
      cachedData: {},
      createdAt: new Date("2026-01-05T00:00:00.000Z"),
      updatedAt: new Date("2026-01-05T00:00:00.000Z"),
    });

    const response = await req
      .get("/api/governance/netbox-sources")
      .set("x-role", "viewer")
      .set("x-org-id", ORG_A)
      .expect(200);

    assert.equal(response.body.length, 1);
    assert.equal(response.body[0].id, "cmdb-netbox-alpha");
    assert.equal(response.body[0].name, "Docker NetBox");
    assert.equal(response.body[0].cmdbAccountId, "cmdb-netbox-alpha");
    assert.equal(response.body[0].cachedVmCount, 0);
    assert.equal(response.body[0].token, undefined);
    assert.equal(storage.sources.length, 1);
  });

  it("refreshing an empty NetBox succeeds and records an import time without evaluating Governance", async () => {
    const syncReq = makeRequest(storage, { listNetboxVmsForSource: async () => [] });
    const response = await syncReq
      .post(`/api/governance/netbox-sources/${ORG_A}-source/sync-cached-vms`)
      .set("x-role", "operator")
      .set("x-org-id", ORG_A)
      .expect(200);
    assert.equal(response.body.importedCount, 0);
    assert.equal(response.body.customerScopesUpserted, 0);
    assert.equal(response.body.customerAssignmentsUpserted, 0);
    assert.equal(response.body.customerUnassignedCount, 0);
    assert.ok(response.body.lastImportAt);
    assert.ok(!JSON.stringify(response.body).includes("token"));
    assert.equal(storage.vms.length, 0);
  });

  it("syncs cached VMs for a governance source with stable source linkage", async () => {
    const syncReq = makeRequest(storage, {
      listNetboxVmsForSource: async () => [
        {
          id: 501,
          name: "alpha-live-1",
          primary_ip4: { address: "192.0.2.51/24" },
          platform: { name: "Ubuntu Linux" },
          custom_fields: {
            tenant: "alpha",
            role: "app",
            automatable: true,
            provider_state: "present",
          },
          tags: [{ name: "production" }],
        },
        {
          id: 502,
          name: "alpha-live-2",
          primary_ip: { address: "192.0.2.52/24" },
          platform: { name: "Windows Server" },
          custom_fields: {},
          tags: [{ slug: "finance" }],
        },
      ],
    });

    const response = await syncReq
      .post(`/api/governance/netbox-sources/${ORG_A}-source/sync-cached-vms`)
      .set("x-role", "operator")
      .set("x-org-id", ORG_A)
      .expect(200);

    assert.equal(response.body.importedCount, 2);
    assert.equal(storage.vms.length, 2);
    assert.equal(storage.vms[0].sourceId, `${ORG_A}-source`);
    assert.equal(storage.vms[0].netboxId, 501);
    assert.equal(storage.vms[0].ip, "192.0.2.51");
    assert.equal(storage.vms[0].operatingSystem, "Linux");
    assert.deepEqual(storage.vms[1].tags, ["finance"]);

    const sourcesResponse = await syncReq
      .get("/api/governance/netbox-sources")
      .set("x-role", "viewer")
      .set("x-org-id", ORG_A)
      .expect(200);

    assert.equal(sourcesResponse.body.find((source: any) => source.id === `${ORG_A}-source`).cachedVmCount, 2);
  });

  it("sync with NetBox tenant creates CustomerScope and dedicated assignment using cached VM id", async () => {
    const syncReq = makeRequest(storage, {
      listNetboxVmsForSource: async () => [
        {
          id: 701,
          name: "alpha-tenant-vm",
          tenant: { id: 20, name: "Engineering", slug: "engineering" },
          custom_fields: {},
          tags: [],
        },
      ],
    });

    const response = await syncReq
      .post(`/api/governance/netbox-sources/${ORG_A}-source/sync-cached-vms`)
      .set("x-role", "operator")
      .set("x-org-id", ORG_A)
      .expect(200);

    assert.equal(response.body.importedCount, 1);
    assert.equal(response.body.customerScopesUpserted, 1);
    assert.equal(response.body.customerAssignmentsUpserted, 1);
    assert.equal(response.body.customerUnassignedCount, 0);
    assert.equal(response.body.customerScopeResolutionErrors, 0);
    assert.equal(storage.customerScopes.length, 1);
    assert.equal(storage.customerScopes[0].externalId, "20");
    assert.equal(storage.customerScopes[0].name, "Engineering");
    assert.equal(storage.customerScopes[0].sourceId, `${ORG_A}-source`);
    assert.equal(storage.customerScopeObjectAssignments.length, 1);
    assert.equal(storage.customerScopeObjectAssignments[0].objectId, storage.vms[0].id);
    assert.equal(storage.customerScopeObjectAssignments[0].objectId.startsWith("vm-"), true);
    assert.equal(storage.customerScopeObjectAssignments[0].relationship, "dedicated");
    assert.equal(storage.customerScopeObjectAssignments[0].customerScopeId, storage.customerScopes[0].id);
  });

  it("sync without NetBox tenant creates explicit unassigned assignment", async () => {
    const syncReq = makeRequest(storage, {
      listNetboxVmsForSource: async () => [
        {
          id: 702,
          name: "alpha-unassigned-vm",
          custom_fields: {},
          tags: [],
        },
      ],
    });

    const response = await syncReq
      .post(`/api/governance/netbox-sources/${ORG_A}-source/sync-cached-vms`)
      .set("x-role", "operator")
      .set("x-org-id", ORG_A)
      .expect(200);

    assert.equal(response.body.customerScopesUpserted, 0);
    assert.equal(response.body.customerAssignmentsUpserted, 1);
    assert.equal(response.body.customerUnassignedCount, 1);
    assert.equal(response.body.customerScopeResolutionErrors, 0);
    assert.equal(storage.customerScopes.length, 0);
    assert.equal(storage.customerScopeObjectAssignments.length, 1);
    assert.equal(storage.customerScopeObjectAssignments[0].objectId, storage.vms[0].id);
    assert.equal(storage.customerScopeObjectAssignments[0].customerScopeId, null);
    assert.equal(storage.customerScopeObjectAssignments[0].relationship, "unassigned");
    assert.equal(storage.customerScopeObjectAssignments[0].derivedFrom, "provider");
    assert.equal(storage.customerScopeObjectAssignments[0].confidence, "authoritative");
  });

  it("repeated sync is idempotent for CustomerScope and assignment records", async () => {
    const syncReq = makeRequest(storage, {
      listNetboxVmsForSource: async () => [
        {
          id: 703,
          name: "alpha-repeat-vm",
          tenant: { id: 21, name: "Operations" },
          custom_fields: {},
          tags: [],
        },
      ],
    });

    for (let i = 0; i < 2; i += 1) {
      await syncReq
        .post(`/api/governance/netbox-sources/${ORG_A}-source/sync-cached-vms`)
        .set("x-role", "operator")
        .set("x-org-id", ORG_A)
        .expect(200);
    }

    assert.equal(storage.vms.length, 1);
    assert.equal(storage.customerScopes.length, 1);
    assert.equal(storage.customerScopeObjectAssignments.length, 1);
    assert.equal(storage.customerScopeObjectAssignments[0].objectId, storage.vms[0].id);
  });

  it("tenant rename updates existing CustomerScope by external id", async () => {
    let tenantName = "Old Name";
    const syncReq = makeRequest(storage, {
      listNetboxVmsForSource: async () => [
        {
          id: 704,
          name: "alpha-renamed-tenant-vm",
          tenant: { id: 22, name: tenantName },
          custom_fields: {},
          tags: [],
        },
      ],
    });

    await syncReq
      .post(`/api/governance/netbox-sources/${ORG_A}-source/sync-cached-vms`)
      .set("x-role", "operator")
      .set("x-org-id", ORG_A)
      .expect(200);
    tenantName = "New Name";
    await syncReq
      .post(`/api/governance/netbox-sources/${ORG_A}-source/sync-cached-vms`)
      .set("x-role", "operator")
      .set("x-org-id", ORG_A)
      .expect(200);

    assert.equal(storage.customerScopes.length, 1);
    assert.equal(storage.customerScopes[0].externalId, "22");
    assert.equal(storage.customerScopes[0].name, "New Name");
    assert.equal(storage.customerScopeObjectAssignments.length, 1);
  });

  it("same NetBox tenant id in two sources creates separate CustomerScopes", async () => {
    const syncReq = makeRequest(storage, {
      listNetboxVmsForSource: async (source) => [
        {
          id: source.id === `${ORG_A}-source` ? 705 : 706,
          name: `vm-${source.id}`,
          tenant: { id: 23, name: "Shared Tenant Id" },
          custom_fields: {},
          tags: [],
        },
      ],
    });

    await syncReq
      .post(`/api/governance/netbox-sources/${ORG_A}-source/sync-cached-vms`)
      .set("x-role", "operator")
      .set("x-org-id", ORG_A)
      .expect(200);
    await syncReq
      .post(`/api/governance/netbox-sources/${ORG_A}-secondary-source/sync-cached-vms`)
      .set("x-role", "operator")
      .set("x-org-id", ORG_A)
      .expect(200);

    assert.equal(storage.customerScopes.length, 2);
    assert.deepEqual(
      storage.customerScopes.map((scope) => `${scope.sourceId}:${scope.externalId}`).sort(),
      [`${ORG_A}-secondary-source:23`, `${ORG_A}-source:23`],
    );
    assert.equal(storage.customerScopeObjectAssignments.length, 2);
  });

  it("partial NetBox tenant does not create weak CustomerScope and records unassigned assignment", async () => {
    const syncReq = makeRequest(storage, {
      listNetboxVmsForSource: async () => [
        {
          id: 707,
          name: "alpha-partial-tenant-vm",
          tenant: { name: "Name Without Stable Id" },
          custom_fields: {},
          tags: [],
        },
      ],
    });

    const response = await syncReq
      .post(`/api/governance/netbox-sources/${ORG_A}-source/sync-cached-vms`)
      .set("x-role", "operator")
      .set("x-org-id", ORG_A)
      .expect(200);

    assert.equal(response.body.customerScopesUpserted, 0);
    assert.equal(response.body.customerUnassignedCount, 1);
    assert.equal(storage.customerScopes.length, 0);
    assert.equal(storage.customerScopeObjectAssignments.length, 1);
    assert.equal(storage.customerScopeObjectAssignments[0].relationship, "unassigned");
    assert.equal(storage.customerScopeObjectAssignments[0].customerScopeId, null);
  });

  it("CustomerScope persistence failure does not prevent cached VM upsert", async () => {
    storage.upsertCustomerScope = async () => {
      throw new Error("customer scope write failed");
    };
    const syncReq = makeRequest(storage, {
      listNetboxVmsForSource: async () => [
        {
          id: 708,
          name: "alpha-scope-failure-vm",
          tenant: { id: 24, name: "Scope Failure Tenant" },
          custom_fields: {},
          tags: [],
        },
      ],
    });

    const response = await syncReq
      .post(`/api/governance/netbox-sources/${ORG_A}-source/sync-cached-vms`)
      .set("x-role", "operator")
      .set("x-org-id", ORG_A)
      .expect(200);

    assert.equal(response.body.importedCount, 1);
    assert.equal(response.body.customerScopesUpserted, 0);
    assert.equal(response.body.customerAssignmentsUpserted, 0);
    assert.equal(response.body.customerScopeResolutionErrors, 1);
    assert.equal(storage.vms.length, 1);
    assert.equal(storage.customerScopes.length, 0);
    assert.equal(storage.customerScopeObjectAssignments.length, 0);
  });

  it("sync cached VMs rejects cross-org sources", async () => {
    const syncReq = makeRequest(storage, {
      listNetboxVmsForSource: async () => {
        throw new Error("should not fetch live NetBox for a cross-org source");
      },
    });

    await syncReq
      .post(`/api/governance/netbox-sources/${ORG_B}-source/sync-cached-vms`)
      .set("x-role", "operator")
      .set("x-org-id", ORG_A)
      .expect(404);

    assert.equal(storage.vms.length, 0);
  });

  it("evaluation after source sync evaluates cached VMs without another live NetBox call", async () => {
    let liveFetchCount = 0;
    const syncReq = makeRequest(storage, {
      listNetboxVmsForSource: async () => {
        liveFetchCount += 1;
        return [
          {
            id: 601,
            name: "alpha-synced-eval",
            primary_ip4: { address: "192.0.2.61/24" },
            platform: { name: "Linux" },
            custom_fields: {
              tenant: "alpha",
              role: "app",
              automatable: true,
              provider_state: "present",
              technical_owner: "platform",
              service_owner: "payments",
              data_owner: "cmdb",
              operations_team: "ops",
              business_owner: "finance",
            },
            tags: [],
          },
        ];
      },
    });
    const { blueprint } = await createDefaultBlueprint(syncReq, ORG_A);

    await syncReq
      .post(`/api/governance/netbox-sources/${ORG_A}-source/sync-cached-vms`)
      .set("x-role", "operator")
      .set("x-org-id", ORG_A)
      .expect(200);

    const response = await syncReq
      .post(`/api/governance/blueprints/${blueprint.id}/evaluate-cached-netbox-vms`)
      .set("x-role", "operator")
      .set("x-org-id", ORG_A)
      .expect(200);

    assert.equal(response.body.evaluatedCount, 1);
    assert.equal(storage.objectEvaluations[0].objectId, storage.vms[0].id);
    assert.equal(liveFetchCount, 1);
  });

  it("evaluation with netboxSourceId only evaluates VMs from that source", async () => {
    const { blueprint } = await createDefaultBlueprint(req, ORG_A);
    storage.vms.push(
      {
        id: "vm-alpha-primary",
        sourceId: `${ORG_A}-source`,
        netboxId: 121,
        name: "alpha-primary",
        ip: "192.0.2.12",
        operatingSystem: "linux",
        customFields: {
          tenant: "alpha",
          role: "app",
          automatable: true,
          provider_state: "present",
          technical_owner: "platform",
          service_owner: "payments",
          data_owner: "cmdb",
          operations_team: "ops",
          business_owner: "finance",
        },
        tags: [],
        lastImportedAt: new Date(),
      },
      {
        id: "vm-alpha-secondary",
        sourceId: `${ORG_A}-secondary-source`,
        netboxId: 122,
        name: "alpha-secondary",
        ip: "192.0.2.13",
        operatingSystem: "linux",
        customFields: {
          tenant: "alpha",
          role: "app",
          automatable: true,
          provider_state: "present",
          technical_owner: "platform",
          service_owner: "payments",
          data_owner: "cmdb",
          operations_team: "ops",
          business_owner: "finance",
        },
        tags: [],
        lastImportedAt: new Date(),
      },
    );

    const response = await req
      .post(`/api/governance/blueprints/${blueprint.id}/evaluate-cached-netbox-vms`)
      .set("x-role", "operator")
      .set("x-org-id", ORG_A)
      .send({ netboxSourceId: `${ORG_A}-secondary-source` })
      .expect(200);

    assert.equal(response.body.evaluatedCount, 1);
    assert.equal(storage.runs[0].netboxSourceId, `${ORG_A}-secondary-source`);
    assert.equal(storage.objectEvaluations.length, 1);
    assert.equal(storage.objectEvaluations[0].objectId, "vm-alpha-secondary");
    assert.equal(storage.netboxVmReadCount, 1);
  });

  it("evaluation defaults to the blueprint bound source", async () => {
    const { blueprint } = await createDefaultBlueprint(req, ORG_A);
    storage.vms.push(
      {
        id: "vm-alpha-bound-primary",
        sourceId: `${ORG_A}-source`,
        netboxId: 125,
        name: "alpha-bound-primary",
        ip: "192.0.2.16",
        operatingSystem: "linux",
        customFields: {
          tenant: "alpha",
          role: "app",
          automatable: true,
          provider_state: "present",
          technical_owner: "platform",
          service_owner: "payments",
          data_owner: "cmdb",
          operations_team: "ops",
          business_owner: "finance",
        },
        tags: [],
        lastImportedAt: new Date(),
      },
      {
        id: "vm-alpha-bound-secondary",
        sourceId: `${ORG_A}-secondary-source`,
        netboxId: 126,
        name: "alpha-bound-secondary",
        ip: "192.0.2.17",
        operatingSystem: "linux",
        customFields: {
          tenant: "alpha",
          role: "app",
          automatable: true,
          provider_state: "present",
          technical_owner: "platform",
          service_owner: "payments",
          data_owner: "cmdb",
          operations_team: "ops",
          business_owner: "finance",
        },
        tags: [],
        lastImportedAt: new Date(),
      },
    );

    const response = await req
      .post(`/api/governance/blueprints/${blueprint.id}/evaluate-cached-netbox-vms`)
      .set("x-role", "operator")
      .set("x-org-id", ORG_A)
      .expect(200);

    assert.equal(response.body.evaluatedCount, 1);
    assert.equal(storage.runs[0].netboxSourceId, `${ORG_A}-source`);
    assert.equal(storage.objectEvaluations[0].objectId, "vm-alpha-bound-primary");
  });

  it("source-bound evaluation with no cached VMs is rejected clearly", async () => {
    const { blueprint } = await createDefaultBlueprint(req, ORG_A);

    const response = await req
      .post(`/api/governance/blueprints/${blueprint.id}/evaluate-cached-netbox-vms`)
      .set("x-role", "operator")
      .set("x-org-id", ORG_A)
      .expect(400);

    assert.match(response.body.message, /No cached NetBox VMs/i);
    assert.equal(storage.runs.length, 0);
    assert.equal(storage.objectEvaluations.length, 0);
  });

  it("evaluation rejects cross-org netboxSourceId", async () => {
    const { blueprint } = await createDefaultBlueprint(req, ORG_A);

    await req
      .post(`/api/governance/blueprints/${blueprint.id}/evaluate-cached-netbox-vms`)
      .set("x-role", "operator")
      .set("x-org-id", ORG_A)
      .send({ netboxSourceId: `${ORG_B}-source` })
      .expect(404);

    assert.equal(storage.runs.length, 0);
    assert.equal(storage.objectEvaluations.length, 0);
  });

  it("omitted netboxSourceId preserves all cached NetBox VM evaluation behavior", async () => {
    const blueprintResponse = await req
      .post("/api/governance/blueprints")
      .set("x-role", "admin")
      .set("x-org-id", ORG_A)
      .send({ name: "Legacy Sourceless Blueprint", objectType: "netbox_vm" })
      .expect(201);
    const versionResponse = await req
      .post(`/api/governance/blueprints/${blueprintResponse.body.id}/versions`)
      .set("x-role", "admin")
      .set("x-org-id", ORG_A)
      .send({ rules: STANDARD_NETBOX_VM_GOVERNANCE_BLUEPRINT.rules })
      .expect(201);
    await req
      .post(`/api/governance/blueprints/${blueprintResponse.body.id}/activate`)
      .set("x-role", "admin")
      .set("x-org-id", ORG_A)
      .send({ versionId: versionResponse.body.id })
      .expect(200);

    storage.vms.push(
      {
        id: "vm-alpha-all-primary",
        sourceId: `${ORG_A}-source`,
        netboxId: 131,
        name: "alpha-all-primary",
        ip: "192.0.2.14",
        operatingSystem: "linux",
        customFields: {
          tenant: "alpha",
          role: "app",
          automatable: true,
          provider_state: "present",
          technical_owner: "platform",
          service_owner: "payments",
          data_owner: "cmdb",
          operations_team: "ops",
          business_owner: "finance",
        },
        tags: [],
        lastImportedAt: new Date(),
      },
      {
        id: "vm-alpha-all-secondary",
        sourceId: `${ORG_A}-secondary-source`,
        netboxId: 132,
        name: "alpha-all-secondary",
        ip: "192.0.2.15",
        operatingSystem: "linux",
        customFields: {
          tenant: "alpha",
          role: "app",
          automatable: true,
          provider_state: "present",
          technical_owner: "platform",
          service_owner: "payments",
          data_owner: "cmdb",
          operations_team: "ops",
          business_owner: "finance",
        },
        tags: [],
        lastImportedAt: new Date(),
      },
    );

    const response = await req
      .post(`/api/governance/blueprints/${blueprintResponse.body.id}/evaluate-cached-netbox-vms`)
      .set("x-role", "operator")
      .set("x-org-id", ORG_A)
      .expect(200);

    assert.equal(response.body.evaluatedCount, 2);
    assert.equal(storage.runs[0].netboxSourceId, null);
    assert.deepEqual(
      storage.objectEvaluations.map((evaluation) => evaluation.objectId).sort(),
      ["vm-alpha-all-primary", "vm-alpha-all-secondary"],
    );
  });

  it("viewer cannot run evaluation", async () => {
    const { blueprint } = await createDefaultBlueprint(req, ORG_A);

    await req
      .post(`/api/governance/blueprints/${blueprint.id}/evaluate-cached-netbox-vms`)
      .set("x-role", "viewer")
      .set("x-org-id", ORG_A)
      .expect(403);
  });

  it("org A cannot read org B blueprint", async () => {
    const { blueprint } = await createDefaultBlueprint(req, ORG_B);

    await req
      .get(`/api/governance/blueprints/${blueprint.id}`)
      .set("x-role", "viewer")
      .set("x-org-id", ORG_A)
      .expect(404);
  });

  it("org A cannot activate org B version", async () => {
    const { blueprint, activeVersion } = await createDefaultBlueprint(req, ORG_B);

    await req
      .post(`/api/governance/blueprints/${blueprint.id}/activate`)
      .set("x-role", "admin")
      .set("x-org-id", ORG_A)
      .send({ versionId: activeVersion.id })
      .expect(404);
  });

  it("activeVersionId cannot point to a version from another blueprint", async () => {
    const first = await createDefaultBlueprint(req, ORG_A);
    const secondResponse = await req
      .post("/api/governance/blueprints")
      .set("x-role", "admin")
      .set("x-org-id", ORG_A)
      .send({ name: "Second Blueprint", objectType: "netbox_vm" })
      .expect(201);
    const versionResponse = await req
      .post(`/api/governance/blueprints/${secondResponse.body.id}/versions`)
      .set("x-role", "admin")
      .set("x-org-id", ORG_A)
      .send({ rules: STANDARD_NETBOX_VM_GOVERNANCE_BLUEPRINT.rules })
      .expect(201);

    await req
      .post(`/api/governance/blueprints/${first.blueprint.id}/activate`)
      .set("x-role", "admin")
      .set("x-org-id", ORG_A)
      .send({ versionId: versionResponse.body.id })
      .expect(404);
  });

  it("cached NetBox VM with missing owner creates persisted finding output", async () => {
    const { blueprint } = await createDefaultBlueprint(req, ORG_A);
    storage.vms.push({
      id: "vm-alpha-missing-owner",
      sourceId: `${ORG_A}-source`,
      netboxId: 202,
      name: "alpha-missing-owner",
      ip: "192.0.2.20",
      operatingSystem: "linux",
      customFields: {
        tenant: "alpha",
        role: "app",
        automatable: true,
        provider_state: "present",
      },
      tags: [],
      lastImportedAt: new Date(),
    });

    const response = await req
      .post(`/api/governance/blueprints/${blueprint.id}/evaluate-cached-netbox-vms`)
      .set("x-role", "operator")
      .set("x-org-id", ORG_A)
      .expect(200);

    assert.equal(response.body.evaluatedCount, 1);
    assert.equal(storage.objectEvaluations.length, 1);
    const persisted = storage.objectEvaluations[0];
    assert.equal(persisted.objectId, "vm-alpha-missing-owner");
    assert.ok(persisted.findings.some((finding: any) => (
      finding.layer === "ownership" &&
      finding.role === "technical_owner"
    )));
    assert.ok(persisted.recommendedActions.includes("enrich"));
  });

  it("viewer can read the latest object evaluation without live NetBox reads", async () => {
    const { blueprint } = await createDefaultBlueprint(req, ORG_A);
    storage.vms.push({
      id: "vm-alpha-latest",
      sourceId: `${ORG_A}-source`,
      netboxId: 303,
      name: "alpha-latest",
      ip: "192.0.2.30",
      operatingSystem: "linux",
      customFields: {
        tenant: "alpha",
        role: "app",
        automatable: true,
        provider_state: "present",
        technical_owner: "platform",
        service_owner: "payments",
        data_owner: "cmdb",
        operations_team: "ops",
        business_owner: "finance",
      },
      tags: [],
      lastImportedAt: new Date(),
    });

    await req
      .post(`/api/governance/blueprints/${blueprint.id}/evaluate-cached-netbox-vms`)
      .set("x-role", "operator")
      .set("x-org-id", ORG_A)
      .expect(200);

    const netboxReadsBeforeLatestLookup = storage.netboxVmReadCount;
    const response = await req
      .get("/api/governance/objects/netbox_vm/vm-alpha-latest/latest-evaluation")
      .set("x-role", "viewer")
      .set("x-org-id", ORG_A)
      .expect(200);

    assert.equal(response.body.evaluation.objectId, "vm-alpha-latest");
    assert.equal(response.body.evaluation.externalId, "303");
    assert.equal(response.body.run.id, storage.runs[0].id);
    assert.equal(storage.netboxVmReadCount, netboxReadsBeforeLatestLookup);
  });

  it("latest object evaluation returns null when none exists", async () => {
    const response = await req
      .get("/api/governance/objects/netbox_vm/missing-vm/latest-evaluation")
      .set("x-role", "viewer")
      .set("x-org-id", ORG_A)
      .expect(200);

    assert.equal(response.body, null);
  });

  it("org A cannot read org B object evaluation", async () => {
    const { blueprint } = await createDefaultBlueprint(req, ORG_B);
    storage.vms.push({
      id: "vm-beta-private",
      sourceId: `${ORG_B}-source`,
      netboxId: 404,
      name: "beta-private",
      ip: "192.0.2.40",
      operatingSystem: "linux",
      customFields: {
        tenant: "beta",
        role: "app",
        automatable: true,
        provider_state: "present",
        technical_owner: "platform",
        service_owner: "payments",
        data_owner: "cmdb",
        operations_team: "ops",
        business_owner: "finance",
      },
      tags: [],
      lastImportedAt: new Date(),
    });

    await req
      .post(`/api/governance/blueprints/${blueprint.id}/evaluate-cached-netbox-vms`)
      .set("x-role", "operator")
      .set("x-org-id", ORG_B)
      .expect(200);

    const response = await req
      .get("/api/governance/objects/netbox_vm/vm-beta-private/latest-evaluation")
      .set("x-role", "viewer")
      .set("x-org-id", ORG_A)
      .expect(200);

    assert.equal(response.body, null);
  });

  it("latest object evaluation uses objectId and not VM name", async () => {
    const { blueprint } = await createDefaultBlueprint(req, ORG_A);
    storage.vms.push({
      id: "vm-object-id-only",
      sourceId: `${ORG_A}-source`,
      netboxId: 505,
      name: "shared-vm-name",
      ip: "192.0.2.50",
      operatingSystem: "linux",
      customFields: {
        tenant: "alpha",
        role: "app",
        automatable: true,
        provider_state: "present",
        technical_owner: "platform",
        service_owner: "payments",
        data_owner: "cmdb",
        operations_team: "ops",
        business_owner: "finance",
      },
      tags: [],
      lastImportedAt: new Date(),
    });

    await req
      .post(`/api/governance/blueprints/${blueprint.id}/evaluate-cached-netbox-vms`)
      .set("x-role", "operator")
      .set("x-org-id", ORG_A)
      .expect(200);

    const byNameResponse = await req
      .get("/api/governance/objects/netbox_vm/shared-vm-name/latest-evaluation")
      .set("x-role", "viewer")
      .set("x-org-id", ORG_A)
      .expect(200);
    const byIdResponse = await req
      .get("/api/governance/objects/netbox_vm/vm-object-id-only/latest-evaluation")
      .set("x-role", "viewer")
      .set("x-org-id", ORG_A)
      .expect(200);

    assert.equal(byNameResponse.body, null);
    assert.equal(byIdResponse.body.evaluation.objectId, "vm-object-id-only");
    assert.equal(byIdResponse.body.evaluation.objectName, "shared-vm-name");
  });
});

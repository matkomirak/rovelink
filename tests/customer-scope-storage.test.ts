import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type {
  CustomerScope,
  CustomerScopeObjectAssignment,
  InsertCustomerScope,
  InsertCustomerScopeObjectAssignment,
} from "../shared/schema";

class CustomerScopeMemoryStore {
  private scopes: CustomerScope[] = [];
  private assignments: CustomerScopeObjectAssignment[] = [];
  private nextScopeId = 1;
  private nextAssignmentId = 1;

  async createCustomerScope(input: InsertCustomerScope): Promise<CustomerScope> {
    const duplicate = await this.getCustomerScopeByExternalId(
      input.orgId,
      input.sourceType,
      input.sourceId,
      input.externalId,
    );
    if (duplicate) {
      throw new Error("duplicate customer scope external identity");
    }

    const now = new Date();
    const scope: CustomerScope = {
      id: `scope-${this.nextScopeId++}`,
      displayName: null,
      isolation: null,
      parentExternalId: null,
      metadata: null,
      lastSyncedAt: null,
      ...input,
      createdAt: now,
      updatedAt: now,
    };
    this.scopes.push(scope);
    return scope;
  }

  async upsertCustomerScope(input: InsertCustomerScope): Promise<CustomerScope> {
    const existing = await this.getCustomerScopeByExternalId(
      input.orgId,
      input.sourceType,
      input.sourceId,
      input.externalId,
    );
    if (!existing) return this.createCustomerScope(input);

    const updated = {
      ...existing,
      ...input,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };
    this.scopes = this.scopes.map((scope) => scope.id === existing.id ? updated : scope);
    return updated;
  }

  async listCustomerScopes(orgId: string, sourceType?: string, sourceId?: string): Promise<CustomerScope[]> {
    return this.scopes.filter((scope) => (
      scope.orgId === orgId &&
      (!sourceType || scope.sourceType === sourceType) &&
      (!sourceId || scope.sourceId === sourceId)
    ));
  }

  async getCustomerScope(id: string, orgId: string): Promise<CustomerScope | undefined> {
    return this.scopes.find((scope) => scope.id === id && scope.orgId === orgId);
  }

  async getCustomerScopeByExternalId(
    orgId: string,
    sourceType: string,
    sourceId: string,
    externalId: string,
  ): Promise<CustomerScope | undefined> {
    return this.scopes.find((scope) => (
      scope.orgId === orgId &&
      scope.sourceType === sourceType &&
      scope.sourceId === sourceId &&
      scope.externalId === externalId
    ));
  }

  async createCustomerScopeObjectAssignment(
    input: InsertCustomerScopeObjectAssignment,
  ): Promise<CustomerScopeObjectAssignment> {
    await this.assertAssignmentScope(input);
    const duplicate = this.findAssignment(input);
    if (duplicate) {
      throw new Error("duplicate customer scope object assignment");
    }

    const now = new Date();
    const assignment: CustomerScopeObjectAssignment = {
      id: `assignment-${this.nextAssignmentId++}`,
      customerScopeId: null,
      metadata: null,
      lastSyncedAt: null,
      ...input,
      createdAt: now,
      updatedAt: now,
    };
    this.assignments.push(assignment);
    return assignment;
  }

  async upsertCustomerScopeObjectAssignment(
    input: InsertCustomerScopeObjectAssignment,
  ): Promise<CustomerScopeObjectAssignment> {
    await this.assertAssignmentScope(input);
    const existing = this.findAssignment(input);
    if (!existing) return this.createCustomerScopeObjectAssignment(input);

    const updated = {
      ...existing,
      ...input,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };
    this.assignments = this.assignments.map((assignment) => assignment.id === existing.id ? updated : assignment);
    return updated;
  }

  async listCustomerScopeObjectAssignments(
    orgId: string,
    sourceType?: string,
    sourceId?: string,
  ): Promise<CustomerScopeObjectAssignment[]> {
    return this.assignments.filter((assignment) => (
      assignment.orgId === orgId &&
      (!sourceType || assignment.sourceType === sourceType) &&
      (!sourceId || assignment.sourceId === sourceId)
    ));
  }

  async listAssignmentsForObject(
    orgId: string,
    sourceType: string,
    sourceId: string,
    objectType: string,
    objectId: string,
  ): Promise<CustomerScopeObjectAssignment[]> {
    return this.assignments.filter((assignment) => (
      assignment.orgId === orgId &&
      assignment.sourceType === sourceType &&
      assignment.sourceId === sourceId &&
      assignment.objectType === objectType &&
      assignment.objectId === objectId
    ));
  }

  async listAssignmentsForCustomerScope(
    orgId: string,
    customerScopeId: string,
  ): Promise<CustomerScopeObjectAssignment[]> {
    const scope = await this.getCustomerScope(customerScopeId, orgId);
    if (!scope) return [];
    return this.assignments.filter((assignment) => (
      assignment.orgId === orgId &&
      assignment.customerScopeId === customerScopeId
    ));
  }

  private async assertAssignmentScope(input: InsertCustomerScopeObjectAssignment) {
    if (!input.customerScopeId) return;
    const scope = await this.getCustomerScope(input.customerScopeId, input.orgId);
    if (!scope || scope.sourceType !== input.sourceType || scope.sourceId !== input.sourceId) {
      throw new Error("assignment must reference a scope in the same organization and source");
    }
  }

  private findAssignment(input: InsertCustomerScopeObjectAssignment): CustomerScopeObjectAssignment | undefined {
    return this.assignments.find((assignment) => (
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

function makeScope(overrides: Partial<InsertCustomerScope> = {}): InsertCustomerScope {
  return {
    orgId: "org-a",
    sourceType: "netbox_inventory_source",
    sourceId: "source-a",
    externalId: "tenant-1",
    name: "Alpha",
    strategy: "tenant",
    isolation: "logical",
    metadata: null,
    ...overrides,
  };
}

function makeAssignment(overrides: Partial<InsertCustomerScopeObjectAssignment> = {}): InsertCustomerScopeObjectAssignment {
  return {
    orgId: "org-a",
    sourceType: "netbox_inventory_source",
    sourceId: "source-a",
    objectType: "netbox_vm",
    objectId: "cached-vm-1",
    customerScopeId: "scope-1",
    relationship: "dedicated",
    derivedFrom: "provider",
    confidence: "authoritative",
    metadata: null,
    ...overrides,
  };
}

describe("CustomerScope storage contract", () => {
  test("creates and lists customer scopes within an organization", async () => {
    const store = new CustomerScopeMemoryStore();
    const scope = await store.createCustomerScope(makeScope());

    assert.equal(scope.orgId, "org-a");
    assert.equal(scope.sourceId, "source-a");
    assert.deepEqual(await store.listCustomerScopes("org-a"), [scope]);
    assert.deepEqual(await store.listCustomerScopes("org-b"), []);
  });

  test("allows the same externalId and name in different sources", async () => {
    const store = new CustomerScopeMemoryStore();
    const first = await store.createCustomerScope(makeScope({ sourceId: "source-a", externalId: "tenant-1", name: "Alpha" }));
    const second = await store.createCustomerScope(makeScope({ sourceId: "source-b", externalId: "tenant-1", name: "Alpha" }));

    assert.notEqual(first.id, second.id);
    assert.equal((await store.listCustomerScopes("org-a")).length, 2);
  });

  test("rejects duplicate create but upserts within the same org and source", async () => {
    const store = new CustomerScopeMemoryStore();
    const original = await store.createCustomerScope(makeScope({ displayName: "Alpha old" }));

    await assert.rejects(
      () => store.createCustomerScope(makeScope({ displayName: "Alpha duplicate" })),
      /duplicate/,
    );

    const updated = await store.upsertCustomerScope(makeScope({ displayName: "Alpha new" }));
    assert.equal(updated.id, original.id);
    assert.equal(updated.displayName, "Alpha new");
  });

  test("rejects cross-org customer scope access", async () => {
    const store = new CustomerScopeMemoryStore();
    const scope = await store.createCustomerScope(makeScope({ orgId: "org-a" }));

    assert.equal(await store.getCustomerScope(scope.id, "org-b"), undefined);
    assert.equal(await store.getCustomerScopeByExternalId("org-b", scope.sourceType, scope.sourceId, scope.externalId), undefined);
  });

  test("creates dedicated and explicit unassigned assignments", async () => {
    const store = new CustomerScopeMemoryStore();
    const scope = await store.createCustomerScope(makeScope());
    const dedicated = await store.createCustomerScopeObjectAssignment(makeAssignment({ customerScopeId: scope.id }));
    const unassigned = await store.createCustomerScopeObjectAssignment(makeAssignment({
      objectId: "cached-vm-2",
      customerScopeId: null,
      relationship: "unassigned",
      derivedFrom: "manual",
      confidence: "manual",
    }));

    assert.equal(dedicated.relationship, "dedicated");
    assert.equal(unassigned.customerScopeId, null);
    assert.equal(unassigned.relationship, "unassigned");
    assert.notEqual(unassigned.relationship, "internal");
  });

  test("allows multiple shared customer scopes for the same object", async () => {
    const store = new CustomerScopeMemoryStore();
    const alpha = await store.createCustomerScope(makeScope({ externalId: "tenant-alpha", name: "Alpha" }));
    const beta = await store.createCustomerScope(makeScope({ externalId: "tenant-beta", name: "Beta" }));

    await store.createCustomerScopeObjectAssignment(makeAssignment({
      customerScopeId: alpha.id,
      relationship: "shared",
    }));
    await store.createCustomerScopeObjectAssignment(makeAssignment({
      customerScopeId: beta.id,
      relationship: "shared",
    }));

    const assignments = await store.listAssignmentsForObject("org-a", "netbox_inventory_source", "source-a", "netbox_vm", "cached-vm-1");
    assert.equal(assignments.length, 2);
    assert.deepEqual(assignments.map((assignment) => assignment.customerScopeId).sort(), [alpha.id, beta.id].sort());
  });

  test("updates duplicate assignment idempotently", async () => {
    const store = new CustomerScopeMemoryStore();
    const scope = await store.createCustomerScope(makeScope());
    const first = await store.upsertCustomerScopeObjectAssignment(makeAssignment({
      customerScopeId: scope.id,
      metadata: { revision: 1 },
    }));
    const second = await store.upsertCustomerScopeObjectAssignment(makeAssignment({
      customerScopeId: scope.id,
      metadata: { revision: 2 },
    }));

    assert.equal(second.id, first.id);
    assert.deepEqual(second.metadata, { revision: 2 });
    assert.equal((await store.listAssignmentsForCustomerScope("org-a", scope.id)).length, 1);
  });

  test("updates duplicate unassigned assignment idempotently", async () => {
    const store = new CustomerScopeMemoryStore();
    const first = await store.upsertCustomerScopeObjectAssignment(makeAssignment({
      objectId: "cached-vm-unassigned",
      customerScopeId: null,
      relationship: "unassigned",
      derivedFrom: "manual",
      confidence: "manual",
      metadata: { revision: 1 },
    }));
    const second = await store.upsertCustomerScopeObjectAssignment(makeAssignment({
      objectId: "cached-vm-unassigned",
      customerScopeId: null,
      relationship: "unassigned",
      derivedFrom: "manual",
      confidence: "manual",
      metadata: { revision: 2 },
    }));

    assert.equal(second.id, first.id);
    assert.equal(second.customerScopeId, null);
    assert.equal(second.relationship, "unassigned");
    assert.notEqual(second.relationship, "internal");
    assert.deepEqual(second.metadata, { revision: 2 });
    assert.equal(
      (await store.listAssignmentsForObject(
        "org-a",
        "netbox_inventory_source",
        "source-a",
        "netbox_vm",
        "cached-vm-unassigned",
      )).length,
      1,
    );
  });

  test("rejects direct duplicate unassigned assignment create in the storage contract", async () => {
    const store = new CustomerScopeMemoryStore();
    const unassigned = makeAssignment({
      objectId: "cached-vm-unassigned",
      customerScopeId: null,
      relationship: "unassigned",
      derivedFrom: "manual",
      confidence: "manual",
    });

    await store.createCustomerScopeObjectAssignment(unassigned);
    await assert.rejects(
      () => store.createCustomerScopeObjectAssignment(unassigned),
      /duplicate/,
    );
  });

  test("rejects assignment to a scope from a different org or source", async () => {
    const store = new CustomerScopeMemoryStore();
    const scope = await store.createCustomerScope(makeScope({ orgId: "org-a", sourceId: "source-a" }));

    await assert.rejects(
      () => store.createCustomerScopeObjectAssignment(makeAssignment({ orgId: "org-b", customerScopeId: scope.id })),
      /same organization and source/,
    );
    await assert.rejects(
      () => store.createCustomerScopeObjectAssignment(makeAssignment({ sourceId: "source-b", customerScopeId: scope.id })),
      /same organization and source/,
    );
  });
});

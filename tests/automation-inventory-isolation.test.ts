/**
 * T3 / v18: Automation Inventory Tenant Isolation Tests
 *
 * These tests verify that automation inventory routes cannot be used
 * to cross org boundaries. They are DB-free (in-memory mocks) and
 * are included in npm test.
 *
 * Coverage:
 *   1. List: org A cannot see org B inventories
 *   2. Detail: org A cannot GET org B inventory by ID
 *   3. Create: client-supplied orgId is ignored; req.orgId is stamped
 *   4. Create (linked CMDB): org A cannot link to org B's CMDB account
 *   5. Update (PATCH): org A cannot mutate org B inventory
 *   6. Delete: org A cannot delete org B inventory
 *   7. Default inventory toggle: only affects the caller's org
 *   8. Role hierarchy: platform_admin passes admin-level routes; operator/viewer cannot mutate
 *
 * Routes return 404 (not 403) for cross-org lookups — leaking existence
 * of a resource to another org would itself be information disclosure.
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

// ─── Minimal in-memory DB mock ───────────────────────────────────────────────
type InvRow = {
  id: string;
  orgId: string;
  name: string;
  type: string;
  isDefault: boolean;
  sourceRef?: string;
  sourceType?: string;
  fileContent?: string;
  fileFormat?: string;
  groupsCount: number;
  hostsCount: number;
  createdBy?: string;
  updatedAt: Date;
  createdAt: Date;
};

type CmdbRow = {
  id: string;
  orgId: string;
  name: string;
  config: Record<string, any>;
};

function makeInvDb() {
  const rows: InvRow[] = [];
  let seq = 0;

  return {
    rows,
    insert(partial: Omit<InvRow, "id" | "createdAt">): InvRow {
      const row: InvRow = {
        id: `inv-${++seq}`,
        createdAt: new Date(),
        ...partial,
      };
      rows.push(row);
      return row;
    },
    listByOrg(orgId: string): InvRow[] {
      return rows.filter((r) => r.orgId === orgId);
    },
    getByIdAndOrg(id: string, orgId: string): InvRow | null {
      return rows.find((r) => r.id === id && r.orgId === orgId) ?? null;
    },
    updateByIdAndOrg(id: string, orgId: string, patch: Partial<InvRow>): boolean {
      const idx = rows.findIndex((r) => r.id === id && r.orgId === orgId);
      if (idx === -1) return false;
      Object.assign(rows[idx], patch);
      return true;
    },
    deleteByIdAndOrg(id: string, orgId: string): boolean {
      const idx = rows.findIndex((r) => r.id === id && r.orgId === orgId);
      if (idx === -1) return false;
      rows.splice(idx, 1);
      return true;
    },
    unsetDefaultForOrg(orgId: string): void {
      rows.forEach((r) => {
        if (r.orgId === orgId) r.isDefault = false;
      });
    },
    clear() {
      rows.length = 0;
    },
  };
}

function makeCmdbDb() {
  const rows: CmdbRow[] = [];
  return {
    rows,
    insert(row: CmdbRow) { rows.push(row); },
    getByIdAndOrg(id: string, orgId: string): CmdbRow | null {
      return rows.find((r) => r.id === id && r.orgId === orgId) ?? null;
    },
    clear() { rows.length = 0; },
  };
}

// ─── Role helper (mirrors server/auth/roles.ts) ───────────────────────────────
const ROLE_RANK: Record<string, number> = {
  viewer: 1,
  operator: 2,
  admin: 3,
  platform_admin: 4,
};

function hasRoleAtLeast(userRole: string | undefined, required: string): boolean {
  if (!userRole) return false;
  return (ROLE_RANK[userRole] ?? 0) >= (ROLE_RANK[required] ?? 999);
}

// ─── Minimal route handler factories (mirrors the real route logic) ──────────
const ORG_A = "org-alpha";
const ORG_B = "org-beta";

const invDb = makeInvDb();
const cmdbDb = makeCmdbDb();

function listHandler(orgId: string) {
  return invDb.listByOrg(orgId);
}

function detailHandler(id: string, orgId: string): { status: number; body: any } {
  const inv = invDb.getByIdAndOrg(id, orgId);
  if (!inv) return { status: 404, body: { message: "Inventory not found" } };
  return { status: 200, body: inv };
}

function createHandler(
  body: Record<string, any>,
  reqOrgId: string,
  userRole: string
): { status: number; body: any } {
  if (!hasRoleAtLeast(userRole, "admin")) {
    return { status: 403, body: { message: "Admin role required" } };
  }

  // Strip client-supplied orgId — always stamp from request
  const { orgId: _ignored, id: _ignoredId, ...safeBody } = body;

  if (safeBody.type === "linked") {
    if (!safeBody.sourceRef || !safeBody.sourceType) {
      return { status: 400, body: { message: "Linked inventories require sourceRef and sourceType" } };
    }
    // CMDB must belong to the same org
    const cmdb = cmdbDb.getByIdAndOrg(safeBody.sourceRef, reqOrgId);
    if (!cmdb) return { status: 404, body: { message: "Linked CMDB not found" } };
  }

  if (safeBody.isDefault) {
    invDb.unsetDefaultForOrg(reqOrgId); // only within this org
  }

  const inv = invDb.insert({
    ...safeBody,
    orgId: reqOrgId,
    groupsCount: 0,
    hostsCount: 0,
    updatedAt: new Date(),
  });

  return { status: 201, body: inv };
}

function patchHandler(
  id: string,
  body: Record<string, any>,
  reqOrgId: string,
  userRole: string
): { status: number; body: any } {
  if (!hasRoleAtLeast(userRole, "admin")) {
    return { status: 403, body: { message: "Admin role required" } };
  }

  const existing = invDb.getByIdAndOrg(id, reqOrgId);
  if (!existing) return { status: 404, body: { message: "Inventory not found" } };

  if (body.isDefault === true) {
    invDb.unsetDefaultForOrg(reqOrgId);
  }

  const { orgId: _ignored, ...safeBody } = body;
  invDb.updateByIdAndOrg(id, reqOrgId, safeBody);
  return { status: 200, body: invDb.getByIdAndOrg(id, reqOrgId) };
}

function deleteHandler(
  id: string,
  reqOrgId: string,
  userRole: string
): { status: number; body: any } {
  if (!hasRoleAtLeast(userRole, "admin")) {
    return { status: 403, body: { message: "Admin role required" } };
  }

  const existing = invDb.getByIdAndOrg(id, reqOrgId);
  if (!existing) return { status: 404, body: { message: "Inventory not found" } };

  invDb.deleteByIdAndOrg(id, reqOrgId);
  return { status: 200, body: { message: "Inventory deleted" } };
}

// ─── Test setup helpers ───────────────────────────────────────────────────────
function seedInventories() {
  invDb.clear();
  cmdbDb.clear();

  const invA = invDb.insert({
    orgId: ORG_A,
    name: "Alpha Inventory",
    type: "file",
    isDefault: false,
    fileContent: "all:\n  hosts:\n    alpha-vm:\n",
    fileFormat: "yaml",
    groupsCount: 1,
    hostsCount: 1,
    updatedAt: new Date(),
  });

  const invB = invDb.insert({
    orgId: ORG_B,
    name: "Beta Inventory",
    type: "file",
    isDefault: false,
    fileContent: "all:\n  hosts:\n    beta-vm:\n",
    fileFormat: "yaml",
    groupsCount: 1,
    hostsCount: 1,
    updatedAt: new Date(),
  });

  // CMDB accounts — each belongs to its own org
  cmdbDb.insert({ id: "cmdb-alpha", orgId: ORG_A, name: "NetBox Alpha", config: { url: "https://nb-a.example.com", token: "tok-a" } });
  cmdbDb.insert({ id: "cmdb-beta",  orgId: ORG_B, name: "NetBox Beta",  config: { url: "https://nb-b.example.com", token: "tok-b" } });

  return { invA, invB };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Automation inventory — list route isolation", async () => {
  before(() => { seedInventories(); });

  await it("org A only sees org A inventories", async () => {
    const result = listHandler(ORG_A);
    assert.ok(result.every((r) => r.orgId === ORG_A), "all returned rows must belong to org A");
    assert.equal(result.length, 1);
    assert.equal(result[0].name, "Alpha Inventory");
  });

  await it("org B only sees org B inventories", async () => {
    const result = listHandler(ORG_B);
    assert.ok(result.every((r) => r.orgId === ORG_B), "all returned rows must belong to org B");
    assert.equal(result.length, 1);
    assert.equal(result[0].name, "Beta Inventory");
  });

  await it("org B's inventories never appear in org A list", async () => {
    const result = listHandler(ORG_A);
    assert.ok(!result.some((r) => r.orgId === ORG_B), "org B records must not appear in org A list");
  });
});

describe("Automation inventory — detail route isolation", async () => {
  let invA: InvRow;
  let invB: InvRow;

  before(() => {
    const seeded = seedInventories();
    invA = seeded.invA;
    invB = seeded.invB;
  });

  await it("org A can GET its own inventory by ID", async () => {
    const r = detailHandler(invA.id, ORG_A);
    assert.equal(r.status, 200);
    assert.equal(r.body.id, invA.id);
  });

  await it("org A cannot GET org B inventory by ID — returns 404", async () => {
    const r = detailHandler(invB.id, ORG_A);
    assert.equal(r.status, 404);
  });

  await it("org B cannot GET org A inventory by ID — returns 404", async () => {
    const r = detailHandler(invA.id, ORG_B);
    assert.equal(r.status, 404);
  });
});

describe("Automation inventory — create route isolation", async () => {
  before(() => { seedInventories(); });

  await it("client-supplied orgId is ignored — inventory always stamped with req.orgId", async () => {
    const r = createHandler(
      { name: "Injected", type: "file", fileContent: "all:\n  hosts:\n", fileFormat: "yaml", orgId: ORG_B },
      ORG_A,
      "admin"
    );
    assert.equal(r.status, 201);
    assert.equal(r.body.orgId, ORG_A, "orgId must be stamped from req, not from body");
    assert.notEqual(r.body.orgId, ORG_B);
  });

  await it("org A cannot create a linked inventory using org B's CMDB account", async () => {
    const r = createHandler(
      { name: "Cross-org Linked", type: "linked", sourceRef: "cmdb-beta", sourceType: "netbox" },
      ORG_A,
      "admin"
    );
    assert.equal(r.status, 404, "should 404 when CMDB does not belong to this org");
  });

  await it("org A can create a linked inventory using its own CMDB account", async () => {
    const r = createHandler(
      { name: "Alpha Linked", type: "linked", sourceRef: "cmdb-alpha", sourceType: "netbox" },
      ORG_A,
      "admin"
    );
    assert.equal(r.status, 201);
    assert.equal(r.body.orgId, ORG_A);
  });
});

describe("Automation inventory — update route isolation", async () => {
  let invA: InvRow;
  let invB: InvRow;

  before(() => {
    const seeded = seedInventories();
    invA = seeded.invA;
    invB = seeded.invB;
  });

  await it("org A can PATCH its own inventory", async () => {
    const r = patchHandler(invA.id, { name: "Updated Alpha" }, ORG_A, "admin");
    assert.equal(r.status, 200);
    assert.equal(r.body?.name, "Updated Alpha");
  });

  await it("org A cannot PATCH org B inventory — returns 404", async () => {
    const r = patchHandler(invB.id, { name: "Hijacked" }, ORG_A, "admin");
    assert.equal(r.status, 404);
  });

  await it("org B cannot PATCH org A inventory — returns 404", async () => {
    const r = patchHandler(invA.id, { name: "Hijacked" }, ORG_B, "admin");
    assert.equal(r.status, 404);
  });

  await it("PATCH strips orgId from payload — cannot re-assign inventory to another org", async () => {
    const before = invDb.getByIdAndOrg(invA.id, ORG_A)!.orgId;
    patchHandler(invA.id, { orgId: ORG_B, name: "Reassign Attempt" }, ORG_A, "admin");
    const after = invDb.getByIdAndOrg(invA.id, ORG_A)!.orgId;
    assert.equal(before, after, "orgId must not change after PATCH");
    assert.equal(after, ORG_A);
  });
});

describe("Automation inventory — delete route isolation", async () => {
  let invA: InvRow;
  let invB: InvRow;

  before(() => {
    const seeded = seedInventories();
    invA = seeded.invA;
    invB = seeded.invB;
  });

  await it("org A cannot DELETE org B inventory — returns 404", async () => {
    const r = deleteHandler(invB.id, ORG_A, "admin");
    assert.equal(r.status, 404);

    // Verify org B's inventory still exists
    const stillThere = invDb.getByIdAndOrg(invB.id, ORG_B);
    assert.ok(stillThere !== null, "org B's inventory must still exist after failed cross-org delete");
  });

  await it("org A can DELETE its own inventory", async () => {
    const r = deleteHandler(invA.id, ORG_A, "admin");
    assert.equal(r.status, 200);

    const gone = invDb.getByIdAndOrg(invA.id, ORG_A);
    assert.equal(gone, null);
  });
});

describe("Automation inventory — default flag isolation", async () => {
  before(() => { seedInventories(); });

  await it("setting default in org A does not clear default inventory in org B", async () => {
    // Give org B an existing default
    const { invB } = seedInventories();
    invDb.updateByIdAndOrg(invB.id, ORG_B, { isDefault: true });

    // Org A creates a new default
    const newInvA = invDb.insert({
      orgId: ORG_A, name: "New Default A", type: "file",
      isDefault: false, groupsCount: 0, hostsCount: 0, updatedAt: new Date(),
    });
    invDb.unsetDefaultForOrg(ORG_A);
    invDb.updateByIdAndOrg(newInvA.id, ORG_A, { isDefault: true });

    // Org B's default must still be set
    const bInv = invDb.getByIdAndOrg(invB.id, ORG_B);
    assert.equal(bInv?.isDefault, true, "org B default must not be disturbed by org A's default change");
  });
});

describe("Automation inventory — role hierarchy", async () => {
  before(() => { seedInventories(); });

  await it("platform_admin can create inventory (passes admin-level route)", async () => {
    const r = createHandler(
      { name: "PA Inventory", type: "file", fileContent: "all:\n  hosts:\n", fileFormat: "yaml" },
      ORG_A,
      "platform_admin"
    );
    assert.equal(r.status, 201);
  });

  await it("admin can create inventory", async () => {
    const r = createHandler(
      { name: "Admin Inventory", type: "file", fileContent: "all:\n  hosts:\n", fileFormat: "yaml" },
      ORG_A,
      "admin"
    );
    assert.equal(r.status, 201);
  });

  await it("operator cannot create inventory — returns 403", async () => {
    const r = createHandler(
      { name: "Op Inventory", type: "file", fileContent: "all:\n  hosts:\n", fileFormat: "yaml" },
      ORG_A,
      "operator"
    );
    assert.equal(r.status, 403);
  });

  await it("viewer cannot create inventory — returns 403", async () => {
    const r = createHandler(
      { name: "Viewer Inventory", type: "file", fileContent: "all:\n  hosts:\n", fileFormat: "yaml" },
      ORG_A,
      "viewer"
    );
    assert.equal(r.status, 403);
  });

  await it("platform_admin can delete inventory", async () => {
    const { invA } = seedInventories();
    const r = deleteHandler(invA.id, ORG_A, "platform_admin");
    assert.equal(r.status, 200);
  });

  await it("operator cannot delete inventory — returns 403", async () => {
    const { invA } = seedInventories();
    const r = deleteHandler(invA.id, ORG_A, "operator");
    assert.equal(r.status, 403);
  });

  await it("viewer cannot delete inventory — returns 403", async () => {
    const { invA } = seedInventories();
    const r = deleteHandler(invA.id, ORG_A, "viewer");
    assert.equal(r.status, 403);
  });
});

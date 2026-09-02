import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GovernanceObjectEvaluation, NetboxVm } from "../shared/schema";
import { CUSTOMER_SCOPE_DEMO_SCOPES, selectCustomerScopeDemoVms } from "../server/scripts/seed-customer-scope-demo";

function vm(id: string, name: string): NetboxVm {
  return {
    id,
    sourceId: "cmdb-local",
    netboxId: Number(id.replace(/\D/g, "")) || 1,
    name,
    ip: null,
    operatingSystem: null,
    customFields: {},
    tags: [],
    lastImportedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

function evaluation(objectId: string): GovernanceObjectEvaluation {
  return {
    id: `eval-${objectId}`,
    orgId: "org-1",
    runId: "run-1",
    blueprintId: "blueprint-1",
    blueprintVersionId: "version-1",
    objectType: "netbox_vm",
    objectId,
    externalId: objectId,
    objectName: objectId,
    governanceScore: 90,
    dataManagementScore: 90,
    ownershipScore: 90,
    relevanceWeightedPriority: 10,
    automationReady: true,
    findings: [],
    recommendedActions: [],
    result: {
      objectType: "netbox_vm",
      objectId,
      objectName: objectId,
      scores: {
        governance: 90,
        dataManagement: 90,
        ownership: 90,
        relevanceWeightedPriority: 10,
      },
      automationReadiness: {
        ready: true,
        reasons: [],
      },
      findings: [],
      recommendedActions: [],
    },
    objectSnapshot: {},
    evaluatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

describe("CustomerScope demo seed helpers", () => {
  it("defines the required visible CustomerScope scenarios", () => {
    assert.deepEqual(
      CUSTOMER_SCOPE_DEMO_SCOPES.map((scope) => scope.name),
      ["ACME GmbH", "Customer B", "Customer C", "Customer D"],
    );
  });

  it("selects five local cached VM ids and keeps one VM unevaluated", () => {
    const cachedVms = [
      vm("vm-1", "alpha"),
      vm("vm-2", "bravo"),
      vm("vm-3", "charlie"),
      vm("vm-4", "delta"),
      vm("vm-5", "echo"),
      vm("vm-6", "foxtrot"),
    ];
    const selected = selectCustomerScopeDemoVms(cachedVms, [
      evaluation("vm-1"),
      evaluation("vm-2"),
      evaluation("vm-3"),
      evaluation("vm-4"),
      evaluation("vm-6"),
    ]);

    assert.ok(selected);
    assert.equal(selected.unevaluated.id, "vm-5");
    assert.equal(new Set(Object.values(selected).map((selectedVm) => selectedVm.id)).size, 5);
  });

  it("does not select a scenario when no unevaluated cached VM is available", () => {
    const cachedVms = [
      vm("vm-1", "alpha"),
      vm("vm-2", "bravo"),
      vm("vm-3", "charlie"),
      vm("vm-4", "delta"),
      vm("vm-5", "echo"),
    ];

    assert.equal(selectCustomerScopeDemoVms(cachedVms, cachedVms.map((item) => evaluation(item.id))), null);
  });
});

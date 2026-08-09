import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  enrichGateDecisionsWithGovernance,
  enrichInventoryHostsWithGovernance,
} from "../server/services/gate-governance-context";
import type { GateDecision } from "../server/services/gate-store";
import type { GovernanceObjectEvaluation, NetboxVm } from "../shared/schema";

const ORG_ID = "org-alpha";

function makeDecision(overrides: Partial<GateDecision> = {}): GateDecision {
  return {
    orgId: ORG_ID,
    assetId: "asset-1",
    vmName: "demo-vm-001",
    netboxVmId: 101,
    allowed: false,
    missing: ["automatable"],
    evaluatedAt: new Date("2026-08-01T12:00:00Z"),
    cmdbAccountId: "cmdb-1",
    reason: "Missing required governance fields: automatable",
    failureType: "governance",
    ...overrides,
  };
}

function makeVm(overrides: Partial<NetboxVm> = {}): NetboxVm {
  return {
    id: "cached-vm-1",
    sourceId: "source-1",
    netboxId: 101,
    name: "demo-vm-001",
    ip: "192.0.2.10",
    operatingSystem: "Linux",
    customFields: {},
    tags: [],
    lastImportedAt: new Date("2026-08-01T11:00:00Z"),
    ...overrides,
  };
}

function makeEvaluation(overrides: Partial<GovernanceObjectEvaluation> = {}): GovernanceObjectEvaluation {
  return {
    id: "gov-eval-1",
    orgId: ORG_ID,
    runId: "gov-run-1",
    blueprintId: "blueprint-1",
    blueprintVersionId: "version-1",
    objectType: "netbox_vm",
    objectId: "cached-vm-1",
    externalId: "101",
    objectName: "demo-vm-001",
    governanceScore: 82,
    dataManagementScore: 75,
    ownershipScore: 90,
    relevanceWeightedPriority: 6,
    automationReady: false,
    findings: [{ severity: "warning", message: "Missing service owner" }],
    recommendedActions: ["report", "validate"],
    result: {},
    objectSnapshot: {},
    evaluatedAt: new Date("2026-08-01T12:30:00Z"),
    ...overrides,
  };
}

function makeStorage(vms: NetboxVm[], evaluations: GovernanceObjectEvaluation[]) {
  let getNetboxVmsCalls = 0;
  let latestEvaluationCalls = 0;

  return {
    get calls() {
      return { getNetboxVmsCalls, latestEvaluationCalls };
    },
    async getNetboxVms(orgId: string) {
      getNetboxVmsCalls += 1;
      return vms.filter((vm) => orgId === ORG_ID && vm.sourceId);
    },
    async getLatestGovernanceEvaluationForObject(orgId: string, objectType: string, objectId: string) {
      latestEvaluationCalls += 1;
      const evaluation = evaluations.find((item) => (
        item.orgId === orgId &&
        item.objectType === objectType &&
        item.objectId === objectId
      ));
      return evaluation ? { evaluation, run: null } : undefined;
    },
  };
}

describe("gate governance context", () => {
  it("includes governance metadata without changing the gate decision", async () => {
    const decision = makeDecision({ allowed: true, missing: [], reason: "All gate requirements met" });
    const storage = makeStorage([makeVm()], [makeEvaluation({ automationReady: true, recommendedActions: ["ignore"] })]);

    const [enriched] = await enrichGateDecisionsWithGovernance(storage, ORG_ID, [decision]);

    assert.equal(enriched.allowed, decision.allowed);
    assert.deepEqual(enriched.missing, decision.missing);
    assert.equal(enriched.reason, decision.reason);
    assert.equal(enriched.governance?.governanceScore, 82);
    assert.equal(enriched.governance?.automationReadiness, true);
    assert.equal(enriched.governance?.latestGovernanceEvaluationId, "gov-eval-1");
    assert.equal(enriched.governance?.latestGovernanceEvaluationRunId, "gov-run-1");
  });

  it("does not break gate output when no governance evaluation exists", async () => {
    const decision = makeDecision();
    const storage = makeStorage([makeVm()], []);

    const [enriched] = await enrichGateDecisionsWithGovernance(storage, ORG_ID, [decision]);

    assert.equal(enriched.allowed, false);
    assert.deepEqual(enriched.missing, ["automatable"]);
    assert.equal(enriched.governance, null);
  });

  it("uses cached NetBox VM id to look up governance metadata, not the VM name", async () => {
    const storage = makeStorage(
      [makeVm({ id: "cached-vm-correct" })],
      [
        makeEvaluation({
          id: "wrong-name-eval",
          objectId: "demo-vm-001",
          governanceScore: 5,
        }),
        makeEvaluation({
          id: "correct-object-eval",
          objectId: "cached-vm-correct",
          governanceScore: 91,
        }),
      ],
    );

    const [enriched] = await enrichGateDecisionsWithGovernance(storage, ORG_ID, [makeDecision()]);

    assert.equal(enriched.governance?.latestGovernanceEvaluationId, "correct-object-eval");
    assert.equal(enriched.governance?.governanceScore, 91);
  });

  it("prefers explicit governanceObjectId over source NetBox id and VM name", async () => {
    const storage = makeStorage(
      [
        makeVm({ id: "cached-vm-wrong", netboxId: 101, name: "demo-vm-001" }),
        makeVm({ id: "cached-vm-correct", netboxId: 202, name: "renamed-vm" }),
      ],
      [
        makeEvaluation({ id: "wrong-eval", objectId: "cached-vm-wrong", governanceScore: 10 }),
        makeEvaluation({ id: "correct-eval", objectId: "cached-vm-correct", governanceScore: 97 }),
      ],
    );

    const [enriched] = await enrichGateDecisionsWithGovernance(storage, ORG_ID, [
      makeDecision({
        vmName: "demo-vm-001",
        netboxVmId: 101,
        sourceNetboxId: 101,
        governanceObjectType: "netbox_vm",
        governanceObjectId: "cached-vm-correct",
      }),
    ]);

    assert.equal(enriched.governance?.latestGovernanceEvaluationId, "correct-eval");
    assert.equal(enriched.governance?.governanceScore, 97);
  });

  it("does not use VM name fallback when governanceObjectId exists on inventory hosts", async () => {
    const storage = makeStorage(
      [
        makeVm({ id: "cached-vm-wrong", netboxId: 101, name: "demo-vm-001" }),
        makeVm({ id: "cached-vm-correct", netboxId: 202, name: "other-name" }),
      ],
      [
        makeEvaluation({ id: "wrong-name-eval", objectId: "cached-vm-wrong", governanceScore: 12 }),
        makeEvaluation({ id: "explicit-id-eval", objectId: "cached-vm-correct", governanceScore: 88 }),
      ],
    );

    const [host] = await enrichInventoryHostsWithGovernance(storage, ORG_ID, [
      {
        name: "demo-vm-001",
        governanceObjectType: "netbox_vm" as const,
        governanceObjectId: "cached-vm-correct",
        sourceNetboxId: 101,
        groups: ["linux"],
        vars: {},
      },
    ]);

    assert.equal(host.governance?.latestGovernanceEvaluationId, "explicit-id-eval");
    assert.equal(host.governance?.governanceScore, 88);
  });

  it("adds governance context to cached inventory hosts using cached data only", async () => {
    const storage = makeStorage([makeVm()], [makeEvaluation()]);

    const [host] = await enrichInventoryHostsWithGovernance(storage, ORG_ID, [
      { name: "demo-vm-001", groups: ["linux"], vars: {} },
    ]);

    assert.equal(host.governance?.governanceScore, 82);
    assert.equal(storage.calls.getNetboxVmsCalls, 1);
    assert.equal(storage.calls.latestEvaluationCalls, 1);
  });

  it("keeps gate block reason unchanged when governance recommends blocking automation", async () => {
    const decision = makeDecision({
      allowed: true,
      missing: [],
      reason: "All gate requirements met",
      governanceObjectType: "netbox_vm",
      governanceObjectId: "cached-vm-1",
    });
    const storage = makeStorage(
      [makeVm()],
      [makeEvaluation({ automationReady: false, recommendedActions: ["block_automation"] })],
    );

    const [enriched] = await enrichGateDecisionsWithGovernance(storage, ORG_ID, [decision]);

    assert.equal(enriched.allowed, true);
    assert.equal(enriched.reason, "All gate requirements met");
    assert.deepEqual(enriched.missing, []);
    assert.deepEqual(enriched.governance?.recommendedActions, ["block_automation"]);
  });
});

/**
 * T008: Gate Tenant Isolation Tests
 *
 * Verifies that the gate store:
 *   1. Never leaks decisions from org A to org B
 *   2. Scopes allow/block lists strictly to the requesting org
 *   3. Correctly handles orgId in all public methods
 *   4. Returns empty results for an org with no decisions (not another org's data)
 *
 * These tests are DB-free: the gate store is an in-memory singleton.
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { gateStore } from "../server/services/gate-store";

const ORG_A = "org-alpha";
const ORG_B = "org-beta";

const makeDecision = (
  orgId: string,
  assetId: string,
  vmName: string,
  allowed: boolean,
  missing: string[] = []
) =>
  ({
    orgId,
    assetId,
    vmName,
    netboxVmId: Math.floor(Math.random() * 10000),
    allowed,
    missing,
    evaluatedAt: new Date(),
    reason: allowed ? "All gate requirements met" : `Missing: ${missing.join(", ")}`,
    failureType: allowed ? undefined : ("missing_fields" as const),
  } as const);

async function clearOrgs() {
  await gateStore.deleteAllDecisions(ORG_A);
  await gateStore.deleteAllDecisions(ORG_B);
}

describe("Gate store — org isolation", async () => {
  before(async () => {
    await clearOrgs();
  });

  await it("storeDecision scopes to orgId key — decisions never share state", async () => {
    await clearOrgs();
    await gateStore.storeDecision(makeDecision(ORG_A, "vm-1", "alpha-vm1", true));
    await gateStore.storeDecision(makeDecision(ORG_B, "vm-1", "beta-vm1", false, ["tenant"]));

    const decA = await gateStore.getDecision(ORG_A, "vm-1");
    const decB = await gateStore.getDecision(ORG_B, "vm-1");

    assert.ok(decA !== null, "org A decision should exist");
    assert.equal(decA!.vmName, "alpha-vm1");
    assert.equal(decA!.allowed, true);

    assert.ok(decB !== null, "org B decision should exist");
    assert.equal(decB!.vmName, "beta-vm1");
    assert.equal(decB!.allowed, false);
  });

  await it("getAllowedVms returns only this org's allowed VMs", async () => {
    await clearOrgs();
    await gateStore.storeDecision(makeDecision(ORG_A, "a-vm1", "allowed-in-A", true));
    await gateStore.storeDecision(makeDecision(ORG_A, "a-vm2", "blocked-in-A", false, ["role"]));
    await gateStore.storeDecision(makeDecision(ORG_B, "b-vm1", "allowed-in-B", true));
    await gateStore.storeDecision(makeDecision(ORG_B, "b-vm2", "allowed-in-B-2", true));

    const allowedA = await gateStore.getAllowedVms(ORG_A);
    const allowedB = await gateStore.getAllowedVms(ORG_B);

    assert.equal(allowedA.length, 1);
    assert.equal(allowedA[0].vmName, "allowed-in-A");

    assert.equal(allowedB.length, 2);
    assert.deepEqual(allowedB.map((v) => v.vmName).sort(), ["allowed-in-B", "allowed-in-B-2"]);
  });

  await it("getBlockedVms never returns another org's blocked VMs", async () => {
    await clearOrgs();
    await gateStore.storeDecision(makeDecision(ORG_A, "a-blocked", "blocked-alpha", false, ["tenant"]));
    await gateStore.storeDecision(makeDecision(ORG_B, "b-allowed", "allowed-beta", true));

    const blockedA = await gateStore.getBlockedVms(ORG_A);
    const blockedB = await gateStore.getBlockedVms(ORG_B);

    assert.equal(blockedA.length, 1);
    assert.equal(blockedA[0].vmName, "blocked-alpha");
    assert.equal(blockedB.length, 0);

    const allB = await gateStore.getAllDecisions(ORG_B);
    const names = allB.map((d) => d.vmName);
    assert.ok(!names.includes("blocked-alpha"), "org B should not see org A blocked VMs");
  });

  await it("deleteAllDecisions(orgId) only clears that org's decisions", async () => {
    await clearOrgs();
    await gateStore.storeDecision(makeDecision(ORG_A, "a1", "alpha-1", true));
    await gateStore.storeDecision(makeDecision(ORG_A, "a2", "alpha-2", false, ["role"]));
    await gateStore.storeDecision(makeDecision(ORG_B, "b1", "beta-1", true));

    await gateStore.deleteAllDecisions(ORG_A);

    const decisionsA = await gateStore.getAllDecisions(ORG_A);
    const decisionsB = await gateStore.getAllDecisions(ORG_B);

    assert.equal(decisionsA.length, 0);
    assert.equal(decisionsB.length, 1);
    assert.equal(decisionsB[0].vmName, "beta-1");
  });

  await it("getSummary counts are scoped per org", async () => {
    await clearOrgs();
    await gateStore.storeDecision(makeDecision(ORG_A, "a1", "a-allowed", true));
    await gateStore.storeDecision(makeDecision(ORG_A, "a2", "a-blocked", false, ["automatable"]));
    await gateStore.storeDecision(makeDecision(ORG_A, "a3", "a-blocked2", false, ["tenant", "role"]));
    await gateStore.storeDecision(makeDecision(ORG_B, "b1", "b-allowed", true));

    const summaryA = await gateStore.getSummary(ORG_A);
    const summaryB = await gateStore.getSummary(ORG_B);

    assert.equal(summaryA.allowed, 1);
    assert.equal(summaryA.blocked, 2);
    assert.equal(summaryB.allowed, 1);
    assert.equal(summaryB.blocked, 0);
  });

  await it("isEvaluationComplete is scoped per org", async () => {
    await clearOrgs();
    assert.equal(gateStore.isEvaluationComplete(ORG_A), false);
    assert.equal(gateStore.isEvaluationComplete(ORG_B), false);

    gateStore.markEvaluationComplete(ORG_A);

    assert.equal(gateStore.isEvaluationComplete(ORG_A), true);
    assert.equal(gateStore.isEvaluationComplete(ORG_B), false);
  });

  await it("getDecision with wrong orgId returns null even if assetId exists", async () => {
    await clearOrgs();
    await gateStore.storeDecision(makeDecision(ORG_A, "shared-asset-id", "alpha-vm", true));

    const result = await gateStore.getDecision(ORG_B, "shared-asset-id");
    assert.equal(result, null);
  });

  await it("getDecisionByVmName scoped to org — cannot see other org's VMs by name", async () => {
    await clearOrgs();
    await gateStore.storeDecision(makeDecision(ORG_A, "vm-123", "web-server-01", true));
    await gateStore.storeDecision(makeDecision(ORG_B, "vm-456", "db-server-01", false, ["tenant"]));

    const resultB = await gateStore.getDecisionByVmName(ORG_B, "web-server-01");
    assert.equal(resultB, null);

    const resultA = await gateStore.getDecisionByVmName(ORG_A, "db-server-01");
    assert.equal(resultA, null);

    const ownA = await gateStore.getDecisionByVmName(ORG_A, "web-server-01");
    assert.ok(ownA !== null);
    assert.equal(ownA!.vmName, "web-server-01");
  });

  await it("getLastEvaluationTime is scoped per org", async () => {
    await clearOrgs();
    const before = new Date();
    gateStore.markEvaluationComplete(ORG_A);

    const timeA = gateStore.getLastEvaluationTime(ORG_A);
    const timeB = gateStore.getLastEvaluationTime(ORG_B);

    assert.ok(timeA !== null);
    assert.ok(timeA!.getTime() >= before.getTime());
    assert.equal(timeB, null);
  });

  await it("concurrent orgs do not interfere during simultaneous evaluation", async () => {
    await clearOrgs();
    const promises = [
      ...Array.from({ length: 5 }, (_, i) =>
        gateStore.storeDecision(makeDecision(ORG_A, `a-vm-${i}`, `alpha-${i}`, i % 2 === 0))
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        gateStore.storeDecision(makeDecision(ORG_B, `b-vm-${i}`, `beta-${i}`, i % 3 === 0))
      ),
    ];

    await Promise.all(promises);

    const decisionsA = await gateStore.getAllDecisions(ORG_A);
    const decisionsB = await gateStore.getAllDecisions(ORG_B);

    assert.equal(decisionsA.length, 5);
    assert.equal(decisionsB.length, 5);

    for (const d of decisionsA) {
      assert.match(d.vmName, /^alpha-/);
    }
    for (const d of decisionsB) {
      assert.match(d.vmName, /^beta-/);
    }
  });
});

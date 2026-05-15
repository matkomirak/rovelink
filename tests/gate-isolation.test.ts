/**
 * T008 / v17: Gate & Provider Hint Tenant Isolation Tests
 *
 * Verifies that:
 *   1. The gate store never leaks decisions from org A to org B
 *   2. Provider hints are fully org-scoped — org B cannot see org A's hints by VM name
 *   3. All hint store methods (getHintsByVmName, getHintsByProviderId,
 *      getAllHintsForProvider, deleteHintsForProvider) are org-scoped
 *
 * These tests are DB-free: both stores are in-memory singletons.
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { gateStore } from "../server/services/gate-store";
import { providerHintsStore } from "../server/services/provider-hints-store";
import type { ProviderHints } from "../server/services/providers/types";

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

const makeHints = (vmName: string): ProviderHints => ({
  vmName,
  providerId: `provider-${vmName}`,
  powerState: "running",
  cpuCount: 4,
  memoryMb: 8192,
  diskGb: 100,
  guestOs: "linux",
  ipAddresses: ["10.0.0.1"],
  tags: [],
  rawData: {},
});

async function clearAll() {
  await gateStore.deleteAllDecisions(ORG_A);
  await gateStore.deleteAllDecisions(ORG_B);
  await providerHintsStore.clear();
}

// ============================================================
// Gate store isolation tests
// ============================================================

describe("Gate store — org isolation", async () => {
  before(async () => { await clearAll(); });

  await it("storeDecision scopes to orgId key — decisions never share state", async () => {
    await clearAll();
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
    await clearAll();
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
    await clearAll();
    await gateStore.storeDecision(makeDecision(ORG_A, "a-blocked", "blocked-alpha", false, ["tenant"]));
    await gateStore.storeDecision(makeDecision(ORG_B, "b-allowed", "allowed-beta", true));

    const blockedA = await gateStore.getBlockedVms(ORG_A);
    const blockedB = await gateStore.getBlockedVms(ORG_B);

    assert.equal(blockedA.length, 1);
    assert.equal(blockedA[0].vmName, "blocked-alpha");
    assert.equal(blockedB.length, 0);

    const allB = await gateStore.getAllDecisions(ORG_B);
    assert.ok(!allB.map((d) => d.vmName).includes("blocked-alpha"));
  });

  await it("deleteAllDecisions(orgId) only clears that org's decisions", async () => {
    await clearAll();
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
    await clearAll();
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
    await clearAll();
    assert.equal(gateStore.isEvaluationComplete(ORG_A), false);
    assert.equal(gateStore.isEvaluationComplete(ORG_B), false);

    gateStore.markEvaluationComplete(ORG_A);

    assert.equal(gateStore.isEvaluationComplete(ORG_A), true);
    assert.equal(gateStore.isEvaluationComplete(ORG_B), false);
  });

  await it("getDecision with wrong orgId returns null even if assetId exists", async () => {
    await clearAll();
    await gateStore.storeDecision(makeDecision(ORG_A, "shared-asset-id", "alpha-vm", true));

    const result = await gateStore.getDecision(ORG_B, "shared-asset-id");
    assert.equal(result, null);
  });

  await it("getDecisionByVmName scoped to org — cannot see other org's VMs by name", async () => {
    await clearAll();
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
    await clearAll();
    const before = new Date();
    gateStore.markEvaluationComplete(ORG_A);

    const timeA = gateStore.getLastEvaluationTime(ORG_A);
    const timeB = gateStore.getLastEvaluationTime(ORG_B);

    assert.ok(timeA !== null);
    assert.ok(timeA!.getTime() >= before.getTime());
    assert.equal(timeB, null);
  });

  await it("concurrent orgs do not interfere during simultaneous evaluation", async () => {
    await clearAll();
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

    for (const d of decisionsA) assert.match(d.vmName, /^alpha-/);
    for (const d of decisionsB) assert.match(d.vmName, /^beta-/);
  });
});

// ============================================================
// Provider hints store isolation tests
// ============================================================

describe("Provider hints store — org isolation", async () => {
  before(async () => { await clearAll(); });

  await it("getHintsByVmName — org B cannot see org A's hints by VM name", async () => {
    await clearAll();
    await providerHintsStore.upsertHint(ORG_A, "acct-1", "web-server-01", "prov-1", makeHints("web-server-01"));

    const resultB = await providerHintsStore.getHintsByVmName(ORG_B, "web-server-01");
    assert.equal(resultB, null, "org B must not see org A's hints by VM name");

    const resultA = await providerHintsStore.getHintsByVmName(ORG_A, "web-server-01");
    assert.ok(resultA !== null, "org A should find its own hint");
    assert.equal(resultA!.vmName, "web-server-01");
    assert.equal(resultA!.orgId, ORG_A);
  });

  await it("getHintsByProviderId — org B cannot see org A's hints by provider ID", async () => {
    await clearAll();
    await providerHintsStore.upsertHint(ORG_A, "acct-1", "db-server-01", "prov-alpha-42", makeHints("db-server-01"));

    const resultB = await providerHintsStore.getHintsByProviderId(ORG_B, "prov-alpha-42");
    assert.equal(resultB, null, "org B must not see org A's hints by provider ID");

    const resultA = await providerHintsStore.getHintsByProviderId(ORG_A, "prov-alpha-42");
    assert.ok(resultA !== null);
    assert.equal(resultA!.providerId, "prov-alpha-42");
  });

  await it("getAllHintsForProvider — fully scoped to org", async () => {
    await clearAll();
    await providerHintsStore.upsertHint(ORG_A, "shared-acct", "vm-a1", "prov-a1", makeHints("vm-a1"));
    await providerHintsStore.upsertHint(ORG_A, "shared-acct", "vm-a2", "prov-a2", makeHints("vm-a2"));
    await providerHintsStore.upsertHint(ORG_B, "shared-acct", "vm-b1", "prov-b1", makeHints("vm-b1"));

    const hintsA = await providerHintsStore.getAllHintsForProvider(ORG_A, "shared-acct");
    const hintsB = await providerHintsStore.getAllHintsForProvider(ORG_B, "shared-acct");

    assert.equal(hintsA.length, 2, "org A should have 2 hints for shared-acct");
    assert.equal(hintsB.length, 1, "org B should have 1 hint for shared-acct");

    const namesA = hintsA.map((h) => h.vmName).sort();
    assert.deepEqual(namesA, ["vm-a1", "vm-a2"]);
    assert.equal(hintsB[0].vmName, "vm-b1");
  });

  await it("deleteHintsForProvider — only deletes that org's hints, not other orgs", async () => {
    await clearAll();
    await providerHintsStore.upsertHint(ORG_A, "acct-x", "vm-a", "prov-ax", makeHints("vm-a"));
    await providerHintsStore.upsertHint(ORG_B, "acct-x", "vm-b", "prov-bx", makeHints("vm-b"));

    await providerHintsStore.deleteHintsForProvider(ORG_A, "acct-x");

    const hintsA = await providerHintsStore.getAllHintsForProvider(ORG_A, "acct-x");
    const hintsB = await providerHintsStore.getAllHintsForProvider(ORG_B, "acct-x");

    assert.equal(hintsA.length, 0, "org A hints should be deleted");
    assert.equal(hintsB.length, 1, "org B hints should be untouched");
    assert.equal(hintsB[0].vmName, "vm-b");
  });

  await it("upsertHint composite key includes orgId — same providerAccountId+providerId across orgs does not collide", async () => {
    await clearAll();
    await providerHintsStore.upsertHint(ORG_A, "acct-shared", "vm-alpha", "prov-shared", makeHints("vm-alpha"));
    await providerHintsStore.upsertHint(ORG_B, "acct-shared", "vm-beta", "prov-shared", makeHints("vm-beta"));

    const hintA = await providerHintsStore.getHintsByVmName(ORG_A, "vm-alpha");
    const hintB = await providerHintsStore.getHintsByVmName(ORG_B, "vm-beta");

    assert.ok(hintA !== null);
    assert.equal(hintA!.orgId, ORG_A);
    assert.equal(hintA!.vmName, "vm-alpha");

    assert.ok(hintB !== null);
    assert.equal(hintB!.orgId, ORG_B);
    assert.equal(hintB!.vmName, "vm-beta");

    // Cross-check: org A cannot see org B's VM and vice versa
    assert.equal(await providerHintsStore.getHintsByVmName(ORG_A, "vm-beta"), null);
    assert.equal(await providerHintsStore.getHintsByVmName(ORG_B, "vm-alpha"), null);
  });
});

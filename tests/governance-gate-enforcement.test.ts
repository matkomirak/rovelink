import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyGovernanceGateEnforcement } from "../server/services/governance-gate-enforcement";
import {
  mergeEligibilityPolicyPatch,
  normalizeEligibilityPolicy,
  type EligibilityPolicy,
  type GovernanceEnforcementPolicy,
  type GovernanceObjectEvaluation,
} from "../shared/schema";

const defaultPolicy: GovernanceEnforcementPolicy = {
  mode: "observe_only",
  requireGovernanceEvaluation: false,
  minimumGovernanceScore: null,
  blockOnRecommendedAction: true,
  allowedReadinessStates: ["ready"],
};

const allowedDecision = {
  allowed: true,
  missing: [] as string[],
  reason: "VM has all required governance",
};

const blockedDecision = {
  allowed: false,
  missing: ["tenant"],
  reason: "VM missing required governance fields: tenant",
  failureType: "governance" as const,
};

function makePolicy(overrides: Partial<GovernanceEnforcementPolicy>): GovernanceEnforcementPolicy {
  return { ...defaultPolicy, ...overrides };
}

function makeEvaluation(overrides: Partial<GovernanceObjectEvaluation> = {}): GovernanceObjectEvaluation {
  return {
    id: "eval-1",
    orgId: "org-1",
    runId: "run-1",
    blueprintId: "blueprint-1",
    blueprintVersionId: "version-1",
    objectType: "netbox_vm",
    objectId: "vm-local-1",
    externalId: "101",
    objectName: "demo-vm-001",
    governanceScore: 90,
    dataManagementScore: 90,
    ownershipScore: 90,
    relevanceWeightedPriority: 3,
    automationReady: true,
    findings: [],
    recommendedActions: ["report"],
    result: {},
    objectSnapshot: {},
    evaluatedAt: new Date("2026-08-01T12:00:00Z"),
    ...overrides,
  };
}

const identity = {
  governanceObjectType: "netbox_vm" as const,
  governanceObjectId: "vm-local-1",
};

const fullPolicy: EligibilityPolicy = {
  requireRole: true,
  requireContacts: true,
  governance: {
    mode: "observe_only",
    requireGovernanceEvaluation: false,
    minimumGovernanceScore: 80,
    blockOnRecommendedAction: true,
    allowedReadinessStates: ["ready"],
  },
};

describe("governance gate enforcement", () => {
  it("defaults governance enforcement policy to observe_only", () => {
    const policy = normalizeEligibilityPolicy({});

    assert.deepEqual(policy.governance, defaultPolicy);
  });

  it("rejects invalid governance enforcement mode", () => {
    assert.throws(() => normalizeEligibilityPolicy({
      governance: {
        ...defaultPolicy,
        mode: "silent_block",
      },
    }));
  });

  it("rejects governance score thresholds outside 0..100", () => {
    assert.throws(() => normalizeEligibilityPolicy({
      governance: {
        ...defaultPolicy,
        minimumGovernanceScore: 101,
      },
    }));
  });

  it("rejects empty allowed readiness states", () => {
    assert.throws(() => normalizeEligibilityPolicy({
      governance: {
        ...defaultPolicy,
        allowedReadinessStates: [],
      },
    }));
  });

  it("rejects unknown allowed readiness states", () => {
    assert.throws(() => normalizeEligibilityPolicy({
      governance: {
        ...defaultPolicy,
        allowedReadinessStates: ["ready", "maybe_ready"],
      },
    }));
  });

  it("observe_only leaves allowed decision unchanged", async () => {
    const result = await applyGovernanceGateEnforcement(
      allowedDecision,
      {},
      makePolicy({ mode: "observe_only", requireGovernanceEvaluation: true }),
      async () => makeEvaluation({ automationReady: false }),
    );

    assert.deepEqual(result, allowedDecision);
  });

  it("observe_only leaves blocked decision unchanged", async () => {
    const result = await applyGovernanceGateEnforcement(
      blockedDecision,
      {},
      makePolicy({ mode: "observe_only", requireGovernanceEvaluation: true }),
      async () => null,
    );

    assert.deepEqual(result, blockedDecision);
  });

  it("warn_only leaves allowed decision unchanged and adds warning metadata", async () => {
    const result = await applyGovernanceGateEnforcement(
      allowedDecision,
      identity,
      makePolicy({ mode: "warn_only" }),
      async () => makeEvaluation({ recommendedActions: ["block_automation"] }),
    );

    assert.equal(result.allowed, true);
    assert.deepEqual(result.missing, []);
    assert.equal(result.reason, allowedDecision.reason);
    assert.equal(result.governanceEnforcement?.mode, "warn_only");
    assert.equal(result.governanceEnforcement?.wouldBlock, true);
    assert.equal(result.governanceEnforcement?.status, "warning");
  });

  it("warn_only leaves blocked decision unchanged", async () => {
    const result = await applyGovernanceGateEnforcement(
      blockedDecision,
      identity,
      makePolicy({ mode: "warn_only" }),
      async () => makeEvaluation({ recommendedActions: ["block_automation"] }),
    );

    assert.equal(result.allowed, false);
    assert.deepEqual(result.missing, ["tenant"]);
    assert.equal(result.reason, blockedDecision.reason);
    assert.equal(result.governanceEnforcement?.status, "warning");
  });

  it("enforce blocks missing governanceObjectId", async () => {
    const result = await applyGovernanceGateEnforcement(
      allowedDecision,
      { governanceObjectType: "netbox_vm" },
      makePolicy({ mode: "enforce" }),
      async () => makeEvaluation(),
    );

    assert.equal(result.allowed, false);
    assert.match(result.reason ?? "", /missing governance object identity/);
    assert.ok(result.missing.includes("governance_enforcement"));
  });

  it("enforce blocks missing evaluation when requireGovernanceEvaluation is true", async () => {
    const result = await applyGovernanceGateEnforcement(
      allowedDecision,
      identity,
      makePolicy({ mode: "enforce", requireGovernanceEvaluation: true }),
      async () => null,
    );

    assert.equal(result.allowed, false);
    assert.equal(result.reason, "Governance enforcement: no governance evaluation found");
  });

  it("enforce allows missing evaluation when requireGovernanceEvaluation is false and no other rule fails", async () => {
    const result = await applyGovernanceGateEnforcement(
      allowedDecision,
      identity,
      makePolicy({ mode: "enforce", requireGovernanceEvaluation: false }),
      async () => null,
    );

    assert.equal(result.allowed, true);
    assert.equal(result.governanceEnforcement?.status, "not_evaluated");
  });

  it("enforce blocks block_automation recommended action when enabled", async () => {
    const result = await applyGovernanceGateEnforcement(
      allowedDecision,
      identity,
      makePolicy({ mode: "enforce", blockOnRecommendedAction: true }),
      async () => makeEvaluation({ recommendedActions: ["block_automation"] }),
    );

    assert.equal(result.allowed, false);
    assert.equal(result.reason, "Governance enforcement: block_automation recommended");
  });

  it("enforce does not block block_automation when blockOnRecommendedAction is false", async () => {
    const result = await applyGovernanceGateEnforcement(
      allowedDecision,
      identity,
      makePolicy({ mode: "enforce", blockOnRecommendedAction: false }),
      async () => makeEvaluation({ recommendedActions: ["block_automation"] }),
    );

    assert.equal(result.allowed, true);
  });

  it("enforce blocks score below threshold", async () => {
    const result = await applyGovernanceGateEnforcement(
      allowedDecision,
      identity,
      makePolicy({ mode: "enforce", minimumGovernanceScore: 80 }),
      async () => makeEvaluation({ governanceScore: 79 }),
    );

    assert.equal(result.allowed, false);
    assert.equal(result.reason, "Governance enforcement: score 79 below required 80");
  });

  it("enforce allows score equal to threshold", async () => {
    const result = await applyGovernanceGateEnforcement(
      allowedDecision,
      identity,
      makePolicy({ mode: "enforce", minimumGovernanceScore: 80 }),
      async () => makeEvaluation({ governanceScore: 80 }),
    );

    assert.equal(result.allowed, true);
  });

  it("enforce blocks readiness not allowed", async () => {
    const result = await applyGovernanceGateEnforcement(
      allowedDecision,
      identity,
      makePolicy({ mode: "enforce" }),
      async () => makeEvaluation({ automationReady: false }),
    );

    assert.equal(result.allowed, false);
    assert.equal(result.reason, "Governance enforcement: readiness not_ready is not allowed");
  });

  it("enforce allows not_ready when explicitly allowed", async () => {
    const result = await applyGovernanceGateEnforcement(
      allowedDecision,
      identity,
      makePolicy({ mode: "enforce", allowedReadinessStates: ["ready", "not_ready"] }),
      async () => makeEvaluation({ automationReady: false, recommendedActions: ["report"] }),
    );

    assert.equal(result.allowed, true);
  });

  it("enforce allows compliant object", async () => {
    const result = await applyGovernanceGateEnforcement(
      allowedDecision,
      identity,
      makePolicy({ mode: "enforce", minimumGovernanceScore: 90 }),
      async () => makeEvaluation({ governanceScore: 90, automationReady: true, recommendedActions: ["report"] }),
    );

    assert.equal(result.allowed, true);
    assert.equal(result.governanceEnforcement?.status, "passed");
  });

  it("keeps an existing gate block reason visible when governance also fails", async () => {
    const result = await applyGovernanceGateEnforcement(
      blockedDecision,
      identity,
      makePolicy({ mode: "enforce" }),
      async () => makeEvaluation({ recommendedActions: ["block_automation"] }),
    );

    assert.equal(result.allowed, false);
    assert.deepEqual(result.missing, ["tenant"]);
    assert.equal(result.reason, blockedDecision.reason);
    assert.equal(result.governanceEnforcement?.reason, "Governance enforcement: block_automation recommended");
  });

  it("does not accept legacy name/source fallback for enforcement", async () => {
    let loaderCalled = false;
    const result = await applyGovernanceGateEnforcement(
      allowedDecision,
      { sourceNetboxId: 101 } as any,
      makePolicy({ mode: "enforce" }),
      async () => {
        loaderCalled = true;
        return makeEvaluation();
      },
    );

    assert.equal(loaderCalled, false);
    assert.equal(result.allowed, false);
    assert.match(result.reason ?? "", /missing governance object identity/);
  });
});

describe("inventory eligibility policy patch merging", () => {
  it("partial governance PATCH preserves requireRole", () => {
    const result = mergeEligibilityPolicyPatch(fullPolicy, {
      governance: { mode: "enforce" },
    });

    assert.equal(result.requireRole, true);
    assert.equal(result.governance.mode, "enforce");
  });

  it("partial governance PATCH preserves requireContacts", () => {
    const result = mergeEligibilityPolicyPatch(fullPolicy, {
      governance: { mode: "warn_only" },
    });

    assert.equal(result.requireContacts, true);
    assert.equal(result.governance.mode, "warn_only");
  });

  it("partial boolean PATCH preserves governance settings", () => {
    const result = mergeEligibilityPolicyPatch(fullPolicy, {
      requireContacts: false,
    });

    assert.equal(result.requireRole, true);
    assert.equal(result.requireContacts, false);
    assert.equal(result.governance.mode, "observe_only");
    assert.equal(result.governance.minimumGovernanceScore, 80);
  });

  it("partial governance PATCH preserves unrelated governance fields", () => {
    const result = mergeEligibilityPolicyPatch(fullPolicy, {
      governance: { mode: "enforce" },
    });

    assert.equal(result.governance.minimumGovernanceScore, 80);
    assert.equal(result.governance.blockOnRecommendedAction, true);
    assert.deepEqual(result.governance.allowedReadinessStates, ["ready"]);
  });

  it("malformed nested governance PATCH is rejected", () => {
    assert.throws(() => mergeEligibilityPolicyPatch(fullPolicy, {
      governance: {
        minimumGovernanceScore: 101,
      },
    }));
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluateGovernanceObject,
  getEffectiveCustomerScopeGovernancePolicy,
  type NormalizedGovernanceObject,
  STANDARD_NETBOX_VM_GOVERNANCE_BLUEPRINT,
} from "../server/services/governance-blueprint-evaluator";
import {
  DEFAULT_CUSTOMER_SCOPE_GOVERNANCE_POLICY,
  type GovernanceBlueprintRules,
  governanceBlueprintRulesSchema,
} from "../shared/governance";

const baseObject: NormalizedGovernanceObject = {
  objectType: "netbox_vm",
  objectId: "vm-001",
  objectName: "demo-vm-001",
  fields: {
    tenant: "rovelink-lab",
    role: "app",
    platform: "linux",
    primaryIp: "192.0.2.10",
    automatable: true,
    providerState: "present",
  },
  owners: {
    technical_owner: "platform-team",
    service_owner: "payments",
    data_owner: "cmdb-team",
    operations_team: "ops",
    business_owner: "finance",
  },
};

const baseRules = STANDARD_NETBOX_VM_GOVERNANCE_BLUEPRINT.rules;

function withCustomerAssignments(assignments: unknown[]): NormalizedGovernanceObject {
  return {
    ...baseObject,
    fields: {
      ...baseObject.fields,
      customerAssignments: assignments,
      customerAssignmentRelationship: (assignments[0] as any)?.relationship ?? null,
      customerScopeCount: assignments.filter((assignment: any) => Boolean(assignment?.customerScope)).length,
      hasCustomerScope: assignments.some((assignment: any) => Boolean(assignment?.customerScope)),
      isCustomerUnassigned: assignments.some((assignment: any) => assignment?.relationship === "unassigned"),
      customerAssignmentConfidence: (assignments[0] as any)?.confidence ?? null,
      customerAssignmentDerivedFrom: (assignments[0] as any)?.derivedFrom ?? null,
    },
  };
}

function dedicatedCustomerScopeAssignment(overrides: Record<string, unknown> = {}) {
  return {
    id: "assignment-1",
    relationship: "dedicated",
    derivedFrom: "provider",
    confidence: "authoritative",
    customerScopeId: "scope-1",
    customerScope: {
      id: "scope-1",
      externalId: "20",
      name: "Engineering",
      displayName: "Engineering",
      strategy: "tenant",
      isolation: "assignment",
    },
    ...overrides,
  };
}

function withCustomerScopePolicy(
  overrides: Partial<GovernanceBlueprintRules["customerScope"]> = {}
): GovernanceBlueprintRules {
  return {
    ...baseRules,
    // Isolate policy-mode scoring from the independent required assignment rule.
    dataManagement: baseRules.dataManagement.map(rule => rule.fieldKey === "customerAssignment" ? { ...rule, required: false } : rule),
    customerScope: {
      ...DEFAULT_CUSTOMER_SCOPE_GOVERNANCE_POLICY,
      mode: "score_only",
      scoreWeight: 12,
      ...overrides,
    },
  };
}

describe("governanceBlueprintRulesSchema", () => {
  it("rejects unknown keys", () => {
    assert.throws(
      () => governanceBlueprintRulesSchema.parse({
        ...baseRules,
        extraLayer: {},
      }),
      /unrecognized/i
    );
  });

  it("rejects duplicate dataManagement fieldKey entries", () => {
    assert.throws(
      () => governanceBlueprintRulesSchema.parse({
        ...baseRules,
        dataManagement: [
          ...baseRules.dataManagement,
          {
            fieldKey: "customerAssignment",
            label: "Duplicate customer assignment",
            required: true,
            managementMode: "owned_by_cmdb",
            weight: 1,
          },
        ],
      }),
      /duplicate data management fieldKey/i
    );
  });

  it("rejects duplicate ownership role entries", () => {
    assert.throws(
      () => governanceBlueprintRulesSchema.parse({
        ...baseRules,
        ownership: [
          ...baseRules.ownership,
          {
            role: "technical_owner",
            label: "Duplicate technical owner",
            required: true,
            sourceField: "owners.alternate_technical_owner",
            weight: 1,
          },
        ],
      }),
      /duplicate ownership role/i
    );
  });

  it("rejects rule weights below 0.1", () => {
    assert.throws(
      () => governanceBlueprintRulesSchema.parse({
        ...baseRules,
        dataManagement: baseRules.dataManagement.map((rule) => (
          rule.fieldKey === "customerAssignment" ? { ...rule, weight: 0.09 } : rule
        )),
      }),
      /greater than or equal to 0.1/i
    );
  });

  it("rejects rule weights above 10", () => {
    assert.throws(
      () => governanceBlueprintRulesSchema.parse({
        ...baseRules,
        ownership: baseRules.ownership.map((rule) => (
          rule.role === "technical_owner" ? { ...rule, weight: 10.1 } : rule
        )),
      }),
      /less than or equal to 10/i
    );
  });

  it("accepts the standard default blueprint rules", () => {
    assert.deepEqual(governanceBlueprintRulesSchema.parse(baseRules), baseRules);
  });

  it("accepts legacy blueprint rules without a customerScope policy", () => {
    const { customerScope: _customerScope, ...legacyRules } = baseRules;

    const parsed = governanceBlueprintRulesSchema.parse(legacyRules);

    assert.deepEqual(parsed.customerScope, DEFAULT_CUSTOMER_SCOPE_GOVERNANCE_POLICY);
  });

  it("accepts each CustomerScope policy mode", () => {
    for (const mode of ["visibility_only", "score_only", "readiness", "enforce"] as const) {
      const parsed = governanceBlueprintRulesSchema.parse({
        ...baseRules,
        customerScope: {
          ...DEFAULT_CUSTOMER_SCOPE_GOVERNANCE_POLICY,
          mode,
        },
      });

      assert.equal(parsed.customerScope.mode, mode);
    }
  });

  it("rejects an invalid CustomerScope policy mode", () => {
    assert.throws(
      () => governanceBlueprintRulesSchema.parse({
        ...baseRules,
        customerScope: {
          ...DEFAULT_CUSTOMER_SCOPE_GOVERNANCE_POLICY,
          mode: "audit_the_moon",
        },
      }),
      /invalid/i
    );
  });

  it("accepts null CustomerScope policy numeric limits", () => {
    const parsed = governanceBlueprintRulesSchema.parse({
      ...baseRules,
      customerScope: {
        ...DEFAULT_CUSTOMER_SCOPE_GOVERNANCE_POLICY,
        maxAllowedCustomerScopeCount: null,
        staleAssignmentMaxAgeDays: null,
      },
    });

    assert.equal(parsed.customerScope.maxAllowedCustomerScopeCount, null);
    assert.equal(parsed.customerScope.staleAssignmentMaxAgeDays, null);
  });

  it("rejects negative CustomerScope policy numeric values", () => {
    assert.throws(
      () => governanceBlueprintRulesSchema.parse({
        ...baseRules,
        customerScope: {
          ...DEFAULT_CUSTOMER_SCOPE_GOVERNANCE_POLICY,
          scoreWeight: -1,
        },
      }),
      /greater than or equal to 0/i
    );

    assert.throws(
      () => governanceBlueprintRulesSchema.parse({
        ...baseRules,
        customerScope: {
          ...DEFAULT_CUSTOMER_SCOPE_GOVERNANCE_POLICY,
          staleAssignmentMaxAgeDays: -1,
        },
      }),
      /greater than or equal to 0/i
    );
  });
});

describe("evaluateGovernanceObject", () => {
  it("passes a complete NetBox VM", () => {
    const result = evaluateGovernanceObject(baseObject, baseRules);

    assert.equal(result.scores.governance, 100);
    assert.equal(result.scores.dataManagement, 100);
    assert.equal(result.scores.ownership, 100);
    assert.equal(result.automationReadiness.ready, true);
    assert.deepEqual(result.findings, []);
    assert.deepEqual(result.recommendedActions, ["ignore"]);
  });

  it("does not create a CustomerScope finding for a dedicated authoritative assignment", () => {
    const result = evaluateGovernanceObject(
      withCustomerAssignments([dedicatedCustomerScopeAssignment()]),
      withCustomerScopePolicy({ mode: "visibility_only" }),
    );

    assert.ok(!result.findings.some((finding) => finding.code.startsWith("CUSTOMER_")));
    assert.equal(result.scores.governance, 100);
    assert.equal(result.automationReadiness.ready, true);
  });

  it("creates CUSTOMER_SCOPE_MISSING when no CustomerScope assignment exists", () => {
    const result = evaluateGovernanceObject(withCustomerAssignments([]), withCustomerScopePolicy({ mode: "visibility_only" }));

    assert.ok(result.findings.some((finding) => (
      finding.code === "CUSTOMER_SCOPE_MISSING" &&
      finding.severity === "warning" &&
      finding.layer === "data_management" &&
      finding.message.includes("No CustomerScope assignment found") &&
      finding.message.includes("visibility-only") &&
      finding.message.includes("does not affect score or automation readiness yet")
    )));
    assert.equal(result.scores.governance, 100);
    assert.equal(result.scores.dataManagement, 100);
    assert.equal(result.automationReadiness.ready, true);
    assert.ok(!result.recommendedActions.includes("block_automation"));
  });

  it("keeps missing CustomerScope policy behavior equivalent to explicit visibility_only", () => {
    const { customerScope: _customerScope, ...legacyRules } = baseRules;
    const explicitVisibilityOnlyRules = {
      ...baseRules,
      customerScope: {
        ...DEFAULT_CUSTOMER_SCOPE_GOVERNANCE_POLICY,
        mode: "visibility_only" as const,
      },
    };
    const legacyResult = evaluateGovernanceObject(withCustomerAssignments([]), legacyRules as GovernanceBlueprintRules);
    const visibilityOnlyResult = evaluateGovernanceObject(
      withCustomerAssignments([]),
      explicitVisibilityOnlyRules,
    );

    assert.deepEqual(getEffectiveCustomerScopeGovernancePolicy({}), DEFAULT_CUSTOMER_SCOPE_GOVERNANCE_POLICY);
    assert.deepEqual(
      getEffectiveCustomerScopeGovernancePolicy(explicitVisibilityOnlyRules),
      DEFAULT_CUSTOMER_SCOPE_GOVERNANCE_POLICY
    );
    assert.deepEqual(legacyResult.findings, visibilityOnlyResult.findings);
    assert.deepEqual(legacyResult.scores, visibilityOnlyResult.scores);
    assert.deepEqual(legacyResult.automationReadiness, visibilityOnlyResult.automationReadiness);
  });

  it("keeps enforce mode ready for a valid dedicated authoritative CustomerScope", () => {
    const result = evaluateGovernanceObject(
      withCustomerAssignments([dedicatedCustomerScopeAssignment()]),
      withCustomerScopePolicy({ mode: "enforce", scoreWeight: 12 }),
    );

    assert.equal(result.scores.dataManagement, 100);
    assert.equal(result.scores.governance, 100);
    assert.equal(result.automationReadiness.ready, true);
    assert.deepEqual(result.automationReadiness.reasons, ["Governance blueprint checks passed."]);
    assert.ok(!result.recommendedActions.includes("block_automation"));
  });

  it("does not reduce score_only score for a valid dedicated authoritative CustomerScope", () => {
    const result = evaluateGovernanceObject(
      withCustomerAssignments([dedicatedCustomerScopeAssignment()]),
      withCustomerScopePolicy(),
    );

    assert.equal(result.scores.dataManagement, 100);
    assert.equal(result.scores.governance, 100);
    assert.equal(result.automationReadiness.ready, true);
    assert.ok(!result.recommendedActions.includes("block_automation"));
  });

  it("reduces score_only dataManagementScore when CustomerScope assignment is missing", () => {
    const result = evaluateGovernanceObject(withCustomerAssignments([]), withCustomerScopePolicy());

    assert.equal(result.scores.dataManagement, 88);
    assert.equal(result.scores.governance, 94);
    assert.equal(result.scores.ownership, 100);
    assert.equal(result.automationReadiness.ready, true);
    assert.deepEqual(result.automationReadiness.reasons, ["Governance blueprint checks passed."]);
    assert.ok(!result.recommendedActions.includes("block_automation"));
  });

  it("keeps score_only score unchanged when scoreWeight is 0", () => {
    const result = evaluateGovernanceObject(
      withCustomerAssignments([]),
      withCustomerScopePolicy({ scoreWeight: 0 }),
    );

    assert.equal(result.scores.dataManagement, 100);
    assert.equal(result.scores.governance, 100);
    assert.equal(result.automationReadiness.ready, true);
  });

  it("reduces score_only dataManagementScore when unassigned is not allowed", () => {
    const result = evaluateGovernanceObject(
      withCustomerAssignments([dedicatedCustomerScopeAssignment({
        relationship: "unassigned",
        customerScopeId: null,
        customerScope: null,
      })]),
      withCustomerScopePolicy({ allowUnassigned: false }),
    );

    assert.equal(result.scores.dataManagement, 88);
    assert.equal(result.scores.governance, 94);
    assert.ok(!result.recommendedActions.includes("block_automation"));
  });

  it("handles score_only internal assignment according to allowInternal", () => {
    const object = withCustomerAssignments([dedicatedCustomerScopeAssignment({
      relationship: "internal",
      customerScopeId: null,
      customerScope: null,
    })]);

    const allowed = evaluateGovernanceObject(object, withCustomerScopePolicy({ allowInternal: true }));
    const disallowed = evaluateGovernanceObject(object, withCustomerScopePolicy({ allowInternal: false }));

    assert.equal(allowed.scores.dataManagement, 100);
    assert.equal(disallowed.scores.dataManagement, 88);
    assert.ok(!allowed.findings.some((finding) => finding.code === "CUSTOMER_ASSIGNMENT_UNASSIGNED"));
    assert.ok(!disallowed.findings.some((finding) => finding.code === "CUSTOMER_ASSIGNMENT_UNASSIGNED"));
  });

  it("handles score_only shared assignment according to allowShared", () => {
    const object = withCustomerAssignments([
      dedicatedCustomerScopeAssignment({ relationship: "shared" }),
      dedicatedCustomerScopeAssignment({
        id: "assignment-2",
        relationship: "shared",
        customerScopeId: "scope-2",
        customerScope: {
          id: "scope-2",
          externalId: "21",
          name: "Finance",
          displayName: "Finance",
          strategy: "tenant",
          isolation: "assignment",
        },
      }),
    ]);

    const allowed = evaluateGovernanceObject(object, withCustomerScopePolicy({ allowShared: true }));
    const disallowed = evaluateGovernanceObject(object, withCustomerScopePolicy({ allowShared: false }));

    assert.equal(allowed.scores.dataManagement, 100);
    assert.equal(disallowed.scores.dataManagement, 88);
    assert.equal(disallowed.automationReadiness.ready, true);
  });

  it("reduces score_only score for low confidence only when authoritative confidence is required", () => {
    const object = withCustomerAssignments([dedicatedCustomerScopeAssignment({ confidence: "mapped" })]);

    const allowed = evaluateGovernanceObject(object, withCustomerScopePolicy({
      requireAuthoritativeConfidence: false,
    }));
    const required = evaluateGovernanceObject(object, withCustomerScopePolicy({
      requireAuthoritativeConfidence: true,
    }));

    assert.equal(allowed.scores.dataManagement, 100);
    assert.equal(required.scores.dataManagement, 88);
    assert.ok(required.findings.some((finding) => finding.code === "CUSTOMER_ASSIGNMENT_LOW_CONFIDENCE"));
  });

  it("reduces score_only score for missing CustomerScope reference when configured", () => {
    const object = withCustomerAssignments([dedicatedCustomerScopeAssignment({ customerScope: null })]);

    const visibility = evaluateGovernanceObject(object, withCustomerScopePolicy({
      treatMissingScopeReferenceAsBlocker: false,
    }));
    const scored = evaluateGovernanceObject(object, withCustomerScopePolicy({
      treatMissingScopeReferenceAsBlocker: true,
    }));

    assert.equal(visibility.scores.dataManagement, 100);
    assert.equal(scored.scores.dataManagement, 88);
    assert.ok(scored.findings.some((finding) => finding.code === "CUSTOMER_SCOPE_NOT_FOUND"));
  });

  it("bounds score_only CustomerScope score penalty", () => {
    const result = evaluateGovernanceObject(
      withCustomerAssignments([]),
      withCustomerScopePolicy({ scoreWeight: 150 }),
    );

    assert.equal(result.scores.dataManagement, 0);
    assert.equal(result.scores.governance, 50);
    assert.equal(result.automationReadiness.ready, true);
    assert.ok(!result.recommendedActions.includes("block_automation"));
  });

  it("keeps readiness mode ready for a valid dedicated authoritative CustomerScope", () => {
    const result = evaluateGovernanceObject(
      withCustomerAssignments([dedicatedCustomerScopeAssignment()]),
      withCustomerScopePolicy({ mode: "readiness", scoreWeight: 12 }),
    );

    assert.equal(result.scores.dataManagement, 100);
    assert.equal(result.scores.governance, 100);
    assert.equal(result.automationReadiness.ready, true);
    assert.deepEqual(result.automationReadiness.reasons, ["Governance blueprint checks passed."]);
    assert.ok(!result.recommendedActions.includes("block_automation"));
  });

  it("marks readiness false when CustomerScope assignment is missing in readiness mode", () => {
    const result = evaluateGovernanceObject(
      withCustomerAssignments([]),
      withCustomerScopePolicy({ mode: "readiness", scoreWeight: 12 }),
    );

    assert.equal(result.scores.dataManagement, 100);
    assert.equal(result.scores.governance, 100);
    assert.equal(result.automationReadiness.ready, false);
    assert.deepEqual(result.automationReadiness.reasons, [
      "CustomerScope policy is not satisfied for this object.",
    ]);
    assert.ok(!result.recommendedActions.includes("block_automation"));
    assert.ok(result.findings.some((finding) => (
      finding.code === "CUSTOMER_SCOPE_MISSING" &&
      finding.message.includes("may affect automation readiness") &&
      !finding.message.includes("does not affect score or automation readiness yet")
    )));
  });

  it("handles readiness mode unassigned assignment according to allowUnassigned", () => {
    const object = withCustomerAssignments([dedicatedCustomerScopeAssignment({
      relationship: "unassigned",
      customerScopeId: null,
      customerScope: null,
    })]);

    const allowed = evaluateGovernanceObject(object, withCustomerScopePolicy({
      mode: "readiness",
      allowUnassigned: true,
    }));
    const disallowed = evaluateGovernanceObject(object, withCustomerScopePolicy({
      mode: "readiness",
      allowUnassigned: false,
    }));

    assert.equal(allowed.automationReadiness.ready, true);
    assert.equal(disallowed.automationReadiness.ready, false);
    assert.equal(disallowed.scores.dataManagement, 100);
    assert.ok(!disallowed.recommendedActions.includes("block_automation"));
  });

  it("handles readiness mode internal assignment according to allowInternal", () => {
    const object = withCustomerAssignments([dedicatedCustomerScopeAssignment({
      relationship: "internal",
      customerScopeId: null,
      customerScope: null,
    })]);

    const allowed = evaluateGovernanceObject(object, withCustomerScopePolicy({
      mode: "readiness",
      allowInternal: true,
    }));
    const disallowed = evaluateGovernanceObject(object, withCustomerScopePolicy({
      mode: "readiness",
      allowInternal: false,
    }));

    assert.equal(allowed.automationReadiness.ready, true);
    assert.equal(disallowed.automationReadiness.ready, false);
    assert.equal(disallowed.scores.dataManagement, 100);
    assert.ok(!disallowed.findings.some((finding) => finding.code === "CUSTOMER_ASSIGNMENT_UNASSIGNED"));
    assert.ok(!disallowed.recommendedActions.includes("block_automation"));
  });

  it("handles readiness mode shared assignment according to allowShared", () => {
    const object = withCustomerAssignments([
      dedicatedCustomerScopeAssignment({ relationship: "shared" }),
      dedicatedCustomerScopeAssignment({
        id: "assignment-2",
        relationship: "shared",
        customerScopeId: "scope-2",
        customerScope: {
          id: "scope-2",
          externalId: "21",
          name: "Finance",
          displayName: "Finance",
          strategy: "tenant",
          isolation: "assignment",
        },
      }),
    ]);

    const allowed = evaluateGovernanceObject(object, withCustomerScopePolicy({
      mode: "readiness",
      allowShared: true,
    }));
    const disallowed = evaluateGovernanceObject(object, withCustomerScopePolicy({
      mode: "readiness",
      allowShared: false,
    }));

    assert.equal(allowed.automationReadiness.ready, true);
    assert.equal(disallowed.automationReadiness.ready, false);
    assert.equal(disallowed.scores.dataManagement, 100);
    assert.ok(!disallowed.recommendedActions.includes("block_automation"));
  });

  it("marks readiness false for low confidence only when authoritative confidence is required", () => {
    const object = withCustomerAssignments([dedicatedCustomerScopeAssignment({ confidence: "mapped" })]);

    const allowed = evaluateGovernanceObject(object, withCustomerScopePolicy({
      mode: "readiness",
      requireAuthoritativeConfidence: false,
    }));
    const required = evaluateGovernanceObject(object, withCustomerScopePolicy({
      mode: "readiness",
      requireAuthoritativeConfidence: true,
    }));

    assert.equal(allowed.automationReadiness.ready, true);
    assert.equal(required.automationReadiness.ready, false);
    assert.equal(required.scores.dataManagement, 100);
    assert.ok(required.findings.some((finding) => finding.code === "CUSTOMER_ASSIGNMENT_LOW_CONFIDENCE"));
    assert.ok(!required.recommendedActions.includes("block_automation"));
  });

  it("marks readiness false for missing CustomerScope reference when configured", () => {
    const object = withCustomerAssignments([dedicatedCustomerScopeAssignment({ customerScope: null })]);

    const allowed = evaluateGovernanceObject(object, withCustomerScopePolicy({
      mode: "readiness",
      treatMissingScopeReferenceAsBlocker: false,
    }));
    const required = evaluateGovernanceObject(object, withCustomerScopePolicy({
      mode: "readiness",
      treatMissingScopeReferenceAsBlocker: true,
    }));

    assert.equal(allowed.automationReadiness.ready, true);
    assert.equal(required.automationReadiness.ready, false);
    assert.equal(required.scores.dataManagement, 100);
    assert.ok(required.findings.some((finding) => finding.code === "CUSTOMER_SCOPE_NOT_FOUND"));
    assert.ok(!required.recommendedActions.includes("block_automation"));
  });

  it("keeps score_only score behavior without adding CustomerScope readiness failure", () => {
    const result = evaluateGovernanceObject(withCustomerAssignments([]), withCustomerScopePolicy());

    assert.equal(result.scores.dataManagement, 88);
    assert.equal(result.automationReadiness.ready, true);
    assert.deepEqual(result.automationReadiness.reasons, ["Governance blueprint checks passed."]);
    assert.ok(!result.recommendedActions.includes("block_automation"));
  });

  it("marks readiness false and recommends block_automation when CustomerScope assignment is missing in enforce mode", () => {
    const result = evaluateGovernanceObject(
      withCustomerAssignments([]),
      withCustomerScopePolicy({ mode: "enforce", scoreWeight: 12 }),
    );

    assert.equal(result.scores.dataManagement, 100);
    assert.equal(result.scores.governance, 100);
    assert.equal(result.automationReadiness.ready, false);
    assert.deepEqual(result.automationReadiness.reasons, [
      "CustomerScope policy is not satisfied for this object.",
    ]);
    assert.ok(result.recommendedActions.includes("block_automation"));
    assert.ok(result.findings.some((finding) => (
      finding.code === "CUSTOMER_SCOPE_MISSING" &&
      finding.message.includes("violates an enforcing CustomerScope blueprint policy") &&
      finding.message.includes("actual blocking depends on Automation Inventory governance enforcement settings")
    )));
  });

  it("handles enforce mode unassigned assignment according to allowUnassigned", () => {
    const object = withCustomerAssignments([dedicatedCustomerScopeAssignment({
      relationship: "unassigned",
      customerScopeId: null,
      customerScope: null,
    })]);

    const allowed = evaluateGovernanceObject(object, withCustomerScopePolicy({
      mode: "enforce",
      allowUnassigned: true,
    }));
    const disallowed = evaluateGovernanceObject(object, withCustomerScopePolicy({
      mode: "enforce",
      allowUnassigned: false,
    }));

    assert.equal(allowed.automationReadiness.ready, true);
    assert.ok(!allowed.recommendedActions.includes("block_automation"));
    assert.equal(disallowed.automationReadiness.ready, false);
    assert.equal(disallowed.scores.dataManagement, 100);
    assert.ok(disallowed.recommendedActions.includes("block_automation"));
  });

  it("handles enforce mode internal assignment according to allowInternal", () => {
    const object = withCustomerAssignments([dedicatedCustomerScopeAssignment({
      relationship: "internal",
      customerScopeId: null,
      customerScope: null,
    })]);

    const allowed = evaluateGovernanceObject(object, withCustomerScopePolicy({
      mode: "enforce",
      allowInternal: true,
    }));
    const disallowed = evaluateGovernanceObject(object, withCustomerScopePolicy({
      mode: "enforce",
      allowInternal: false,
    }));

    assert.equal(allowed.automationReadiness.ready, true);
    assert.ok(!allowed.recommendedActions.includes("block_automation"));
    assert.equal(disallowed.automationReadiness.ready, false);
    assert.equal(disallowed.scores.dataManagement, 100);
    assert.ok(!disallowed.findings.some((finding) => finding.code === "CUSTOMER_ASSIGNMENT_UNASSIGNED"));
    assert.ok(disallowed.recommendedActions.includes("block_automation"));
  });

  it("handles enforce mode shared assignment according to allowShared", () => {
    const object = withCustomerAssignments([
      dedicatedCustomerScopeAssignment({ relationship: "shared" }),
      dedicatedCustomerScopeAssignment({
        id: "assignment-2",
        relationship: "shared",
        customerScopeId: "scope-2",
        customerScope: {
          id: "scope-2",
          externalId: "21",
          name: "Finance",
          displayName: "Finance",
          strategy: "tenant",
          isolation: "assignment",
        },
      }),
    ]);

    const allowed = evaluateGovernanceObject(object, withCustomerScopePolicy({
      mode: "enforce",
      allowShared: true,
    }));
    const disallowed = evaluateGovernanceObject(object, withCustomerScopePolicy({
      mode: "enforce",
      allowShared: false,
    }));

    assert.equal(allowed.automationReadiness.ready, true);
    assert.ok(!allowed.recommendedActions.includes("block_automation"));
    assert.equal(disallowed.automationReadiness.ready, false);
    assert.equal(disallowed.scores.dataManagement, 100);
    assert.ok(disallowed.recommendedActions.includes("block_automation"));
  });

  it("recommends block_automation for low confidence in enforce mode only when authoritative confidence is required", () => {
    const object = withCustomerAssignments([dedicatedCustomerScopeAssignment({ confidence: "mapped" })]);

    const allowed = evaluateGovernanceObject(object, withCustomerScopePolicy({
      mode: "enforce",
      requireAuthoritativeConfidence: false,
    }));
    const required = evaluateGovernanceObject(object, withCustomerScopePolicy({
      mode: "enforce",
      requireAuthoritativeConfidence: true,
    }));

    assert.equal(allowed.automationReadiness.ready, true);
    assert.ok(!allowed.recommendedActions.includes("block_automation"));
    assert.equal(required.automationReadiness.ready, false);
    assert.equal(required.scores.dataManagement, 100);
    assert.ok(required.findings.some((finding) => finding.code === "CUSTOMER_ASSIGNMENT_LOW_CONFIDENCE"));
    assert.ok(required.recommendedActions.includes("block_automation"));
  });

  it("recommends block_automation for missing CustomerScope reference in enforce mode when configured", () => {
    const object = withCustomerAssignments([dedicatedCustomerScopeAssignment({ customerScope: null })]);

    const allowed = evaluateGovernanceObject(object, withCustomerScopePolicy({
      mode: "enforce",
      treatMissingScopeReferenceAsBlocker: false,
    }));
    const required = evaluateGovernanceObject(object, withCustomerScopePolicy({
      mode: "enforce",
      treatMissingScopeReferenceAsBlocker: true,
    }));

    assert.equal(allowed.automationReadiness.ready, true);
    assert.ok(!allowed.recommendedActions.includes("block_automation"));
    assert.equal(required.automationReadiness.ready, false);
    assert.equal(required.scores.dataManagement, 100);
    assert.ok(required.findings.some((finding) => finding.code === "CUSTOMER_SCOPE_NOT_FOUND"));
    assert.ok(required.recommendedActions.includes("block_automation"));
  });

  it("creates CUSTOMER_ASSIGNMENT_UNASSIGNED without treating internal as unassigned", () => {
    const unassigned = evaluateGovernanceObject(
      withCustomerAssignments([dedicatedCustomerScopeAssignment({
        relationship: "unassigned",
        customerScopeId: null,
        customerScope: null,
      })]),
      withCustomerScopePolicy({ mode: "visibility_only" }),
    );
    const internal = evaluateGovernanceObject(
      withCustomerAssignments([dedicatedCustomerScopeAssignment({
        relationship: "internal",
        customerScopeId: null,
        customerScope: null,
      })]),
      withCustomerScopePolicy({ mode: "visibility_only" }),
    );

    assert.ok(unassigned.findings.some((finding) => (
      finding.code === "CUSTOMER_ASSIGNMENT_UNASSIGNED" &&
      finding.message.includes("Object is explicitly unassigned") &&
      finding.message.includes("visibility-only")
    )));
    assert.ok(!internal.findings.some((finding) => finding.code === "CUSTOMER_ASSIGNMENT_UNASSIGNED"));
    assert.equal(unassigned.automationReadiness.ready, true);
    assert.equal(internal.automationReadiness.ready, true);
  });

  it("accepts a shared CustomerScope assignment with scopes", () => {
    const result = evaluateGovernanceObject(
      withCustomerAssignments([
        dedicatedCustomerScopeAssignment({ relationship: "shared" }),
        dedicatedCustomerScopeAssignment({
          id: "assignment-2",
          relationship: "shared",
          customerScopeId: "scope-2",
          customerScope: {
            id: "scope-2",
            externalId: "21",
            name: "Finance",
            displayName: "Finance",
            strategy: "tenant",
            isolation: "assignment",
          },
        }),
      ]),
      withCustomerScopePolicy({ mode: "visibility_only" }),
    );

    assert.ok(!result.findings.some((finding) => finding.code.startsWith("CUSTOMER_")));
    assert.equal(result.scores.governance, 100);
    assert.equal(result.automationReadiness.ready, true);
  });

  it("creates CUSTOMER_ASSIGNMENT_LOW_CONFIDENCE for non-authoritative assignment confidence", () => {
    const result = evaluateGovernanceObject(
      withCustomerAssignments([dedicatedCustomerScopeAssignment({ confidence: "mapped" })]),
      withCustomerScopePolicy({ mode: "visibility_only" }),
    );

    assert.ok(result.findings.some((finding) => (
      finding.code === "CUSTOMER_ASSIGNMENT_LOW_CONFIDENCE" &&
      finding.message.includes("confidence is not authoritative") &&
      finding.message.includes("visibility-only")
    )));
    assert.equal(result.scores.governance, 100);
    assert.equal(result.automationReadiness.ready, true);
    assert.ok(!result.recommendedActions.includes("block_automation"));
  });

  it("creates CUSTOMER_ASSIGNMENT_INVALID for dedicated assignment without scope", () => {
    const result = evaluateGovernanceObject(
      withCustomerAssignments([dedicatedCustomerScopeAssignment({
        customerScopeId: null,
        customerScope: null,
      })]),
      withCustomerScopePolicy({ mode: "visibility_only" }),
    );

    assert.ok(result.findings.some((finding) => (
      finding.code === "CUSTOMER_ASSIGNMENT_INVALID" &&
      finding.message.includes("CustomerScope assignment is inconsistent") &&
      finding.message.includes("visibility-only")
    )));
    assert.equal(result.scores.governance, 100);
    assert.equal(result.automationReadiness.ready, true);
  });

  it("creates CUSTOMER_SCOPE_NOT_FOUND when assignment references a missing scope", () => {
    const result = evaluateGovernanceObject(
      withCustomerAssignments([dedicatedCustomerScopeAssignment({ customerScope: null })]),
      withCustomerScopePolicy({ mode: "visibility_only" }),
    );

    assert.ok(result.findings.some((finding) => (
      finding.code === "CUSTOMER_SCOPE_NOT_FOUND" &&
      finding.message.includes("CustomerScope reference could not be resolved") &&
      finding.message.includes("visibility-only")
    )));
    assert.equal(result.scores.governance, 100);
    assert.equal(result.automationReadiness.ready, true);
  });

  it("creates an ownership finding when technical owner is missing", () => {
    const result = evaluateGovernanceObject(
      {
        ...baseObject,
        owners: {
          ...baseObject.owners,
          technical_owner: "",
        },
      },
      baseRules
    );

    assert.ok(result.scores.ownership < 100);
    assert.ok(result.findings.some((finding) => (
      finding.layer === "ownership" &&
      finding.role === "technical_owner" &&
      finding.code === "required_owner_missing"
    )));
    assert.ok(result.recommendedActions.includes("enrich"));
  });

  it("creates an ownership finding when service owner is missing", () => {
    const result = evaluateGovernanceObject(
      {
        ...baseObject,
        owners: {
          ...baseObject.owners,
          service_owner: undefined,
        },
      },
      baseRules
    );

    assert.ok(result.scores.ownership < 100);
    assert.ok(result.findings.some((finding) => (
      finding.layer === "ownership" &&
      finding.role === "service_owner" &&
      finding.code === "required_owner_missing"
    )));
  });

  it("creates a data management finding for unknown management mode", () => {
    const rules: GovernanceBlueprintRules = {
      ...baseRules,
      dataManagement: baseRules.dataManagement.map((rule) => (
        rule.fieldKey === "platform"
          ? { ...rule, managementMode: "unknown" }
          : rule
      )),
    };

    const result = evaluateGovernanceObject(baseObject, rules);

    assert.ok(result.scores.dataManagement < 100);
    assert.ok(result.findings.some((finding) => (
      finding.layer === "data_management" &&
      finding.fieldKey === "platform" &&
      finding.code === "management_mode_unknown"
    )));
    assert.ok(result.recommendedActions.includes("validate"));
  });

  it("increases priority when audit and support relevance are high", () => {
    const lowRelevanceRules: GovernanceBlueprintRules = {
      ...baseRules,
      relevance: {
        support: 1,
        audit: 1,
        billing: 0,
        reporting: 0,
        compliance: 0,
      },
    };
    const highRelevanceRules: GovernanceBlueprintRules = {
      ...baseRules,
      relevance: {
        support: 3,
        audit: 3,
        billing: 0,
        reporting: 0,
        compliance: 0,
      },
    };

    const low = evaluateGovernanceObject(baseObject, lowRelevanceRules);
    const high = evaluateGovernanceObject(baseObject, highRelevanceRules);

    assert.ok(high.scores.relevanceWeightedPriority > low.scores.relevanceWeightedPriority);
  });

  it("recommends block_automation when automatable is false", () => {
    const result = evaluateGovernanceObject(
      {
        ...baseObject,
        fields: {
          ...baseObject.fields,
          automatable: false,
        },
      },
      baseRules
    );

    assert.equal(result.automationReadiness.ready, false);
    assert.ok(result.recommendedActions.includes("block_automation"));
    assert.ok(result.findings.some((finding) => finding.code === "automation_not_approved"));
  });

  it("recommends report, not block, for low relevance missing optional data", () => {
    const rules: GovernanceBlueprintRules = {
      objectType: "netbox_vm",
      dataManagement: [
        {
          fieldKey: "optionalCostCenter",
          label: "Cost center",
          required: false,
          managementMode: "manual",
          weight: 1,
        },
      ],
      ownership: [],
      relevance: {
        support: 0,
        audit: 0,
        billing: 1,
        reporting: 0,
        compliance: 0,
      },
      reporting: {
        minimumGovernanceScoreForAutomation: 70,
        highPriorityRelevanceScore: 10,
      },
      customerScope: DEFAULT_CUSTOMER_SCOPE_GOVERNANCE_POLICY,
    };

    const result = evaluateGovernanceObject(
      {
        objectType: "netbox_vm",
        fields: {},
      },
      rules
    );

    assert.equal(result.automationReadiness.ready, true);
    assert.ok(result.recommendedActions.includes("report"));
    assert.ok(!result.recommendedActions.includes("block_automation"));
  });

  it("calculates scores deterministically", () => {
    const object = {
      ...baseObject,
      fields: {
        ...baseObject.fields,
        providerState: "",
      },
      owners: {
        ...baseObject.owners,
        technical_owner: "",
      },
    };

    const first = evaluateGovernanceObject(object, baseRules);
    const second = evaluateGovernanceObject(object, baseRules);

    assert.deepEqual(first, second);
  });
});


describe("canonical NetBox customer assignment requirements", () => {
  const legacyRules = governanceBlueprintRulesSchema.parse({ ...baseRules, customerScope: undefined,
    dataManagement: [{ fieldKey: "tenant", label: "Tenant", required: true, managementMode: "owned_by_cmdb", weight: 1 }],
  });
  it("resolved NetBox Tenant CustomerScope satisfies legacy and standard requirements without raw tenant", () => {
    const object = withCustomerAssignments([dedicatedCustomerScopeAssignment()]);
    delete object.fields.tenant;
    for (const rules of [legacyRules, baseRules]) {
      const result = evaluateGovernanceObject(object, rules);
      assert.ok(!result.findings.some(f => f.code === "required_data_missing" && ["tenant", "customerAssignment"].includes(f.fieldKey ?? "")));
      assert.equal(result.scores.governance, 100);
      assert.equal(result.automationReadiness.ready, true);
    }
  });
  it("resolved shared and internal CustomerScope references satisfy the presence rule", () => {
    for (const relationship of ["shared", "internal"]) {
      const result = evaluateGovernanceObject(withCustomerAssignments([dedicatedCustomerScopeAssignment({ relationship })]), legacyRules);
      assert.ok(!result.findings.some(f => f.code === "required_data_missing"));
    }
  });
  it("raw tenant cannot mask missing assignments when resolved context exists", () => {
    const result = evaluateGovernanceObject(withCustomerAssignments([]), legacyRules);
    const finding = result.findings.find(f => f.code === "required_data_missing");
    assert.equal(finding?.fieldKey, "customerAssignment");
    assert.equal(finding?.message, "Customer assignment is required but missing.");
  });
  it("dangling or unassigned scope references do not satisfy the requirement", () => {
    for (const assignment of [dedicatedCustomerScopeAssignment({ customerScope: null }), dedicatedCustomerScopeAssignment({ relationship: "unassigned" })]) {
      const result = evaluateGovernanceObject(withCustomerAssignments([assignment]), legacyRules);
      assert.ok(result.findings.some(f => f.code === "required_data_missing" && f.fieldKey === "customerAssignment"));
    }
  });
  it("legacy normalized inputs without assignment context remain compatible", () => {
    assert.ok(!evaluateGovernanceObject(baseObject, legacyRules).findings.some(f => f.code === "required_data_missing"));
  });
});

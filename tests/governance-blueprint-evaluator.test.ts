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
            fieldKey: "tenant",
            label: "Duplicate tenant",
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
          rule.fieldKey === "tenant" ? { ...rule, weight: 0.09 } : rule
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
      baseRules,
    );

    assert.ok(!result.findings.some((finding) => finding.code.startsWith("CUSTOMER_")));
    assert.equal(result.scores.governance, 100);
    assert.equal(result.automationReadiness.ready, true);
  });

  it("creates CUSTOMER_SCOPE_MISSING when no CustomerScope assignment exists", () => {
    const result = evaluateGovernanceObject(withCustomerAssignments([]), baseRules);

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

  it("does not apply CustomerScope policy modes to score or readiness yet", () => {
    const baseline = evaluateGovernanceObject(withCustomerAssignments([]), baseRules);

    for (const mode of ["score_only", "readiness", "enforce"] as const) {
      const result = evaluateGovernanceObject(
        withCustomerAssignments([]),
        {
          ...baseRules,
          customerScope: {
            ...DEFAULT_CUSTOMER_SCOPE_GOVERNANCE_POLICY,
            mode,
            scoreWeight: 5,
          },
        },
      );

      assert.deepEqual(result.scores, baseline.scores);
      assert.deepEqual(result.automationReadiness, baseline.automationReadiness);
      assert.ok(!result.recommendedActions.includes("block_automation"));
    }
  });

  it("creates CUSTOMER_ASSIGNMENT_UNASSIGNED without treating internal as unassigned", () => {
    const unassigned = evaluateGovernanceObject(
      withCustomerAssignments([dedicatedCustomerScopeAssignment({
        relationship: "unassigned",
        customerScopeId: null,
        customerScope: null,
      })]),
      baseRules,
    );
    const internal = evaluateGovernanceObject(
      withCustomerAssignments([dedicatedCustomerScopeAssignment({
        relationship: "internal",
        customerScopeId: null,
        customerScope: null,
      })]),
      baseRules,
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
      baseRules,
    );

    assert.ok(!result.findings.some((finding) => finding.code.startsWith("CUSTOMER_")));
    assert.equal(result.scores.governance, 100);
    assert.equal(result.automationReadiness.ready, true);
  });

  it("creates CUSTOMER_ASSIGNMENT_LOW_CONFIDENCE for non-authoritative assignment confidence", () => {
    const result = evaluateGovernanceObject(
      withCustomerAssignments([dedicatedCustomerScopeAssignment({ confidence: "mapped" })]),
      baseRules,
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
      baseRules,
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
      baseRules,
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

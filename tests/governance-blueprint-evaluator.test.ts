import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluateGovernanceObject,
  type NormalizedGovernanceObject,
  STANDARD_NETBOX_VM_GOVERNANCE_BLUEPRINT,
} from "../server/services/governance-blueprint-evaluator";
import {
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

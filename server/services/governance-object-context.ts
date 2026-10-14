import type { IStorage } from "../storage";
import type { CustomerScope, CustomerScopeObjectAssignment, NetboxVm } from "../../shared/schema";
import type { NormalizedGovernanceObject } from "./governance-blueprint-evaluator";

interface NormalizedCustomerScopeReference {
  id: string;
  externalId: string;
  name: string;
  displayName: string | null;
  strategy: string;
  isolation: string | null;
}

interface NormalizedCustomerScopeAssignment {
  id: string;
  customerScopeId: string | null;
  relationship: string;
  derivedFrom: string;
  confidence: string;
  lastSyncedAt: Date | null;
  customerScope: NormalizedCustomerScopeReference | null;
}

interface CustomerScopeGovernanceContext {
  customerAssignments: NormalizedCustomerScopeAssignment[];
  customerAssignmentRelationship: string | null;
  customerScopeCount: number;
  hasCustomerScope: boolean;
  isCustomerUnassigned: boolean;
  customerAssignmentConfidence: string | null;
  customerAssignmentDerivedFrom: string | null;
}

export async function loadCustomerScopeContextByObjectId(
  storage: Pick<IStorage, "listCustomerScopeObjectAssignments" | "listCustomerScopes">,
  orgId: string,
  sourceId?: string,
): Promise<Map<string, CustomerScopeGovernanceContext>> {
  const [assignments, scopes] = await Promise.all([
    storage.listCustomerScopeObjectAssignments(orgId, "netbox_inventory_source", sourceId),
    storage.listCustomerScopes(orgId, "netbox_inventory_source", sourceId),
  ]);
  const scopesById = new Map(scopes.map((scope) => [scope.id, scope]));
  const assignmentsByObjectId = new Map<string, NormalizedCustomerScopeAssignment[]>();

  for (const assignment of assignments) {
    if (assignment.objectType !== "netbox_vm") continue;
    const current = assignmentsByObjectId.get(assignment.objectId) ?? [];
    current.push(normalizeCustomerScopeAssignmentForGovernance(assignment, scopesById));
    assignmentsByObjectId.set(assignment.objectId, current);
  }

  const contextByObjectId = new Map<string, CustomerScopeGovernanceContext>();
  for (const [objectId, objectAssignments] of Array.from(assignmentsByObjectId.entries())) {
    const customerScopeCount = objectAssignments.filter((assignment: NormalizedCustomerScopeAssignment) => assignment.customerScope).length;
    contextByObjectId.set(objectId, {
      customerAssignments: objectAssignments,
      customerAssignmentRelationship: objectAssignments[0]?.relationship ?? null,
      customerScopeCount,
      hasCustomerScope: customerScopeCount > 0,
      isCustomerUnassigned: objectAssignments.some((assignment: NormalizedCustomerScopeAssignment) => assignment.relationship === "unassigned"),
      customerAssignmentConfidence: objectAssignments[0]?.confidence ?? null,
      customerAssignmentDerivedFrom: objectAssignments[0]?.derivedFrom ?? null,
    });
  }

  return contextByObjectId;
}

function normalizeCustomerScopeAssignmentForGovernance(
  assignment: CustomerScopeObjectAssignment,
  scopesById: Map<string, CustomerScope>,
): NormalizedCustomerScopeAssignment {
  const scope = assignment.customerScopeId ? scopesById.get(assignment.customerScopeId) ?? null : null;
  return {
    id: assignment.id,
    customerScopeId: assignment.customerScopeId,
    relationship: assignment.relationship,
    derivedFrom: assignment.derivedFrom,
    confidence: assignment.confidence,
    lastSyncedAt: assignment.lastSyncedAt,
    customerScope: scope ? {
      id: scope.id,
      externalId: scope.externalId,
      name: scope.name,
      displayName: scope.displayName,
      strategy: scope.strategy,
      isolation: scope.isolation,
    } : null,
  };
}

function emptyCustomerScopeGovernanceContext(): CustomerScopeGovernanceContext {
  return {
    customerAssignments: [],
    customerAssignmentRelationship: null,
    customerScopeCount: 0,
    hasCustomerScope: false,
    isCustomerUnassigned: false,
    customerAssignmentConfidence: null,
    customerAssignmentDerivedFrom: null,
  };
}

export function normalizeCachedNetboxVm(
  vm: NetboxVm,
  customerScopeContext: CustomerScopeGovernanceContext = emptyCustomerScopeGovernanceContext(),
): NormalizedGovernanceObject {
  const customFields = isRecord(vm.customFields) ? vm.customFields : {};

  return {
    objectType: "netbox_vm",
    objectId: vm.id,
    objectName: vm.name,
    fields: {
      tenant: customFields.tenant,
      role: customFields._netboxRole ?? customFields.role,
      platform: vm.operatingSystem,
      primaryIp: vm.ip,
      automatable: customFields.automatable,
      providerState: customFields.provider_state,
      customerAssignments: customerScopeContext.customerAssignments,
      customerAssignmentRelationship: customerScopeContext.customerAssignmentRelationship,
      customerScopeCount: customerScopeContext.customerScopeCount,
      hasCustomerScope: customerScopeContext.hasCustomerScope,
      isCustomerUnassigned: customerScopeContext.isCustomerUnassigned,
      customerAssignmentConfidence: customerScopeContext.customerAssignmentConfidence,
      customerAssignmentDerivedFrom: customerScopeContext.customerAssignmentDerivedFrom,
    },
    owners: {
      technical_owner: customFields.technical_owner,
      service_owner: customFields.service_owner,
      data_owner: customFields.data_owner,
      operations_team: customFields.operations_team,
      business_owner: customFields.business_owner,
    },
  };
}


function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

import type {
  CiCustomerRelationship,
  CustomerScopeAssignmentConfidence,
  CustomerScopeAssignmentDerivedFrom,
  CustomerScopeIsolation,
  CustomerScopeStrategy,
} from "./schema";
import {
  ciCustomerRelationshipValues,
  customerScopeAssignmentConfidenceValues,
  customerScopeAssignmentDerivedFromValues,
  customerScopeIsolationValues,
  customerScopeStrategyValues,
} from "./schema";

export interface ProviderCustomerMapping {
  provider: string;
  strategy: CustomerScopeStrategy;
  providerObject: string;
  isolation: CustomerScopeIsolation;
  supportsSharedCis: boolean;
  allowOverride: boolean;
  notes?: string;
}

export const providerCustomerMappings = [
  {
    provider: "netbox",
    strategy: "tenant",
    providerObject: "Tenant",
    isolation: "assignment",
    supportsSharedCis: true,
    allowOverride: true,
    notes: "NetBox tenants can be assigned to virtual machines and other CMDB objects.",
  },
  {
    provider: "idoit_single_mandant",
    strategy: "organization",
    providerObject: "Organization / Customer",
    isolation: "logical",
    supportsSharedCis: true,
    allowOverride: true,
  },
  {
    provider: "idoit_multi_mandant",
    strategy: "mandant",
    providerObject: "Mandant",
    isolation: "hard",
    supportsSharedCis: false,
    allowOverride: true,
  },
  {
    provider: "servicenow",
    strategy: "domain",
    providerObject: "Domain / Customer Account",
    isolation: "logical",
    supportsSharedCis: true,
    allowOverride: true,
  },
  {
    provider: "bmc_helix",
    strategy: "company",
    providerObject: "Company",
    isolation: "logical",
    supportsSharedCis: true,
    allowOverride: true,
  },
  {
    provider: "opentext_ucmdb",
    strategy: "customer",
    providerObject: "Customer / Tenant",
    isolation: "logical",
    supportsSharedCis: true,
    allowOverride: true,
  },
  {
    provider: "itop",
    strategy: "organization",
    providerObject: "Organization",
    isolation: "logical",
    supportsSharedCis: true,
    allowOverride: true,
  },
  {
    provider: "glpi",
    strategy: "entity",
    providerObject: "Entity",
    isolation: "logical",
    supportsSharedCis: true,
    allowOverride: true,
  },
  {
    provider: "manageengine_sdp_msp",
    strategy: "account",
    providerObject: "Account",
    isolation: "logical",
    supportsSharedCis: true,
    allowOverride: true,
  },
  {
    provider: "generic_custom_field",
    strategy: "custom_field",
    providerObject: "Configured field",
    isolation: "custom",
    supportsSharedCis: true,
    allowOverride: true,
  },
  {
    provider: "generic_tag",
    strategy: "tag",
    providerObject: "Tag",
    isolation: "custom",
    supportsSharedCis: true,
    allowOverride: true,
  },
  {
    provider: "generic_manual",
    strategy: "manual",
    providerObject: "Manual assignment",
    isolation: "custom",
    supportsSharedCis: true,
    allowOverride: true,
  },
] as const satisfies readonly ProviderCustomerMapping[];

export type ProviderCustomerMappingKey = typeof providerCustomerMappings[number]["provider"];

const mappingsByProvider = new Map<string, ProviderCustomerMapping>(
  providerCustomerMappings.map((mapping) => [mapping.provider, mapping]),
);

export function getProviderCustomerMapping(providerKey: string): ProviderCustomerMapping | undefined {
  return mappingsByProvider.get(providerKey);
}

export function listProviderCustomerMappings(): ProviderCustomerMapping[] {
  return [...providerCustomerMappings];
}

export function isCustomerScopeStrategySupported(
  providerKey: string,
  strategy: CustomerScopeStrategy,
): boolean {
  return getProviderCustomerMapping(providerKey)?.strategy === strategy;
}

export function assertCustomerScopeStrategySupported(
  providerKey: string,
  strategy: CustomerScopeStrategy,
): ProviderCustomerMapping {
  const mapping = getProviderCustomerMapping(providerKey);
  if (!mapping) {
    throw new Error(`Unsupported CustomerScope provider mapping: ${providerKey}`);
  }
  if (mapping.strategy !== strategy) {
    throw new Error(
      `CustomerScope strategy ${strategy} is not supported for ${providerKey}; expected ${mapping.strategy}`,
    );
  }
  return mapping;
}

export interface CustomerScopeResolverContext {
  orgId: string;
  sourceType: string;
  sourceId: string;
  providerKey: string;
  metadata?: Record<string, unknown>;
}

export interface DiscoveredCustomerScope {
  externalId: string;
  name: string;
  displayName?: string;
  strategy: CustomerScopeStrategy;
  isolation?: CustomerScopeIsolation;
  parentExternalId?: string;
  metadata?: Record<string, unknown>;
}

export interface ExternalCiCustomerInput extends CustomerScopeResolverContext {
  objectType: string;
  objectId: string;
  externalId?: string;
  name?: string;
  raw?: unknown;
  providerFields?: Record<string, unknown>;
}

export interface ResolvedCustomerScopeAssignment {
  relationship: CiCustomerRelationship;
  customerScopes: DiscoveredCustomerScope[];
  derivedFrom: CustomerScopeAssignmentDerivedFrom;
  confidence: CustomerScopeAssignmentConfidence;
  metadata?: Record<string, unknown>;
  reason?: string;
}

export interface CustomerScopeResolver {
  providerKey: string;
  discoverScopes(input: CustomerScopeResolverContext): Promise<DiscoveredCustomerScope[]>;
  resolveCiScopes(input: ExternalCiCustomerInput): Promise<ResolvedCustomerScopeAssignment>;
}

function includesString(values: readonly string[], value: string): boolean {
  return values.includes(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function validateDiscoveredCustomerScope(scope: DiscoveredCustomerScope): string[] {
  const errors: string[] = [];

  if (!isNonEmptyString(scope.externalId)) {
    errors.push("discovered customer scope externalId is required");
  }
  if (!isNonEmptyString(scope.name)) {
    errors.push("discovered customer scope name is required");
  }
  if (!includesString(customerScopeStrategyValues, scope.strategy)) {
    errors.push(`unsupported customer scope strategy: ${scope.strategy}`);
  }
  if (scope.isolation && !includesString(customerScopeIsolationValues, scope.isolation)) {
    errors.push(`unsupported customer scope isolation: ${scope.isolation}`);
  }

  return errors;
}

export function assertValidDiscoveredCustomerScope(scope: DiscoveredCustomerScope): DiscoveredCustomerScope {
  const errors = validateDiscoveredCustomerScope(scope);
  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }
  return scope;
}

export function validateResolvedCustomerScopeAssignment(
  assignment: ResolvedCustomerScopeAssignment,
): string[] {
  const errors: string[] = [];

  if (!includesString(ciCustomerRelationshipValues, assignment.relationship)) {
    errors.push(`unsupported customer scope relationship: ${assignment.relationship}`);
  }
  if (!includesString(customerScopeAssignmentDerivedFromValues, assignment.derivedFrom)) {
    errors.push(`unsupported customer scope assignment source: ${assignment.derivedFrom}`);
  }
  if (!includesString(customerScopeAssignmentConfidenceValues, assignment.confidence)) {
    errors.push(`unsupported customer scope assignment confidence: ${assignment.confidence}`);
  }
  if (!Array.isArray(assignment.customerScopes)) {
    errors.push("customerScopes must be an array");
    return errors;
  }

  assignment.customerScopes.forEach((scope, index) => {
    validateDiscoveredCustomerScope(scope).forEach((error) => {
      errors.push(`customerScopes[${index}]: ${error}`);
    });
  });

  if (assignment.relationship === "unassigned" && assignment.customerScopes.length > 0) {
    errors.push("unassigned customer scope assignment must not include customer scopes");
  }
  if (assignment.relationship === "dedicated" && assignment.customerScopes.length !== 1) {
    errors.push("dedicated customer scope assignment must include exactly one customer scope");
  }
  if (assignment.relationship === "shared" && assignment.customerScopes.length < 1) {
    errors.push("shared customer scope assignment must include at least one customer scope");
  }

  return errors;
}

export function assertValidResolvedCustomerScopeAssignment(
  assignment: ResolvedCustomerScopeAssignment,
): ResolvedCustomerScopeAssignment {
  const errors = validateResolvedCustomerScopeAssignment(assignment);
  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }
  return assignment;
}

export function createDefaultCustomerScopeResolver(
  providerKey = "generic_manual",
): CustomerScopeResolver {
  return {
    providerKey,
    async discoverScopes() {
      return [];
    },
    async resolveCiScopes() {
      return {
        relationship: "unassigned",
        customerScopes: [],
        derivedFrom: "manual",
        confidence: "manual",
        reason: `No CustomerScope resolver is configured for provider ${providerKey}; CI remains explicitly unassigned.`,
      };
    },
  };
}

export const defaultCustomerScopeResolver = createDefaultCustomerScopeResolver();

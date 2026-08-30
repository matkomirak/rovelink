import type {
  CustomerScopeIsolation,
  CustomerScopeStrategy,
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

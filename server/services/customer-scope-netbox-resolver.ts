import {
  assertCustomerScopeStrategySupported,
  assertValidDiscoveredCustomerScope,
  assertValidResolvedCustomerScopeAssignment,
  type CustomerScopeResolver,
  type DiscoveredCustomerScope,
  type ExternalCiCustomerInput,
  type ResolvedCustomerScopeAssignment,
} from "@shared/customer-scope";

const NETBOX_PROVIDER_KEY = "netbox";

type NetBoxTenantRecord = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function getNetBoxMapping() {
  const mapping = assertCustomerScopeStrategySupported(NETBOX_PROVIDER_KEY, "tenant");
  if (mapping.isolation !== "assignment") {
    throw new Error(`NetBox CustomerScope isolation must be assignment; got ${mapping.isolation}`);
  }
  return mapping;
}

function getTenantFromVm(raw: unknown): unknown {
  return isRecord(raw) ? raw.tenant : undefined;
}

function getGroupSummary(group: unknown): Record<string, unknown> | undefined {
  if (!isRecord(group)) return undefined;

  const summary: Record<string, unknown> = {};
  const id = stringValue(group.id);
  const name = stringValue(group.name);
  const slug = stringValue(group.slug);
  const display = stringValue(group.display);
  const url = stringValue(group.url);

  if (id) summary.id = id;
  if (name) summary.name = name;
  if (slug) summary.slug = slug;
  if (display) summary.display = display;
  if (url) summary.url = url;

  return Object.keys(summary).length > 0 ? summary : undefined;
}

function getParentExternalId(group: unknown): string | null {
  if (!isRecord(group)) return null;
  return stringValue(group.id) ?? stringValue(group.slug) ?? null;
}

function buildTenantMetadata(tenant: NetBoxTenantRecord): Record<string, unknown> {
  const metadata: Record<string, unknown> = { provider: NETBOX_PROVIDER_KEY };
  const slug = stringValue(tenant.slug);
  const display = stringValue(tenant.display);
  const url = stringValue(tenant.url);
  const group = getGroupSummary(tenant.group);

  if (slug) metadata.slug = slug;
  if (display) metadata.display = display;
  if (url) metadata.url = url;
  if (group) metadata.group = group;

  return metadata;
}

function buildIncompleteTenantMetadata(tenant: unknown): Record<string, unknown> {
  const record = isRecord(tenant) ? tenant : {};
  return {
    provider: NETBOX_PROVIDER_KEY,
    tenantPresent: tenant !== null && tenant !== undefined,
    hasStableId: Boolean(stringValue(record.id)),
    hasName: Boolean(stringValue(record.name)),
  };
}

export function extractNetBoxTenantScope(rawVm: unknown): DiscoveredCustomerScope | undefined {
  const mapping = getNetBoxMapping();
  const tenant = getTenantFromVm(rawVm);

  if (!isRecord(tenant)) return undefined;

  const externalId = stringValue(tenant.id);
  const name = stringValue(tenant.name);
  if (!externalId || !/^[1-9]\d*$/.test(externalId) || !name || name.length > 2048 || /[\0-\x1f]/.test(name)) return undefined;

  return assertValidDiscoveredCustomerScope({
    externalId,
    name,
    displayName: stringValue(tenant.display) ?? name,
    strategy: mapping.strategy,
    isolation: mapping.isolation,
    parentExternalId: getParentExternalId(tenant.group),
    metadata: buildTenantMetadata(tenant),
  });
}

export function resolveNetBoxVmCustomerScopeAssignment(
  input: ExternalCiCustomerInput,
): ResolvedCustomerScopeAssignment {
  const scope = extractNetBoxTenantScope(input.raw);
  if (scope) {
    return assertValidResolvedCustomerScopeAssignment({
      relationship: "dedicated",
      customerScopes: [scope],
      derivedFrom: "provider",
      confidence: "authoritative",
      metadata: { provider: NETBOX_PROVIDER_KEY },
      reason: "Resolved from NetBox VM tenant",
    });
  }

  const tenant = getTenantFromVm(input.raw);
  const reason = tenant === null || tenant === undefined
    ? "NetBox VM has no tenant"
    : "NetBox VM tenant payload is incomplete; stable id and name are required";

  return assertValidResolvedCustomerScopeAssignment({
    relationship: "unassigned",
    customerScopes: [],
    derivedFrom: "provider",
    confidence: "authoritative",
    metadata: buildIncompleteTenantMetadata(tenant),
    reason,
  });
}

export const netboxCustomerScopeResolver: CustomerScopeResolver = {
  providerKey: NETBOX_PROVIDER_KEY,
  async discoverScopes() {
    return [];
  },
  async resolveCiScopes(input) {
    return resolveNetBoxVmCustomerScopeAssignment(input);
  },
};

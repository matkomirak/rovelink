import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  getProviderCustomerMapping,
} from "../shared/customer-scope";
import {
  extractNetBoxTenantScope,
  netboxCustomerScopeResolver,
  resolveNetBoxVmCustomerScopeAssignment,
} from "../server/services/customer-scope-netbox-resolver";

function resolverInput(raw: unknown) {
  return {
    orgId: "org-1",
    sourceType: "netbox_inventory_source",
    sourceId: "source-1",
    providerKey: "netbox",
    objectType: "netbox_vm",
    objectId: "cached-vm-1",
    raw,
  };
}

describe("NetBox CustomerScope resolver", () => {
  test("tenant with id and name maps to dedicated authoritative assignment", () => {
    const resolved = resolveNetBoxVmCustomerScopeAssignment(resolverInput({
      id: 101,
      name: "app-001",
      tenant: { id: 20, name: "Engineering" },
    }));

    assert.equal(resolved.relationship, "dedicated");
    assert.equal(resolved.derivedFrom, "provider");
    assert.equal(resolved.confidence, "authoritative");
    assert.equal(resolved.reason, "Resolved from NetBox VM tenant");
    assert.equal(resolved.customerScopes.length, 1);
    assert.deepEqual(resolved.customerScopes[0], {
      externalId: "20",
      name: "Engineering",
      displayName: "Engineering",
      strategy: "tenant",
      isolation: "assignment",
      parentExternalId: null,
      metadata: { provider: "netbox" },
    });
  });

  test("tenant with slug, display, url, and group maps safe metadata and parentExternalId", () => {
    const scope = extractNetBoxTenantScope({
      id: 101,
      tenant: {
        id: 20,
        name: "Engineering",
        slug: "engineering",
        display: "Engineering Team",
        url: "https://netbox.example/api/tenancy/tenants/20/",
        group: {
          id: 7,
          name: "Managed Customers",
          slug: "managed-customers",
          display: "Managed Customers",
          url: "https://netbox.example/api/tenancy/tenant-groups/7/",
          token: "must-not-leak",
        },
      },
    });

    assert.deepEqual(scope, {
      externalId: "20",
      name: "Engineering",
      displayName: "Engineering Team",
      strategy: "tenant",
      isolation: "assignment",
      parentExternalId: "7",
      metadata: {
        provider: "netbox",
        slug: "engineering",
        display: "Engineering Team",
        url: "https://netbox.example/api/tenancy/tenants/20/",
        group: {
          id: "7",
          name: "Managed Customers",
          slug: "managed-customers",
          display: "Managed Customers",
          url: "https://netbox.example/api/tenancy/tenant-groups/7/",
        },
      },
    });
  });

  test("VM without tenant maps to explicit unassigned", () => {
    const resolved = resolveNetBoxVmCustomerScopeAssignment(resolverInput({
      id: 101,
      name: "app-001",
    }));

    assert.equal(resolved.relationship, "unassigned");
    assert.deepEqual(resolved.customerScopes, []);
    assert.equal(resolved.derivedFrom, "provider");
    assert.equal(resolved.confidence, "authoritative");
    assert.equal(resolved.reason, "NetBox VM has no tenant");
  });

  test("null tenant maps to explicit unassigned", () => {
    const resolved = resolveNetBoxVmCustomerScopeAssignment(resolverInput({
      id: 101,
      name: "app-001",
      tenant: null,
    }));

    assert.equal(resolved.relationship, "unassigned");
    assert.deepEqual(resolved.customerScopes, []);
    assert.equal(resolved.reason, "NetBox VM has no tenant");
  });

  test("partial tenant without id maps to unassigned", () => {
    const resolved = resolveNetBoxVmCustomerScopeAssignment(resolverInput({
      id: 101,
      name: "app-001",
      tenant: { name: "Engineering" },
    }));

    assert.equal(resolved.relationship, "unassigned");
    assert.deepEqual(resolved.customerScopes, []);
    assert.equal(resolved.reason, "NetBox VM tenant payload is incomplete; stable id and name are required");
    assert.deepEqual(resolved.metadata, {
      provider: "netbox",
      tenantPresent: true,
      hasStableId: false,
      hasName: true,
    });
  });

  test("partial tenant without name maps to unassigned", () => {
    const resolved = resolveNetBoxVmCustomerScopeAssignment(resolverInput({
      id: 101,
      name: "app-001",
      tenant: { id: 20 },
    }));

    assert.equal(resolved.relationship, "unassigned");
    assert.deepEqual(resolved.customerScopes, []);
    assert.equal(resolved.reason, "NetBox VM tenant payload is incomplete; stable id and name are required");
    assert.deepEqual(resolved.metadata, {
      provider: "netbox",
      tenantPresent: true,
      hasStableId: true,
      hasName: false,
    });
  });

  test("tags are ignored when tenant exists", () => {
    const resolved = resolveNetBoxVmCustomerScopeAssignment(resolverInput({
      id: 101,
      name: "app-001",
      tenant: { id: 20, name: "Engineering" },
      tags: [
        { name: "customer-finance" },
        { name: "tenant-operations" },
      ],
      custom_fields: {
        customer: "Finance",
        tenant: "Operations",
      },
    }));

    assert.equal(resolved.relationship, "dedicated");
    assert.equal(resolved.customerScopes[0]?.externalId, "20");
    assert.equal(resolved.customerScopes[0]?.name, "Engineering");
  });

  test("registry alignment with netbox mapping", () => {
    const mapping = getProviderCustomerMapping("netbox");

    assert.equal(mapping?.strategy, "tenant");
    assert.equal(mapping?.isolation, "assignment");
    assert.equal(netboxCustomerScopeResolver.providerKey, "netbox");
  });

  test("resolver does not require provider API client usage", async () => {
    assert.equal(typeof netboxCustomerScopeResolver.discoverScopes, "function");
    assert.equal(typeof netboxCustomerScopeResolver.resolveCiScopes, "function");
    assert.deepEqual(await netboxCustomerScopeResolver.discoverScopes({
      orgId: "org-1",
      sourceType: "netbox_inventory_source",
      sourceId: "source-1",
      providerKey: "netbox",
    }), []);
  });

  test("secret-shaped tenant fields are not included in metadata", () => {
    const scope = extractNetBoxTenantScope({
      id: 101,
      tenant: {
        id: 20,
        name: "Engineering",
        slug: "engineering",
        token: "tenant-token",
        password: "tenant-password",
        api_key: "tenant-api-key",
        secret: "tenant-secret",
        group: {
          id: 7,
          name: "Managed Customers",
          token: "group-token",
          apiKey: "group-api-key",
        },
      },
    });

    const serializedMetadata = JSON.stringify(scope?.metadata);
    assert.ok(!serializedMetadata.includes("tenant-token"));
    assert.ok(!serializedMetadata.includes("tenant-password"));
    assert.ok(!serializedMetadata.includes("tenant-api-key"));
    assert.ok(!serializedMetadata.includes("tenant-secret"));
    assert.ok(!serializedMetadata.includes("group-token"));
    assert.ok(!serializedMetadata.includes("group-api-key"));
  });
});

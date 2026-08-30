import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  assertValidResolvedCustomerScopeAssignment,
  createDefaultCustomerScopeResolver,
  getProviderCustomerMapping,
  type CustomerScopeResolver,
  type DiscoveredCustomerScope,
  type ResolvedCustomerScopeAssignment,
} from "../shared/customer-scope";

const acmeScope: DiscoveredCustomerScope = {
  externalId: "tenant-1",
  name: "Acme",
  displayName: "Acme Corp",
  strategy: "tenant",
  isolation: "assignment",
};

const betaScope: DiscoveredCustomerScope = {
  externalId: "tenant-2",
  name: "Beta",
  strategy: "tenant",
  isolation: "assignment",
};

function assignment(
  overrides: Partial<ResolvedCustomerScopeAssignment>,
): ResolvedCustomerScopeAssignment {
  return {
    relationship: "dedicated",
    customerScopes: [acmeScope],
    derivedFrom: "provider",
    confidence: "authoritative",
    ...overrides,
  };
}

describe("CustomerScope resolver abstraction", () => {
  test("resolver contract exports support async discovery and resolution", async () => {
    const resolver: CustomerScopeResolver = {
      providerKey: "netbox",
      async discoverScopes() {
        return [acmeScope];
      },
      async resolveCiScopes() {
        return assignment({});
      },
    };

    assert.equal(resolver.providerKey, "netbox");
    assert.deepEqual(
      await resolver.discoverScopes({
        orgId: "org-1",
        sourceType: "cmdb",
        sourceId: "source-1",
        providerKey: "netbox",
      }),
      [acmeScope],
    );
    assert.equal(
      (await resolver.resolveCiScopes({
        orgId: "org-1",
        sourceType: "cmdb",
        sourceId: "source-1",
        providerKey: "netbox",
        objectType: "netbox_vm",
        objectId: "vm-1",
      })).relationship,
      "dedicated",
    );
  });

  test("default resolver returns explicit unassigned assignment", async () => {
    const resolver = createDefaultCustomerScopeResolver("unsupported_provider");

    assert.deepEqual(
      await resolver.discoverScopes({
        orgId: "org-1",
        sourceType: "cmdb",
        sourceId: "source-1",
        providerKey: "unsupported_provider",
      }),
      [],
    );

    const resolved = await resolver.resolveCiScopes({
      orgId: "org-1",
      sourceType: "cmdb",
      sourceId: "source-1",
      providerKey: "unsupported_provider",
      objectType: "netbox_vm",
      objectId: "vm-1",
    });

    assert.equal(resolved.relationship, "unassigned");
    assert.equal(resolved.customerScopes.length, 0);
    assert.equal(resolved.derivedFrom, "manual");
    assert.equal(resolved.confidence, "manual");
    assert.match(resolved.reason ?? "", /No CustomerScope resolver is configured/);
  });

  test("validation rejects dedicated assignment with zero scopes", () => {
    assert.throws(
      () => assertValidResolvedCustomerScopeAssignment(assignment({ customerScopes: [] })),
      /dedicated customer scope assignment must include exactly one customer scope/,
    );
  });

  test("validation rejects dedicated assignment with multiple scopes", () => {
    assert.throws(
      () => assertValidResolvedCustomerScopeAssignment(assignment({ customerScopes: [acmeScope, betaScope] })),
      /dedicated customer scope assignment must include exactly one customer scope/,
    );
  });

  test("validation accepts shared assignment with multiple scopes", () => {
    const resolved = assertValidResolvedCustomerScopeAssignment(assignment({
      relationship: "shared",
      customerScopes: [acmeScope, betaScope],
    }));

    assert.equal(resolved.relationship, "shared");
    assert.equal(resolved.customerScopes.length, 2);
  });

  test("validation rejects unassigned assignment with scopes", () => {
    assert.throws(
      () => assertValidResolvedCustomerScopeAssignment(assignment({
        relationship: "unassigned",
        customerScopes: [acmeScope],
        derivedFrom: "manual",
        confidence: "manual",
      })),
      /unassigned customer scope assignment must not include customer scopes/,
    );
  });

  test("validation accepts unassigned assignment without scopes", () => {
    const resolved = assertValidResolvedCustomerScopeAssignment(assignment({
      relationship: "unassigned",
      customerScopes: [],
      derivedFrom: "manual",
      confidence: "manual",
    }));

    assert.equal(resolved.relationship, "unassigned");
    assert.equal(resolved.customerScopes.length, 0);
  });

  test("validation accepts internal assignment without external scope", () => {
    const resolved = assertValidResolvedCustomerScopeAssignment(assignment({
      relationship: "internal",
      customerScopes: [],
      derivedFrom: "mapping_rule",
      confidence: "mapped",
    }));

    assert.equal(resolved.relationship, "internal");
    assert.equal(resolved.customerScopes.length, 0);
  });

  test("provider registry can be used together with resolver types", async () => {
    const mapping = getProviderCustomerMapping("netbox");
    assert.ok(mapping);

    const resolver: CustomerScopeResolver = {
      providerKey: mapping.provider,
      async discoverScopes() {
        return [{ ...acmeScope, strategy: mapping.strategy, isolation: mapping.isolation }];
      },
      async resolveCiScopes() {
        return {
          relationship: "dedicated",
          customerScopes: [{ ...acmeScope, strategy: mapping.strategy, isolation: mapping.isolation }],
          derivedFrom: "provider",
          confidence: "authoritative",
        };
      },
    };

    const resolved = await resolver.resolveCiScopes({
      orgId: "org-1",
      sourceType: "cmdb",
      sourceId: "source-1",
      providerKey: mapping.provider,
      objectType: "netbox_vm",
      objectId: "vm-1",
    });

    assert.equal(resolver.providerKey, "netbox");
    assert.equal(resolved.customerScopes[0]?.strategy, "tenant");
  });

  test("resolver abstraction does not require provider API clients", async () => {
    const resolver = createDefaultCustomerScopeResolver();
    const resolved = await resolver.resolveCiScopes({
      orgId: "org-1",
      sourceType: "cmdb",
      sourceId: "source-1",
      providerKey: "generic_manual",
      objectType: "netbox_vm",
      objectId: "vm-1",
      raw: { providerPayload: true },
    });

    assert.equal(resolved.relationship, "unassigned");
    assert.equal(typeof resolver.discoverScopes, "function");
    assert.equal(typeof resolver.resolveCiScopes, "function");
  });
});

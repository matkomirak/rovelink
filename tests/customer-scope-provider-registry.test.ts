import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  assertCustomerScopeStrategySupported,
  getProviderCustomerMapping,
  isCustomerScopeStrategySupported,
  listProviderCustomerMappings,
} from "../shared/customer-scope";

describe("CustomerScope provider customer mapping registry", () => {
  test("NetBox default strategy is tenant", () => {
    const mapping = getProviderCustomerMapping("netbox");
    assert.equal(mapping?.strategy, "tenant");
    assert.equal(mapping?.providerObject, "Tenant");
    assert.equal(mapping?.isolation, "assignment");
    assert.equal(mapping?.supportsSharedCis, true);
    assert.equal(mapping?.allowOverride, true);
  });

  test("i-doit single Mandant maps to organization", () => {
    const mapping = getProviderCustomerMapping("idoit_single_mandant");
    assert.equal(mapping?.strategy, "organization");
    assert.equal(mapping?.providerObject, "Organization / Customer");
    assert.equal(mapping?.isolation, "logical");
  });

  test("i-doit multi Mandant maps to mandant and hard isolation", () => {
    const mapping = getProviderCustomerMapping("idoit_multi_mandant");
    assert.equal(mapping?.strategy, "mandant");
    assert.equal(mapping?.providerObject, "Mandant");
    assert.equal(mapping?.isolation, "hard");
    assert.equal(mapping?.supportsSharedCis, false);
  });

  test("ServiceNow maps to domain", () => {
    const mapping = getProviderCustomerMapping("servicenow");
    assert.equal(mapping?.strategy, "domain");
    assert.equal(mapping?.providerObject, "Domain / Customer Account");
    assert.equal(mapping?.isolation, "logical");
  });

  test("GLPI maps to entity", () => {
    const mapping = getProviderCustomerMapping("glpi");
    assert.equal(mapping?.strategy, "entity");
    assert.equal(mapping?.providerObject, "Entity");
    assert.equal(mapping?.isolation, "logical");
  });

  test("generic custom field, tag, and manual mappings exist", () => {
    assert.equal(getProviderCustomerMapping("generic_custom_field")?.strategy, "custom_field");
    assert.equal(getProviderCustomerMapping("generic_tag")?.strategy, "tag");
    assert.equal(getProviderCustomerMapping("generic_manual")?.strategy, "manual");
  });

  test("unsupported provider returns undefined", () => {
    assert.equal(getProviderCustomerMapping("unknown_provider"), undefined);
  });

  test("unsupported strategy is rejected by assert helper", () => {
    assert.equal(isCustomerScopeStrategySupported("netbox", "tenant"), true);
    assert.equal(isCustomerScopeStrategySupported("netbox", "domain"), false);

    assert.throws(
      () => assertCustomerScopeStrategySupported("netbox", "domain"),
      /strategy domain is not supported for netbox/,
    );
  });

  test("unsupported provider is rejected by assert helper", () => {
    assert.throws(
      () => assertCustomerScopeStrategySupported("unknown_provider", "tenant"),
      /Unsupported CustomerScope provider mapping/,
    );
  });

  test("list returns all registry entries", () => {
    const mappings = listProviderCustomerMappings();
    assert.equal(mappings.length, 12);
    assert.deepEqual(
      mappings.map((mapping) => mapping.provider).sort(),
      [
        "bmc_helix",
        "generic_custom_field",
        "generic_manual",
        "generic_tag",
        "glpi",
        "idoit_multi_mandant",
        "idoit_single_mandant",
        "itop",
        "manageengine_sdp_msp",
        "netbox",
        "opentext_ucmdb",
        "servicenow",
      ],
    );
  });

  test("registry is pure metadata and does not require provider clients", () => {
    const mappings = listProviderCustomerMappings();
    assert.ok(mappings.every((mapping) => typeof mapping.provider === "string"));
    assert.ok(mappings.every((mapping) => typeof mapping.providerObject === "string"));
    assert.ok(mappings.every((mapping) => typeof mapping.supportsSharedCis === "boolean"));
  });
});

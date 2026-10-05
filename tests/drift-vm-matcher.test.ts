import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildVmMatchCandidates,
  matchVmInventories,
  normalizeIpList,
  normalizeVmName,
  type ProviderVmInput,
  type ReferenceVmInput,
} from "../server/services/drift/vm-matcher";

function referenceVm(overrides: Partial<ReferenceVmInput> = {}): ReferenceVmInput {
  return {
    id: "ref-1",
    name: "acme-web-01",
    ip: "10.0.0.10",
    operatingSystem: "linux",
    powerState: "running",
    ...overrides,
  };
}

function providerVm(overrides: Partial<ProviderVmInput> = {}): ProviderVmInput {
  return {
    id: "provider-1",
    name: "acme-web-01",
    ip: "10.0.0.10",
    platform: "linux",
    powerState: "running",
    ...overrides,
  };
}

function onlyResult(reference: ReferenceVmInput[], provider: ProviderVmInput[]) {
  const results = matchVmInventories(reference, provider);
  assert.equal(results.length, 1);
  return results[0];
}

describe("pure VM drift matcher", () => {
  test("normalizes VM names and IP lists deterministically", () => {
    assert.equal(normalizeVmName("  ACME-WEB-01. "), "acme-web-01");
    assert.equal(normalizeVmName(" \t "), null);
    assert.deepEqual(normalizeIpList("10.0.0.2, 10.0.0.1 10.0.0.2"), ["10.0.0.1", "10.0.0.2"]);
  });

  test("exact hostname/FQDN unique match has high confidence", () => {
    const result = onlyResult(
      [referenceVm({ id: "ref-host", name: "cmdb-name", fqdn: "Web01.Example.COM" })],
      [providerVm({ id: "provider-host", name: "runtime-name", metadata: { fqdn: "web01.example.com" } })],
    );

    assert.equal(result.matchStatus, "matched");
    assert.equal(result.matchConfidence, "high");
    assert.equal(result.matchReason, "Exact normalized hostname/FQDN match");
    assert.equal(result.providerObjectId, "provider-host");
  });

  test("exact normalized name unique match has medium confidence", () => {
    const result = onlyResult(
      [referenceVm({ id: "ref-name", name: " ACME-WEB-01 " })],
      [providerVm({ id: "provider-name", name: "acme-web-01" })],
    );

    assert.equal(result.matchStatus, "matched");
    assert.equal(result.matchConfidence, "medium");
    assert.equal(result.matchReason, "Exact normalized VM name/displayName match");
  });

  test("name matching is case and whitespace insensitive but never high confidence", () => {
    const result = onlyResult(
      [referenceVm({ name: "  ACME-WEB-01  " })],
      [providerVm({ name: "acme-web-01" })],
    );

    assert.equal(result.matchStatus, "matched");
    assert.equal(result.matchConfidence, "medium");
    assert.notEqual(result.matchConfidence, "high");
  });

  test("IP overlap unique match has medium confidence", () => {
    const result = onlyResult(
      [referenceVm({ id: "ref-ip", name: "cmdb-only", ip: "10.10.10.10" })],
      [providerVm({ id: "provider-ip", name: "runtime-only", ipAddresses: ["10.10.10.10", "10.10.10.11"] })],
    );

    assert.equal(result.matchStatus, "matched");
    assert.equal(result.matchConfidence, "medium");
    assert.equal(result.matchReason, "IP address overlap match");
  });

  test("reference without provider candidate becomes unmatched_reference", () => {
    const result = onlyResult(
      [referenceVm({ id: "ref-missing", name: "missing-vm", ip: "10.0.0.20" })],
      [],
    );

    assert.equal(result.matchStatus, "unmatched_reference");
    assert.equal(result.driftStatus, "not_compared");
    assert.deepEqual(result.findings.map((finding) => finding.code), ["UNMATCHED_REFERENCE"]);
  });

  test("provider-only VM becomes unmatched_provider", () => {
    const result = onlyResult(
      [],
      [providerVm({ id: "provider-only", name: "runtime-only" })],
    );

    assert.equal(result.matchStatus, "unmatched_provider");
    assert.equal(result.driftStatus, "not_compared");
    assert.deepEqual(result.findings.map((finding) => finding.code), ["UNMATCHED_PROVIDER"]);
  });

  test("multiple providers with the same name are ambiguous", () => {
    const result = onlyResult(
      [referenceVm({ id: "ref-ambiguous", name: "duplicate-name", ip: null })],
      [
        providerVm({ id: "provider-b", name: "duplicate-name", ip: null }),
        providerVm({ id: "provider-a", name: "duplicate-name", ip: null }),
      ],
    );

    assert.equal(result.matchStatus, "ambiguous");
    assert.equal(result.providerObjectId, null);
    assert.deepEqual(result.candidateProviderObjectIds, ["provider-a", "provider-b"]);
    assert.deepEqual(result.findings.map((finding) => finding.code), ["AMBIGUOUS_MATCH"]);
  });

  test("one provider matching multiple references marks affected references ambiguous", () => {
    const results = matchVmInventories(
      [
        referenceVm({ id: "ref-a", name: "shared-name", ip: null }),
        referenceVm({ id: "ref-b", name: "shared-name", ip: null }),
      ],
      [providerVm({ id: "provider-shared", name: "shared-name", ip: null })],
    );

    assert.equal(results.length, 2);
    assert.deepEqual(results.map((result) => result.matchStatus), ["ambiguous", "ambiguous"]);
    assert.ok(results.every((result) => result.candidateProviderObjectIds[0] === "provider-shared"));
  });

  test("matched same IP, OS, and power has no drift", () => {
    const result = onlyResult(
      [referenceVm({ ipAddresses: ["10.0.0.10", "10.0.0.11"], operatingSystem: "Linux", powerState: "powered_on" })],
      [providerVm({ ipAddresses: ["10.0.0.11", "10.0.0.10"], platform: "linux", powerState: "running" })],
    );

    assert.equal(result.matchStatus, "matched");
    assert.equal(result.driftStatus, "no_drift");
    assert.equal(result.driftSeverity, "info");
    assert.deepEqual(result.fieldDiffs, []);
  });

  test("IP mismatch creates VM_IP_MISMATCH", () => {
    const result = onlyResult(
      [referenceVm({ ip: "10.0.0.10" })],
      [providerVm({ ip: "10.0.0.99" })],
    );

    assert.equal(result.driftStatus, "drift");
    assert.deepEqual(result.findings.map((finding) => finding.code), ["VM_IP_MISMATCH"]);
  });

  test("OS mismatch creates VM_OS_MISMATCH", () => {
    const result = onlyResult(
      [referenceVm({ operatingSystem: "windows" })],
      [providerVm({ platform: "linux" })],
    );

    assert.equal(result.driftStatus, "drift");
    assert.deepEqual(result.findings.map((finding) => finding.code), ["VM_OS_MISMATCH"]);
  });

  test("power state mismatch creates VM_POWER_STATE_MISMATCH", () => {
    const result = onlyResult(
      [referenceVm({ powerState: "running" })],
      [providerVm({ powerState: "powered_off" })],
    );

    assert.equal(result.driftStatus, "drift");
    assert.deepEqual(result.findings.map((finding) => finding.code), ["VM_POWER_STATE_MISMATCH"]);
  });

  test("missing comparison values do not create false drift", () => {
    const result = onlyResult(
      [referenceVm({ ip: null, operatingSystem: null, powerState: null })],
      [providerVm({ ip: null, platform: null, powerState: null })],
    );

    assert.equal(result.matchStatus, "matched");
    assert.equal(result.driftStatus, "no_drift");
    assert.deepEqual(result.findings, []);
  });

  test("result ordering is deterministic", () => {
    const results = matchVmInventories(
      [
        referenceVm({ id: "ref-b", name: "bravo", ip: null }),
        referenceVm({ id: "ref-a", name: "alpha", ip: null }),
        referenceVm({ id: "ref-c", name: "charlie", ip: null }),
      ],
      [
        providerVm({ id: "provider-z", name: "zulu", ip: null }),
        providerVm({ id: "provider-a", name: "alpha", ip: null }),
        providerVm({ id: "provider-y", name: "yankee", ip: null }),
      ],
    );

    assert.deepEqual(
      results.map((result) => `${result.referenceObjectId ?? "-"}:${result.providerObjectId ?? "-"}`),
      [
        "ref-a:provider-a",
        "ref-b:-",
        "ref-c:-",
        "-:provider-y",
        "-:provider-z",
      ],
    );
  });

  test("candidate builder returns sorted mocked candidates without storage", () => {
    const candidates = buildVmMatchCandidates(
      [referenceVm({ id: "ref-z", name: "zulu", ip: null }), referenceVm({ id: "ref-a", name: "alpha", ip: null })],
      [providerVm({ id: "provider-z", name: "zulu", ip: null }), providerVm({ id: "provider-a", name: "alpha", ip: null })],
    );

    assert.deepEqual(
      candidates.map((candidate) => `${candidate.referenceObjectId}:${candidate.providerObjectId}`),
      ["ref-a:provider-a", "ref-z:provider-z"],
    );
  });
});

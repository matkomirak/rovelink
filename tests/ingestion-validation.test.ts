import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import supertest from "supertest";
import { storage } from "../server/storage";
import netboxRoutes from "../server/routes/netbox-sources";
import { customerScopeCandidateSchema, normalizedInfrastructureSchema, normalizedNetboxVmSchema, sanitizeIngestionMetadata } from "../server/services/ingestion-validation";
import { normalizeIpList } from "../server/services/drift/vm-matcher";
import { extractNetBoxTenantScope } from "../server/services/customer-scope-netbox-resolver";
import { azureInfrastructureNormalizer } from "../server/services/infrastructure-normalizers/azure";
import { fakeInfrastructureNormalizer } from "../server/services/infrastructure-normalizers/fake";

test("normalized boundaries validate stable IDs, types, optional fields and IPs safely", () => {
  const vm = { sourceId: "source", netboxId: 1, name: "demo", ip: null };
  assert.equal(normalizedNetboxVmSchema.safeParse(vm).success, true);
  for (const patch of [{ netboxId: -1 }, { netboxId: 1.5 }, { name: "" }, { ip: "192.0.2.999" }, { ip: "192.0.2.1/99" }]) assert.equal(normalizedNetboxVmSchema.safeParse({ ...vm, ...patch }).success, false);
  assert.equal(normalizedInfrastructureSchema.safeParse({ providerType: "fake", objectType: "vm", externalId: "stable", metadata: { primaryIp4: "bad-ip" } }).success, false);
  assert.equal(customerScopeCandidateSchema.safeParse({ object: { objectType: "vm", externalId: "stable" }, candidateValue: "demo", derivedFrom: "tag", confidence: "high" }).success, true);
  assert.equal(extractNetBoxTenantScope({ tenant: { id: -1, name: "bad" } }), undefined);
  assert.deepEqual(normalizeIpList(["192.0.2.1", "bad", "999.999.999.999"]), ["192.0.2.1"]);
  const safe = sanitizeIngestionMetadata({ token: "synthetic-token", nested: { private_key: "synthetic-key", owner: "team" }, note: "Bearer synthetic-value" });
  assert.ok(!JSON.stringify(safe).match(/synthetic-token|synthetic-key|synthetic-value/));
  assert.match(JSON.stringify(safe), /team/);
});
test("malformed vendor records do not crash valid sibling normalization", async () => {
  const context = { provider: { id: "provider", orgId: "a" } as any, orgId: "a", config: {}, now: new Date() };
  const fake = await fakeInfrastructureNormalizer.normalize({ ...context, items: [null, { externalId: "valid", name: "demo", provider: "fake", status: "running", tags: [] }] as any });
  assert.equal(fake.objects.length, 1);
  assert.equal(fake.skipped.length, 1);
  const azure = await azureInfrastructureNormalizer.normalize({ ...context, items: [null, { subscriptionId: "demo", vms: [null, { id: "/subscriptions/demo/resourceGroups/demo/providers/Microsoft.Compute/virtualMachines/demo", name: "demo" }], nics: "invalid" }] as any });
  assert.equal(azure.objects.length, 1);
  assert.equal(azure.skipped.length, 3);
});
test("NetBox import requires an owned source, skips malformed records and sanitizes valid records", async () => {
  const originalSource = storage.getNetboxInventorySource;
  const originalUpsert = storage.upsertNetboxVm;
  const saved: any[] = [];
  storage.getNetboxInventorySource = async (id, org) => id === "owned" && org === "a" ? { id, orgId: org } as any : undefined;
  storage.upsertNetboxVm = async input => { saved.push(input); return input as any; };
  try {
    const app = express(); app.use(express.json());
    app.use((req: any, _res, next) => { req.user = { role: "admin" }; req.orgId = "a"; next(); });
    app.use(netboxRoutes);
    await supertest(app).post("/import").send({ sourceId: "foreign", vms: [] }).expect(404);
    await supertest(app).post("/import").send({ vms: [] }).expect(400);
    const response = await supertest(app).post("/import").send({ sourceId: "owned", vms: [null, { id: -1, name: "invalid" }, { id: 1, name: "valid", custom_fields: { password: "synthetic-secret", technical_owner: "team" } }] }).expect(200);
    assert.equal(response.body.imported, 1);
    assert.equal(response.body.validation.recordsSkipped, 2);
    assert.equal(saved[0].sourceId, "owned");
    assert.ok(!JSON.stringify(saved).includes("synthetic-secret"));
    assert.equal(saved[0].customFields.technical_owner, "team");
  } finally { storage.getNetboxInventorySource = originalSource; storage.upsertNetboxVm = originalUpsert; }
});

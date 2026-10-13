import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import supertest from "supertest";
import { createAutomationReadinessRouter } from "../server/routes/automation-readiness-report";
import { summarizeAutomationReadiness, type ReadinessInventoryInput } from "../server/services/automation-readiness-report";
import { automationReadinessPercentages } from "../shared/automation-readiness";

const inventory = (patch: Partial<ReadinessInventoryInput> = {}): ReadinessInventoryInput => ({
  id: "inventory-a", orgId: "a", name: "Inventory", type: "linked", hostsCount: 0,
  lastRefreshedAt: null, hosts: [], ...patch,
});

test("counts missing addresses and governance blockers once per target, never grants execution from governance alone", () => {
  const report = summarizeAutomationReadiness("a", [inventory({ hosts: [
    { address: "10.0.0.1", governanceReady: true },
    { address: "", governanceReady: false },
    { address: "vm.example.com", governanceReady: false },
    { address: "10.0.0.4", governanceReady: null },
  ] })]);
  assert.deepEqual(report.summary, { targets: 4, ready: 0, needsAttention: 2, unknown: 2 });
  assert.equal(report.blockers.find(issue => issue.key === "missing_address")?.count, 1);
  assert.equal(report.blockers.find(issue => issue.key === "governance_not_ready")?.count, 2);
  assert.equal(report.inventories[0].addressPresentCount, 3);
  assert.equal(report.inventories[0].governanceReadyCount, 1);
  assert.equal(report.inventories[0].governanceUnknownCount, 1);
});

test("file/script and missing host details remain unknown; no fabricated missing-user/credential blocker", () => {
  const report = summarizeAutomationReadiness("a", [inventory({ type: "file", hostsCount: 3 }), inventory({ id: "script", type: "script", hostsCount: 2 }), inventory({ id: "partial", hostsCount: 3, hosts: [{ address: "10.0.0.1", governanceReady: true }] })]);
  assert.deepEqual(report.summary, { targets: 8, ready: 0, needsAttention: 0, unknown: 8 });
  assert.deepEqual(report.blockers.map(issue => issue.key), ["readiness_unknown"]);
});

test("empty inventories and org isolation preserve zero totals", () => {
  assert.deepEqual(summarizeAutomationReadiness("a", []), { summary: { targets: 0, ready: 0, needsAttention: 0, unknown: 0 }, blockers: [], inventories: [] });
  const result = summarizeAutomationReadiness("a", [inventory(), inventory({ orgId: "b", hostsCount: 5 }), inventory({ orgId: null, hostsCount: 4 })]);
  assert.equal(result.inventories.length, 1);
  assert.equal(result.summary.targets, 0);
});

test("readiness percentages handle zero, mixed and each full category", () => {
  assert.deepEqual(automationReadinessPercentages({ targets: 0, ready: 0, needsAttention: 0, unknown: 0 }), { ready: 0, attention: 0, unknown: 0 });
  assert.deepEqual(automationReadinessPercentages({ targets: 200, ready: 101, needsAttention: 99, unknown: 0 }), { ready: 51, attention: 49, unknown: 0 });
  for (const [ready, needsAttention, unknown, expected] of [[4, 0, 0, { ready: 100, attention: 0, unknown: 0 }], [0, 4, 0, { ready: 0, attention: 100, unknown: 0 }], [0, 0, 4, { ready: 0, attention: 0, unknown: 100 }], [1, 1, 1, { ready: 33, attention: 33, unknown: 34 }]] as const) {
    assert.deepEqual(automationReadinessPercentages({ targets: ready + needsAttention + unknown, ready, needsAttention, unknown }), expected);
  }
});

test("readiness endpoint scopes inventory and governance reads and returns only safe aggregates", async () => {
  const calls: string[] = [];
  const app = express();
  app.use((req: any, _res, next) => { req.orgId = "a"; next(); });
  app.use(createAutomationReadinessRouter({
    listInventories: async orgId => {
      calls.push(orgId);
      return [
        { ...inventory({ hostsCount: 2 }), cachedData: { secret: "secret-marker", hosts: [
          { name: "private-host", ansible_host: "10.0.0.1", governanceObjectType: "netbox_vm", governanceObjectId: "a-vm", vars: { token: "secret-marker" } },
          { ansible_host: "10.0.0.2", governance: { automationReadiness: true } },
        ] } },
        { ...inventory({ orgId: "b", name: "foreign-inventory", hostsCount: 9 }), cachedData: { hosts: [{ governanceObjectType: "netbox_vm", governanceObjectId: "b-vm" }] } },
      ];
    },
    getGovernanceReady: async (orgId, id) => { calls.push(`${orgId}:${id}`); return false; },
  }));
  const response = await supertest(app).get("/readiness-report").expect(200);
  assert.deepEqual(calls, ["a", "a:a-vm"]);
  assert.deepEqual(response.body.summary, { targets: 2, ready: 0, needsAttention: 1, unknown: 1 });
  assert.ok(!JSON.stringify(response.body).match(/secret-marker|private-host|foreign-inventory|10\.0\.0|cachedData|vars/));
});

test("endpoint requires org context before reads and returns safe errors", async () => {
  const app = express();
  app.use(createAutomationReadinessRouter({ listInventories: async () => { throw new Error("Must not read"); }, getGovernanceReady: async () => null }));
  await supertest(app).get("/readiness-report").expect(403);
  const failing = express();
  failing.use((req: any, _res, next) => { req.orgId = "a"; next(); });
  failing.use(createAutomationReadinessRouter({ listInventories: async () => { throw new Error("private-token-marker"); }, getGovernanceReady: async () => null }));
  const response = await supertest(failing).get("/readiness-report").expect(500);
  assert.ok(!JSON.stringify(response.body).includes("private-token-marker"));
});

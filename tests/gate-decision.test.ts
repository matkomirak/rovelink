import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import supertest from "supertest";
import { createGateDecisionRouter } from "../server/routes/gate-decision";
import { gateDecisionRequestSchema } from "../shared/gate-decision";

const request = { target: { sourceType: "cmdb", sourceId: "source-a", objectType: "netbox_vm", objectId: "vm-a" }, automation: { adapter: "local" } };
function fixture(options: { authenticated?: boolean; orgId?: string; ready?: boolean; missing?: boolean; old?: boolean; foreignSource?: boolean; foreignEvaluation?: boolean } = {}) {
  const calls: string[] = [];
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { if (options.authenticated !== false) req.userId = "user-a"; req.orgId = options.orgId ?? "a"; next(); });
  app.use("/api/v1/gate", createGateDecisionRouter({
    getCmdbAccount: async (_id, orgId) => { calls.push(orgId); return { id: "source-a", orgId: options.foreignSource ? "b" : "a", kind: "netbox", config: { password: "payload-secret" } } as any; },
    getNetboxVms: async orgId => { calls.push(orgId); return options.missing ? [] : [{ id: "vm-a", sourceId: "source-a", ip: "10.0.0.1", customFields: { token: "payload-secret" } }] as any; },
    getJobTemplate: async (_id, orgId) => { calls.push(orgId); return undefined; },
    getLatestGovernanceEvaluationForObject: async (orgId, type, id) => {
      calls.push(`${orgId}:${type}:${id}`);
      return { evaluation: { orgId: options.foreignEvaluation ? "b" : "a", objectType: type, objectId: id, runId: "run-a", automationReady: options.ready ?? false, evaluatedAt: options.old ? new Date(0) : new Date(), findings: [{ token: "payload-secret" }] }, run: { id: "run-a", orgId: "a", status: "ok", cmdbAccountId: "source-a", blueprintId: "blueprint-a" } } as any;
    },
  }));
  return { app, calls };
}

test("preflight requires authentication and server org context before reads", async () => {
  const anonymous = fixture({ authenticated: false });
  await supertest(anonymous.app).post("/api/v1/gate/evaluate").send(request).expect(401);
  assert.deepEqual(anonymous.calls, []);
  const noOrg = fixture({ orgId: "" });
  await supertest(noOrg.app).post("/api/v1/gate/evaluate").send(request).expect(403);
  assert.deepEqual(noOrg.calls, []);
});
test("preflight blocks not-ready governance with only selected evidence", async () => {
  const { app, calls } = fixture();
  const response = await supertest(app).post("/api/v1/gate/evaluate").send(request).expect(200);
  assert.equal(response.body.decision, "block");
  assert.ok(response.body.reasons.includes("governance_not_ready"));
  assert.equal(response.body.evidence.governanceRunId, "run-a");
  assert.ok(!JSON.stringify(response.body).match(/payload-secret|customFields|password|token|findings/));
  assert.deepEqual(calls, ["a", "a", "a:netbox_vm:vm-a"]);
});
test("ready posture, foreign evidence, missing targets and stale evaluations never allow", async () => {
  for (const options of [{ ready: true }, { missing: true }, { foreignSource: true }, { foreignEvaluation: true }, { old: true }]) {
    const { app } = fixture(options);
    const response = await supertest(app).post("/api/v1/gate/evaluate").send({ ...request, freshness: { maxGovernanceAgeSeconds: 60 } }).expect(200);
    assert.equal(response.body.decision, "unknown");
    if (options.foreignSource || options.missing) assert.deepEqual(response.body.evidence, {});
    if (options.foreignEvaluation) assert.equal(response.body.evidence.governanceRunId, undefined);
    if (options.old) assert.ok(response.body.reasons.includes("stale_governance_evaluation"));
  }
});
test("strict preflight input rejects caller org/requester, secret context and unsupported policies", async () => {
  assert.equal(gateDecisionRequestSchema.safeParse({ ...request, orgId: "b" }).success, false);
  const { app, calls } = fixture();
  const response = await supertest(app).post("/api/v1/gate/evaluate").send({ ...request, context: { token: "payload-secret" } }).expect(400);
  assert.ok(!JSON.stringify(response.body).includes("payload-secret"));
  assert.deepEqual(calls, []);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeGovernanceReadiness, type ReadinessRun, type ReadinessObject } from "../server/services/governance-readiness-report";
import { availableTopIssues, displayGovernanceScore, readinessRatio } from "../client/src/lib/governance-report-presentation";

const run = (id: string, patch: Partial<ReadinessRun> = {}): ReadinessRun => ({
  id, orgId: "a", blueprintId: "blueprint", blueprintName: "Blueprint", sourceId: "source", sourceName: "CMDB",
  objectType: "netbox_vm", status: "ok", createdAt: "2026-01-01", completedAt: "2026-01-01", ...patch,
});
const object = (runId: string, patch: Partial<ReadinessObject> = {}): ReadinessObject => ({
  orgId: "a", runId, objectType: "netbox_vm", automationReady: true, governanceScore: 100, findings: [], ...patch,
});

test("current posture selects newest successful completed run and ignores failed/in-progress history", () => {
  const result = summarizeGovernanceReadiness("a", { runs: [run("old"), run("new", { completedAt: "2026-01-02" }), run("failed", { status: "failed", completedAt: "2026-01-03" }), run("incomplete", { completedAt: null })],
    objects: [object("old", { automationReady: false }), object("new"), object("failed", { automationReady: false }), object("incomplete")] });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].latestRunId, "new");
  assert.deepEqual(result.summary, { evaluated: 1, ready: 1, blocked: 0, averageScore: 100 });
});

test("each blueprint/source/object type is a separate group and averages are weighted by objects", () => {
  const runs = [run("one"), run("two", { sourceId: "second" }), run("three", { blueprintId: "other" }), run("four", { objectType: "other_type" }), run("five", { sourceId: null })];
  const result = summarizeGovernanceReadiness("a", { runs, objects: [object("one"), object("one"), object("two", { governanceScore: 0, automationReady: false }), object("four", { objectType: "other_type", governanceScore: 0 })] });
  assert.equal(result.rows.length, 5);
  assert.deepEqual(result.summary, { evaluated: 4, ready: 3, blocked: 1, averageScore: 50 });
  assert.equal(result.rows.find(r => r.latestRunId === "five")?.averageScore, null);
});

test("findings count affected objects once per code and blockers are distinguished from warnings", () => {
  const findings = [{ code: "required_data_missing", severity: "blocker", message: "private payload" }, { code: "required_data_missing", severity: "blocker" }, { code: "required_owner_missing", severity: "warning" }];
  const result = summarizeGovernanceReadiness("a", { runs: [run("one")], objects: [object("one", { automationReady: false, findings }), object("one", { findings: [{ code: "required_owner_missing", severity: "warning" }] })] });
  assert.equal(result.rows[0].warnings, 2);
  assert.equal(result.rows[0].ready, 1);
  assert.deepEqual(result.rows[0].topFindings, [{ code: "required_owner_missing", count: 2 }, { code: "required_data_missing", count: 1 }]);
  assert.deepEqual(result.rows[0].topBlockers, [{ code: "required_data_missing", count: 1 }]);
  assert.ok(!JSON.stringify(result).includes("private payload"));
});

test("foreign runs, foreign objects, and wrong object types cannot contribute", () => {
  const result = summarizeGovernanceReadiness("a", { runs: [run("one"), run("foreign", { orgId: "b", completedAt: "2026-01-03" })], objects: [object("one"), object("one", { orgId: "b", automationReady: false }), object("foreign"), object("one", { objectType: "wrong" })] });
  assert.equal(result.rows.length, 1);
  assert.equal(result.summary.evaluated, 1);
});

test("empty or failed-only report has zero counts and no fabricated average", () => {
  for (const runs of [[], [run("failed", { status: "failed" })]]) {
    assert.deepEqual(summarizeGovernanceReadiness("a", { runs, objects: [] }), { rows: [], summary: { evaluated: 0, ready: 0, blocked: 0, averageScore: null } });
  }
});

test("dashboard readiness ratios handle mixed, all-ready, all-attention and empty data", () => {
  assert.deepEqual(readinessRatio(1, 3), { total: 4, readyPercent: 25, attentionPercent: 75 });
  assert.deepEqual(readinessRatio(4, 0), { total: 4, readyPercent: 100, attentionPercent: 0 });
  assert.deepEqual(readinessRatio(0, 4), { total: 4, readyPercent: 0, attentionPercent: 100 });
  assert.deepEqual(readinessRatio(0, 0), { total: 0, readyPercent: 0, attentionPercent: 0 });
  assert.deepEqual(readinessRatio(NaN, -1), { total: 0, readyPercent: 0, attentionPercent: 0 });
});

test("dashboard findings aggregate available group summaries without double-counting blockers", () => {
  const rows = summarizeGovernanceReadiness("a", { runs: [run("one"), run("two", { sourceId: "second" })], objects: [object("one", { findings: [{ code: "required_data_missing", severity: "blocker" }], automationReady: false }), object("two", { findings: [{ code: "required_data_missing", severity: "warning" }] })] }).rows;
  assert.deepEqual(availableTopIssues(rows), [{ code: "required_data_missing", count: 2, includesBlockers: true }]);
  assert.deepEqual(availableTopIssues([]), []);
});

test("dashboard score formatting preserves zero and handles missing scores", () => {
  assert.equal(displayGovernanceScore(0), "0/100");
  assert.equal(displayGovernanceScore(72), "72/100");
  assert.equal(displayGovernanceScore(null), "—");
  assert.equal(displayGovernanceScore(undefined), "—");
  assert.equal(displayGovernanceScore(NaN), "—");
});

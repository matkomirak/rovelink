import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { navigationSections, navItemIsActive, reportsVisibleSections } from "../client/src/lib/sidebar-navigation";

const items = navigationSections.flatMap(section => section.items);
const active = (path: string) => items.filter(item => navItemIsActive(path, item)).map(item => item.title);

test("sidebar groups reporting, drift and automation separately", () => {
  assert.deepEqual(navigationSections.map(section => [section.label, section.items.map(item => item.title)]), [
    ["Navigation", ["Dashboard"]],
    ["Reports", ["Governance Readiness", "Automation Readiness"]],
    ["Drift", ["Drift Reports"]],
    ["Inputs", ["Providers", "CMDBs", "Sync Flows"]],
    ["Governance", ["Blueprints", "Evaluation Runs"]],
    ["Automation", ["Inventories", "Templates", "Credentials", "Projects", "Automation Runs"]],
    ["System", ["Notifications", "Settings"]],
  ]);
});

test("all sidebar destinations exist, with no duplicate or dead report links", () => {
  const source = readFileSync(new URL("../client/src/App.tsx", import.meta.url), "utf8");
  const routes = Array.from(source.matchAll(/<Route path="([^"]+)"/g), match => match[1]);
  for (const item of items) assert.ok(routes.includes(item.url), `Missing route for ${item.title}: ${item.url}`);
  assert.equal(new Set(items.map(item => item.url)).size, items.length);
  assert.ok(!items.some(item => item.title === "Runs" || item.title === "Reports"));
});

test("active state distinguishes reports, drift and governance history, including nested routes", () => {
  for (const [path, title] of [
    ["/", "Dashboard"], ["/reports", "Governance Readiness"],
    ["/reports/governance", "Governance Readiness"], ["/reports/automation", "Automation Readiness"],
    ["/reports/drift", "Drift Reports"], ["/reports/drift/run-id", "Drift Reports"],
    ["/runs", "Automation Runs"], ["/runs/run-id", "Automation Runs"],
    ["/automation-inventories", "Inventories"], ["/inventories/new", "Inventories"],
    ["/inventories/id/edit", "Inventories"], ["/governance", "Blueprints"],
    ["/governance/blueprints/id", "Blueprints"], ["/governance/evaluation-runs", "Evaluation Runs"],
    ["/governance/evaluation-runs/id", "Evaluation Runs"], ["/providers/id", "Providers"],
    ["/cmdbs/id", "CMDBs"], ["/pipelines/id", "Sync Flows"],
  ]) assert.deepEqual(active(path), [title], path);
  assert.deepEqual(active("/reports-unrelated"), []);
  assert.deepEqual(active("/runs-unrelated"), []);
  assert.deepEqual(active("/inventories-unrelated"), []);
});

test("report aliases reuse the respective dashboard while legacy /reports retains both", () => {
  assert.deepEqual(reportsVisibleSections("/reports"), { governance: true, automation: true });
  assert.deepEqual(reportsVisibleSections("/reports/governance"), { governance: true, automation: false });
  assert.deepEqual(reportsVisibleSections("/reports/automation"), { governance: false, automation: true });
});

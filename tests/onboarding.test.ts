import assert from "node:assert/strict";
import { test } from "node:test";
import { onboardingSteps } from "../shared/onboarding";
const empty = { cmdbs: 0, referenceObjects: 0, assigned: 0, unassigned: 0, providers: 0, runtimeObjects: 0, driftRuns: 0, governanceRuns: 0, inventories: 0, templates: 0 };
test("empty onboarding offers CMDB first, never marks automation ready", () => {
  const steps = onboardingSteps(empty);
  assert.equal(steps.length, 8); assert.equal(steps[0].status, "Ready");
  assert.equal(steps[7].status, "Not started");
});
test("runtime inventory can compare against empty reference, without implying readiness", () => {
  const steps = onboardingSteps({ ...empty, cmdbs: 1, providers: 1, runtimeObjects: 4 });
  assert.equal(steps[1].status, "Ready"); assert.equal(steps[5].status, "Ready");
  assert.equal(steps[6].status, "Not started"); assert.equal(steps[7].status, "Not started");
});
test("populated setup flags unassigned customers and keeps automation preparation separate", () => {
  const steps = onboardingSteps({ ...empty, cmdbs: 1, referenceObjects: 4, assigned: 3, unassigned: 1, providers: 1, runtimeObjects: 4, driftRuns: 1, governanceRuns: 1, inventories: 1, templates: 1 });
  assert.equal(steps[2].status, "Needs attention"); assert.equal(steps[5].status, "Done");
  assert.equal(steps[7].status, "Ready"); assert.ok(steps[7].help.includes("never authorizes"));
});


import { selectDemoVms } from "../server/scripts/import-demo-proxmox-netbox";
test("explicit demo import selects only known offline VMs and rejects empty or unknown selection", () => {
  const vms = [{ name: "alpha-web-001" }, { name: "beta-app-002" }];
  assert.throws(() => selectDemoVms(vms, []));
  assert.throws(() => selectDemoVms(vms, ["real-production-vm"]));
  assert.deepEqual(selectDemoVms(vms, ["beta-app-002", "beta-app-002"]), [vms[1]]);
});

export type OnboardingStatus = "Not started" | "Ready" | "Needs attention" | "Done";
export interface OnboardingProgress {
  cmdbs: number; referenceObjects: number; assigned: number; unassigned: number;
  providers: number; runtimeObjects: number; driftRuns: number; governanceRuns: number;
  inventories: number; templates: number;
}
export function onboardingSteps(p: OnboardingProgress) {
  const status = (done: boolean, ready: boolean): OnboardingStatus => done ? "Done" : ready ? "Ready" : "Not started";
  return [
    { label: "Connect CMDB", href: "/cmdbs", status: status(p.cmdbs > 0, true), help: "Add your documented reference source." },
    { label: "Refresh/import reference inventory", href: "/cmdbs", status: status(p.referenceObjects > 0, p.cmdbs > 0), help: "Confirm Refresh on the CMDB page. An empty source can import zero VMs successfully." },
    { label: "Review customer assignments", href: "/cmdbs", status: p.unassigned > 0 ? "Needs attention" as OnboardingStatus : status(p.assigned > 0, p.referenceObjects > 0), help: "Set NetBox Tenants for customers, refresh, and review CustomerScopes." },
    { label: "Connect provider", href: "/providers", status: status(p.providers > 0, p.cmdbs > 0), help: "Add an observed runtime source; fake providers need no live credentials." },
    { label: "Sync runtime inventory", href: "/providers", status: status(p.runtimeObjects > 0, p.providers > 0), help: "Use Sync Cached Inventory on the provider page." },
    { label: "Run drift report", href: "/reports/drift", status: status(p.driftRuns > 0, p.cmdbs > 0 && p.runtimeObjects > 0), help: "Compare reference and runtime VMs. Empty reference sources produce unmatched provider VMs." },
    { label: "Run governance", href: "/governance", status: status(p.governanceRuns > 0, p.referenceObjects > 0), help: "Evaluate reference data, ownership, and customer assignments; review findings." },
    { label: "Prepare automation", href: "/automation-inventories", status: p.inventories > 0 && p.templates > 0 ? "Ready" as OnboardingStatus : "Not started" as OnboardingStatus, help: "Configure inventory and templates, then inspect readiness and GATE. Setup progress never authorizes a run." },
  ];
}

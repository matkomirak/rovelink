import type { AutomationReadinessIssue, AutomationReadinessReport } from "../../shared/automation-readiness";

export interface ReadinessInventoryInput {
  id: string;
  orgId: string | null;
  name: string;
  type: string;
  hostsCount: number | null;
  lastRefreshedAt: Date | string | null;
  hosts: Array<{ address: unknown; governanceReady: boolean | null }>;
}

const issues = {
  missing_address: { label: "Missing host address", severity: "warning" },
  governance_not_ready: { label: "Governance not ready", severity: "warning" },
  readiness_unknown: { label: "Execution readiness unknown", severity: "info" },
} as const;

export function assessInventoryHostSignals(host: { address: unknown; governanceReady: boolean | null }) {
  const addressPresent = typeof host.address === "string" && !!host.address.trim();
  return { addressPresent, governanceBlocked: host.governanceReady === false,
    governanceReady: host.governanceReady === true, needsAttention: !addressPresent || host.governanceReady === false };
}

/** Read-only inventory signals, never an execution authorization or GATE evaluation.
 * Cached linked inventories exclude blocked source VMs. File/script host details
 * and run-time credentials/users are not available in this projection.
 */
export function summarizeAutomationReadiness(orgId: string, inputs: ReadinessInventoryInput[]): AutomationReadinessReport {
  const summary = { targets: 0, ready: 0, needsAttention: 0, unknown: 0 };
  const globalCounts = new Map<string, number>();
  const toIssues = (counts: Map<string, number>): AutomationReadinessIssue[] => Array.from(counts.entries()).map(([key, count]) => ({
    key, count, ...issues[key as keyof typeof issues],
  })).sort((a, b) => (a.severity === b.severity ? b.count - a.count : a.severity === "warning" ? -1 : 1) || a.key.localeCompare(b.key));
  const inventories = inputs.filter(input => input.orgId === orgId).map(input => {
    const hosts = input.type === "linked" ? input.hosts : [];
    const recordedCount = Number.isInteger(input.hostsCount) && input.hostsCount! > 0 ? input.hostsCount! : 0;
    const targetCount = Math.max(recordedCount, hosts.length);
    let needsAttentionCount = 0, addressPresentCount = 0, governanceReadyCount = 0;
    const counts = new Map<string, number>();
    const add = (key: keyof typeof issues, count = 1) => {
      if (!count) return;
      counts.set(key, (counts.get(key) ?? 0) + count);
      globalCounts.set(key, (globalCounts.get(key) ?? 0) + count);
    };
    for (const host of hosts) {
      const { addressPresent } = assessInventoryHostSignals(host);
      if (addressPresent) addressPresentCount++;
      else add("missing_address");
      if (host.governanceReady === true) governanceReadyCount++;
      if (host.governanceReady === false) add("governance_not_ready");
      if (!addressPresent || host.governanceReady === false) needsAttentionCount++;
    }
    const unknownCount = targetCount - needsAttentionCount;
    add("readiness_unknown", unknownCount);
    summary.targets += targetCount;
    summary.needsAttention += needsAttentionCount;
    summary.unknown += unknownCount;
    const refreshed = input.lastRefreshedAt ? new Date(input.lastRefreshedAt) : null;
    return {
      inventoryId: input.id, inventoryName: input.name, targetCount, readyCount: 0,
      needsAttentionCount, unknownCount, addressPresentCount, governanceReadyCount,
      governanceUnknownCount: targetCount - hosts.filter(host => typeof host.governanceReady === "boolean").length,
      topIssue: toIssues(counts)[0] ?? null,
      lastRefreshedAt: refreshed && Number.isFinite(refreshed.getTime()) ? refreshed.toISOString() : null,
    };
  });
  return { summary, blockers: toIssues(globalCounts), inventories };
}

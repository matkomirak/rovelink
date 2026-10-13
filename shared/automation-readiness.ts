export interface AutomationReadinessIssue {
  key: string;
  label: string;
  count: number;
  severity: "warning" | "info";
}

export interface AutomationReadinessInventory {
  inventoryId: string;
  inventoryName: string;
  targetCount: number;
  readyCount: number;
  needsAttentionCount: number;
  unknownCount: number;
  addressPresentCount: number;
  governanceReadyCount: number;
  governanceUnknownCount: number;
  topIssue: AutomationReadinessIssue | null;
  lastRefreshedAt: string | null;
}

export interface AutomationReadinessReport {
  summary: { targets: number; ready: number; needsAttention: number; unknown: number };
  blockers: AutomationReadinessIssue[];
  inventories: AutomationReadinessInventory[];
}

export function automationReadinessPercentages(summary: AutomationReadinessReport["summary"]) {
  const total = summary.ready + summary.needsAttention + summary.unknown;
  const ready = total ? Math.round(summary.ready / total * 100) : 0;
  const attention = total ? Math.min(100 - ready, Math.round(summary.needsAttention / total * 100)) : 0;
  return { ready, attention, unknown: total ? 100 - ready - attention : 0 };
}

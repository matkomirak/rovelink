import type { GovernanceReadinessRow } from "@shared/governance-readiness";

export function readinessRatio(ready: number, attention: number) {
  const safeCount = (value: number) => Number.isFinite(value) && value > 0 ? value : 0;
  const total = safeCount(ready) + safeCount(attention);
  const readyPercent = total ? Math.round(safeCount(ready) / total * 100) : 0;
  return { total, readyPercent, attentionPercent: total ? 100 - readyPercent : 0 };
}

export function displayGovernanceScore(score: number | null | undefined) {
  return typeof score === "number" && Number.isFinite(score) ? `${score}/100` : "—";
}

export function findingLabel(code: string) {
  const labels: Record<string, string> = {
    automation_not_approved: "Automation not approved",
    required_owner_missing: "Required owner missing",
    optional_owner_missing: "Optional owner missing",
    required_data_missing: "Required data missing",
    CUSTOMER_ASSIGNMENT_UNASSIGNED: "Customer assignment missing",
  };
  return labels[code] ?? code.replace(/_/g, " ").toLowerCase().replace(/^./, letter => letter.toUpperCase());
}

export function availableTopIssues(rows: GovernanceReadinessRow[]) {
  const issues = new Map<string, { code: string; count: number; includesBlockers: boolean }>();
  for (const row of rows) {
    const perGroup = new Map<string, { count: number; includesBlockers: boolean }>();
    for (const finding of row.topFindings) perGroup.set(finding.code, { count: finding.count, includesBlockers: false });
    for (const blocker of row.topBlockers) {
      const existing = perGroup.get(blocker.code);
      perGroup.set(blocker.code, { count: Math.max(existing?.count ?? 0, blocker.count), includesBlockers: true });
    }
    perGroup.forEach((finding, code) => {
      const existing = issues.get(code);
      issues.set(code, { code, count: (existing?.count ?? 0) + finding.count, includesBlockers: Boolean(existing?.includesBlockers || finding.includesBlockers) });
    });
  }
  return Array.from(issues.values()).sort((a, b) => b.count - a.count || Number(b.includesBlockers) - Number(a.includesBlockers) || a.code.localeCompare(b.code)).slice(0, 5);
}

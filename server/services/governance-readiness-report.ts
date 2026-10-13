import type { GovernanceReadinessReport } from "../../shared/governance-readiness";

export interface ReadinessRun {
  id: string; orgId: string; blueprintId: string; blueprintName: string;
  sourceId: string | null; sourceName: string | null; objectType: string;
  status: string; createdAt: Date | string; completedAt: Date | string | null;
}
export interface ReadinessObject {
  orgId: string; runId: string | null; objectType: string;
  automationReady: boolean; governanceScore: number; findings: unknown;
}
export interface GovernanceReadinessData { runs: ReadinessRun[]; objects: ReadinessObject[] }

export function summarizeGovernanceReadiness(orgId: string, data: GovernanceReadinessData): GovernanceReadinessReport {
  const latest = new Map<string, ReadinessRun>();
  const ordered = data.runs.filter(r => r.orgId === orgId && r.status === "ok" && r.completedAt)
    .sort((a, b) => new Date(b.completedAt!).getTime() - new Date(a.completedAt!).getTime()
      || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || b.id.localeCompare(a.id));
  for (const run of ordered) {
    const key = JSON.stringify([run.blueprintId, run.sourceId, run.objectType]);
    if (!latest.has(key)) latest.set(key, run);
  }
  const byRun = new Map<string, ReadinessObject[]>();
  for (const object of data.objects) {
    if (object.orgId !== orgId || !object.runId) continue;
    const objects = byRun.get(object.runId) ?? [];
    objects.push(object);
    byRun.set(object.runId, objects);
  }
  const ranked = (counts: Map<string, number>) => Array.from(counts, ([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code)).slice(0, 5);
  let scoreTotal = 0;
  let scoreCount = 0;
  const rows = Array.from(latest.values()).map(run => {
    const objects = (byRun.get(run.id) ?? []).filter(o => o.objectType === run.objectType);
    const findings = new Map<string, number>();
    const blockers = new Map<string, number>();
    let ready = 0, warnings = 0, sum = 0, scored = 0;
    for (const object of objects) {
      if (object.automationReady) ready++;
      if (Number.isFinite(object.governanceScore)) { sum += object.governanceScore; scored++; }
      const entries = (Array.isArray(object.findings) ? object.findings : []) as Array<{ code?: unknown; severity?: unknown }>;
      if (entries.some(f => f?.severity === "warning")) warnings++;
      const codes = new Set<string>(), blockerCodes = new Set<string>();
      for (const finding of entries) {
        if (typeof finding?.code !== "string") continue;
        codes.add(finding.code);
        if (finding.severity === "blocker") blockerCodes.add(finding.code);
      }
      codes.forEach(code => findings.set(code, (findings.get(code) ?? 0) + 1));
      blockerCodes.forEach(code => blockers.set(code, (blockers.get(code) ?? 0) + 1));
    }
    scoreTotal += sum; scoreCount += scored;
    return {
      latestRunId: run.id, blueprintId: run.blueprintId, blueprintName: run.blueprintName,
      sourceId: run.sourceId, sourceName: run.sourceName, objectType: run.objectType, status: run.status,
      lastEvaluated: new Date(run.completedAt!).toISOString(), evaluated: objects.length,
      ready, blocked: objects.length - ready, warnings, averageScore: scored ? Math.round(sum / scored) : null,
      topFindings: ranked(findings), topBlockers: ranked(blockers),
    };
  });
  return { rows, summary: {
    evaluated: rows.reduce((n, r) => n + r.evaluated, 0), ready: rows.reduce((n, r) => n + r.ready, 0),
    blocked: rows.reduce((n, r) => n + r.blocked, 0), averageScore: scoreCount ? Math.round(scoreTotal / scoreCount) : null,
  } };
}

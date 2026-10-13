export interface GovernanceReadinessRow {
  latestRunId: string;
  blueprintId: string;
  blueprintName: string;
  sourceId: string | null;
  sourceName: string | null;
  objectType: string;
  status: string;
  lastEvaluated: string;
  evaluated: number;
  ready: number;
  blocked: number;
  warnings: number;
  averageScore: number | null;
  topFindings: Array<{ code: string; count: number }>;
  topBlockers: Array<{ code: string; count: number }>;
}

export interface GovernanceReadinessReport {
  rows: GovernanceReadinessRow[];
  summary: { evaluated: number; ready: number; blocked: number; averageScore: number | null };
}

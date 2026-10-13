import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AlertTriangle, ArrowUpRight, CheckCircle2, ClipboardCheck, RefreshCw, ShieldCheck, TrendingUp, type LucideIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getGovernanceReadinessReport, governanceKeys } from "@/lib/governance-api";
import { availableTopIssues, displayGovernanceScore, findingLabel, readinessRatio } from "@/lib/governance-report-presentation";
import type { GovernanceReadinessRow } from "@shared/governance-readiness";

function Metric({ label, value, helper, icon: Icon, accent }: { label: string; value: string | number; helper: string; icon: LucideIcon; accent: string }) {
  return <div className={`rounded-xl border bg-card p-5 shadow-sm ${accent}`}>
    <div className="flex min-h-10 items-center justify-between gap-2"><p className="text-sm font-medium text-muted-foreground">{label}</p><Icon aria-hidden="true" className="h-5 w-5 opacity-80" /></div>
    <p className="mt-3 text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
    <p className="mt-2 text-xs text-muted-foreground">{helper}</p>
  </div>;
}

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "Date unavailable";
}

function BlueprintIdentity({ row }: { row: GovernanceReadinessRow }) {
  return <div className="min-w-0 space-y-2">
    <a href={`/governance/blueprints/${row.blueprintId}`} className="block font-medium text-primary hover:underline [overflow-wrap:anywhere]">{row.blueprintName?.trim() || "Unnamed blueprint"}</a>
    <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{row.sourceName?.trim() || (row.sourceId ? "Source unavailable" : "No source recorded")}</p>
    <Badge variant="outline" className="max-w-full whitespace-normal break-all text-xs">{row.objectType || "Object type unavailable"}</Badge>
  </div>;
}

function TopIssue({ row }: { row: GovernanceReadinessRow }) {
  const top = row.topBlockers[0] ?? row.topFindings[0];
  return top ? <div className="space-y-1">
    <Badge variant="outline" title={top.code} className="max-w-full whitespace-normal text-left [overflow-wrap:anywhere]">{findingLabel(top.code)}</Badge>
    <p className="text-xs text-muted-foreground">{top.count} affected {top.count === 1 ? "object" : "objects"}</p>
  </div> : <span className="text-xs text-muted-foreground">No findings</span>;
}

function ViewResults({ id }: { id: string }) {
  return <Button size="sm" variant="outline" asChild className="max-w-full px-2 text-xs"><Link href={`/governance/evaluation-runs/${id}`}>View results<ArrowUpRight aria-hidden="true" className="ml-1 h-3 w-3 shrink-0" /></Link></Button>;
}

export default function Reports() {
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: governanceKeys.readinessReport, queryFn: getGovernanceReadinessReport, refetchOnMount: "always",
  });
  const ratio = readinessRatio(data?.summary.ready ?? 0, data?.summary.blocked ?? 0);
  const issues = availableTopIssues(data?.rows ?? []);
  const latest = (data?.rows ?? []).map(row => new Date(row.lastEvaluated).getTime()).filter(Number.isFinite).sort((a, b) => b - a)[0];

  return <div className="space-y-6">
    <div><h1 className="text-2xl font-semibold" data-testid="text-page-title">Reports</h1>
      <p className="mt-1 text-sm text-muted-foreground">Governance reports summarize the latest evaluation results. They do not run automation or change CMDB/provider data.</p>
    </div>
    <Card>
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2"><CardTitle>Governance Readiness Report</CardTitle>
            <CardDescription>Current governance posture based on the latest evaluation per blueprint and CMDB source.</CardDescription>
            {latest !== undefined && <p className="text-xs text-muted-foreground">Last updated from latest evaluation: {new Date(latest).toLocaleString()}</p>}
          </div>
          <Button variant="outline" onClick={() => refetch()} disabled={isFetching}><RefreshCw aria-hidden="true" className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />Refresh report</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {isError ? <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">Could not load the governance readiness report. Use Refresh report to retry.</div>
          : isLoading ? <div className="space-y-4"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-36 rounded-xl" />)}</div><Skeleton className="h-52 rounded-xl" /></div>
          : !data?.rows.length ? <div className="flex flex-col items-center rounded-xl border border-dashed bg-muted/20 px-6 py-16 text-center">
            <div className="mb-5 rounded-full bg-primary/10 p-4"><ClipboardCheck aria-hidden="true" className="h-8 w-8 text-primary" /></div>
            <h2 className="text-lg font-semibold">No governance evaluations yet.</h2>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">Run a governance evaluation from a blueprint to populate this report.</p>
            <Button asChild className="mt-6"><Link href="/governance">Open Governance<ArrowUpRight aria-hidden="true" className="ml-2 h-4 w-4" /></Link></Button>
          </div> : <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="Total evaluated objects" value={data.summary.evaluated} helper={`${data.rows.length} latest evaluation ${data.rows.length === 1 ? "group" : "groups"}`} icon={ClipboardCheck} accent="border-t-4 border-t-primary/60" />
              <Metric label="Ready" value={data.summary.ready} helper={`${ratio.readyPercent}% of evaluated objects`} icon={CheckCircle2} accent="border-t-4 border-t-emerald-500/70 [&>p]:text-emerald-700 dark:[&>p]:text-emerald-400" />
              <Metric label="Needs attention" value={data.summary.blocked} helper={`${ratio.attentionPercent}% need review`} icon={AlertTriangle} accent="border-t-4 border-t-amber-500/70 [&>p]:text-amber-700 dark:[&>p]:text-amber-400" />
              <Metric label="Average score" value={displayGovernanceScore(data.summary.averageScore)} helper="Mean governance score across objects" icon={TrendingUp} accent="border-t-4 border-t-primary/30" />
            </div>

            <div className="grid items-start gap-4 lg:grid-cols-2">
              <div className="rounded-xl border bg-muted/10 p-5">
                <h2 className="flex items-center gap-2 font-semibold"><ShieldCheck aria-hidden="true" className="h-4 w-4 text-primary" />Readiness at a glance</h2>
                <p className="mt-2 text-sm text-muted-foreground">{ratio.total ? `${ratio.readyPercent}% of evaluated objects are ready.` : "No evaluated objects in these groups."}</p>
                <div role="img" aria-label={`${data.summary.ready} ready (${ratio.readyPercent}%), ${data.summary.blocked} need attention (${ratio.attentionPercent}%)`} className="mt-6 flex h-4 overflow-hidden rounded-full bg-muted">
                  <span className="bg-emerald-500 dark:bg-emerald-400" style={{ width: `${ratio.readyPercent}%` }} />
                  <span className="bg-amber-500 dark:bg-amber-400" style={{ width: `${ratio.attentionPercent}%` }} />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
                  <div><span className="font-medium text-emerald-700 dark:text-emerald-400">Ready</span><p className="mt-1 tabular-nums">{data.summary.ready} <span className="text-muted-foreground">· {ratio.readyPercent}%</span></p></div>
                  <div><span className="font-medium text-amber-700 dark:text-amber-400">Needs attention</span><p className="mt-1 tabular-nums">{data.summary.blocked} <span className="text-muted-foreground">· {ratio.attentionPercent}%</span></p></div>
                </div>
                <p className="mt-5 border-t pt-4 text-xs leading-relaxed text-muted-foreground">Recorded evaluations, not live GATE decisions. Refresh source data and reevaluate after policy or source changes. Objects can appear in more than one blueprint group.</p>
              </div>
              <div className="rounded-xl border p-5">
                <h2 className="font-semibold">Top Governance Issues</h2>
                <p className="mt-1 text-xs text-muted-foreground">Based on available per-group summaries, not an exhaustive total.</p>
                {issues.length ? <ul className="mt-4 divide-y">{issues.map(issue => <li key={issue.code} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0"><p className="text-sm font-medium [overflow-wrap:anywhere]">{findingLabel(issue.code)}</p>
                    <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{issue.code}</p>
                    {issue.includesBlockers && <Badge variant="outline" className="mt-1 border-amber-500/30 bg-amber-500/10 text-xs text-amber-800 dark:text-amber-300">Includes blockers</Badge>}
                  </div>
                  <div className="shrink-0 text-right"><p className="text-lg font-semibold tabular-nums">{issue.count}</p><p className="text-xs text-muted-foreground">affected objects</p></div>
                </li>)}</ul> : <p className="mt-6 text-sm text-muted-foreground">No governance findings in the latest evaluations.</p>}
              </div>
            </div>

            <div className="space-y-4">
              <div><h2 className="font-semibold">Latest evaluations</h2><p className="mt-1 text-xs text-muted-foreground">One successful completed evaluation per blueprint, CMDB source, and object type. Warnings count affected objects and may also occur on ready objects.</p></div>
              <div className="hidden rounded-xl border xl:block"><Table className="table-fixed [&_th]:px-2 [&_th]:text-xs [&_td]:px-2">
                <TableHeader><TableRow><TableHead className="w-[24%]">Blueprint / Source</TableHead><TableHead className="w-[12%]">Last evaluated</TableHead><TableHead className="w-[8%]">Evaluated</TableHead><TableHead className="w-[6%]">Ready</TableHead><TableHead className="w-[12%]">Needs attention</TableHead><TableHead className="w-[12%]">Score / Warnings</TableHead><TableHead className="w-[12%]">Top issue</TableHead><TableHead className="w-[14%]">Action</TableHead></TableRow></TableHeader>
                <TableBody>{data.rows.map(row => <TableRow key={row.latestRunId} className="align-top hover:bg-muted/40">
                  <TableCell className="py-5"><BlueprintIdentity row={row} /></TableCell><TableCell className="py-5 text-xs text-muted-foreground">{dateLabel(row.lastEvaluated)}</TableCell>
                  <TableCell className="py-5 font-medium tabular-nums">{row.evaluated}</TableCell><TableCell className="py-5 font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{row.ready}</TableCell><TableCell className="py-5 font-semibold tabular-nums text-amber-700 dark:text-amber-400">{row.blocked}</TableCell>
                  <TableCell className="py-5"><p className="text-xs font-medium tabular-nums">{displayGovernanceScore(row.averageScore)}</p><p className="mt-2 text-xs text-muted-foreground">{row.warnings} warnings</p></TableCell><TableCell className="py-5"><TopIssue row={row} /></TableCell><TableCell className="py-5"><ViewResults id={row.latestRunId} /></TableCell>
                </TableRow>)}</TableBody>
              </Table></div>
              <div className="grid gap-4 xl:hidden">{data.rows.map(row => <div key={row.latestRunId} className="min-w-0 space-y-4 rounded-xl border p-4">
                <BlueprintIdentity row={row} />
                <dl className="grid grid-cols-3 gap-3 rounded-lg bg-muted/30 p-3 text-sm">
                  {[["Evaluated", row.evaluated], ["Ready", row.ready], ["Needs attention", row.blocked], ["Warnings", row.warnings], ["Average score", displayGovernanceScore(row.averageScore)]].map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 font-semibold tabular-nums">{value}</dd></div>)}
                </dl>
                <div className="space-y-2"><p className="text-xs text-muted-foreground">Top issue</p><TopIssue row={row} /></div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3"><p className="text-xs text-muted-foreground">Last evaluated: {dateLabel(row.lastEvaluated)}</p><ViewResults id={row.latestRunId} /></div>
              </div>)}</div>
            </div>
          </>}
      </CardContent>
    </Card>
  </div>;
}

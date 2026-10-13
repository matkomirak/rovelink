import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { RefreshCw, ArrowUpRight } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiRequest } from "@/lib/queryClient";
import { automationReadinessPercentages, type AutomationReadinessReport } from "@shared/automation-readiness";

export function AutomationReadinessDashboard() {
  const { data, isLoading, isError, isFetching, refetch } = useQuery<AutomationReadinessReport>({
    queryKey: ["/api/inventories/readiness-report"],
    queryFn: async () => (await apiRequest("GET", "/api/inventories/readiness-report")).json(),
    refetchOnMount: "always",
  });
  const percentages = automationReadinessPercentages(data?.summary ?? { targets: 0, ready: 0, needsAttention: 0, unknown: 0 });
  const segments = [
    { label: "Ready", count: data?.summary.ready ?? 0, percent: percentages.ready, color: "bg-emerald-500" },
    { label: "Needs attention", count: data?.summary.needsAttention ?? 0, percent: percentages.attention, color: "bg-amber-500" },
    { label: "Unknown", count: data?.summary.unknown ?? 0, percent: percentages.unknown, color: "bg-slate-500" },
  ];
  return <Card>
    <CardHeader>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2"><CardTitle>Automation Readiness Report</CardTitle>
          <CardDescription>Shows which automation inventory targets are currently ready to automate and what needs attention before execution.</CardDescription>
          <p className="text-xs text-muted-foreground">This report does not execute automation. It summarizes inventory and readiness signals.</p>
        </div>
        <Button variant="outline" onClick={() => refetch()} disabled={isFetching}><RefreshCw aria-hidden="true" className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />Refresh report</Button>
      </div>
    </CardHeader>
    <CardContent className="space-y-6">
      <div className="rounded-lg border bg-muted/20 p-4 text-sm text-muted-foreground">
        <p>Missing cached host addresses or a latest stored governance result that is not ready need attention. Remaining targets are Unknown: current execution GATE authorization is not tracked by this report. Ready stays zero until full execution readiness can be established.</p>
        <p className="mt-2">Connection user and credential availability are selected at run preparation and are not tracked here. File/script host details are not assessed. Counts cover inventory targets, not source VMs excluded during inventory sync; the same target in two inventories counts twice. Stored governance results may be older than the current CMDB state. Execution always checks GATE again.</p>
      </div>
      {isError ? <p role="alert" className="text-sm text-destructive">Could not load automation readiness. Use Refresh report to retry.</p>
        : isLoading ? <Skeleton className="h-52 rounded-xl" />
        : <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[{ label: "Automation targets", count: data?.summary.targets ?? 0, color: "bg-primary" }, ...segments].map(metric => <div key={metric.label} className="overflow-hidden rounded-xl border bg-card shadow-sm">
              <div className={`h-1 ${metric.color}`} /><div className="p-5"><p className="min-h-10 text-sm font-medium text-muted-foreground">{metric.label}</p><p className="mt-3 text-3xl font-semibold tabular-nums">{metric.count}</p></div>
            </div>)}
          </div>
          {!data?.summary.targets && <div className="rounded-xl border border-dashed bg-muted/20 p-8 text-center">
            <h2 className="text-lg font-semibold">No automation targets yet.</h2>
            <p className="mt-2 text-sm text-muted-foreground">Create or sync an automation inventory to populate this report.</p>
            <Button asChild className="mt-4"><Link href="/automation-inventories">Open Automation Inventories</Link></Button>
          </div>}
          {!!data?.summary.targets && <div className="grid items-start gap-4 lg:grid-cols-2">
            <div className="rounded-xl border bg-muted/10 p-5"><h2 className="font-semibold">Readiness at a glance</h2>
              <div role="img" aria-label={segments.map(s => `${s.count} ${s.label} (${s.percent}%)`).join(", ")} className="mt-6 flex h-4 overflow-hidden rounded-full bg-muted">
                {segments.map(segment => <span key={segment.label} className={segment.color} style={{ width: `${segment.percent}%` }} />)}
              </div>
              <div className="mt-4 flex flex-wrap gap-4 text-sm">{segments.map(segment => <span key={segment.label} className="flex items-center gap-2"><span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${segment.color}`} />{segment.label}: {segment.count} ({segment.percent}%)</span>)}</div>
            </div>
            <div className="rounded-xl border bg-muted/10 p-5"><h2 className="font-semibold">Top Readiness Issues</h2>
              <p className="mt-2 text-xs text-muted-foreground">Counts are affected targets per issue; a target can have more than one issue.</p>
              <ul className="mt-4 space-y-3">{data.blockers.map(issue => <li key={issue.key} className="flex items-start justify-between gap-3 text-sm"><span className="break-words">{issue.label}<span className="ml-2 text-xs text-muted-foreground">{issue.severity === "info" ? "Unknown signal" : "Needs attention"}</span></span><span className="shrink-0 tabular-nums">{issue.count} {issue.count === 1 ? "target" : "targets"}</span></li>)}</ul>
            </div>
          </div>}
          {!!data?.inventories.length && <div>
            <h2 className="mb-4 font-semibold">Readiness by inventory</h2>
            <div className="hidden xl:block"><Table><TableHeader><TableRow>
              {["Inventory", "Targets", "Ready", "Needs attention", "Unknown", "Signals / top issue", "Action"].map(label => <TableHead key={label}>{label}</TableHead>)}
            </TableRow></TableHeader><TableBody>{data.inventories.map(row => <TableRow key={row.inventoryId}>
              <TableCell className="max-w-48 [overflow-wrap:anywhere]"><Link href={`/inventories/${row.inventoryId}`} className="font-medium text-primary hover:underline">{row.inventoryName || "Unnamed inventory"}</Link></TableCell>
              <TableCell>{row.targetCount}</TableCell><TableCell>{row.readyCount}</TableCell><TableCell>{row.needsAttentionCount}</TableCell><TableCell>{row.unknownCount}</TableCell>
              <TableCell className="max-w-64 text-xs"><p>{row.topIssue ? `${row.topIssue.label} — ${row.topIssue.count}` : "No targets"}</p><p className="mt-1 text-muted-foreground">{row.addressPresentCount} addresses present; {row.governanceReadyCount} governance-ready; {row.governanceUnknownCount} governance unknown</p><p className="mt-1 text-muted-foreground">Inventory refreshed: {row.lastRefreshedAt ? new Date(row.lastRefreshedAt).toLocaleString() : "Not recorded"}</p></TableCell>
              <TableCell><Button asChild variant="outline" size="sm"><Link href={`/inventories/${row.inventoryId}`}>View inventory<ArrowUpRight aria-hidden="true" className="ml-1 h-3 w-3" /></Link></Button></TableCell>
            </TableRow>)}</TableBody></Table></div>
            <div className="grid gap-4 xl:hidden">{data.inventories.map(row => <div key={row.inventoryId} className="min-w-0 space-y-3 rounded-xl border p-4">
              <Link href={`/inventories/${row.inventoryId}`} className="block font-medium text-primary hover:underline [overflow-wrap:anywhere]">{row.inventoryName || "Unnamed inventory"}</Link>
              <dl className="grid grid-cols-2 gap-3 text-sm">{[["Targets", row.targetCount], ["Ready", row.readyCount], ["Needs attention", row.needsAttentionCount], ["Unknown", row.unknownCount]].map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd>{value}</dd></div>)}</dl>
              <p className="text-sm">{row.topIssue ? `${row.topIssue.label} — ${row.topIssue.count}` : "No targets"}</p>
              <p className="text-xs text-muted-foreground">{row.addressPresentCount} addresses present; {row.governanceReadyCount} governance-ready; {row.governanceUnknownCount} governance unknown</p>
              <p className="text-xs text-muted-foreground">Inventory refreshed: {row.lastRefreshedAt ? new Date(row.lastRefreshedAt).toLocaleString() : "Not recorded"}</p>
              <Button asChild variant="outline" size="sm"><Link href={`/inventories/${row.inventoryId}`}>View inventory</Link></Button>
            </div>)}</div>
          </div>}
        </>}
    </CardContent>
  </Card>;
}

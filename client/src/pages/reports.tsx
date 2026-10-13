import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { RefreshCw } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getGovernanceReadinessReport, governanceKeys } from "@/lib/governance-api";

export default function Reports() {
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: governanceKeys.readinessReport, queryFn: getGovernanceReadinessReport, refetchOnMount: "always",
  });
  return <div className="space-y-6">
    <div><h1 className="text-2xl font-semibold" data-testid="text-page-title">Reports</h1>
      <p className="text-sm text-muted-foreground">Governance reports summarize the latest evaluation results. They do not run automation or change CMDB/provider data.</p>
    </div>
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Governance Readiness Report</CardTitle>
          <Button variant="outline" onClick={() => refetch()} disabled={isFetching}><RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />Refresh report</Button>
        </div>
        <CardDescription>Current governance posture based on the latest evaluation per blueprint and CMDB source.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {isError ? <p role="alert" className="text-destructive">Could not load the governance readiness report. Use Refresh report to retry.</p>
          : isLoading ? <Skeleton className="h-40 w-full" />
          : !data?.rows.length ? <div className="rounded-md border border-dashed p-8 text-center">
            <p>No governance evaluations yet. Run a governance evaluation from a blueprint to populate this report.</p>
            <Button variant="outline" asChild className="mt-3"><Link href="/governance">Open Governance</Link></Button>
          </div> : <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[['Total evaluated objects', data.summary.evaluated], ['Ready', data.summary.ready], ['Blocked / Not ready', data.summary.blocked], ['Average score', data.summary.averageScore ?? '—']].map(([label, value]) =>
                <div key={label} className="rounded-md border p-4"><p className="text-sm text-muted-foreground">{label}</p><p className="text-2xl font-semibold">{value}</p></div>)}
            </div>
            <p className="text-xs text-muted-foreground">Latest successful completed evaluations only. Counts are object evaluations across groups; the same object may appear under multiple blueprints. Results may be stale after source or policy changes and are not execution-time GATE decisions. Warning and finding counts measure affected objects, not individual rule failures.</p>
            <div className="overflow-x-auto"><Table>
              <TableHeader><TableRow>
                <TableHead>Blueprint</TableHead><TableHead>CMDB Source</TableHead><TableHead>Object Type</TableHead><TableHead>Last evaluated</TableHead>
                <TableHead>Evaluated</TableHead><TableHead>Ready</TableHead><TableHead>Blocked / Not ready</TableHead><TableHead>Warnings</TableHead><TableHead>Average score</TableHead><TableHead>Top finding / blocker</TableHead><TableHead>Action</TableHead>
              </TableRow></TableHeader>
              <TableBody>{data.rows.map(row => {
                const top = row.topBlockers[0] ?? row.topFindings[0];
                return <TableRow key={row.latestRunId}>
                  <TableCell><a href={`/governance/blueprints/${row.blueprintId}`} className="font-medium text-primary hover:underline">{row.blueprintName}</a></TableCell>
                  <TableCell>{row.sourceName ?? (row.sourceId ? 'Source unavailable' : 'No source recorded')}</TableCell>
                  <TableCell><Badge variant="outline">{row.objectType}</Badge></TableCell>
                  <TableCell>{new Date(row.lastEvaluated).toLocaleString()}</TableCell>
                  <TableCell>{row.evaluated}</TableCell><TableCell>{row.ready}</TableCell><TableCell>{row.blocked}</TableCell><TableCell>{row.warnings}</TableCell><TableCell>{row.averageScore ?? '—'}</TableCell>
                  <TableCell>{top ? <><span className="font-mono text-xs">{top.code}</span><span className="ml-1">({top.count})</span></> : 'No findings'}</TableCell>
                  <TableCell><Button size="sm" variant="outline" asChild><Link href={`/governance/evaluation-runs/${row.latestRunId}`}>View results</Link></Button></TableCell>
                </TableRow>;
              })}</TableBody>
            </Table></div>
          </>}
      </CardContent>
    </Card>
  </div>;
}

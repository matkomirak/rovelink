import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { governanceKeys, listGovernanceEvaluationRuns } from "@/lib/governance-api";

export function GovernanceBlueprintRuns({ blueprintId }: { blueprintId: string }) {
  const { data: runs = [], isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: governanceKeys.blueprintEvaluationRuns(blueprintId),
    queryFn: () => listGovernanceEvaluationRuns(blueprintId),
    enabled: Boolean(blueprintId),
  });
  const count = (counts: unknown, key: string) => {
    const value = counts && typeof counts === "object" ? (counts as Record<string, unknown>)[key] : undefined;
    return typeof value === "number" ? value : "—";
  };
  return <Card>
    <CardHeader>
      <div className="flex items-center justify-between gap-3">
        <CardTitle>Recent Evaluation Runs</CardTitle>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />Refresh evaluations
        </Button>
      </div>
      <CardDescription>Latest 10 evaluations of this blueprint, including earlier versions. Historical results do not represent a new GATE decision.</CardDescription>
    </CardHeader>
    <CardContent>
      {isError ? <p role="alert" className="text-destructive">Could not load evaluation history. Use Refresh evaluations to retry.</p>
        : isLoading ? <Skeleton className="h-16 w-full" />
        : runs.length === 0 ? <p className="text-sm text-muted-foreground">No evaluations have been run for this blueprint yet.</p>
        : <div className="overflow-x-auto"><Table>
          <TableHeader><TableRow>
            <TableHead>Created</TableHead><TableHead>Status</TableHead><TableHead>Evaluated objects</TableHead><TableHead>Blocked</TableHead><TableHead className="text-right">Action</TableHead>
          </TableRow></TableHeader>
          <TableBody>{runs.map(run => <TableRow key={run.id}>
            <TableCell>{new Date(run.createdAt).toLocaleString()}</TableCell>
            <TableCell><Badge variant={run.status === "failed" ? "destructive" : "outline"}>{run.status}</Badge></TableCell>
            <TableCell>{count(run.counts, "evaluated")}</TableCell><TableCell>{count(run.counts, "blocked")}</TableCell>
            <TableCell className="text-right"><Button variant="outline" size="sm" asChild><Link href={`/governance/evaluation-runs/${run.id}`}>View results</Link></Button></TableCell>
          </TableRow>)}</TableBody>
        </Table></div>}
      <Link href="/governance/evaluation-runs" className="mt-4 inline-block text-sm text-primary hover:underline">View evaluation history across all blueprints</Link>
    </CardContent>
  </Card>;
}

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowLeft, History, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  governanceKeys,
  listGovernanceBlueprints,
  listGovernanceEvaluationRuns,
} from "@/lib/governance-api";
import type { GovernanceBlueprint, GovernanceEvaluationRun } from "@shared/schema";

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "ok") return "default";
  if (status === "failed") return "destructive";
  if (status === "running" || status === "queued") return "secondary";
  return "outline";
}

function getEvaluatedCount(run: GovernanceEvaluationRun) {
  const counts = run.counts;
  if (!counts || typeof counts !== "object" || Array.isArray(counts)) return "-";
  const evaluated = (counts as Record<string, unknown>).evaluated;
  return typeof evaluated === "number" ? String(evaluated) : "-";
}

export default function GovernanceEvaluationRuns() {
  const { data: runs = [], isLoading, isError, error, refetch, isFetching } = useQuery<GovernanceEvaluationRun[]>({
    queryKey: governanceKeys.evaluationRuns,
    queryFn: listGovernanceEvaluationRuns,
  });
  const { data: blueprints = [] } = useQuery<GovernanceBlueprint[]>({
    queryKey: governanceKeys.blueprints,
    queryFn: listGovernanceBlueprints,
  });

  const blueprintNames = useMemo(() => new Map(blueprints.map((blueprint) => [blueprint.id, blueprint.name])), [blueprints]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/governance"><ArrowLeft className="h-4 w-4 mr-2" />Back to Governance</Link>
          </Button>
          <div>
            <h1 className="text-2xl font-semibold" data-testid="text-page-title">Governance Evaluation Runs</h1>
            <p className="text-sm text-muted-foreground">Review cached CMDB governance evaluation history.</p>
          </div>
        </div>
        <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Runs
          </CardTitle>
          <CardDescription>{runs.length} governance evaluation run{runs.length === 1 ? "" : "s"}</CardDescription>
        </CardHeader>
        <CardContent>
          {isError ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
              {(error as Error).message}
            </div>
          ) : isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-12 w-full" />)}
            </div>
          ) : runs.length === 0 ? (
            <div className="rounded-md border border-dashed p-8 text-center">
              <p className="font-medium">No evaluation runs yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Run an evaluation from Governance and choose the cached NetBox source to inspect.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Created</TableHead>
                    <TableHead>Blueprint</TableHead>
                    <TableHead>Object Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Evaluated</TableHead>
                    <TableHead className="text-right">Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((run) => (
                    <TableRow key={run.id}>
                      <TableCell>{formatDate(run.createdAt)}</TableCell>
                      <TableCell className="font-medium">{blueprintNames.get(run.blueprintId) ?? run.blueprintId}</TableCell>
                      <TableCell><Badge variant="outline">netbox_vm</Badge></TableCell>
                      <TableCell><Badge variant={statusVariant(run.status)}>{run.status}</Badge></TableCell>
                      <TableCell>{getEvaluatedCount(run)}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="outline" size="sm" asChild>
                          <Link href={`/governance/evaluation-runs/${run.id}`}>View</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

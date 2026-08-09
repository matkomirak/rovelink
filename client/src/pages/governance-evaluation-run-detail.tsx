import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { ArrowLeft, CheckCircle2, RefreshCw, ShieldAlert, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  getGovernanceBlueprint,
  getGovernanceEvaluationRun,
  governanceKeys,
  listGovernanceEvaluationObjects,
} from "@/lib/governance-api";
import type { GovernanceBlueprint, GovernanceEvaluationRun, GovernanceObjectEvaluation } from "@shared/schema";
import type { GovernanceFinding, RecommendedGovernanceAction } from "@shared/governance";

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

function getCount(run: GovernanceEvaluationRun | undefined, key: string) {
  const counts = run?.counts;
  if (!counts || typeof counts !== "object" || Array.isArray(counts)) return "-";
  const value = (counts as Record<string, unknown>)[key];
  return typeof value === "number" ? String(value) : "-";
}

function getSnapshotValue(evaluation: GovernanceObjectEvaluation, key: string) {
  const snapshot = evaluation.objectSnapshot;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return undefined;
  return (snapshot as Record<string, unknown>)[key];
}

function readinessBadge(ready: boolean) {
  return ready ? (
    <Badge className="gap-1"><CheckCircle2 className="h-3 w-3" />Ready</Badge>
  ) : (
    <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" />Blocked</Badge>
  );
}

function FindingsList({ findings }: { findings: GovernanceFinding[] }) {
  if (!findings.length) return <span className="text-muted-foreground">No findings</span>;
  return (
    <div className="space-y-1">
      {findings.map((finding, index) => (
        <div key={`${finding.code}-${index}`} className="rounded-md border p-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={finding.severity === "blocker" ? "destructive" : "outline"}>{finding.severity}</Badge>
            <span className="font-medium">{finding.code}</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{finding.message}</p>
        </div>
      ))}
    </div>
  );
}

function ActionsList({ actions }: { actions: RecommendedGovernanceAction[] }) {
  if (!actions.length) return <span className="text-muted-foreground">No actions</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {actions.map((action) => (
        <Badge key={action} variant={action === "block_automation" ? "destructive" : "secondary"}>
          {action}
        </Badge>
      ))}
    </div>
  );
}

export default function GovernanceEvaluationRunDetail() {
  const { id = "" } = useParams<{ id: string }>();
  const {
    data: run,
    isLoading: runLoading,
    isError: runError,
    error,
  } = useQuery<GovernanceEvaluationRun>({
    queryKey: governanceKeys.evaluationRun(id),
    queryFn: () => getGovernanceEvaluationRun(id),
    enabled: Boolean(id),
  });

  const { data: blueprint } = useQuery<GovernanceBlueprint>({
    queryKey: governanceKeys.blueprint(run?.blueprintId ?? ""),
    queryFn: () => getGovernanceBlueprint(run!.blueprintId),
    enabled: Boolean(run?.blueprintId),
  });

  const {
    data: evaluations = [],
    isLoading: evaluationsLoading,
    isError: evaluationsError,
    error: evaluationsErrorDetail,
    refetch: refetchEvaluations,
    isFetching: evaluationsFetching,
  } = useQuery<GovernanceObjectEvaluation[]>({
    queryKey: governanceKeys.evaluationObjects(id),
    queryFn: () => listGovernanceEvaluationObjects(id),
    enabled: Boolean(id),
  });

  if (runError) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" asChild>
          <Link href="/governance/evaluation-runs"><ArrowLeft className="h-4 w-4 mr-2" />Back</Link>
        </Button>
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {(error as Error).message}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/governance/evaluation-runs"><ArrowLeft className="h-4 w-4 mr-2" />Back to Evaluation Runs</Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-page-title">Governance Evaluation</h1>
          <p className="text-sm text-muted-foreground">Object-level scores, readiness, findings, and recommended actions.</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5" />
            Run Metadata
          </CardTitle>
        </CardHeader>
        <CardContent>
          {runLoading ? (
            <div className="grid gap-3 md:grid-cols-5">
              {Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-12" />)}
            </div>
          ) : run ? (
            <div className="grid gap-4 md:grid-cols-5">
              <div>
                <div className="text-xs text-muted-foreground">Status</div>
                <Badge variant={statusVariant(run.status)}>{run.status}</Badge>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Blueprint</div>
                <div className="font-medium">{blueprint?.name ?? run.blueprintId}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Created</div>
                <div className="font-medium">{formatDate(run.createdAt)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Evaluated</div>
                <div className="font-medium">{getCount(run, "evaluated")}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Blocked</div>
                <div className="font-medium">{getCount(run, "blocked")}</div>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Object Evaluations</CardTitle>
          <CardDescription>{evaluations.length} evaluated object{evaluations.length === 1 ? "" : "s"}</CardDescription>
        </CardHeader>
        <CardContent>
          {evaluationsError ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
              <p className="font-medium">Failed to load object evaluations</p>
              <p className="mt-1 text-muted-foreground">{(evaluationsErrorDetail as Error).message}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => refetchEvaluations()}
                disabled={evaluationsFetching}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${evaluationsFetching ? "animate-spin" : ""}`} />
                Retry
              </Button>
            </div>
          ) : evaluationsLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-16 w-full" />)}
            </div>
          ) : evaluations.length === 0 ? (
            <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
              No object evaluations were stored for this run.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Object</TableHead>
                    <TableHead>IDs</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Readiness</TableHead>
                    <TableHead>Actions</TableHead>
                    <TableHead>Findings</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {evaluations.map((evaluation) => (
                    <TableRow key={evaluation.id} className="align-top">
                      <TableCell>
                        <div className="font-medium">{evaluation.objectName ?? evaluation.objectId ?? "Unnamed object"}</div>
                        <div className="text-xs text-muted-foreground">{evaluation.objectType}</div>
                      </TableCell>
                      <TableCell className="text-xs">
                        <div>object: {evaluation.objectId ?? "-"}</div>
                        <div>source: {String(getSnapshotValue(evaluation, "sourceId") ?? "-")}</div>
                        <div>netbox: {evaluation.externalId ?? String(getSnapshotValue(evaluation, "netboxId") ?? "-")}</div>
                      </TableCell>
                      <TableCell>
                        <div className="font-semibold">{evaluation.governanceScore}</div>
                        <div className="text-xs text-muted-foreground">
                          data {evaluation.dataManagementScore} / ownership {evaluation.ownershipScore} / priority {evaluation.relevanceWeightedPriority}
                        </div>
                      </TableCell>
                      <TableCell>{readinessBadge(evaluation.automationReady)}</TableCell>
                      <TableCell><ActionsList actions={evaluation.recommendedActions as RecommendedGovernanceAction[]} /></TableCell>
                      <TableCell className="min-w-72"><FindingsList findings={evaluation.findings as GovernanceFinding[]} /></TableCell>
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

import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, RefreshCw, ShieldAlert, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getLatestGovernanceEvaluationForObject,
  governanceKeys,
  type LatestGovernanceObjectEvaluationResponse,
} from "@/lib/governance-api";
import type { GovernanceFinding, RecommendedGovernanceAction } from "@shared/governance";

interface GovernanceObjectSummaryCardProps {
  objectType: string;
  objectId: string;
  compact?: boolean;
}

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function ReadinessBadge({ ready }: { ready: boolean }) {
  return ready ? (
    <Badge className="gap-1">
      <CheckCircle2 className="h-3 w-3" />
      Governance ready
    </Badge>
  ) : (
    <Badge variant="destructive" className="gap-1">
      <XCircle className="h-3 w-3" />
      Governance block recommended
    </Badge>
  );
}

function ActionBadges({ actions }: { actions: RecommendedGovernanceAction[] }) {
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

function FindingsPreview({ findings }: { findings: GovernanceFinding[] }) {
  if (!findings.length) return <span className="text-muted-foreground">No findings</span>;
  return (
    <div className="space-y-1">
      {findings.slice(0, 3).map((finding, index) => (
        <div key={`${finding.code}-${index}`} className="rounded-md border px-2 py-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={finding.severity === "blocker" ? "destructive" : "outline"} className="text-[10px]">
              {finding.severity}
            </Badge>
            <span className="text-xs font-medium">{finding.code}</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground break-words">{finding.message}</p>
        </div>
      ))}
      {findings.length > 3 && (
        <p className="text-xs text-muted-foreground">+{findings.length - 3} more finding{findings.length - 3 === 1 ? "" : "s"}</p>
      )}
    </div>
  );
}

export function GovernanceObjectSummaryCard({ objectType, objectId, compact = false }: GovernanceObjectSummaryCardProps) {
  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery<LatestGovernanceObjectEvaluationResponse | null>({
    queryKey: governanceKeys.latestObjectEvaluation(objectType, objectId),
    queryFn: () => getLatestGovernanceEvaluationForObject(objectType, objectId),
    enabled: Boolean(objectType && objectId),
  });

  const content = (() => {
    if (isLoading) {
      return (
        <div className="space-y-2">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      );
    }

    if (isError) {
      return (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <p className="font-medium">Failed to load governance evaluation</p>
          <p className="mt-1 text-muted-foreground">{(error as Error).message}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
            Retry
          </Button>
        </div>
      );
    }

    if (!data) {
      return (
        <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          No governance evaluation yet. Run an evaluation from Governance.
        </div>
      );
    }

    const { evaluation, run } = data;
    const findings = evaluation.findings as GovernanceFinding[];
    const actions = evaluation.recommendedActions as RecommendedGovernanceAction[];

    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <div className="text-xs text-muted-foreground">Governance Score</div>
            <div className="text-2xl font-semibold">{evaluation.governanceScore}</div>
          </div>
          <ReadinessBadge ready={evaluation.automationReady} />
          <div className="text-xs text-muted-foreground">
            Evaluated {formatDate(evaluation.evaluatedAt)}
          </div>
        </div>
        <div className="grid gap-2 text-xs sm:grid-cols-3">
          <div className="rounded-md border p-2">
            <div className="text-muted-foreground">Data</div>
            <div className="font-semibold">{evaluation.dataManagementScore}</div>
          </div>
          <div className="rounded-md border p-2">
            <div className="text-muted-foreground">Ownership</div>
            <div className="font-semibold">{evaluation.ownershipScore}</div>
          </div>
          <div className="rounded-md border p-2">
            <div className="text-muted-foreground">Priority</div>
            <div className="font-semibold">{evaluation.relevanceWeightedPriority}</div>
          </div>
        </div>
        <div>
          <div className="mb-1 text-xs font-medium">Recommended Actions</div>
          <ActionBadges actions={actions} />
        </div>
        {!compact && (
          <div>
            <div className="mb-1 text-xs font-medium">Top Findings</div>
            <FindingsPreview findings={findings} />
          </div>
        )}
        {run && (
          <Button variant="outline" size="sm" asChild>
            <Link href={`/governance/evaluation-runs/${run.id}`}>View evaluation run</Link>
          </Button>
        )}
      </div>
    );
  })();

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldAlert className="h-4 w-4" />
          Governance
        </CardTitle>
        <CardDescription>{objectType} / {objectId}</CardDescription>
      </CardHeader>
      <CardContent>{content}</CardContent>
    </Card>
  );
}

export function GovernanceObjectStatusBadge({ objectType, objectId }: GovernanceObjectSummaryCardProps) {
  const { data, isLoading, isError } = useQuery<LatestGovernanceObjectEvaluationResponse | null>({
    queryKey: governanceKeys.latestObjectEvaluation(objectType, objectId),
    queryFn: () => getLatestGovernanceEvaluationForObject(objectType, objectId),
    enabled: Boolean(objectType && objectId),
  });

  if (isLoading) {
    return <Skeleton className="h-6 w-24" />;
  }

  if (isError) {
    return <Badge variant="outline">Unavailable</Badge>;
  }

  if (!data) {
    return <Badge variant="outline">Not evaluated</Badge>;
  }

  const { evaluation } = data;
  const findings = evaluation.findings as GovernanceFinding[];
  const hasBlocker = findings.some((finding) => finding.severity === "blocker");
  const label = evaluation.automationReady
    ? "Governance ready"
    : hasBlocker
      ? "Governance block recommended"
      : "Governance warning";
  const variant = evaluation.automationReady ? "default" : hasBlocker ? "destructive" : "secondary";

  return (
    <div className="flex flex-wrap items-center gap-1">
      <Badge variant={variant}>{label}</Badge>
      <span className="text-xs text-muted-foreground">score {evaluation.governanceScore}</span>
      {findings.length > 0 && (
        <span className="text-xs text-muted-foreground">({findings.length})</span>
      )}
    </div>
  );
}

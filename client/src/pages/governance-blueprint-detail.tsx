import { useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { ArrowLeft, ClipboardCheck, PlayCircle, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import {
  activateGovernanceBlueprintVersion,
  getGovernanceBlueprint,
  governanceKeys,
  listGovernanceBlueprintVersions,
  runCachedNetboxVmEvaluation,
} from "@/lib/governance-api";
import type { GovernanceBlueprint, GovernanceBlueprintVersion } from "@shared/schema";
import type { GovernanceBlueprintRules } from "@shared/governance";

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "active") return "default";
  if (status === "archived") return "outline";
  return "secondary";
}

function RulesPreview({ rules }: { rules: GovernanceBlueprintRules }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Data & Management</CardTitle>
          <CardDescription>{rules.dataManagement.length} field rules</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {rules.dataManagement.map((rule) => (
            <div key={rule.fieldKey} className="rounded-md border p-3">
              <div className="font-medium">{rule.fieldKey}</div>
              <div className="text-muted-foreground">mode: {rule.managementMode}</div>
              <div className="text-muted-foreground">required: {rule.required ? "yes" : "no"} | weight: {rule.weight}</div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ownership</CardTitle>
          <CardDescription>{rules.ownership.length} role rules</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {rules.ownership.map((rule) => (
            <div key={rule.role} className="rounded-md border p-3">
              <div className="font-medium">{rule.role}</div>
              <div className="text-muted-foreground">required: {rule.required ? "yes" : "no"} | weight: {rule.weight}</div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Relevance</CardTitle>
          <CardDescription>0 none, 3 mandatory</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {Object.entries(rules.relevance).map(([dimension, score]) => (
            <div key={dimension} className="flex items-center justify-between rounded-md border px-3 py-2">
              <span className="font-medium">{dimension}</span>
              <Badge variant="outline">{score}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="lg:col-span-3">
        <CardHeader>
          <CardTitle className="text-base">Raw Rules</CardTitle>
          <CardDescription>Read-only JSON until the rule editor is added.</CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="max-h-96 overflow-auto rounded-md bg-muted p-4 text-xs">
            {JSON.stringify(rules, null, 2)}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}

export default function GovernanceBlueprintDetail() {
  const { id = "" } = useParams<{ id: string }>();
  const { toast } = useToast();

  const {
    data: blueprint,
    isLoading: blueprintLoading,
    isError: blueprintError,
    error,
  } = useQuery<GovernanceBlueprint>({
    queryKey: governanceKeys.blueprint(id),
    queryFn: () => getGovernanceBlueprint(id),
    enabled: Boolean(id),
  });

  const {
    data: versions = [],
    isLoading: versionsLoading,
    isError: versionsError,
    error: versionsErrorDetail,
    refetch: refetchVersions,
    isFetching: versionsFetching,
  } = useQuery<GovernanceBlueprintVersion[]>({
    queryKey: governanceKeys.versions(id),
    queryFn: () => listGovernanceBlueprintVersions(id),
    enabled: Boolean(id),
  });

  const activeVersion = useMemo(
    () => versions.find((version) => version.id === blueprint?.activeVersionId),
    [blueprint?.activeVersionId, versions],
  );

  const activateMutation = useMutation({
    mutationFn: (versionId: string) => activateGovernanceBlueprintVersion(id, versionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: governanceKeys.blueprint(id) });
      queryClient.invalidateQueries({ queryKey: governanceKeys.blueprints });
      toast({ title: "Blueprint version activated" });
    },
    onError: (mutationError: Error) => {
      toast({ variant: "destructive", title: "Activation failed", description: mutationError.message });
    },
  });

  const evaluateMutation = useMutation({
    mutationFn: () => runCachedNetboxVmEvaluation(id),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: governanceKeys.evaluationRuns });
      toast({
        title: "Evaluation complete",
        description: `${result.evaluatedCount} cached NetBox VM${result.evaluatedCount === 1 ? "" : "s"} evaluated.`,
      });
    },
    onError: (mutationError: Error) => {
      toast({ variant: "destructive", title: "Evaluation failed", description: mutationError.message });
    },
  });

  if (blueprintError) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" asChild>
          <Link href="/governance"><ArrowLeft className="h-4 w-4 mr-2" />Back</Link>
        </Button>
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {(error as Error).message}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/governance"><ArrowLeft className="h-4 w-4 mr-2" />Back to Governance</Link>
          </Button>
          <div>
            <h1 className="text-2xl font-semibold">{blueprintLoading ? "Governance Blueprint" : blueprint?.name}</h1>
            <p className="text-sm text-muted-foreground">Review versions and run cached NetBox VM evaluations.</p>
          </div>
        </div>
        <Button
          onClick={() => evaluateMutation.mutate()}
          disabled={!blueprint?.activeVersionId || evaluateMutation.isPending}
          data-testid="button-run-governance-evaluation"
        >
          {evaluateMutation.isPending ? (
            <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <PlayCircle className="h-4 w-4 mr-2" />
          )}
          Run Cached NetBox VM Evaluation
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5" />
            Blueprint Metadata
          </CardTitle>
        </CardHeader>
        <CardContent>
          {blueprintLoading ? (
            <div className="grid gap-3 md:grid-cols-4">
              {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-12" />)}
            </div>
          ) : blueprint ? (
            <div className="grid gap-4 md:grid-cols-4">
              <div>
                <div className="text-xs text-muted-foreground">Object Type</div>
                <Badge variant="outline">{blueprint.objectType}</Badge>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Status</div>
                <Badge variant={statusVariant(blueprint.status)}>{blueprint.status}</Badge>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Active Version</div>
                <div className="font-medium">{activeVersion ? `v${activeVersion.version}` : "-"}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Updated</div>
                <div className="font-medium">{formatDate(blueprint.updatedAt)}</div>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Versions</CardTitle>
          <CardDescription>Blueprint versions are read-only here; activation is explicit.</CardDescription>
        </CardHeader>
        <CardContent>
          {versionsError ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
              <p className="font-medium">Failed to load blueprint versions</p>
              <p className="mt-1 text-muted-foreground">{(versionsErrorDetail as Error).message}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => refetchVersions()}
                disabled={versionsFetching}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${versionsFetching ? "animate-spin" : ""}`} />
                Retry
              </Button>
            </div>
          ) : versionsLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-12 w-full" />)}
            </div>
          ) : versions.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              No versions found for this blueprint.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Version</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {versions.map((version) => {
                  const isActive = version.id === blueprint?.activeVersionId;
                  return (
                    <TableRow key={version.id}>
                      <TableCell className="font-medium">v{version.version}</TableCell>
                      <TableCell>{formatDate(version.createdAt)}</TableCell>
                      <TableCell>{isActive ? <Badge>Active</Badge> : <Badge variant="outline">Inactive</Badge>}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isActive || activateMutation.isPending}
                          onClick={() => activateMutation.mutate(version.id)}
                        >
                          Activate
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {activeVersion && <RulesPreview rules={activeVersion.rules as GovernanceBlueprintRules} />}
    </div>
  );
}

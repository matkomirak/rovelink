import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ClipboardCheck, Loader2, PlayCircle, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import {
  governanceKeys,
  listGovernanceBlueprints,
  listGovernanceNetBoxSources,
  runCachedNetboxVmEvaluation,
  syncGovernanceCachedNetBoxVms,
  type CachedNetBoxEvaluationResponse,
  type GovernanceNetBoxSourceSummary,
} from "@/lib/governance-api";
import type { GovernanceBlueprint } from "@shared/schema";

interface GovernanceEvaluationLauncherProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fixedBlueprintId?: string;
  fixedBlueprint?: GovernanceBlueprint;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "never imported";
  return new Date(value).toLocaleString();
}

function sourceLabel(source: GovernanceNetBoxSourceSummary) {
  return `${source.name} (${source.cachedVmCount} VM${source.cachedVmCount === 1 ? "" : "s"})`;
}

export function GovernanceEvaluationLauncher({
  open,
  onOpenChange,
  fixedBlueprintId,
  fixedBlueprint,
}: GovernanceEvaluationLauncherProps) {
  const { toast } = useToast();
  const [selectedBlueprintId, setSelectedBlueprintId] = useState(fixedBlueprintId ?? "");
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [lastResult, setLastResult] = useState<CachedNetBoxEvaluationResponse | null>(null);

  const {
    data: blueprints = [],
    isLoading: blueprintsLoading,
    isError: blueprintsError,
    error: blueprintsErrorDetail,
  } = useQuery<GovernanceBlueprint[]>({
    queryKey: governanceKeys.blueprints,
    queryFn: listGovernanceBlueprints,
    enabled: open && !fixedBlueprintId,
  });

  const {
    data: sources = [],
    isLoading: sourcesLoading,
    isError: sourcesError,
    error: sourcesErrorDetail,
  } = useQuery<GovernanceNetBoxSourceSummary[]>({
    queryKey: governanceKeys.netboxSources,
    queryFn: listGovernanceNetBoxSources,
    enabled: open,
  });

  const blueprintOptions = useMemo(
    () => blueprints.filter((blueprint) => blueprint.objectType === "netbox_vm"),
    [blueprints],
  );
  const selectedBlueprint = fixedBlueprint ?? blueprintOptions.find((blueprint) => blueprint.id === selectedBlueprintId);
  const selectedSource = sources.find((source) => source.id === selectedSourceId);
  const blueprintReady = fixedBlueprintId ? true : Boolean(selectedBlueprint?.activeVersionId);
  const hasCachedVms = Boolean(selectedSource && selectedSource.cachedVmCount > 0);
  const canRun = Boolean(selectedBlueprintId && selectedSourceId && blueprintReady && hasCachedVms);
  const boundSourceId = selectedBlueprint?.sourceType === "netbox_inventory_source" && selectedBlueprint.sourceId
    ? selectedBlueprint.sourceId
    : "";

  useEffect(() => {
    if (!open) return;
    setLastResult(null);
    if (fixedBlueprintId) {
      setSelectedBlueprintId(fixedBlueprintId);
    } else if (!selectedBlueprintId && blueprintOptions.length > 0) {
      const firstActive = blueprintOptions.find((blueprint) => blueprint.activeVersionId) ?? blueprintOptions[0];
      setSelectedBlueprintId(firstActive.id);
      const firstBoundSourceId = firstActive.sourceType === "netbox_inventory_source" && firstActive.sourceId
        ? firstActive.sourceId
        : "";
      if (firstBoundSourceId && sources.some((source) => source.id === firstBoundSourceId)) {
        setSelectedSourceId(firstBoundSourceId);
        return;
      }
    }
    if (!selectedSourceId && boundSourceId && sources.some((source) => source.id === boundSourceId)) {
      setSelectedSourceId(boundSourceId);
    } else if (!selectedSourceId && sources.length > 0) {
      setSelectedSourceId(sources[0].id);
    }
  }, [blueprintOptions, boundSourceId, fixedBlueprintId, open, selectedBlueprintId, selectedSourceId, sources]);

  const handleBlueprintChange = (blueprintId: string) => {
    setSelectedBlueprintId(blueprintId);
    const nextBlueprint = blueprintOptions.find((blueprint) => blueprint.id === blueprintId);
    const nextBoundSourceId = nextBlueprint?.sourceType === "netbox_inventory_source" && nextBlueprint.sourceId
      ? nextBlueprint.sourceId
      : "";
    if (nextBoundSourceId && sources.some((source) => source.id === nextBoundSourceId)) {
      setSelectedSourceId(nextBoundSourceId);
    }
  };

  const evaluationMutation = useMutation({
    mutationFn: () => runCachedNetboxVmEvaluation(selectedBlueprintId, { netboxSourceId: selectedSourceId }),
    onSuccess: (result) => {
      setLastResult(result);
      queryClient.invalidateQueries({ queryKey: governanceKeys.evaluationRuns });
      toast({
        title: "Evaluation complete",
        description: `${result.evaluatedCount} cached NetBox VM${result.evaluatedCount === 1 ? "" : "s"} evaluated from ${selectedSource?.name ?? "selected source"}.`,
      });
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", title: "Evaluation failed", description: error.message });
    },
  });

  const syncMutation = useMutation({
    mutationFn: () => syncGovernanceCachedNetBoxVms(selectedSourceId),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: governanceKeys.netboxSources });
      toast({
        title: "Cached VMs synced",
        description: `${result.importedCount} NetBox VM${result.importedCount === 1 ? "" : "s"} imported for ${selectedSource?.name ?? "the selected source"}.`,
      });
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", title: "Sync failed", description: error.message });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5" />
            Run Governance Evaluation
          </DialogTitle>
          <DialogDescription>
            Blueprint defines governance rules. Evaluation applies those rules to cached CMDB objects from a selected source.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {!fixedBlueprintId && (
            <div className="space-y-2">
              <Label htmlFor="governance-blueprint-select">Governance blueprint</Label>
              {blueprintsLoading ? (
                <Skeleton className="h-10 w-full" />
              ) : blueprintsError ? (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  {(blueprintsErrorDetail as Error).message}
                </div>
              ) : blueprintOptions.length === 0 ? (
                <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                  No NetBox VM blueprints are available yet.
                </div>
              ) : (
                <Select value={selectedBlueprintId} onValueChange={handleBlueprintChange}>
                  <SelectTrigger id="governance-blueprint-select" data-testid="select-governance-evaluation-blueprint">
                    <SelectValue placeholder="Select blueprint" />
                  </SelectTrigger>
                  <SelectContent>
                    {blueprintOptions.map((blueprint) => (
                      <SelectItem key={blueprint.id} value={blueprint.id} disabled={!blueprint.activeVersionId}>
                        {blueprint.name}{!blueprint.activeVersionId ? " (no active version)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="governance-source-select">CMDB / NetBox inventory source</Label>
            {sourcesLoading ? (
              <Skeleton className="h-10 w-full" />
            ) : sourcesError ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                {(sourcesErrorDetail as Error).message}
              </div>
            ) : sources.length === 0 ? (
              <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                No cached NetBox inventory sources are available. Add and import a NetBox source before running evaluation.
              </div>
            ) : (
              <Select value={selectedSourceId} onValueChange={setSelectedSourceId}>
                <SelectTrigger id="governance-source-select" data-testid="select-governance-evaluation-source">
                  <SelectValue placeholder="Select source" />
                </SelectTrigger>
                <SelectContent>
                  {sources.map((source) => (
                    <SelectItem key={source.id} value={source.id}>
                      {sourceLabel(source)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {boundSourceId && selectedSourceId !== boundSourceId && (
            <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm">
              This blueprint is bound to a different source. The selected source will override that binding for this evaluation only.
            </div>
          )}

          {selectedSource && (
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{selectedSource.name}</span>
                {selectedSource.cmdbAccountId && <Badge variant="outline">CMDB source</Badge>}
                <Badge variant={selectedSource.enabled ? "default" : "secondary"}>
                  {selectedSource.enabled ? "enabled" : "disabled"}
                </Badge>
                <Badge variant="outline">{selectedSource.cachedVmCount} cached VM{selectedSource.cachedVmCount === 1 ? "" : "s"}</Badge>
              </div>
              <div className="mt-2 text-muted-foreground">{selectedSource.url}</div>
              <div className="text-muted-foreground">Last import: {formatDate(selectedSource.lastImportAt)}</div>
              <div className="mt-2 text-muted-foreground">
                Governance evaluation never calls live NetBox directly; it evaluates the cached VM set.
              </div>
              {selectedSource.cachedVmCount > 0 && (
                <div className="mt-3">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => syncMutation.mutate()}
                    disabled={!selectedSourceId || syncMutation.isPending}
                    data-testid="button-refresh-governance-cached-vms"
                  >
                    {syncMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4 mr-2" />
                    )}
                    Refresh cached VMs
                  </Button>
                </div>
              )}
            </div>
          )}

          {selectedSource && selectedSource.cachedVmCount === 0 && (
            <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 p-4 text-sm">
              <p className="font-semibold text-foreground">No cached VMs yet</p>
              <p className="mt-1 text-muted-foreground">
                Governance evaluation uses cached CMDB objects. Sync this CMDB source before running an evaluation.
              </p>
              <p className="mt-1 text-muted-foreground">
                Governance evaluation never calls live NetBox directly; it evaluates the cached VM set.
              </p>
              <Button
                type="button"
                className="mt-3"
                onClick={() => syncMutation.mutate()}
                disabled={!selectedSourceId || syncMutation.isPending}
                data-testid="button-sync-governance-cached-vms"
              >
                {syncMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                Sync cached VMs
              </Button>
            </div>
          )}

          {lastResult && (
            <div className="rounded-md border border-green-500/30 bg-green-500/10 p-3 text-sm">
              <p className="font-medium">Evaluation complete</p>
              <p className="mt-1 text-muted-foreground">
                {lastResult.evaluatedCount} evaluated, {lastResult.compliantCount} compliant, {lastResult.warningCount} warning, {lastResult.blockedCount} blocked.
              </p>
              <Button variant="ghost" size="sm" className="mt-1 h-auto px-0" asChild>
                <Link href={`/governance/evaluation-runs/${lastResult.evaluationRunId}`}>View evaluation run</Link>
              </Button>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            onClick={() => evaluationMutation.mutate()}
            disabled={!canRun || evaluationMutation.isPending}
            data-testid="button-confirm-governance-evaluation"
          >
            {evaluationMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <PlayCircle className="h-4 w-4 mr-2" />
            )}
            Run Evaluation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

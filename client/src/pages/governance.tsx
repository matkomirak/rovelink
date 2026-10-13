import { useState } from "react";
import { useMutation, useQueries, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ClipboardCheck, FilePlus2, History, PlayCircle, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { GovernanceBlueprintCreateDialog } from "@/components/governance-blueprint-create-dialog";
import { GovernanceEvaluationLauncher } from "@/components/governance-evaluation-launcher";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  governanceKeys,
  deleteGovernanceBlueprint,
  listGovernanceBlueprints,
  listGovernanceBlueprintVersions,
  listGovernanceNetBoxSources,
  type GovernanceNetBoxSourceSummary,
} from "@/lib/governance-api";
import type { GovernanceBlueprint, GovernanceBlueprintVersion } from "@shared/schema";

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "active") return "default";
  if (status === "archived") return "outline";
  return "secondary";
}

export default function Governance() {
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleting, setDeleting] = useState<GovernanceBlueprint | null>(null);
  const { toast } = useToast();
  const deletion = useMutation({
    mutationFn: (id: string) => deleteGovernanceBlueprint(id),
    onSuccess: () => {
      setDeleting(null);
      queryClient.invalidateQueries({ queryKey: governanceKeys.blueprints });
      queryClient.invalidateQueries({ queryKey: governanceKeys.evaluationRuns });
      queryClient.invalidateQueries({ queryKey: ["/api/governance/objects"] });
      toast({ title: "Blueprint deleted" });
    },
    onError: () => toast({ variant: "destructive", title: "Could not delete blueprint", description: "Check your permissions and try again." }),
  });
  const { data: blueprints = [], isLoading, isError, error, refetch, isFetching } = useQuery<GovernanceBlueprint[]>({
    queryKey: governanceKeys.blueprints,
    queryFn: listGovernanceBlueprints,
  });
  const { data: sources = [] } = useQuery<GovernanceNetBoxSourceSummary[]>({
    queryKey: governanceKeys.netboxSources,
    queryFn: listGovernanceNetBoxSources,
  });
  const sourceNames = new Map(sources.map((source) => [source.id, source.name]));
  const versionQueries = useQueries({
    queries: blueprints.map((blueprint) => ({
      queryKey: governanceKeys.versions(blueprint.id),
      queryFn: () => listGovernanceBlueprintVersions(blueprint.id),
      enabled: Boolean(blueprint.activeVersionId),
    })),
  });
  const activeVersionLabels = new Map<string, string>();
  blueprints.forEach((blueprint, index) => {
    if (!blueprint.activeVersionId) {
      activeVersionLabels.set(blueprint.id, "no active version");
      return;
    }

    const versions = versionQueries[index]?.data as GovernanceBlueprintVersion[] | undefined;
    const activeVersion = versions?.find((version) => version.id === blueprint.activeVersionId);
    activeVersionLabels.set(blueprint.id, activeVersion ? `v${activeVersion.version}` : "active version set");
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-page-title">Governance</h1>
          <p className="text-sm text-muted-foreground">
            Governance evaluates whether reference objects are complete, owned, and ready for safe automation. Evaluate explicitly after refreshing the cache.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => setLauncherOpen(true)} data-testid="button-open-governance-evaluation-launcher">
            <PlayCircle className="h-4 w-4 mr-2" />
            Run Evaluation
          </Button>
          <Button variant="outline" asChild data-testid="link-governance-runs">
            <Link href="/governance/evaluation-runs">
              <History className="h-4 w-4 mr-2" />
              Evaluation Runs
            </Link>
          </Button>
          <Button
            onClick={() => setCreateOpen(true)}
            data-testid="button-create-governance-blueprint"
          >
            <FilePlus2 className="h-4 w-4 mr-2" />
            Create Governance Blueprint
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ClipboardCheck className="h-5 w-5" />
                Blueprints
              </CardTitle>
              <CardDescription>{blueprints.length} governance blueprint{blueprints.length === 1 ? "" : "s"}</CardDescription>
            </div>
            <Button variant="ghost" size="icon" onClick={() => refetch()} disabled={isFetching} title="Refresh blueprints">
              <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isError ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
              {(error as Error).message}
            </div>
          ) : isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-12 w-full" />
              ))}
            </div>
          ) : blueprints.length === 0 ? (
            <div className="rounded-md border border-dashed p-8 text-center">
              <p className="font-medium">No governance blueprints yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Create a source-bound NetBox VM blueprint to start evaluating cached CMDB data.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Object Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Active Version</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Updated</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {blueprints.map((blueprint) => (
                    <TableRow key={blueprint.id}>
                      <TableCell className="font-medium"><a href={`/governance/blueprints/${blueprint.id}`} className="text-primary hover:underline">{blueprint.name}</a></TableCell>
                      <TableCell>
                        {blueprint.sourceType === "netbox_inventory_source" && blueprint.sourceId ? (
                          sourceNames.get(blueprint.sourceId) ?? "Bound source"
                        ) : (
                          <span className="text-muted-foreground">No bound source</span>
                        )}
                      </TableCell>
                      <TableCell><Badge variant="outline">{blueprint.objectType}</Badge></TableCell>
                      <TableCell><Badge variant={statusVariant(blueprint.status)}>{blueprint.status}</Badge></TableCell>
                      <TableCell>{activeVersionLabels.get(blueprint.id) ?? "active version set"}</TableCell>
                      <TableCell>{formatDate(blueprint.createdAt)}</TableCell>
                      <TableCell>{formatDate(blueprint.updatedAt)}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="outline" size="sm" asChild>
                          <Link href={`/governance/blueprints/${blueprint.id}`}>View</Link>
                        </Button>
                        <Button variant="destructive" size="sm" className="ml-2" onClick={() => { deletion.reset(); setDeleting(blueprint); }} aria-label={`Delete ${blueprint.name}`}>Delete</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      <GovernanceBlueprintCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
      <GovernanceEvaluationLauncher open={launcherOpen} onOpenChange={setLauncherOpen} />
      <Dialog open={Boolean(deleting)} onOpenChange={open => { if (!open && !deletion.isPending) setDeleting(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete governance blueprint?</DialogTitle>
            <DialogDescription>Delete “{deleting?.name}”? This permanently removes its versions, evaluation runs, and object findings. Automation inventories referring to it will need review. CMDB and provider objects are not deleted.</DialogDescription>
          </DialogHeader>
          {deletion.isError && <p role="alert" className="text-sm text-destructive">Deletion failed. Check your permissions and retry.</p>}
          <DialogFooter>
            <Button variant="outline" disabled={deletion.isPending} onClick={() => setDeleting(null)}>Cancel</Button>
            <Button variant="destructive" disabled={deletion.isPending} onClick={() => deleting && deletion.mutate(deleting.id)}>{deletion.isPending ? "Deleting…" : "Delete blueprint"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

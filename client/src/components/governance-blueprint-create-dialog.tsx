import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { FilePlus2, Loader2 } from "lucide-react";
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
  createDefaultNetboxVmBlueprint,
  governanceKeys,
  listGovernanceNetBoxSources,
  type GovernanceNetBoxSourceSummary,
} from "@/lib/governance-api";

interface GovernanceBlueprintCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "never imported";
  return new Date(value).toLocaleString();
}

export function GovernanceBlueprintCreateDialog({ open, onOpenChange }: GovernanceBlueprintCreateDialogProps) {
  const { toast } = useToast();
  const [selectedSourceId, setSelectedSourceId] = useState("");

  const {
    data: sources = [],
    isLoading,
    isError,
    error,
  } = useQuery<GovernanceNetBoxSourceSummary[]>({
    queryKey: governanceKeys.netboxSources,
    queryFn: listGovernanceNetBoxSources,
    enabled: open,
  });

  const selectedSource = sources.find((source) => source.id === selectedSourceId);

  useEffect(() => {
    if (!open) return;
    if (!selectedSourceId && sources.length > 0) {
      setSelectedSourceId(sources[0].id);
    }
  }, [open, selectedSourceId, sources]);

  const createMutation = useMutation({
    mutationFn: () => createDefaultNetboxVmBlueprint(selectedSourceId),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: governanceKeys.blueprints });
      queryClient.invalidateQueries({ queryKey: governanceKeys.netboxSources });
      toast({
        title: "Governance blueprint ready",
        description: `${result.blueprint.name} is bound to ${selectedSource?.name ?? "the selected NetBox source"}.`,
      });
      onOpenChange(false);
    },
    onError: (mutationError: Error) => {
      toast({ variant: "destructive", title: "Could not create governance blueprint", description: mutationError.message });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FilePlus2 className="h-5 w-5" />
            Create Governance Blueprint
          </DialogTitle>
          <DialogDescription>
            Choose the cached CMDB / NetBox source this blueprint will govern. The MVP object type is NetBox VM.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="governance-create-source">CMDB / NetBox source</Label>
            {isLoading ? (
              <Skeleton className="h-10 w-full" />
            ) : isError ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                {(error as Error).message}
              </div>
            ) : sources.length === 0 ? (
              <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                No NetBox CMDB sources are available. Add a NetBox CMDB account before creating a governance blueprint.
              </div>
            ) : (
              <Select value={selectedSourceId} onValueChange={setSelectedSourceId}>
                <SelectTrigger id="governance-create-source" data-testid="select-governance-blueprint-source">
                  <SelectValue placeholder="Select source" />
                </SelectTrigger>
                <SelectContent>
                  {sources.map((source) => (
                    <SelectItem key={source.id} value={source.id}>
                      {source.name} ({source.cachedVmCount} cached VM{source.cachedVmCount === 1 ? "" : "s"})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="space-y-2">
            <Label>Object type</Label>
            <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-3 text-sm">
              <Badge variant="outline">netbox_vm</Badge>
              <span className="text-muted-foreground">NetBox virtual machines</span>
            </div>
          </div>

          {selectedSource && (
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">Standard NetBox VM Governance — {selectedSource.name}</span>
                {selectedSource.cmdbAccountId && <Badge variant="outline">CMDB source</Badge>}
                <Badge variant={selectedSource.enabled ? "default" : "secondary"}>
                  {selectedSource.enabled ? "enabled source" : "disabled source"}
                </Badge>
              </div>
              <div className="mt-2 text-muted-foreground">{selectedSource.url}</div>
              {selectedSource.cachedVmCount === 0 && (
                <div className="text-muted-foreground">
                  No cached VMs yet - sync/import this CMDB source before running an evaluation.
                </div>
              )}
              <div className="text-muted-foreground">Last import: {formatDate(selectedSource.lastImportAt)}</div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={!selectedSourceId || createMutation.isPending}
            data-testid="button-confirm-create-governance-blueprint"
          >
            {createMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <FilePlus2 className="h-4 w-4 mr-2" />
            )}
            Create Blueprint
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

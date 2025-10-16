import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Wrench, RefreshCw, Database, Trash2, RotateCw } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function Settings() {
  const { toast } = useToast();

  const rebuildCacheMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/housekeeping/rebuild-cache", {}),
    onSuccess: () => {
      toast({ title: "Cache Rebuilt", description: "Group cache has been refreshed from NetBox" });
    },
  });

  const ensureSchemaMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/housekeeping/ensure-schema", {}),
    onSuccess: () => {
      toast({ title: "Schema Verified", description: "NetBox custom fields are up to date" });
    },
  });

  const pruneStaleMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/housekeeping/prune-stale", {}),
    onSuccess: (data: any) => {
      toast({ title: "Stale Objects Pruned", description: `Removed ${data.count || 0} stale objects` });
    },
  });

  const retryFailedMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/housekeeping/retry-failed", {}),
    onSuccess: (data: any) => {
      toast({ title: "Retrying Failed Syncs", description: `${data.count || 0} sync runs queued for retry` });
    },
  });

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="text-page-title">Settings</h1>
        <p className="text-sm text-muted-foreground">System maintenance and housekeeping operations</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5 text-primary" />
            Housekeeping Operations
          </CardTitle>
          <CardDescription>
            Maintenance operations for provider sync, cache management, and data cleanup
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div className="flex-1">
              <h3 className="font-medium">Rebuild Group Cache</h3>
              <p className="text-sm text-muted-foreground">Refresh autocomplete cache from NetBox inventory groups</p>
            </div>
            <Button 
              onClick={() => rebuildCacheMutation.mutate()}
              disabled={rebuildCacheMutation.isPending}
              data-testid="button-rebuild-cache"
            >
              {rebuildCacheMutation.isPending && <RefreshCw className="mr-2 h-4 w-4 animate-spin" />}
              <Database className="mr-2 h-4 w-4" />
              Rebuild
            </Button>
          </div>

          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div className="flex-1">
              <h3 className="font-medium">Ensure NetBox Schema</h3>
              <p className="text-sm text-muted-foreground">Create/update custom fields in NetBox (bridge_provider_id, bridge_external_id)</p>
            </div>
            <Button 
              onClick={() => ensureSchemaMutation.mutate()}
              disabled={ensureSchemaMutation.isPending}
              data-testid="button-ensure-schema"
            >
              {ensureSchemaMutation.isPending && <RefreshCw className="mr-2 h-4 w-4 animate-spin" />}
              <Database className="mr-2 h-4 w-4" />
              Verify
            </Button>
          </div>

          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div className="flex-1">
              <h3 className="font-medium">Prune Stale Objects</h3>
              <p className="text-sm text-muted-foreground">Remove objects from disabled or deleted providers</p>
            </div>
            <Button 
              variant="destructive"
              onClick={() => pruneStaleMutation.mutate()}
              disabled={pruneStaleMutation.isPending}
              data-testid="button-prune-stale"
            >
              {pruneStaleMutation.isPending && <RefreshCw className="mr-2 h-4 w-4 animate-spin" />}
              <Trash2 className="mr-2 h-4 w-4" />
              Prune
            </Button>
          </div>

          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div className="flex-1">
              <h3 className="font-medium">Retry Failed Syncs</h3>
              <p className="text-sm text-muted-foreground">Re-queue failed provider sync runs for automatic retry</p>
            </div>
            <Button 
              onClick={() => retryFailedMutation.mutate()}
              disabled={retryFailedMutation.isPending}
              data-testid="button-retry-failed"
            >
              {retryFailedMutation.isPending && <RefreshCw className="mr-2 h-4 w-4 animate-spin" />}
              <RotateCw className="mr-2 h-4 w-4" />
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

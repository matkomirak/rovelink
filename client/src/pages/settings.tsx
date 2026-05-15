import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Wrench, RefreshCw, Database, Trash2, RotateCw, Zap, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function Settings() {
  const { toast } = useToast();

  // AWX settings state
  const [awxUrl, setAwxUrl] = useState("");
  const [awxToken, setAwxToken] = useState("");
  const [awxVerifySsl, setAwxVerifySsl] = useState(true);

  const { data: awxConfig } = useQuery<{ url: string; verify_ssl: boolean; token_set: boolean }>({
    queryKey: ["/api/settings/awx"],
  });

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

  const testAwxMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/settings/awx/test", {
        url: awxUrl || awxConfig?.url,
        token: awxToken || undefined,
        verify_ssl: awxVerifySsl,
      }),
    onSuccess: (data: any) => {
      if (data.ok) {
        toast({ title: "AWX Connected", description: data.version ? `Version: ${data.version}` : "Connection successful" });
      } else {
        toast({ title: "AWX Connection Failed", description: data.error || "Could not reach AWX", variant: "destructive" });
      }
    },
    onError: (err: any) => {
      toast({ title: "AWX Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="text-page-title">Settings</h1>
        <p className="text-sm text-muted-foreground">System maintenance, housekeeping, and runner configuration</p>
      </div>

      {/* AWX Integration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            AWX / Ansible Automation Platform
          </CardTitle>
          <CardDescription>
            Configure the AWX endpoint used when job templates have runner mode set to AWX.
            Credentials are stored encrypted at rest.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {awxConfig?.token_set && (
            <div className="flex items-center gap-2 text-sm text-emerald-500">
              <CheckCircle className="h-4 w-4" />
              AWX token is configured
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="awx-url">AWX URL</Label>
              <Input
                id="awx-url"
                data-testid="input-awx-url"
                placeholder={awxConfig?.url || "https://awx.example.com"}
                value={awxUrl}
                onChange={(e) => setAwxUrl(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="awx-token">API Token</Label>
              <Input
                id="awx-token"
                data-testid="input-awx-token"
                type="password"
                placeholder={awxConfig?.token_set ? "••••••••••••" : "Paste AWX token..."}
                value={awxToken}
                onChange={(e) => setAwxToken(e.target.value)}
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Switch
              id="awx-ssl"
              data-testid="switch-awx-verify-ssl"
              checked={awxVerifySsl}
              onCheckedChange={setAwxVerifySsl}
            />
            <Label htmlFor="awx-ssl">Verify SSL certificate</Label>
          </div>
          <Button
            data-testid="button-test-awx"
            onClick={() => testAwxMutation.mutate()}
            disabled={testAwxMutation.isPending || (!awxUrl && !awxConfig?.url)}
          >
            {testAwxMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Zap className="h-4 w-4 mr-2" />
            )}
            Test &amp; Save
          </Button>
        </CardContent>
      </Card>

      {/* Housekeeping */}
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
              data-testid="button-rebuild-cache"
              variant="outline"
              size="sm"
              onClick={() => rebuildCacheMutation.mutate()}
              disabled={rebuildCacheMutation.isPending}
            >
              {rebuildCacheMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Rebuild
            </Button>
          </div>

          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div className="flex-1">
              <h3 className="font-medium">Verify NetBox Schema</h3>
              <p className="text-sm text-muted-foreground">Ensure all required custom fields exist in NetBox</p>
            </div>
            <Button
              data-testid="button-ensure-schema"
              variant="outline"
              size="sm"
              onClick={() => ensureSchemaMutation.mutate()}
              disabled={ensureSchemaMutation.isPending}
            >
              {ensureSchemaMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Database className="h-4 w-4 mr-2" />
              )}
              Verify
            </Button>
          </div>

          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div className="flex-1">
              <h3 className="font-medium">Prune Stale Objects</h3>
              <p className="text-sm text-muted-foreground">Remove external objects no longer seen in provider scans</p>
            </div>
            <Button
              data-testid="button-prune-stale"
              variant="outline"
              size="sm"
              onClick={() => pruneStaleMutation.mutate()}
              disabled={pruneStaleMutation.isPending}
            >
              {pruneStaleMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              Prune
            </Button>
          </div>

          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div className="flex-1">
              <h3 className="font-medium">Retry Failed Syncs</h3>
              <p className="text-sm text-muted-foreground">Re-queue provider syncs that ended in an error state</p>
            </div>
            <Button
              data-testid="button-retry-failed"
              variant="outline"
              size="sm"
              onClick={() => retryFailedMutation.mutate()}
              disabled={retryFailedMutation.isPending}
            >
              {retryFailedMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RotateCw className="h-4 w-4 mr-2" />
              )}
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

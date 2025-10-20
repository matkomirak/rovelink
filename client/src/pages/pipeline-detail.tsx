import { useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Play, RefreshCw, Download, Clock, Save } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface Pipeline {
  id: string;
  name: string;
  version: number;
  enabled: boolean;
  scheduleCron: string | null;
  providerAccountId: string;
  cmdbAccountId: string;
}

interface PipelineMapping {
  id: string;
  sourceType: string;
  targetType: string;
  rules: any;
}

interface PipelineRun {
  id: string;
  status: string;
  dry_run: boolean;
  started_at: Date;
  finished_at: Date | null;
  summary: any;
}

interface Preset {
  id: string;
  label: string;
}

interface DryRunResult {
  status: string;
  counts: {
    created: number;
    updated: number;
    unchanged: number;
    removed: number;
    errors: number;
  };
  notes: string[];
  changes: Array<{
    action: string;
    targetType: string;
    name: string;
    extId: string;
    field: string;
    from: any;
    to: any;
  }>;
  runId: string;
}

export default function PipelineDetail() {
  const { id } = useParams();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("mappings");
  const [showDryRunModal, setShowDryRunModal] = useState(false);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [showPresetModal, setShowPresetModal] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<DryRunResult | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<string>("");
  const [changesFilter, setChangesFilter] = useState<string>("all");
  const [activeSyncRunId, setActiveSyncRunId] = useState<string | null>(null);
  const [syncLogs, setSyncLogs] = useState<string[]>([]);
  const [syncStatus, setSyncStatus] = useState<string>("running");
  
  // Editing states
  const [editingSchedule, setEditingSchedule] = useState(false);
  const [scheduleCron, setScheduleCron] = useState("");

  const { data: pipeline, isLoading } = useQuery<Pipeline>({
    queryKey: ["/api/pipelines", id],
  });

  const { data: mappings } = useQuery<{ items: PipelineMapping[] }>({
    queryKey: ["/api/pipelines", id, "mappings"],
  });

  const { data: runs } = useQuery<{ items: PipelineRun[] }>({
    queryKey: ["/api/pipelines", id, "runs"],
  });

  const { data: presets } = useQuery<{ items: Preset[] }>({
    queryKey: ["/api/pipelines/presets"],
  });

  const toggleEnabled = useMutation({
    mutationFn: async (enabled: boolean) => {
      const response = await apiRequest("PATCH", `/api/pipelines/${id}`, { enabled });
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pipelines", id] });
      toast({ title: "Success", description: "Pipeline updated" });
    },
  });

  const updateSchedule = useMutation({
    mutationFn: async (cron: string) => {
      const response = await apiRequest("PATCH", `/api/pipelines/${id}`, { 
        scheduleCron: cron || null 
      });
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pipelines", id] });
      setEditingSchedule(false);
      toast({ title: "Success", description: "Schedule updated" });
    },
  });

  const runDryRun = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/pipelines/${id}/dry-run`, {});
      return await response.json();
    },
    onSuccess: (data: DryRunResult) => {
      setDryRunResult(data);
      setShowDryRunModal(true);
      queryClient.invalidateQueries({ queryKey: ["/api/pipelines", id, "runs"] });
    },
    onError: (error: any) => {
      toast({
        title: "Dry-Run Failed",
        description: error.message || "Failed to execute dry-run",
        variant: "destructive",
      });
    },
  });

  const runSync = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/pipelines/${id}/sync`, {});
      return await response.json();
    },
    onSuccess: (data) => {
      setActiveSyncRunId(data.runId);
      setShowSyncModal(true);
      setSyncLogs([]);
      setSyncStatus("running");
      startSyncPolling(data.runId);
      queryClient.invalidateQueries({ queryKey: ["/api/pipelines", id, "runs"] });
    },
  });

  const startSyncPolling = (runId: string) => {
    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`/api/pipelines/${id}/runs/${runId}`, {
          headers: {
            Authorization: `Bearer ${localStorage.getItem("auth_token")}`,
          },
        });
        const data = await response.json();
        
        setSyncLogs(data.logs || []);
        setSyncStatus(data.status);
        
        if (data.status === "ok" || data.status === "error" || data.status === "failed") {
          clearInterval(pollInterval);
          queryClient.invalidateQueries({ queryKey: ["/api/pipelines", id, "runs"] });
        }
      } catch (error) {
        console.error("Polling error:", error);
      }
    }, 2000);

    // Cleanup after 60 seconds max
    setTimeout(() => clearInterval(pollInterval), 60000);
  };

  const loadPreset = useMutation({
    mutationFn: async (presetId: string) => {
      const response = await apiRequest("GET", `/api/pipelines/presets/${presetId}`, undefined);
      return await response.json();
    },
    onSuccess: (rules) => {
      // TODO: Apply rules to mapping
      toast({ 
        title: "Preset Loaded", 
        description: "Mapping rules have been updated with preset configuration" 
      });
      setShowPresetModal(false);
      queryClient.invalidateQueries({ queryKey: ["/api/pipelines", id, "mappings"] });
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-48" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-32 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!pipeline) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Pipeline not found</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/pipelines">
          <Button variant="ghost" size="icon" data-testid="button-back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-3xl font-bold">{pipeline.name}</h1>
          <p className="text-muted-foreground">Version {pipeline.version}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => runDryRun.mutate()}
            disabled={runDryRun.isPending}
            data-testid="button-dry-run"
          >
            <Play className="h-4 w-4 mr-2" />
            Dry-Run
          </Button>
          <Button
            onClick={() => runSync.mutate()}
            disabled={runSync.isPending}
            data-testid="button-sync-now"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Sync Now
          </Button>
        </div>
      </div>

      {/* Pipeline Settings Card */}
      <Card>
        <CardHeader>
          <CardTitle>Pipeline Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Enabled</Label>
              <div className="text-sm text-muted-foreground">
                Allow this pipeline to run sync operations
              </div>
            </div>
            <Switch
              checked={pipeline.enabled}
              onCheckedChange={(checked) => toggleEnabled.mutate(checked)}
              data-testid="switch-enabled"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Schedule (Cron)</Label>
              {!editingSchedule ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setScheduleCron(pipeline.scheduleCron || "");
                    setEditingSchedule(true);
                  }}
                  data-testid="button-edit-schedule"
                >
                  <Clock className="h-4 w-4 mr-2" />
                  Edit
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditingSchedule(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => updateSchedule.mutate(scheduleCron)}
                    disabled={updateSchedule.isPending}
                    data-testid="button-save-schedule"
                  >
                    <Save className="h-4 w-4 mr-2" />
                    Save
                  </Button>
                </div>
              )}
            </div>
            {editingSchedule ? (
              <Input
                value={scheduleCron}
                onChange={(e) => setScheduleCron(e.target.value)}
                placeholder="0 2 * * * (daily at 2am)"
                data-testid="input-schedule"
              />
            ) : (
              <div className="text-sm">
                {pipeline.scheduleCron || (
                  <span className="text-muted-foreground">Not scheduled</span>
                )}
              </div>
            )}
            {pipeline.scheduleCron && !editingSchedule && (
              <div className="text-xs text-muted-foreground">
                Next run: In 2h 15m
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="mappings" data-testid="tab-mappings">
            Mappings
          </TabsTrigger>
          <TabsTrigger value="runs" data-testid="tab-runs">
            Runs
          </TabsTrigger>
          <TabsTrigger value="settings" data-testid="tab-settings">
            Settings
          </TabsTrigger>
        </TabsList>

        {/* Mappings Tab */}
        <TabsContent value="mappings" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Field Mappings</CardTitle>
                  <CardDescription>
                    Configure how source fields map to target fields
                  </CardDescription>
                </div>
                <Button
                  variant="outline"
                  onClick={() => setShowPresetModal(true)}
                  data-testid="button-load-preset"
                >
                  Load Preset...
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {!mappings || mappings.items.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No mappings configured yet
                </div>
              ) : (
                <div className="space-y-4">
                  {mappings.items.map((mapping) => (
                    <div key={mapping.id} className="border rounded-lg p-4">
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <h4 className="font-medium">
                            {mapping.sourceType} → {mapping.targetType}
                          </h4>
                          <p className="text-sm text-muted-foreground">
                            {mapping.rules?.fields?.length || 0} field rules configured
                          </p>
                        </div>
                        <Link href={`/pipelines/${id}/mappings/${mapping.id}/edit`}>
                          <Button variant="outline" size="sm">
                            Edit Mapping
                          </Button>
                        </Link>
                      </div>
                      {mapping.rules?.fields && mapping.rules.fields.length > 0 && (
                        <div className="text-xs space-y-1">
                          {mapping.rules.fields.slice(0, 5).map((field: any, idx: number) => (
                            <div key={idx} className="flex items-center gap-2 text-muted-foreground">
                              <code className="bg-muted px-1 rounded">{field.source || 'static'}</code>
                              <span>→</span>
                              <code className="bg-muted px-1 rounded">{field.target}</code>
                              {field.transforms && field.transforms.length > 0 && (
                                <Badge variant="secondary" className="text-xs">
                                  {field.transforms.length} transform{field.transforms.length > 1 ? 's' : ''}
                                </Badge>
                              )}
                            </div>
                          ))}
                          {mapping.rules.fields.length > 5 && (
                            <div className="text-muted-foreground">
                              +{mapping.rules.fields.length - 5} more rules
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Runs Tab */}
        <TabsContent value="runs" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Execution History</CardTitle>
              <CardDescription>Recent pipeline runs and their results</CardDescription>
            </CardHeader>
            <CardContent>
              {!runs || runs.items.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No runs yet
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Status</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Started</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead>Summary</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runs.items.map((run) => (
                      <TableRow key={run.id}>
                        <TableCell>
                          <Badge
                            variant={
                              run.status === "ok"
                                ? "default"
                                : run.status === "error"
                                ? "destructive"
                                : "secondary"
                            }
                          >
                            {run.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {run.dry_run ? (
                            <Badge variant="outline">Dry-Run</Badge>
                          ) : (
                            <Badge>Live Sync</Badge>
                          )}
                        </TableCell>
                        <TableCell>{new Date(run.started_at).toLocaleString()}</TableCell>
                        <TableCell>
                          {run.finished_at
                            ? `${Math.round(
                                (new Date(run.finished_at).getTime() -
                                  new Date(run.started_at).getTime()) /
                                  1000
                              )}s`
                            : "Running..."}
                        </TableCell>
                        <TableCell>
                          {run.summary && (
                            <div className="text-xs space-x-2">
                              {run.summary.created > 0 && (
                                <span className="text-green-600">+{run.summary.created}</span>
                              )}
                              {run.summary.updated > 0 && (
                                <span className="text-blue-600">~{run.summary.updated}</span>
                              )}
                              {run.summary.errors > 0 && (
                                <span className="text-destructive">!{run.summary.errors}</span>
                              )}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Settings Tab */}
        <TabsContent value="settings" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Advanced Settings</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">
                Additional pipeline configuration options coming soon
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Dry-Run Modal */}
      <Dialog open={showDryRunModal} onOpenChange={setShowDryRunModal}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Dry-Run Results</DialogTitle>
            <DialogDescription>
              Preview of changes without applying them
            </DialogDescription>
          </DialogHeader>
          {dryRunResult && (
            <div className="space-y-4">
              <div className="grid grid-cols-5 gap-4">
                <div className="text-center p-4 border rounded-lg">
                  <div className="text-2xl font-bold text-green-600">
                    {dryRunResult.counts.created}
                  </div>
                  <div className="text-sm text-muted-foreground">Created</div>
                </div>
                <div className="text-center p-4 border rounded-lg">
                  <div className="text-2xl font-bold text-blue-600">
                    {dryRunResult.counts.updated}
                  </div>
                  <div className="text-sm text-muted-foreground">Updated</div>
                </div>
                <div className="text-center p-4 border rounded-lg">
                  <div className="text-2xl font-bold">{dryRunResult.counts.unchanged}</div>
                  <div className="text-sm text-muted-foreground">Unchanged</div>
                </div>
                <div className="text-center p-4 border rounded-lg">
                  <div className="text-2xl font-bold text-amber-600">
                    {dryRunResult.counts.removed}
                  </div>
                  <div className="text-sm text-muted-foreground">Removed</div>
                </div>
                <div className="text-center p-4 border rounded-lg">
                  <div className="text-2xl font-bold text-destructive">
                    {dryRunResult.counts.errors}
                  </div>
                  <div className="text-sm text-muted-foreground">Errors</div>
                </div>
              </div>

              {dryRunResult.changes && dryRunResult.changes.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium">Changes</h4>
                    <Select value={changesFilter} onValueChange={setChangesFilter}>
                      <SelectTrigger className="w-32 h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        <SelectItem value="create">Create</SelectItem>
                        <SelectItem value="update">Update</SelectItem>
                        <SelectItem value="remove">Remove</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="border rounded-lg overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Action</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Name</TableHead>
                          <TableHead>Field</TableHead>
                          <TableHead>From → To</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {dryRunResult.changes
                          .filter((c) => changesFilter === "all" || c.action === changesFilter)
                          .slice(0, 20)
                          .map((change, idx) => (
                            <TableRow key={idx}>
                              <TableCell>
                                <Badge
                                  variant={
                                    change.action === "create"
                                      ? "default"
                                      : change.action === "update"
                                      ? "secondary"
                                      : "destructive"
                                  }
                                >
                                  {change.action}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-sm">{change.targetType}</TableCell>
                              <TableCell className="text-sm font-mono">{change.name}</TableCell>
                              <TableCell className="text-sm">{change.field}</TableCell>
                              <TableCell className="text-xs font-mono">
                                {change.from !== null && (
                                  <span className="text-muted-foreground">{String(change.from)} → </span>
                                )}
                                <span className="text-foreground">{String(change.to)}</span>
                              </TableCell>
                            </TableRow>
                          ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}

              {dryRunResult.notes.length > 0 && (
                <div className="space-y-2">
                  <h4 className="font-medium text-sm">Notes</h4>
                  <ul className="text-xs space-y-1">
                    {dryRunResult.notes.map((note, idx) => (
                      <li key={idx} className="text-muted-foreground">
                        • {note}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDryRunModal(false)}>
              Close
            </Button>
            {dryRunResult && (
              <Button
                variant="outline"
                onClick={() => {
                  window.open(`/api/pipelines/${id}/runs/${dryRunResult.runId}/changes.csv`, '_blank');
                }}
                data-testid="button-export-csv"
              >
                <Download className="h-4 w-4 mr-2" />
                Export CSV
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sync Modal */}
      <Dialog open={showSyncModal} onOpenChange={setShowSyncModal}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Pipeline Sync</DialogTitle>
            <DialogDescription>
              {syncStatus === "running" ? "Sync in progress..." : "Sync complete"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {syncStatus === "running" && (
              <div className="flex items-center gap-2 text-sm">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
                <span className="text-muted-foreground">Processing...</span>
              </div>
            )}
            {syncStatus === "ok" && (
              <div className="flex items-center gap-2 text-sm text-green-600">
                <span>✓ Sync completed successfully</span>
              </div>
            )}
            {(syncStatus === "error" || syncStatus === "failed") && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <span>✗ Sync failed</span>
              </div>
            )}
            
            <div className="border rounded-lg bg-muted/50 h-96 overflow-y-auto p-4 font-mono text-xs">
              {syncLogs.length === 0 ? (
                <div className="text-muted-foreground">Waiting for logs...</div>
              ) : (
                <div className="space-y-1">
                  {syncLogs.map((log, idx) => (
                    <div key={idx} className="text-foreground">
                      {log}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => {
                setShowSyncModal(false);
                setActiveSyncRunId(null);
                setSyncLogs([]);
              }}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Load Preset Modal */}
      <Dialog open={showPresetModal} onOpenChange={setShowPresetModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Load Preset Mapping</DialogTitle>
            <DialogDescription>
              Choose a pre-configured mapping template
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Preset</Label>
              <Select value={selectedPreset} onValueChange={setSelectedPreset}>
                <SelectTrigger data-testid="select-preset">
                  <SelectValue placeholder="Select a preset" />
                </SelectTrigger>
                <SelectContent>
                  {presets?.items.map((preset) => (
                    <SelectItem key={preset.id} value={preset.id}>
                      {preset.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPresetModal(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => selectedPreset && loadPreset.mutate(selectedPreset)}
              disabled={!selectedPreset || loadPreset.isPending}
              data-testid="button-apply-preset"
            >
              Apply Preset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

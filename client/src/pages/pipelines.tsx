import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Play, RefreshCw, Edit, Power, PowerOff, Trash2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface Pipeline {
  id: string;
  name: string;
  providerAccountId: string;
  cmdbAccountId: string;
  enabled: boolean;
  scheduleCron: string | null;
  version: number;
  lastRun: {
    id: string;
    status: string;
    started_at: Date;
    finished_at: Date | null;
    summary: any;
  } | null;
}

interface Provider {
  id: string;
  name: string;
  kind: string;
}

interface Cmdb {
  id: string;
  name: string;
  kind: string;
}

export default function Pipelines() {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [pipelineToDelete, setPipelineToDelete] = useState<Pipeline | null>(null);
  const { toast } = useToast();

  const { data: pipelines, isLoading: loadingPipelines } = useQuery<Pipeline[]>({
    queryKey: ["/api/pipelines"],
  });

  const { data: providers } = useQuery<Provider[]>({
    queryKey: ["/api/providers"],
  });

  const { data: cmdbs } = useQuery<Cmdb[]>({
    queryKey: ["/api/cmdbs"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/pipelines/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pipelines"] });
      toast({
        title: "Pipeline deleted",
        description: "The pipeline has been successfully deleted.",
      });
      setDeleteDialogOpen(false);
      setPipelineToDelete(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Error deleting pipeline",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const syncMutation = useMutation({
    mutationFn: async (pipelineId: string) => {
      return apiRequest("POST", `/api/pipelines/${pipelineId}/sync`);
    },
    onSuccess: async (response) => {
      const data = await response.json();
      queryClient.invalidateQueries({ queryKey: ["/api/pipelines"] });
      toast({
        title: "Sync Started",
        description: `Sync run ${data.runId} has been queued`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error starting sync",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const dryRunMutation = useMutation({
    mutationFn: async (pipelineId: string) => {
      return apiRequest("POST", `/api/pipelines/${pipelineId}/dry-run`);
    },
    onSuccess: async (response) => {
      const data = await response.json();
      queryClient.invalidateQueries({ queryKey: ["/api/pipelines"] });
      toast({
        title: "Dry-Run Started",
        description: `Dry-run ${data.runId} has been queued`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error starting dry-run",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleDeleteClick = (pipeline: Pipeline) => {
    setPipelineToDelete(pipeline);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = () => {
    if (pipelineToDelete) {
      deleteMutation.mutate(pipelineToDelete.id);
    }
  };

  const getProviderName = (id: string) => {
    return providers?.find((p) => p.id === id)?.name || id;
  };

  const getCmdbName = (id: string) => {
    return cmdbs?.find((c) => c.id === id)?.name || id;
  };

  const getNextRun = (cron: string | null) => {
    if (!cron) return null;
    // TODO: Calculate next run using cron-parser
    return "In 2h 15m";
  };

  if (loadingPipelines) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-10 w-32" />
        </div>
        <Card>
          <CardContent className="p-6">
            <div className="space-y-4">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Sync Flows</h1>
          <p className="text-muted-foreground mt-1">
            Data sync flows from providers to CMDBs
          </p>
        </div>
        <Link href="/pipelines/new">
          <Button data-testid="button-new-pipeline">
            <Plus className="h-4 w-4 mr-2" />
            New Sync Flow
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Sync Flows</CardTitle>
        </CardHeader>
        <CardContent>
          {!pipelines || pipelines.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground mb-4">No sync flows configured yet</p>
              <Link href="/pipelines/new">
                <Button variant="outline" data-testid="button-create-first">
                  <Plus className="h-4 w-4 mr-2" />
                  Create your first sync flow
                </Button>
              </Link>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>CMDB</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead>Last Run</TableHead>
                  <TableHead>Next Run</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pipelines.map((pipeline) => (
                  <TableRow key={pipeline.id} data-testid={`row-pipeline-${pipeline.id}`}>
                    <TableCell>
                      <Link href={`/pipelines/${pipeline.id}`}>
                        <Button variant="ghost" className="p-0 h-auto font-medium">
                          {pipeline.name}
                        </Button>
                      </Link>
                      <div className="text-xs text-muted-foreground">v{pipeline.version}</div>
                    </TableCell>
                    <TableCell>{getProviderName(pipeline.providerAccountId)}</TableCell>
                    <TableCell>{getCmdbName(pipeline.cmdbAccountId)}</TableCell>
                    <TableCell>
                      {pipeline.enabled ? (
                        <Badge variant="default" className="gap-1">
                          <Power className="h-3 w-3" />
                          Enabled
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="gap-1">
                          <PowerOff className="h-3 w-3" />
                          Disabled
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {pipeline.lastRun ? (
                        <div className="flex flex-col gap-1">
                          <Badge
                            variant={
                              pipeline.lastRun.status === "ok"
                                ? "default"
                                : pipeline.lastRun.status === "error"
                                ? "destructive"
                                : "secondary"
                            }
                          >
                            {pipeline.lastRun.status}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {new Date(pipeline.lastRun.started_at).toLocaleString()}
                          </span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-sm">Never run</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {pipeline.scheduleCron ? (
                        <span className="text-sm">{getNextRun(pipeline.scheduleCron)}</span>
                      ) : (
                        <span className="text-muted-foreground text-sm">Not scheduled</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => dryRunMutation.mutate(pipeline.id)}
                          disabled={dryRunMutation.isPending}
                          data-testid={`button-dry-run-${pipeline.id}`}
                        >
                          <Play className="h-4 w-4 mr-1" />
                          Dry-Run
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => syncMutation.mutate(pipeline.id)}
                          disabled={syncMutation.isPending}
                          data-testid={`button-sync-${pipeline.id}`}
                        >
                          <RefreshCw className={`h-4 w-4 mr-1 ${syncMutation.isPending ? "animate-spin" : ""}`} />
                          Sync Now
                        </Button>
                        <Link href={`/pipelines/${pipeline.id}`}>
                          <Button
                            variant="ghost"
                            size="icon"
                            data-testid={`button-edit-${pipeline.id}`}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                        </Link>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteClick(pipeline)}
                          data-testid={`button-delete-${pipeline.id}`}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Pipeline</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the pipeline "{pipelineToDelete?.name}"?
              This action cannot be undone and will also delete all associated mappings and run history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-destructive hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

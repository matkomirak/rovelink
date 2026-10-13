import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PlayCircle, CheckCircle2, XCircle, Clock, FileText, GitCompare, Archive, ArchiveRestore, Filter, Database, Server, Workflow, RefreshCw } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface UnifiedRun {
  id: string;
  runType: 'playbook-run' | 'bdp-sync' | 'provider-sync';
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  logs: string | null;
  summary: any;
  archived: boolean;
  sourceId: string | null;
  sourceName: string | null;
  sourceType: string | null;
}

export default function Runs() {
  const [, setLocation] = useLocation();
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [archivedFilter, setArchivedFilter] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const { toast } = useToast();
  
  const queryParams = new URLSearchParams();
  if (statusFilter) queryParams.append("status", statusFilter);
  if (archivedFilter) queryParams.append("archived", archivedFilter);
  if (typeFilter) queryParams.append("type", typeFilter);
  if (startDate) queryParams.append("startDate", startDate);
  if (endDate) queryParams.append("endDate", endDate);
  
  const { data: runs, isLoading, refetch, isFetching } = useQuery<UnifiedRun[]>({
    queryKey: ["/api/runs", queryParams.toString()],
  });

  const archiveMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/runs/${id}/archive`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/runs"] });
      toast({ title: "Run archived successfully" });
    },
  });

  const unarchiveMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/runs/${id}/unarchive`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/runs"] });
      toast({ title: "Run unarchived successfully" });
    },
  });

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "ok":
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "failed":
      case "error":
        return <XCircle className="h-4 w-4 text-red-500" />;
      case "running":
        return <Clock className="h-4 w-4 text-blue-500 animate-pulse" />;
      default:
        return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive"> = {
      ok: "default",
      failed: "destructive",
      error: "destructive",
      running: "secondary",
      queued: "secondary",
    };
    return (
      <Badge variant={variants[status] || "secondary"} className="capitalize">
        {status}
      </Badge>
    );
  };

  const getRunTypeIcon = (runType: string) => {
    switch (runType) {
      case 'playbook-run':
        return <Workflow className="h-4 w-4" />;
      case 'bdp-sync':
        return <Database className="h-4 w-4" />;
      case 'provider-sync':
        return <Server className="h-4 w-4" />;
      default:
        return <PlayCircle className="h-4 w-4" />;
    }
  };

  const getRunTypeBadge = (runType: string) => {
    const labels: Record<string, string> = {
      'playbook-run': 'Playbook',
      'bdp-sync': 'Pipeline',
      'provider-sync': 'Provider Sync',
    };
    const colors: Record<string, string> = {
      'playbook-run': 'text-purple-500 border-purple-500/30',
      'bdp-sync': 'text-blue-500 border-blue-500/30',
      'provider-sync': 'text-green-500 border-green-500/30',
    };
    return (
      <Badge variant="outline" className={`gap-1 ${colors[runType] || ''}`}>
        {getRunTypeIcon(runType)}
        {labels[runType] || runType}
      </Badge>
    );
  };

  const formatDuration = (run: UnifiedRun) => {
    if (!run.startedAt) return "—";
    const start = new Date(run.startedAt).getTime();
    const end = run.finishedAt ? new Date(run.finishedAt).getTime() : Date.now();
    const durationMs = end - start;
    
    if (durationMs < 1000) return `${durationMs}ms`;
    const seconds = Math.floor(durationMs / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  };

  const getSummaryText = (run: UnifiedRun) => {
    if (!run.summary || typeof run.summary !== 'object') return '—';
    
    const summary = run.summary as any;
    
    if (run.runType === 'bdp-sync' || run.runType === 'provider-sync') {
      const parts = [];
      if (summary.created) parts.push(`${summary.created} created`);
      if (summary.updated) parts.push(`${summary.updated} updated`);
      if (summary.unchanged) parts.push(`${summary.unchanged} unchanged`);
      if (summary.errors) parts.push(`${summary.errors} errors`);
      return parts.length > 0 ? parts.join(', ') : '—';
    }
    
    if (run.runType === 'playbook-run') {
      const parts = [];
      if (summary.ok) parts.push(`${summary.ok} ok`);
      if (summary.changed) parts.push(`${summary.changed} changed`);
      if (summary.failed) parts.push(`${summary.failed} failed`);
      return parts.length > 0 ? parts.join(', ') : '—';
    }
    
    return '—';
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-page-title">Automation Runs</h1>
          <p className="text-sm text-muted-foreground">Monitor playbooks, provider syncs, and pipeline syncs in one place</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => refetch()}
            disabled={isFetching}
            title="Refresh all runs"
            data-testid="button-refresh-runs"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
          {runs && runs.length >= 2 && (
            <Button onClick={() => setLocation("/compare")} data-testid="button-compare-runs">
              <GitCompare className="h-4 w-4 mr-2" />
              Compare Runs
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Filter className="h-5 w-5" />
            <CardTitle>Filters</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Type</label>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger data-testid="filter-type">
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">All types</SelectItem>
                  <SelectItem value="playbook-run">Playbook Runs</SelectItem>
                  <SelectItem value="bdp-sync">Pipeline Syncs</SelectItem>
                  <SelectItem value="provider-sync">Provider Syncs</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">Status</label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger data-testid="filter-status">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">All statuses</SelectItem>
                  <SelectItem value="queued">Queued</SelectItem>
                  <SelectItem value="running">Running</SelectItem>
                  <SelectItem value="ok">Success</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">Archive Status</label>
              <Select value={archivedFilter} onValueChange={setArchivedFilter}>
                <SelectTrigger data-testid="filter-archived">
                  <SelectValue placeholder="All runs" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">All runs</SelectItem>
                  <SelectItem value="false">Active only</SelectItem>
                  <SelectItem value="true">Archived only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">Start Date</label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                data-testid="filter-start-date"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">End Date</label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                data-testid="filter-end-date"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <Card>
          <CardContent className="p-6">
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-16 bg-muted animate-pulse rounded" />
              ))}
            </div>
          </CardContent>
        </Card>
      ) : runs && runs.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>All Runs ({runs.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Summary</TableHead>
                    <TableHead>Started</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((run) => (
                    <TableRow key={run.id} data-testid={`row-run-${run.id}`}>
                      <TableCell>
                        {getRunTypeBadge(run.runType)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">{run.sourceName || '—'}</span>
                          <span className="text-xs text-muted-foreground font-mono">{run.id.slice(0, 8)}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {getStatusIcon(run.status)}
                          {getStatusBadge(run.status)}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                        {getSummaryText(run)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {run.startedAt
                          ? new Date(run.startedAt).toLocaleString()
                          : run.createdAt
                          ? new Date(run.createdAt).toLocaleString()
                          : "—"}
                      </TableCell>
                      <TableCell className="text-sm font-mono">{formatDuration(run)}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Link href={`/runs/${run.id}`}>
                            <Button variant="ghost" size="icon" data-testid={`button-view-${run.id}`} title="View Logs">
                              <FileText className="h-4 w-4" />
                            </Button>
                          </Link>
                          {run.runType === 'playbook-run' && (
                            run.archived ? (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => unarchiveMutation.mutate(run.id)}
                                data-testid={`button-unarchive-${run.id}`}
                                title="Unarchive"
                              >
                                <ArchiveRestore className="h-4 w-4" />
                              </Button>
                            ) : (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => archiveMutation.mutate(run.id)}
                                data-testid={`button-archive-${run.id}`}
                                title="Archive"
                              >
                                <Archive className="h-4 w-4" />
                              </Button>
                            )
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="text-center py-12">
            <PlayCircle className="h-16 w-16 mx-auto mb-4 opacity-50 text-muted-foreground" />
            <p className="font-medium mb-2">No runs yet</p>
            <p className="text-sm text-muted-foreground">Launch a job template or run a sync to see status, duration, and logs here.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

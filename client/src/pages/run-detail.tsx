import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, Clock, Download, Radio, ArrowLeft, Database, Server, Workflow } from "lucide-react";

interface UnifiedRunDetail {
  id: string;
  runType: 'playbook-run' | 'bdp-sync' | 'provider-sync';
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  logs: string | null;
  summary?: Record<string, unknown>;
  resultSummary?: Record<string, unknown>;
  counts?: Record<string, unknown>;
  sourceName?: string;
  sourceType?: string;
  sourceId?: string;
  dryRun?: boolean;
  error?: string;
}

export default function RunDetail() {
  const { id } = useParams<{ id: string }>();
  const logContainerRef = useRef<HTMLDivElement>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [logs, setLogs] = useState<string>("");

  const { data: run, isLoading } = useQuery<UnifiedRunDetail>({
    queryKey: ["/api/runs", id],
    refetchInterval: (query) => {
      const data = query.state.data;
      return data?.status === "running" || data?.status === "queued" ? 2000 : false;
    },
  });

  useEffect(() => {
    if (!id) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws/runs/${id}`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      setWsConnected(true);
    };

    ws.onmessage = (event) => {
      setLogs((prev) => prev + event.data);
      if (logContainerRef.current) {
        logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
      }
    };

    ws.onclose = () => {
      setWsConnected(false);
    };

    return () => {
      ws.close();
    };
  }, [id]);

  useEffect(() => {
    if (run?.logs && !wsConnected) {
      setLogs(run.logs);
    }
  }, [run, wsConnected]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "ok":
        return <CheckCircle2 className="h-5 w-5 text-green-500" />;
      case "failed":
      case "error":
        return <XCircle className="h-5 w-5 text-red-500" />;
      case "running":
        return <Clock className="h-5 w-5 text-blue-500 animate-pulse" />;
      default:
        return <Clock className="h-5 w-5 text-muted-foreground" />;
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
        return null;
    }
  };

  const getRunTypeBadge = (runType: string) => {
    const labels: Record<string, string> = {
      'playbook-run': 'Playbook Run',
      'bdp-sync': 'Pipeline Sync',
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

  const downloadLogs = () => {
    const blob = new Blob([logs], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `run-${id}-logs.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getSummaryData = () => {
    if (!run) return null;
    const summarySource = run.summary || run.resultSummary || run.counts;
    if (!summarySource || typeof summarySource !== 'object') return null;
    return summarySource;
  };

  const formatDuration = () => {
    if (!run?.startedAt) return "—";
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

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 bg-muted animate-pulse rounded w-1/3" />
        <Card>
          <CardContent className="p-6">
            <div className="h-96 bg-muted animate-pulse rounded" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!run) {
    return (
      <Card>
        <CardContent className="text-center py-12">
          <p className="text-muted-foreground">Run not found</p>
        </CardContent>
      </Card>
    );
  }

  const summaryData = getSummaryData();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/runs">
          <Button variant="ghost" size="icon" data-testid="button-back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold" data-testid="text-page-title">
              Run #{id?.slice(0, 8)}
            </h1>
            {getStatusIcon(run.status)}
            {run.runType && getRunTypeBadge(run.runType)}
            {run.dryRun && <Badge variant="outline">Dry Run</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">
            {run.sourceName && <span className="font-medium">{run.sourceName}</span>}
            {run.sourceName && " · "}
            {run.startedAt ? new Date(run.startedAt).toLocaleString() : "Not started"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {wsConnected && (
            <Badge variant="outline" className="flex items-center gap-1">
              <Radio className="h-3 w-3 animate-pulse text-green-500" />
              Live
            </Badge>
          )}
          {getStatusBadge(run.status)}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Status</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold capitalize">{run.status}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Started</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">
              {run.startedAt ? new Date(run.startedAt).toLocaleTimeString() : "Pending"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Completed</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">
              {run.finishedAt ? new Date(run.finishedAt).toLocaleTimeString() : "In progress"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Duration</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm font-mono">{formatDuration()}</p>
          </CardContent>
        </Card>
      </div>

      {run.error && (
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle className="text-destructive">Error</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-sm text-destructive whitespace-pre-wrap font-mono bg-destructive/10 p-4 rounded">
              {run.error}
            </pre>
          </CardContent>
        </Card>
      )}

      {summaryData && Object.keys(summaryData).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Run Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {Object.entries(summaryData).map(([key, value]) => (
                <div key={key}>
                  <p className="text-xs text-muted-foreground mb-1 capitalize">{key.replace(/_/g, ' ')}</p>
                  <p className="text-2xl font-bold">{String(value)}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Console Logs</CardTitle>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={downloadLogs} disabled={!logs} data-testid="button-download-logs">
                <Download className="h-4 w-4 mr-2" />
                Download Logs
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div
            ref={logContainerRef}
            className="bg-[hsl(220_15%_6%)] text-green-400 p-4 rounded-lg font-mono text-sm h-[60vh] overflow-y-auto"
            data-testid="log-console"
          >
            {logs ? (
              <pre className="whitespace-pre-wrap">{logs}</pre>
            ) : (
              <p className="text-muted-foreground">
                {run.status === 'queued' ? 'Waiting to start...' : 'No logs available'}
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

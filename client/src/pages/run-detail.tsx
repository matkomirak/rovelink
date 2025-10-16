import { useEffect, useRef, useState } from "react";
import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, Clock, Download, Radio } from "lucide-react";
import type { JobRun } from "@shared/schema";

export default function RunDetail() {
  const { id } = useParams<{ id: string }>();
  const logContainerRef = useRef<HTMLDivElement>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [logs, setLogs] = useState<string>("");

  const { data: run, isLoading } = useQuery<JobRun>({
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
      // Auto-scroll to bottom
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

  // Load initial logs if run is complete
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
      running: "secondary",
      queued: "secondary",
    };
    return (
      <Badge variant={variants[status] || "secondary"} className="capitalize">
        {status}
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

  const downloadCSV = async () => {
    try {
      const response = await fetch(`/api/runs/${id}/csv`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `run-${id}-results.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Failed to download CSV:", error);
    }
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-3" data-testid="text-page-title">
            Run #{id?.slice(0, 8)}
            {getStatusIcon(run.status)}
          </h1>
          <p className="text-sm text-muted-foreground">
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
              {run.completedAt ? new Date(run.completedAt).toLocaleTimeString() : "In progress"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Duration</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm font-mono">
              {run.startedAt
                ? `${Math.floor(
                    ((run.completedAt ? new Date(run.completedAt).getTime() : Date.now()) -
                      new Date(run.startedAt).getTime()) /
                      1000
                  )}s`
                : "N/A"}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Live Console</CardTitle>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={downloadLogs} data-testid="button-download-logs">
                <Download className="h-4 w-4 mr-2" />
                Download Logs
              </Button>
              <Button variant="outline" size="sm" onClick={downloadCSV} data-testid="button-download-csv">
                <Download className="h-4 w-4 mr-2" />
                Download CSV
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
              <p className="text-muted-foreground">Waiting for logs...</p>
            )}
          </div>
        </CardContent>
      </Card>

      {run.resultSummary && typeof run.resultSummary === 'object' && Object.keys(run.resultSummary).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Run Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {Object.entries(run.resultSummary).map(([key, value]) => (
                <div key={key}>
                  <p className="text-xs text-muted-foreground mb-1 capitalize">{key.replace(/_/g, ' ')}</p>
                  <p className="text-2xl font-bold">{String(value)}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

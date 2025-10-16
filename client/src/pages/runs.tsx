import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PlayCircle, CheckCircle2, XCircle, Clock, ExternalLink, GitCompare } from "lucide-react";
import type { JobRun } from "@shared/schema";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function Runs() {
  const [, setLocation] = useLocation();
  const { data: runs, isLoading } = useQuery<JobRun[]>({
    queryKey: ["/api/runs"],
  });

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "ok":
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "failed":
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
      running: "secondary",
      queued: "secondary",
    };
    return (
      <Badge variant={variants[status] || "secondary"} className="capitalize">
        {status}
      </Badge>
    );
  };

  const formatDuration = (run: JobRun) => {
    if (!run.startedAt) return "Not started";
    const start = new Date(run.startedAt).getTime();
    const end = run.completedAt ? new Date(run.completedAt).getTime() : Date.now();
    const duration = Math.floor((end - start) / 1000);
    return `${duration}s`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-page-title">Job Runs</h1>
          <p className="text-sm text-muted-foreground">View and monitor automation job executions</p>
        </div>
        {runs && runs.length >= 2 && (
          <Button onClick={() => setLocation("/compare")} data-testid="button-compare-runs">
            <GitCompare className="h-4 w-4 mr-2" />
            Compare Runs
          </Button>
        )}
      </div>

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
            <CardTitle>All Runs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead>Run ID</TableHead>
                    <TableHead>Started</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((run) => (
                    <TableRow key={run.id} data-testid={`row-run-${run.id}`}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {getStatusIcon(run.status)}
                          {getStatusBadge(run.status)}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-sm">{run.id.slice(0, 8)}</TableCell>
                      <TableCell className="text-sm">
                        {run.startedAt
                          ? new Date(run.startedAt).toLocaleString()
                          : run.createdAt
                          ? new Date(run.createdAt).toLocaleString()
                          : "N/A"}
                      </TableCell>
                      <TableCell className="text-sm font-mono">{formatDuration(run)}</TableCell>
                      <TableCell>
                        <Link href={`/runs/${run.id}`}>
                          <Button variant="ghost" size="sm" data-testid={`button-view-${run.id}`}>
                            <ExternalLink className="h-4 w-4 mr-2" />
                            View
                          </Button>
                        </Link>
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
            <p className="text-muted-foreground mb-2">No job runs yet</p>
            <p className="text-sm text-muted-foreground">Launch a template to create your first run</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

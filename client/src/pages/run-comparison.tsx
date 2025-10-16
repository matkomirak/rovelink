import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Clock, CheckCircle, XCircle } from "lucide-react";
import type { JobRun } from "@shared/schema";

export default function RunComparison() {
  const [, setLocation] = useLocation();
  const [selectedRuns, setSelectedRuns] = useState<string[]>([]);

  const { data: runs } = useQuery<JobRun[]>({
    queryKey: ["/api/runs"],
  });

  const comparisonRuns = runs?.filter(r => selectedRuns.includes(r.id)) || [];

  const formatDuration = (start?: Date | null, end?: Date | null) => {
    if (!start || !end) return "N/A";
    const duration = new Date(end).getTime() - new Date(start).getTime();
    return `${Math.round(duration / 1000)}s`;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "ok": return "text-green-500";
      case "failed": return "text-destructive";
      case "running": return "text-blue-500";
      default: return "text-muted-foreground";
    }
  };

  const highlightDiff = (text1: string, text2: string) => {
    const lines1 = text1.split('\n');
    const lines2 = text2.split('\n');
    const diff = [];

    for (let i = 0; i < Math.max(lines1.length, lines2.length); i++) {
      const line1 = lines1[i] || "";
      const line2 = lines2[i] || "";
      if (line1 !== line2) {
        diff.push({ line: i + 1, text: line1 || line2, changed: true });
      } else {
        diff.push({ line: i + 1, text: line1, changed: false });
      }
    }

    return diff;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button 
            variant="ghost" 
            onClick={() => setLocation("/runs")}
            data-testid="button-back"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Runs
          </Button>
          <div>
            <h1 className="text-2xl font-semibold" data-testid="text-page-title">Run Comparison</h1>
            <p className="text-sm text-muted-foreground">Compare execution results and logs</p>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Select Runs to Compare</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Run 1</label>
              <Select 
                value={selectedRuns[0] || ""} 
                onValueChange={(value) => setSelectedRuns([value, selectedRuns[1] || ""])}
              >
                <SelectTrigger data-testid="select-run-1">
                  <SelectValue placeholder="Select first run" />
                </SelectTrigger>
                <SelectContent>
                  {runs?.map((run) => (
                    <SelectItem key={run.id} value={run.id}>
                      {run.id.substring(0, 8)} - {run.status} - {new Date(run.createdAt).toLocaleString()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">Run 2</label>
              <Select 
                value={selectedRuns[1] || ""} 
                onValueChange={(value) => setSelectedRuns([selectedRuns[0] || "", value])}
              >
                <SelectTrigger data-testid="select-run-2">
                  <SelectValue placeholder="Select second run" />
                </SelectTrigger>
                <SelectContent>
                  {runs?.map((run) => (
                    <SelectItem key={run.id} value={run.id}>
                      {run.id.substring(0, 8)} - {run.status} - {new Date(run.createdAt).toLocaleString()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {comparisonRuns.length === 2 && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {comparisonRuns.map((run, index) => (
              <Card key={run.id} data-testid={`comparison-card-${index}`}>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span>Run {index + 1}</span>
                    <Badge variant={run.status === 'ok' ? 'default' : run.status === 'failed' ? 'destructive' : 'secondary'}>
                      {run.status}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">ID</span>
                    <span className="font-mono">{run.id.substring(0, 8)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Status</span>
                    <span className={getStatusColor(run.status)}>
                      {run.status === 'ok' && <CheckCircle className="h-4 w-4 inline mr-1" />}
                      {run.status === 'failed' && <XCircle className="h-4 w-4 inline mr-1" />}
                      {run.status}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Duration</span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDuration(run.startedAt, run.completedAt)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Created</span>
                    <span>{new Date(run.createdAt).toLocaleString()}</span>
                  </div>
                  {run.resultSummary && typeof run.resultSummary === 'object' && (
                    <div className="pt-2 border-t">
                      <p className="text-sm font-medium mb-2">Results</p>
                      <div className="space-y-1 text-sm">
                        {Object.entries(run.resultSummary).map(([key, value]) => (
                          <div key={key} className="flex justify-between">
                            <span className="text-muted-foreground capitalize">{key.replace(/_/g, ' ')}</span>
                            <span>{String(value)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Log Comparison</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {comparisonRuns.map((run, index) => (
                  <div key={run.id} className="space-y-2">
                    <p className="text-sm font-medium">Run {index + 1} Logs</p>
                    <div 
                      className="bg-muted p-3 rounded-md font-mono text-xs max-h-96 overflow-auto"
                      data-testid={`logs-${index}`}
                    >
                      {run.logs?.split('\n').map((line, i) => {
                        const otherRun = comparisonRuns[index === 0 ? 1 : 0];
                        const otherLines = otherRun.logs?.split('\n') || [];
                        const isDifferent = otherLines[i] !== line;
                        
                        return (
                          <div 
                            key={i} 
                            className={isDifferent ? 'bg-yellow-500/10 px-1' : ''}
                          >
                            {line}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {comparisonRuns[0].logs && comparisonRuns[1].logs && (
            <Card>
              <CardHeader>
                <CardTitle>Differences Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {(() => {
                    const lines1 = comparisonRuns[0].logs.split('\n');
                    const lines2 = comparisonRuns[1].logs.split('\n');
                    const differences = lines1.reduce((acc, line, i) => {
                      if (lines2[i] !== line) acc.push(i + 1);
                      return acc;
                    }, [] as number[]);

                    return differences.length > 0 ? (
                      <div className="text-sm">
                        <p className="font-medium mb-2">
                          {differences.length} line{differences.length !== 1 ? 's' : ''} differ
                        </p>
                        <p className="text-muted-foreground">
                          Lines: {differences.slice(0, 10).join(', ')}
                          {differences.length > 10 && ` and ${differences.length - 10} more...`}
                        </p>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">Logs are identical</p>
                    );
                  })()}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

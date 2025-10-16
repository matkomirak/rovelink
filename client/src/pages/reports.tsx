import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Server, AlertTriangle, CheckCircle2, XCircle, TrendingUp } from "lucide-react";
import type { JobRun } from "@shared/schema";

interface InventoryHealth {
  total: number;
  withIP: number;
  withUser: number;
  coverage: number;
}

export default function Reports() {
  const { data: health, isLoading: healthLoading } = useQuery<InventoryHealth>({
    queryKey: ["/api/reports/inventory-health"],
  });

  const { data: runs } = useQuery<JobRun[]>({
    queryKey: ["/api/runs"],
  });

  const successCount = runs?.filter((r) => r.status === "ok").length || 0;
  const failedCount = runs?.filter((r) => r.status === "failed").length || 0;
  const totalCompleted = successCount + failedCount;
  const successRate = totalCompleted > 0 ? Math.round((successCount / totalCompleted) * 100) : 0;

  // Get top failures
  const failedRuns = runs?.filter((r) => r.status === "failed").slice(0, 5) || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="text-page-title">Reports</h1>
        <p className="text-sm text-muted-foreground">Analytics and insights for your infrastructure</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Inventory Health */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Server className="h-5 w-5 text-primary" />
              Inventory Health
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {healthLoading ? (
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="h-16 bg-muted animate-pulse rounded" />
                ))}
              </div>
            ) : health ? (
              <>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">Overall Coverage</span>
                    <span className="text-2xl font-bold" data-testid="text-coverage">
                      {health.coverage}%
                    </span>
                  </div>
                  <Progress value={health.coverage} className="h-2" />
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                      <span className="text-sm">Hosts with IP</span>
                    </div>
                    <span className="font-semibold" data-testid="text-hosts-with-ip">
                      {health.withIP} / {health.total}
                    </span>
                  </div>

                  <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                      <span className="text-sm">Hosts with Ansible User</span>
                    </div>
                    <span className="font-semibold" data-testid="text-hosts-with-user">
                      {health.withUser} / {health.total}
                    </span>
                  </div>

                  <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-yellow-500" />
                      <span className="text-sm">Missing Configuration</span>
                    </div>
                    <span className="font-semibold text-yellow-600 dark:text-yellow-400">
                      {health.total - Math.min(health.withIP, health.withUser)}
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <p className="text-sm">No inventory data available</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Run Statistics */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              Run Statistics
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">Success Rate</span>
                <span className="text-2xl font-bold" data-testid="text-success-rate">
                  {successRate}%
                </span>
              </div>
              <Progress value={successRate} className="h-2" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
                <p className="text-xs text-green-600 dark:text-green-400 mb-1">Successful</p>
                <p className="text-2xl font-bold text-green-600 dark:text-green-400" data-testid="text-success-total">
                  {successCount}
                </p>
              </div>
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                <p className="text-xs text-red-600 dark:text-red-400 mb-1">Failed</p>
                <p className="text-2xl font-bold text-red-600 dark:text-red-400" data-testid="text-failed-total">
                  {failedCount}
                </p>
              </div>
            </div>

            <div>
              <p className="text-sm font-medium mb-3">Recent Failures</p>
              {failedRuns.length > 0 ? (
                <div className="space-y-2">
                  {failedRuns.map((run) => (
                    <div
                      key={run.id}
                      className="flex items-center justify-between p-2 bg-muted rounded"
                      data-testid={`failed-run-${run.id}`}
                    >
                      <div className="flex items-center gap-2">
                        <XCircle className="h-4 w-4 text-red-500" />
                        <span className="text-sm font-mono">{run.id.slice(0, 8)}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {run.completedAt
                          ? new Date(run.completedAt).toLocaleDateString()
                          : "In progress"}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">No failures</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

import { OnboardingProgress } from "@/components/onboarding-progress";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Server, FolderGit2, PlayCircle, CheckCircle2, XCircle, Clock, ShieldCheck, ShieldX, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { JobRun, Project, JobTemplate } from "@shared/schema";

interface GateSummary {
  allowed: number;
  blocked: number;
  last_evaluation: string | null;
  evaluation_complete: boolean;
}

export default function Dashboard() {
  const [, setLocation] = useLocation();

  const { data: projects } = useQuery<Project[]>({
    queryKey: ["/api/projects"],
  });

  const { data: templates } = useQuery<JobTemplate[]>({
    queryKey: ["/api/templates"],
  });

  const { data: runs } = useQuery<JobRun[]>({
    queryKey: ["/api/runs"],
  });

  const { data: gate } = useQuery<GateSummary>({
    queryKey: ["/api/gate/summary"],
    refetchInterval: 30000,
  });

  const recentRuns = runs?.slice(0, 5) || [];
  const successCount = runs?.filter(r => r.status === "ok").length || 0;
  const failedCount = runs?.filter(r => r.status === "failed").length || 0;

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

  const totalGate = (gate?.allowed ?? 0) + (gate?.blocked ?? 0);
  const readinessPct = totalGate > 0 ? Math.round(((gate?.allowed ?? 0) / totalGate) * 100) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="text-page-title">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Governance and pre-flight decision layer: recorded readiness and activity are evidence, not execution permission.</p>
      </div>

      <OnboardingProgress />

      {/* Automation GATE readiness — primary hero section */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="md:col-span-1">
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2 flex-wrap">
            <CardTitle className="text-sm font-medium">Recorded GATE Eligibility</CardTitle>
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-600 dark:text-green-400" data-testid="text-gate-allowed">
              {gate?.allowed ?? "—"}
            </div>
            <p className="text-xs text-muted-foreground mt-1">assets allowed in the last recorded inventory check; execution checks GATE again</p>
            {totalGate > 0 && (
              <div className="mt-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-muted-foreground">{readinessPct}% eligible in the recorded check</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-green-500 transition-all"
                    style={{ width: `${readinessPct}%` }}
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="md:col-span-1">
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2 flex-wrap">
            <CardTitle className="text-sm font-medium">Blocked Assets</CardTitle>
            <ShieldX className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div
              className="text-3xl font-bold text-red-600 dark:text-red-400 cursor-pointer hover:underline"
              data-testid="text-gate-blocked"
              onClick={() => setLocation("/automation-inventories")}
            >
              {gate?.blocked ?? "—"}
            </div>
            <p className="text-xs text-muted-foreground mt-1">assets blocked in the last recorded GATE check</p>
            {gate && gate.blocked > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => setLocation("/automation-inventories")}
                data-testid="button-view-blocked"
              >
                Review blocked
              </Button>
            )}
          </CardContent>
        </Card>

        <Card className="md:col-span-1">
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2 flex-wrap">
            <CardTitle className="text-sm font-medium">Gate Status</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 mt-1">
              {gate?.evaluation_complete ? (
                <Badge variant="default" data-testid="badge-gate-status">Complete</Badge>
              ) : (
                <Badge variant="secondary" data-testid="badge-gate-status">Pending</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              {gate?.last_evaluation
                ? `Last evaluated ${new Date(gate.last_evaluation).toLocaleString()}`
                : "No evaluation recorded yet"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Standard stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2 flex-wrap">
            <CardTitle className="text-sm font-medium">Projects</CardTitle>
            <FolderGit2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-projects-count">{projects?.length || 0}</div>
            <p className="text-xs text-muted-foreground">Git repositories configured</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2 flex-wrap">
            <CardTitle className="text-sm font-medium">Templates</CardTitle>
            <Server className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-templates-count">{templates?.length || 0}</div>
            <p className="text-xs text-muted-foreground">Job templates ready</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2 flex-wrap">
            <CardTitle className="text-sm font-medium">Successful Automation Runs</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600 dark:text-green-400" data-testid="text-success-count">{successCount}</div>
            <p className="text-xs text-muted-foreground">Completed successfully</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2 flex-wrap">
            <CardTitle className="text-sm font-medium">Failed Automation Runs</CardTitle>
            <XCircle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600 dark:text-red-400" data-testid="text-failed-count">{failedCount}</div>
            <p className="text-xs text-muted-foreground">Requires attention</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Automation Runs</CardTitle>
        </CardHeader>
        <CardContent>
          {recentRuns.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <PlayCircle className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="font-medium text-foreground">No automation runs yet</p>
              <p className="text-sm mt-1">Connect and review your sources first. Prepare inventory and templates, then inspect GATE before starting a run.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {recentRuns.map((run) => (
                <div
                  key={run.id}
                  className="flex items-center justify-between p-3 border rounded-md hover-elevate"
                  data-testid={`run-item-${run.id}`}
                >
                  <div className="flex items-center gap-3 flex-1">
                    {getStatusIcon(run.status)}
                    <div className="flex-1">
                      <p className="text-sm font-medium">Run #{run.id.slice(0, 8)}</p>
                      <p className="text-xs text-muted-foreground">
                        {run.createdAt ? new Date(run.createdAt).toLocaleString() : "N/A"}
                      </p>
                    </div>
                  </div>
                  {getStatusBadge(run.status)}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

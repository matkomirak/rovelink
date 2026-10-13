import { useQueries, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { onboardingSteps } from "@shared/onboarding";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type Source = { id: string; enabled: boolean; kind: string };
type Types = { objectTypes: Array<{ count: number | null; mode?: string }> };
export function OnboardingProgress() {
  const cmdbs = useQuery<Source[]>({ refetchOnMount: "always" as const, queryKey: ["/api/cmdbs"] });
  const providers = useQuery<Source[]>({ refetchOnMount: "always" as const, queryKey: ["/api/providers"] });
  const references = (cmdbs.data ?? []).filter(s => s.enabled && s.kind === "netbox");
  const runtime = (providers.data ?? []).filter(s => s.enabled);
  const referenceQueries = useQueries({ queries: references.map(s => ({ refetchOnMount: "always" as const, queryKey: ["/api/cmdbs", s.id, "object-types"] })) });
  const assignmentQueries = useQueries({ queries: references.map(s => ({ refetchOnMount: "always" as const, queryKey: ["/api/cmdbs", s.id, "customer-scope-summary"] })) });
  const runtimeQueries = useQueries({ queries: runtime.map(s => ({ refetchOnMount: "always" as const, queryKey: ["/api/providers", s.id, "inventory/object-types"] })) });
  const drift = useQuery<{ runs: Array<{ status: string }> }>({ refetchOnMount: "always" as const, queryKey: ["/api/drift-runs"] });
  const governance = useQuery<Array<{ status: string }>>({ refetchOnMount: "always" as const, queryKey: ["/api/governance/evaluation-runs"] });
  const inventories = useQuery<unknown[]>({ refetchOnMount: "always" as const, queryKey: ["/api/inventories"] });
  const templates = useQuery<unknown[]>({ refetchOnMount: "always" as const, queryKey: ["/api/templates"] });
  const allQueries = [cmdbs, providers, drift, governance, inventories, templates, ...referenceQueries, ...assignmentQueries, ...runtimeQueries];
  const loading = allQueries.some(q => q.isLoading);
  const failed = allQueries.some(q => q.isError);
  const sumTypes = (data: unknown, cachedOnly = false) => ((data as Types | undefined)?.objectTypes ?? []).reduce((sum, t) => sum + (cachedOnly && t.mode !== "cached" ? 0 : t.count ?? 0), 0);
  const steps = onboardingSteps({
    cmdbs: references.length, providers: runtime.length,
    referenceObjects: referenceQueries.reduce((n, q) => n + sumTypes(q.data, true), 0),
    runtimeObjects: runtimeQueries.reduce((n, q) => n + sumTypes(q.data), 0),
    assigned: assignmentQueries.reduce((n, q) => n + ((q.data as { assignedObjectCount?: number })?.assignedObjectCount ?? 0), 0),
    unassigned: assignmentQueries.reduce((n, q) => n + ((q.data as { unassignedObjectCount?: number })?.unassignedObjectCount ?? 0), 0),
    driftRuns: (drift.data?.runs ?? []).filter(r => r.status === "completed").length,
    governanceRuns: (governance.data ?? []).filter(r => r.status === "ok").length,
    inventories: inventories.data?.length ?? 0, templates: templates.data?.length ?? 0,
  });
  return <Card>
    <CardHeader><CardTitle>Getting started</CardTitle><p className="text-sm text-muted-foreground">Reference → runtime → drift → governance → automation preparation. Links open pages; no sync or automation runs automatically.</p></CardHeader>
    <CardContent>
      {loading ? <p role="status">Loading setup progress…</p> : failed ? <p role="alert">Needs attention: setup progress could not be loaded. Check your connection or access permissions.</p> :
        <ol className="grid gap-3 md:grid-cols-2">{steps.map((step, i) => <li key={step.label} className="rounded-md border p-3">
          <div className="flex items-center justify-between gap-2"><Link href={step.href} className="font-medium text-sm hover:underline">{i + 1}. {step.label}</Link><Badge variant={step.status === "Needs attention" ? "destructive" : "outline"}>{step.status}</Badge></div>
          <p className="mt-1 text-xs text-muted-foreground">{step.help}</p>
        </li>)}</ol>}
      <p className="mt-3 text-xs text-muted-foreground">Done means a setup milestone has evidence, not that all objects are current or automation-ready. Zero cached VMs keep the import step Ready; successful empty imports are shown on the CMDB page.</p>
    </CardContent>
  </Card>;
}



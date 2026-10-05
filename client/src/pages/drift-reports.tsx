import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Eye, GitCompareArrows, Info, Loader2, RefreshCw } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { CmdbAccount, ProviderAccount } from "@shared/schema";

type DriftRunStatus = "pending" | "running" | "completed" | "failed";
type DriftMatchStatus = "matched" | "unmatched_reference" | "unmatched_provider" | "ambiguous";
type DriftStatus = "no_drift" | "drift" | "unknown" | "not_compared";
type DriftSeverity = "info" | "warning" | "critical";

interface DriftCounts {
  total?: number;
  matched?: number;
  unmatchedReference?: number;
  unmatchedProvider?: number;
  ambiguous?: number;
  drift?: number;
  noDrift?: number;
  unknown?: number;
  notCompared?: number;
  warning?: number;
  critical?: number;
  info?: number;
}

interface DriftRun {
  id: string;
  orgId: string;
  cmdbSourceId: string;
  providerSourceId: string;
  objectType: string;
  status: DriftRunStatus;
  counts: DriftCounts;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface DriftItem {
  id: string;
  runId: string;
  objectType: string;
  referenceObjectId: string | null;
  providerObjectId: string | null;
  matchStatus: DriftMatchStatus;
  matchConfidence: string | null;
  matchReason: string | null;
  driftStatus: DriftStatus;
  driftSeverity: DriftSeverity;
  fieldDiffs: unknown[];
  findings: unknown[];
  metadata: Record<string, unknown>;
  createdAt: string;
}

interface DriftRunListResponse {
  runs: DriftRun[];
  total: number;
}

interface DriftItemsResponse {
  runId: string;
  items: DriftItem[];
  total: number;
}

interface DriftRunResponse {
  run: DriftRun;
  counts: DriftCounts;
  itemsCreated: number;
}

const ALL_VALUE = "__all__";

function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function countValue(counts: DriftCounts | undefined, key: keyof DriftCounts) {
  return typeof counts?.[key] === "number" ? counts[key] as number : 0;
}

function sourceName(id: string, sources: Array<{ id: string; name: string }>) {
  return sources.find((source) => source.id === id)?.name ?? id;
}

function buildItemsUrl(runId: string, filters: {
  matchStatus: string;
  driftStatus: string;
  driftSeverity: string;
}) {
  const params = new URLSearchParams();
  if (filters.matchStatus !== ALL_VALUE) params.set("matchStatus", filters.matchStatus);
  if (filters.driftStatus !== ALL_VALUE) params.set("driftStatus", filters.driftStatus);
  if (filters.driftSeverity !== ALL_VALUE) params.set("driftSeverity", filters.driftSeverity);
  const query = params.toString();
  return `/api/drift-runs/${runId}/items${query ? `?${query}` : ""}`;
}

function badgeVariant(kind: string): "default" | "secondary" | "destructive" | "outline" {
  if (kind === "failed" || kind === "critical") return "destructive";
  if (kind === "matched" || kind === "no_drift" || kind === "completed") return "secondary";
  if (kind === "running" || kind === "pending") return "outline";
  return "default";
}

function summarizeFindings(findings: unknown[]) {
  if (!findings.length) return "None";
  return findings
    .map((finding) => {
      if (finding && typeof finding === "object" && "code" in finding) {
        return String((finding as { code?: unknown }).code);
      }
      return "Finding";
    })
    .join(", ");
}

function compactJson(value: unknown) {
  if (value === null || value === undefined) return "-";
  const serialized = JSON.stringify(value, null, 2);
  return serialized.length > 3000 ? `${serialized.slice(0, 3000)}\n...` : serialized;
}

function StatCell({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function DetailBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">{title}</h3>
      <pre className="max-h-64 overflow-auto rounded-md border bg-muted/40 p-3 text-xs whitespace-pre-wrap break-words">
        {compactJson(value)}
      </pre>
    </div>
  );
}

function LoadError({ subject, onRetry }: { subject: string; onRetry: () => void }) {
  return (
    <Alert variant="destructive">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>Could not load {subject}</AlertTitle>
      <AlertDescription>
        Check the app connection and try again.
        <Button type="button" variant="outline" size="sm" className="ml-2" onClick={onRetry}>
          Retry
        </Button>
      </AlertDescription>
    </Alert>
  );
}

export default function DriftReports() {
  const { toast } = useToast();
  const [cmdbSourceId, setCmdbSourceId] = useState("");
  const [providerSourceId, setProviderSourceId] = useState("");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<DriftItem | null>(null);
  const [matchStatus, setMatchStatus] = useState(ALL_VALUE);
  const [driftStatus, setDriftStatus] = useState(ALL_VALUE);
  const [driftSeverity, setDriftSeverity] = useState(ALL_VALUE);

  const { data: cmdbs = [], isLoading: cmdbsLoading, isError: cmdbsError, refetch: refetchCmdbs } = useQuery<CmdbAccount[]>({
    queryKey: ["/api/cmdbs"],
  });
  const { data: providers = [], isLoading: providersLoading, isError: providersError, refetch: refetchProviders } = useQuery<ProviderAccount[]>({
    queryKey: ["/api/providers"],
  });
  const { data: runList, isLoading: runsLoading, isFetching: runsFetching, isError: runsError, refetch: refetchRuns } = useQuery<DriftRunListResponse>({
    queryKey: ["/api/drift-runs"],
  });

  const netboxCmdbs = useMemo(
    () => cmdbs.filter((cmdb) => cmdb.kind === "netbox" && cmdb.enabled),
    [cmdbs],
  );
  const enabledProviders = useMemo(
    () => providers.filter((provider) => provider.enabled),
    [providers],
  );
  const runs = runList?.runs ?? [];
  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? runs[0] ?? null;
  const effectiveRunId = selectedRun?.id ?? null;
  const itemsUrl = effectiveRunId
    ? buildItemsUrl(effectiveRunId, { matchStatus, driftStatus, driftSeverity })
    : null;
  const { data: itemsResponse, isLoading: itemsLoading, isError: itemsError, refetch: refetchItems } = useQuery<DriftItemsResponse>({
    queryKey: [itemsUrl ?? "/api/drift-runs/no-run/items"],
    enabled: Boolean(itemsUrl),
  });
  const items = itemsResponse?.items ?? [];

  const runMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/drift-runs", {
        cmdbSourceId,
        providerSourceId,
        objectType: "vm",
      });
      return await response.json() as DriftRunResponse;
    },
    onSuccess: (result) => {
      setSelectedRunId(result.run.id);
      queryClient.invalidateQueries({ queryKey: ["/api/drift-runs"] });
      toast({
        title: "Drift comparison completed",
        description: `${result.itemsCreated} drift item${result.itemsCreated === 1 ? "" : "s"} created for VM comparison.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Drift comparison failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const sourceSelectionDisabled = cmdbsLoading || providersLoading || cmdbsError || providersError || runMutation.isPending;
  const canRun = Boolean(cmdbSourceId && providerSourceId) && !sourceSelectionDisabled;

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold" data-testid="text-page-title">Drift Reports</h1>
        <p className="text-sm text-muted-foreground">
          Compare documented CMDB reference state with observed provider runtime state.
        </p>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>Analysis only</AlertTitle>
        <AlertDescription>
          Drift Reports compare documented CMDB/reference state with observed provider/runtime state.
          Results are analysis only. They do not update CMDBs, providers, Governance readiness,
          or Automation GATE decisions.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitCompareArrows className="h-5 w-5 text-primary" />
            Run VM Drift Comparison
          </CardTitle>
          <CardDescription>
            Select one NetBox CMDB source and one provider source. The comparison runs now and stores a report only.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
          <div className="space-y-2">
            <label className="text-sm font-medium">CMDB source</label>
            <Select value={cmdbSourceId} onValueChange={setCmdbSourceId} disabled={sourceSelectionDisabled}>
              <SelectTrigger data-testid="select-drift-cmdb-source">
                <SelectValue placeholder={cmdbsLoading ? "Loading CMDBs..." : "Select NetBox CMDB"} />
              </SelectTrigger>
              <SelectContent>
                {netboxCmdbs.map((cmdb) => (
                  <SelectItem key={cmdb.id} value={cmdb.id}>
                    {cmdb.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {cmdbsError && <LoadError subject="CMDB sources" onRetry={() => void refetchCmdbs()} />}
            {!cmdbsLoading && !cmdbsError && netboxCmdbs.length === 0 && (
              <p className="text-xs text-muted-foreground">No enabled NetBox CMDB sources are available.</p>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Provider source</label>
            <Select value={providerSourceId} onValueChange={setProviderSourceId} disabled={sourceSelectionDisabled}>
              <SelectTrigger data-testid="select-drift-provider-source">
                <SelectValue placeholder={providersLoading ? "Loading providers..." : "Select provider"} />
              </SelectTrigger>
              <SelectContent>
                {enabledProviders.map((provider) => (
                  <SelectItem key={provider.id} value={provider.id}>
                    {provider.name} ({provider.kind})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {providersError && <LoadError subject="provider sources" onRetry={() => void refetchProviders()} />}
            {!providersLoading && !providersError && enabledProviders.length === 0 && (
              <p className="text-xs text-muted-foreground">No enabled provider sources are available.</p>
            )}
          </div>

          <Button
            type="button"
            onClick={() => runMutation.mutate()}
            disabled={!canRun}
            data-testid="button-run-drift-comparison"
          >
            {runMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Run VM Drift Comparison
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent Drift Runs</CardTitle>
          <CardDescription>Stored comparison summaries. Rows do not include item payloads.</CardDescription>
        </CardHeader>
        <CardContent>
          {runsLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((key) => <Skeleton key={key} className="h-12 w-full" />)}
            </div>
          ) : runsError ? (
            <LoadError subject="drift runs" onRetry={() => void refetchRuns()} />
          ) : runs.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              No drift runs yet. Select sources and run a VM drift comparison to create the first report.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Created</TableHead>
                    <TableHead>CMDB</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Matched</TableHead>
                    <TableHead>Unmatched Ref</TableHead>
                    <TableHead>Unmatched Provider</TableHead>
                    <TableHead>Ambiguous</TableHead>
                    <TableHead>Drift</TableHead>
                    <TableHead>No Drift</TableHead>
                    <TableHead>Warnings</TableHead>
                    <TableHead>Critical</TableHead>
                    <TableHead>Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((run) => (
                    <TableRow
                      key={run.id}
                      className={effectiveRunId === run.id ? "bg-muted/60" : "cursor-pointer"}
                      onClick={() => setSelectedRunId(run.id)}
                      data-testid={`row-drift-run-${run.id}`}
                    >
                      <TableCell className="whitespace-nowrap">{formatDate(run.createdAt)}</TableCell>
                      <TableCell>{sourceName(run.cmdbSourceId, cmdbs)}</TableCell>
                      <TableCell>{sourceName(run.providerSourceId, providers)}</TableCell>
                      <TableCell>
                        <Badge variant={badgeVariant(run.status)}>{run.status}</Badge>
                      </TableCell>
                      <TableCell>{countValue(run.counts, "matched")}</TableCell>
                      <TableCell>{countValue(run.counts, "unmatchedReference")}</TableCell>
                      <TableCell>{countValue(run.counts, "unmatchedProvider")}</TableCell>
                      <TableCell>{countValue(run.counts, "ambiguous")}</TableCell>
                      <TableCell>{countValue(run.counts, "drift")}</TableCell>
                      <TableCell>{countValue(run.counts, "noDrift")}</TableCell>
                      <TableCell>{countValue(run.counts, "warning")}</TableCell>
                      <TableCell>{countValue(run.counts, "critical")}</TableCell>
                      <TableCell>{countValue(run.counts, "total")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {runsFetching && <p className="mt-2 text-xs text-muted-foreground">Refreshing runs...</p>}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Run Detail</CardTitle>
          <CardDescription>
            {selectedRun
              ? `Items for run ${selectedRun.id.slice(0, 8)}. Drift findings are report data, not remediation actions.`
              : "Select a run to inspect drift items."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {selectedRun?.status === "failed" && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Run failed</AlertTitle>
              <AlertDescription>{selectedRun.error ?? "The drift comparison failed."}</AlertDescription>
            </Alert>
          )}

          {selectedRun && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
              <StatCell label="Matched" value={countValue(selectedRun.counts, "matched")} />
              <StatCell label="Unmatched reference" value={countValue(selectedRun.counts, "unmatchedReference")} />
              <StatCell label="Unmatched provider" value={countValue(selectedRun.counts, "unmatchedProvider")} />
              <StatCell label="Ambiguous" value={countValue(selectedRun.counts, "ambiguous")} />
              <StatCell label="Drift" value={countValue(selectedRun.counts, "drift")} />
              <StatCell label="Total" value={countValue(selectedRun.counts, "total")} />
            </div>
          )}

          <div className="grid gap-3 lg:grid-cols-3">
            <Select value={matchStatus} onValueChange={setMatchStatus} disabled={!selectedRun}>
              <SelectTrigger>
                <SelectValue placeholder="Match status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>All match statuses</SelectItem>
                <SelectItem value="matched">Matched</SelectItem>
                <SelectItem value="unmatched_reference">Unmatched reference</SelectItem>
                <SelectItem value="unmatched_provider">Unmatched provider</SelectItem>
                <SelectItem value="ambiguous">Ambiguous</SelectItem>
              </SelectContent>
            </Select>
            <Select value={driftStatus} onValueChange={setDriftStatus} disabled={!selectedRun}>
              <SelectTrigger>
                <SelectValue placeholder="Drift status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>All drift statuses</SelectItem>
                <SelectItem value="no_drift">No drift</SelectItem>
                <SelectItem value="drift">Drift</SelectItem>
                <SelectItem value="unknown">Unknown</SelectItem>
                <SelectItem value="not_compared">Not compared</SelectItem>
              </SelectContent>
            </Select>
            <Select value={driftSeverity} onValueChange={setDriftSeverity} disabled={!selectedRun}>
              <SelectTrigger>
                <SelectValue placeholder="Severity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>All severities</SelectItem>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {!selectedRun ? (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              No drift run selected.
            </div>
          ) : itemsLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((key) => <Skeleton key={key} className="h-12 w-full" />)}
            </div>
          ) : itemsError ? (
            <LoadError subject="drift items" onRetry={() => void refetchItems()} />
          ) : items.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              No drift items match the selected filters.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Match</TableHead>
                    <TableHead>Confidence</TableHead>
                    <TableHead>Drift</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead>Reference Object</TableHead>
                    <TableHead>Provider Object</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Findings</TableHead>
                    <TableHead className="text-right">Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell><Badge variant={badgeVariant(item.matchStatus)}>{item.matchStatus}</Badge></TableCell>
                      <TableCell>{item.matchConfidence ?? "-"}</TableCell>
                      <TableCell><Badge variant={badgeVariant(item.driftStatus)}>{item.driftStatus}</Badge></TableCell>
                      <TableCell><Badge variant={badgeVariant(item.driftSeverity)}>{item.driftSeverity}</Badge></TableCell>
                      <TableCell className="font-mono text-xs">{item.referenceObjectId ?? "-"}</TableCell>
                      <TableCell className="font-mono text-xs">{item.providerObjectId ?? "-"}</TableCell>
                      <TableCell className="max-w-64 truncate">{item.matchReason ?? "-"}</TableCell>
                      <TableCell className="max-w-64 truncate">{summarizeFindings(item.findings)}</TableCell>
                      <TableCell className="text-right">
                        <Button type="button" size="sm" variant="outline" onClick={() => setSelectedItem(item)}>
                          <Eye className="mr-2 h-4 w-4" />
                          Inspect
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Sheet open={Boolean(selectedItem)} onOpenChange={(open) => !open && setSelectedItem(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>Drift Item Detail</SheetTitle>
            <SheetDescription>
              Read-only report data. No CMDB, provider, Governance, or Automation GATE changes are made here.
            </SheetDescription>
          </SheetHeader>
          {selectedItem && (
            <div className="mt-6 space-y-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="text-xs text-muted-foreground">Match status</div>
                  <Badge variant={badgeVariant(selectedItem.matchStatus)}>{selectedItem.matchStatus}</Badge>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Match confidence</div>
                  <div>{selectedItem.matchConfidence ?? "-"}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Drift status</div>
                  <Badge variant={badgeVariant(selectedItem.driftStatus)}>{selectedItem.driftStatus}</Badge>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Drift severity</div>
                  <Badge variant={badgeVariant(selectedItem.driftSeverity)}>{selectedItem.driftSeverity}</Badge>
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Match reason</div>
                <p className="text-sm">{selectedItem.matchReason ?? "-"}</p>
              </div>
              <DetailBlock title="Candidate Provider IDs" value={selectedItem.metadata?.candidateProviderObjectIds ?? []} />
              <DetailBlock title="Signals" value={selectedItem.metadata?.signals ?? []} />
              <DetailBlock title="Field Diffs" value={selectedItem.fieldDiffs} />
              <DetailBlock title="Findings" value={selectedItem.findings} />
              <DetailBlock title="Metadata" value={selectedItem.metadata} />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

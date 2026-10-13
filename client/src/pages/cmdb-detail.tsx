import { netboxCustomerAssignmentSourceLabel } from "@shared/governance";
import { useParams, Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  ArrowLeft,
  Box,
  ChevronRight,
  Cpu,
  Database,
  HardDrive,
  Info,
  Layers,
  Network,
  RefreshCw,
  Search,
  Server,
  Tag,
  TriangleAlert,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";

interface CmdbAccount {
  id: string;
  kind: string;
  name: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

interface CmdbObjectType {
  objectType: "netbox_vm";
  name: string;
  description: string;
  count: number | null;
  status: "available" | "cached" | "live" | "not_supported";
  mode: "cached" | "live";
}

interface CmdbObjectTypesResponse {
  objectTypes: CmdbObjectType[];
}

interface NetBoxVmObject {
  id: number | string;
  localObjectId?: string | null;
  cachedVmId?: string | null;
  name: string;
  status?: { value?: string; label?: string } | string | null;
  platform?: { id?: number; name?: string } | null;
  primary_ip?: { id?: number; address?: string } | null;
  primary_ip4?: { id?: number; address?: string } | null;
  tenant?: { id?: number; name?: string } | null;
  role?: { id?: number; name?: string } | string | null;
  cluster?: { id?: number; name?: string } | null;
  site?: { id?: number; name?: string } | null;
  vcpus?: number | null;
  memory?: number | null;
  disk?: number | null;
  tags?: Array<{ name?: string } | string>;
  custom_fields?: Record<string, unknown>;
  last_synced?: string | null;
  raw?: Record<string, unknown>;
}

interface CmdbObjectsResponse {
  source: { id: string; name: string; kind: string };
  objectType: string;
  objectTypeName: string;
  mode: "cached" | "live";
  objects: NetBoxVmObject[];
  total: number;
}

interface CmdbObjectDetailResponse {
  source: { id: string; name: string; kind: string };
  objectType: string;
  objectTypeName: string;
  mode: "cached" | "live";
  object: NetBoxVmObject;
}

interface CmdbRefreshResult {
  sourceId: string;
  importedCount: number;
  customerScopesUpserted: number;
  customerAssignmentsUpserted: number;
  customerUnassignedCount: number;
  customerScopeResolutionErrors: number;
  lastImportAt: string | null;
}

interface CustomerScopeSummary {
  customerScopeCount: number;
  assignedObjectCount: number;
  unassignedObjectCount: number;
  relationshipCounts: Record<string, number>;
  derivedFromCounts: Record<string, number>;
  confidenceCounts: Record<string, number>;
  latestLastSyncedAt: string | null;
}

interface CustomerScopeListItem {
  id: string;
  name: string;
  displayName?: string | null;
  externalId: string;
  strategy: string;
  isolation?: string | null;
  assignmentCount: number;
  relationshipCounts?: Record<string, number>;
  lastSyncedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CustomerScopeGovernanceFinding {
  code: string;
  count: number;
  message: string;
  severity?: string;
}

interface CustomerScopeGovernanceSummaryItem {
  sourceId: string;
  customerScopeId: string | null;
  customerScopeName: string;
  objectType: "netbox_vm";
  objectCount: number;
  assignedObjectCount: number;
  unassignedObjectCount: number;
  evaluatedObjectCount: number;
  unevaluatedObjectCount: number;
  latestEvaluationRunId: string | null;
  latestEvaluatedAt: string | null;
  averageGovernanceScore: number | null;
  readyCount: number;
  notReadyCount: number;
  blockAutomationRecommendationCount: number;
  findingCounts: Record<string, number>;
  topFindings: CustomerScopeGovernanceFinding[];
}

interface CustomerScopeGovernanceSummariesResponse {
  sourceId: string;
  objectType: "netbox_vm";
  summaries: CustomerScopeGovernanceSummaryItem[];
}

interface CustomerAssignment {
  id: string;
  objectType: string;
  objectId: string;
  relationship: "dedicated" | "shared" | "internal" | "unassigned";
  derivedFrom: string;
  confidence: string;
  lastSyncedAt?: string | null;
  customerScope: {
    id: string;
    name: string;
    displayName?: string | null;
    externalId: string;
    strategy: string;
    isolation?: string | null;
  } | null;
}

interface CustomerAssignmentsResponse {
  objectType: string;
  objectId: string;
  assignments: CustomerAssignment[];
}

function statusValue(status: NetBoxVmObject["status"]) {
  return typeof status === "string" ? status : status?.value;
}

function statusLabel(status: NetBoxVmObject["status"]) {
  return typeof status === "string" ? status : status?.label ?? status?.value;
}

function relationName(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "object" && "name" in value) {
    return String((value as { name?: unknown }).name ?? "");
  }
  return undefined;
}

function primaryIp(vm: NetBoxVmObject) {
  return vm.primary_ip?.address ?? vm.primary_ip4?.address;
}

function tagsFor(vm: NetBoxVmObject) {
  return (vm.tags ?? [])
    .map((tag) => (typeof tag === "string" ? tag : tag.name))
    .filter(Boolean) as string[];
}

function statusVariant(status?: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "active":
      return "default";
    case "offline":
    case "failed":
      return "destructive";
    case "staged":
    case "planned":
      return "secondary";
    default:
      return "outline";
  }
}

function relationshipVariant(relationship?: string): "default" | "secondary" | "destructive" | "outline" {
  switch (relationship) {
    case "dedicated":
    case "shared":
      return "default";
    case "unassigned":
      return "destructive";
    case "internal":
      return "secondary";
    default:
      return "outline";
  }
}

function scoreVariant(score: number | null | undefined): "default" | "secondary" | "destructive" | "outline" {
  if (score === null || score === undefined) return "outline";
  if (score < 70) return "destructive";
  if (score < 90) return "secondary";
  return "default";
}

function formatDate(value?: string | null) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function AttrRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div className="flex gap-3 py-2 border-b border-border/40 last:border-0">
      <span className="text-xs text-muted-foreground w-40 shrink-0 pt-0.5">{label}</span>
      <span className="text-xs flex-1 break-all">{value}</span>
    </div>
  );
}

function CountBadges({ counts }: { counts?: Record<string, number> }) {
  const entries = Object.entries(counts ?? {}).filter(([, count]) => count > 0);
  if (entries.length === 0) return <span className="text-muted-foreground/50">-</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {entries.map(([key, count]) => (
        <Badge key={key} variant={relationshipVariant(key)} className="text-[10px]">
          {key}: {count}
        </Badge>
      ))}
    </div>
  );
}

function ScoreBadge({ summary }: { summary?: CustomerScopeGovernanceSummaryItem }) {
  if (!summary) return <span className="text-muted-foreground/50">-</span>;
  if (summary.objectCount === 0) return <span className="text-muted-foreground">No objects</span>;
  if (summary.evaluatedObjectCount === 0 || summary.averageGovernanceScore === null) {
    return <span className="text-muted-foreground">Not evaluated</span>;
  }
  return <Badge variant={scoreVariant(summary.averageGovernanceScore)}>{summary.averageGovernanceScore}</Badge>;
}

function EvaluationCount({ summary }: { summary?: CustomerScopeGovernanceSummaryItem }) {
  if (!summary) return <span className="text-muted-foreground/50">-</span>;
  if (summary.objectCount === 0) return <span className="text-muted-foreground">No objects</span>;
  return (
    <div className="space-y-1">
      <div className="font-medium">{summary.evaluatedObjectCount} / {summary.objectCount}</div>
      {summary.unevaluatedObjectCount > 0 && (
        <div className="text-xs text-muted-foreground">{summary.unevaluatedObjectCount} not evaluated</div>
      )}
    </div>
  );
}

function ReadinessCounts({ summary }: { summary?: CustomerScopeGovernanceSummaryItem }) {
  if (!summary) return <span className="text-muted-foreground/50">-</span>;
  if (summary.objectCount === 0) return <span className="text-muted-foreground">No objects</span>;
  if (summary.evaluatedObjectCount === 0) return <span className="text-muted-foreground">Not evaluated</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      <Badge variant="default" className="text-[10px]">ready: {summary.readyCount}</Badge>
      <Badge variant={summary.notReadyCount > 0 ? "destructive" : "outline"} className="text-[10px]">
        not ready: {summary.notReadyCount}
      </Badge>
    </div>
  );
}

function BlockRecommendationBadge({ summary }: { summary?: CustomerScopeGovernanceSummaryItem }) {
  if (!summary) return <span className="text-muted-foreground/50">-</span>;
  if (summary.objectCount === 0 || summary.evaluatedObjectCount === 0) {
    return <span className="text-muted-foreground">Not evaluated</span>;
  }
  return (
    <Badge variant={summary.blockAutomationRecommendationCount > 0 ? "destructive" : "outline"} className="text-[10px]">
      {summary.blockAutomationRecommendationCount} recommendations
    </Badge>
  );
}

function TopFinding({ summary }: { summary?: CustomerScopeGovernanceSummaryItem }) {
  if (!summary) return <span className="text-muted-foreground/50">-</span>;
  if (summary.objectCount === 0 || summary.evaluatedObjectCount === 0) {
    return <span className="text-muted-foreground">Not evaluated</span>;
  }
  const finding = summary.topFindings[0];
  if (!finding) return <span className="text-muted-foreground">No findings</span>;
  return (
    <div className="space-y-1">
      <Badge variant={finding.severity === "blocker" ? "destructive" : "outline"} className="text-[10px]">
        {finding.count}x {finding.code}
      </Badge>
      <div className="max-w-56 truncate text-xs text-muted-foreground" title={finding.message}>
        {finding.message}
      </div>
    </div>
  );
}

function Section({ icon: Icon, title, children }: { icon: any; title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <div className="rounded-md border border-border/50 px-3 py-1">{children}</div>
    </div>
  );
}

function RawJsonView({ raw }: { raw: Record<string, unknown> }) {
  const [expanded, setExpanded] = useState(false);
  const json = JSON.stringify(raw, null, 2);

  return (
    <div className="space-y-2">
      <pre className={`rounded-md border bg-muted/40 p-3 text-xs overflow-auto ${expanded ? "max-h-none" : "max-h-72"}`}>
        {json}
      </pre>
      {json.length > 1200 && (
        <Button variant="ghost" size="sm" className="w-full text-xs" onClick={() => setExpanded(!expanded)}>
          {expanded ? "Collapse raw payload" : "Show full raw payload"}
        </Button>
      )}
    </div>
  );
}

function CmdbObjectDetailSheet({
  object,
  cmdbId,
  objectType,
  sourceName,
  objectTypeName,
  open,
  onClose,
}: {
  object: NetBoxVmObject | null;
  cmdbId?: string;
  objectType: string;
  sourceName: string;
  objectTypeName: string;
  open: boolean;
  onClose: () => void;
}) {
  const localObjectId = object?.localObjectId ?? object?.cachedVmId;
  const customerAssignmentsQuery = useQuery<CustomerAssignmentsResponse>({
    queryKey: ["/api/cmdbs", cmdbId, "objects", objectType, localObjectId, "customer-assignments"],
    enabled: open && !!cmdbId && !!objectType && !!localObjectId,
  });

  if (!object) return null;
  const tags = tagsFor(object);
  const raw = object.raw ?? {};
  const customFields = object.custom_fields ?? {};
  const assignments = customerAssignmentsQuery.data?.assignments ?? [];

  return (
    <Sheet open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-2xl p-0 flex flex-col" data-testid="sheet-cmdb-object-detail">
        <SheetHeader className="px-6 py-4 border-b">
          <SheetTitle className="flex items-center gap-3">
            <Server className="w-5 h-5 text-muted-foreground shrink-0" />
            <span className="truncate" data-testid="text-cmdb-object-name">{object.name}</span>
            <Badge variant={statusVariant(statusValue(object.status))} className="ml-auto shrink-0">
              {statusLabel(object.status) ?? "unknown"}
            </Badge>
          </SheetTitle>
          <p className="text-xs text-muted-foreground truncate">
            {objectTypeName} from {sourceName}
          </p>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="space-y-5 pb-6">
            <Section icon={Info} title="Core CMDB Data">
              <AttrRow label="Name" value={object.name} />
              <AttrRow label="NetBox ID" value={<span className="font-mono">{object.id}</span>} />
              <AttrRow label="Status" value={<Badge variant={statusVariant(statusValue(object.status))}>{statusLabel(object.status) ?? "unknown"}</Badge>} />
              <AttrRow label="Platform" value={relationName(object.platform)} />
              <AttrRow label="NetBox Tenant (source)" value={relationName(object.tenant)} />
              <AttrRow label="Role" value={relationName(object.role)} />
              <AttrRow label="Cluster" value={relationName(object.cluster)} />
              <AttrRow label="Site" value={relationName(object.site)} />
              <AttrRow label="Last synced/imported" value={formatDate(object.last_synced)} />
            </Section>

            <Section icon={Users} title="Customer Assignment">
              <p className="py-2 text-xs text-muted-foreground">CustomerScope is the business/customer boundary. NetBox Tenant supplies tenant-based customer assignments.</p>
              {!localObjectId ? (
                <div className="py-2 text-xs text-muted-foreground">
                  Customer assignments are available after this VM is imported into the local cache.
                </div>
              ) : customerAssignmentsQuery.isLoading ? (
                <div className="py-2 space-y-2">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-2/3" />
                </div>
              ) : customerAssignmentsQuery.isError ? (
                <div className="py-2 text-xs text-muted-foreground">
                  Customer assignment data is not available for this object.
                </div>
              ) : assignments.length === 0 ? (
                <div className="py-2 text-xs text-muted-foreground">
                  No CustomerScope assignment has been synced for this VM yet.
                </div>
              ) : (
                <div className="py-1 divide-y divide-border/40">
                  {assignments.map((assignment) => (
                    <div key={assignment.id} className="py-2 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={relationshipVariant(assignment.relationship)}>
                          {assignment.relationship}
                        </Badge>
                        {assignment.relationship === "unassigned" && (
                          <span className="inline-flex items-center gap-1 text-xs text-destructive">
                            <TriangleAlert className="h-3.5 w-3.5" />
                            Governance attention
                          </span>
                        )}
                      </div>
                      {assignment.customerScope ? (
                        <>
                          <AttrRow label="CustomerScope" value={assignment.customerScope.displayName ?? assignment.customerScope.name} />
                          <AttrRow label={assignment.customerScope.strategy === "tenant" ? "NetBox Tenant ID" : "External ID"} value={<span className="font-mono">{assignment.customerScope.externalId}</span>} />
                          <AttrRow label="Strategy" value={<Badge variant="outline">{assignment.customerScope.strategy === "tenant" ? "NetBox Tenant" : assignment.customerScope.strategy}</Badge>} />
                          <AttrRow label="Isolation" value={assignment.customerScope.isolation ? <Badge variant="outline">{assignment.customerScope.isolation}</Badge> : undefined} />
                        </>
                      ) : (
                        <AttrRow label="CustomerScope" value={<span className="text-destructive">No CustomerScope assigned</span>} />
                      )}
                      <AttrRow label="Derived from" value={<Badge variant="outline">{netboxCustomerAssignmentSourceLabel(assignment.derivedFrom, assignment.customerScope?.strategy)}</Badge>} />
                      <AttrRow label="Confidence" value={<Badge variant="outline">{assignment.confidence}</Badge>} />
                      <AttrRow label="Last synced" value={formatDate(assignment.lastSyncedAt)} />
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {(object.vcpus || object.memory || object.disk) && (
              <Section icon={Cpu} title="Compute">
                <AttrRow label="vCPUs" value={object.vcpus ? String(object.vcpus) : undefined} />
                <AttrRow label="Memory" value={object.memory ? `${object.memory} MB` : undefined} />
                <AttrRow label="Disk" value={object.disk ? `${object.disk} GB` : undefined} />
              </Section>
            )}

            {primaryIp(object) && (
              <Section icon={Network} title="Network">
                <AttrRow label="Primary IP" value={<span className="font-mono">{primaryIp(object)}</span>} />
              </Section>
            )}

            {tags.length > 0 && (
              <Section icon={Tag} title="Tags">
                <div className="py-2 flex flex-wrap gap-1.5">
                  {tags.map((tag) => (
                    <Badge key={tag} variant="outline" className="text-[10px]">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </Section>
            )}

            {Object.keys(customFields).length > 0 && (
              <Section icon={HardDrive} title="Custom Fields">
                <RawJsonView raw={customFields} />
              </Section>
            )}

            {Object.keys(raw).length > 0 && (
              <Section icon={Layers} title="Raw CMDB Payload">
                <RawJsonView raw={raw} />
              </Section>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default function CmdbDetail() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [refreshOpen, setRefreshOpen] = useState(false);
  const [retryOpen, setRetryOpen] = useState(false);
  const [protocol, setProtocol] = useState<string[]>([]);
  const [retryRunning, setRetryRunning] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedObjectType, setSelectedObjectType] = useState<"netbox_vm">("netbox_vm");
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);

  const { data: cmdbs = [] } = useQuery<CmdbAccount[]>({
    queryKey: ["/api/cmdbs"],
  });
  const cmdb = cmdbs.find((candidate) => candidate.id === id);

  const importSourcesQuery = useQuery<Array<{ id: string; lastImportAt: string | null }>>({
    queryKey: ["/api/governance/netbox-sources"],
    enabled: !!id && cmdb?.kind === "netbox",
  });
  const refreshMutation = useMutation<CmdbRefreshResult, Error>({
    mutationFn: async () => {
      const response = await fetch(`/api/governance/netbox-sources/${encodeURIComponent(id!)}/sync-cached-vms`, {
        method: "POST", credentials: "include",
      });
      if (!response.ok) {
        throw new Error(`Refresh request failed (Rovelink HTTP ${response.status}). ${response.status === 403
          ? "An admin or operator role is required."
          : response.status === 404 ? "The NetBox source is unavailable in this organization."
          : "Check NetBox connectivity, TLS, base URL, and token permissions. For host NetBox from Docker use host.docker.internal; within the demo stack use http://netbox:8080."}`);
      }
      return response.json();
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/cmdbs"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/cmdbs", id] }),
        queryClient.invalidateQueries({ queryKey: ["/api/governance/netbox-sources"] }),
      ]);
    },
  });

  const objectTypesQuery = useQuery<CmdbObjectTypesResponse>({
    queryKey: ["/api/cmdbs", id, "object-types"],
    enabled: !!id,
  });

  const objectsQuery = useQuery<CmdbObjectsResponse>({
    queryKey: ["/api/cmdbs", id, "objects", selectedObjectType],
    queryFn: async ({ signal }) => {
      setProtocol([`${new Date().toISOString()} Request started`]);
      try {
        const response = await fetch(`/api/cmdbs/${encodeURIComponent(id!)}/objects/${selectedObjectType}`, { credentials: "include", signal, cache: "no-store" });
        const body = await response.json();
        setProtocol((steps) => [...steps, `Rovelink HTTP ${response.status}`, ...(Array.isArray(body.diagnostics) ? body.diagnostics : []), response.ok ? 'Completed successfully' : 'Request failed']);
        if (!response.ok) throw new Error(`CMDB request failed (HTTP ${response.status}). Retry to view diagnostics.`);
        return body;
      } catch (error) {
        setProtocol((steps) => [...steps, 'Request ended. If no HTTP result is shown, check connection and server availability.']);
        throw error;
      }
    },
    enabled: !!id && !!selectedObjectType,
  });

  async function retryObjects() {
    if (retryRunning || objectsQuery.isFetching) return;
    setRetryOpen(true);
    setRetryRunning(true);
    try { await objectsQuery.refetch(); }
    finally { setRetryRunning(false); }
  }

  const customerScopeSummaryQuery = useQuery<CustomerScopeSummary>({
    queryKey: ["/api/cmdbs", id, "customer-scope-summary"],
    enabled: !!id,
  });

  const customerScopesQuery = useQuery<CustomerScopeListItem[]>({
    queryKey: ["/api/cmdbs", id, "customer-scopes"],
    enabled: !!id,
  });

  const customerScopeGovernanceSummariesQuery = useQuery<CustomerScopeGovernanceSummariesResponse>({
    queryKey: ["/api/cmdbs", id, "customer-scope-governance-summaries"],
    enabled: !!id,
  });

  const objectDetailQuery = useQuery<CmdbObjectDetailResponse>({
    queryKey: ["/api/cmdbs", id, "objects", selectedObjectType, selectedObjectId],
    enabled: !!id && !!selectedObjectId,
  });

  const objects = objectsQuery.data?.objects ?? [];
  const filtered = useMemo(() => {
    if (!search.trim()) return objects;
    const q = search.toLowerCase();
    return objects.filter((vm) => {
      const fields = [
        vm.name,
        statusLabel(vm.status),
        relationName(vm.platform),
        relationName(vm.cluster),
        relationName(vm.site),
        relationName(vm.tenant),
        relationName(vm.role),
        primaryIp(vm),
      ];
      return fields.some((value) => value?.toLowerCase().includes(q));
    });
  }, [objects, search]);

  const selectedType = objectTypesQuery.data?.objectTypes.find((type) => type.objectType === selectedObjectType);
  const governanceSummariesByScopeId = useMemo(() => {
    const map = new Map<string, CustomerScopeGovernanceSummaryItem>();
    for (const summary of customerScopeGovernanceSummariesQuery.data?.summaries ?? []) {
      map.set(summary.customerScopeId ?? "unassigned", summary);
    }
    return map;
  }, [customerScopeGovernanceSummariesQuery.data?.summaries]);
  const unassignedGovernanceSummary = governanceSummariesByScopeId.get("unassigned");
  const customerScopeRows = customerScopesQuery.data ?? [];
  const showCustomerScopeTable = customerScopeRows.length > 0 || Boolean(unassignedGovernanceSummary);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/cmdbs">
            <ArrowLeft className="w-4 h-4" />
          </Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-3xl font-bold">{cmdb?.name ?? "CMDB"}</h1>
          <p className="text-muted-foreground">
            Browse CMDB object data from this source.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => { refreshMutation.reset(); setRefreshOpen(true); }}
          disabled={refreshMutation.isPending || objectsQuery.isFetching || objectTypesQuery.isFetching || cmdb?.kind !== "netbox"}
          data-testid="button-refresh-cmdb-objects"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
          {refreshMutation.isPending ? "Refreshing CMDB…" : "Refresh"}
        </Button>
      </div>

      <Dialog open={refreshOpen} onOpenChange={setRefreshOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{refreshMutation.isSuccess ? "CMDB refresh completed" : refreshMutation.isError ? "CMDB refresh failed" : refreshMutation.isPending ? "Refreshing CMDB…" : "Refresh CMDB source?"}</DialogTitle>
            <DialogDescription>
              Read the latest virtual machines from {cmdb?.name ?? "this NetBox source"} into Rovelink's cached CMDB/reference inventory.
              This does not write to NetBox or providers. NetBox Tenant assignments may update CustomerScopes and customer assignments.
              No provider sync, drift comparison, Governance evaluation, or automation/GATE action will run.
            </DialogDescription>
          </DialogHeader>
          {refreshMutation.isPending && <p role="status" className="flex items-center gap-2 text-sm"><RefreshCw className="h-4 w-4 animate-spin" />Reading NetBox and updating the local cache…</p>}
          {refreshMutation.isSuccess && (
            <div role="status" className="space-y-2 text-sm">
              <p>{refreshMutation.data.importedCount === 0 ? "Refresh completed. No virtual machines were returned by this CMDB source." : `${refreshMutation.data.importedCount} virtual machines imported/upserted.`}</p>
              <p>CustomerScopes updated: {refreshMutation.data.customerScopesUpserted}. Assignments updated: {refreshMutation.data.customerAssignmentsUpserted}. Unassigned VMs in this import: {refreshMutation.data.customerUnassignedCount}.</p>
              <p>Latest import: {formatDate(refreshMutation.data.lastImportAt) ?? "Completed"}</p>
              {refreshMutation.data.customerScopeResolutionErrors > 0 && <p className="text-amber-600">{refreshMutation.data.customerScopeResolutionErrors} VM customer assignments could not be resolved. VM import completed; review assignments before relying on them.</p>}
            </div>
          )}
          {refreshMutation.isError && <p role="alert" className="text-sm text-destructive">{refreshMutation.error.message.includes("Refresh request failed") ? refreshMutation.error.message : "Could not complete the refresh request. Check your connection and server availability."}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setRefreshOpen(false)}>{refreshMutation.isPending || refreshMutation.isSuccess || refreshMutation.isError ? "Close" : "Cancel"}</Button>
            {!refreshMutation.isSuccess && <Button onClick={() => refreshMutation.mutate()} disabled={refreshMutation.isPending} data-testid="button-confirm-cmdb-refresh">{refreshMutation.isPending ? "Refreshing CMDB…" : refreshMutation.isError ? "Retry refresh" : "Refresh CMDB"}</Button>}
          </div>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" />
            Customer Scopes
          </CardTitle>
          <CardDescription>
            Customer/environment boundaries synchronized from this CMDB source.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {customerScopeSummaryQuery.isError || customerScopesQuery.isError ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm">
              <p className="font-medium text-destructive">Failed to load CustomerScopes</p>
              <p className="text-muted-foreground">
                CustomerScope visibility is unavailable for this CMDB right now.
              </p>
            </div>
          ) : customerScopeSummaryQuery.isLoading || customerScopesQuery.isLoading ? (
            <div className="space-y-3">
              <div className="grid gap-3 md:grid-cols-4">
                {Array.from({ length: 4 }).map((_, index) => (
                  <Skeleton key={index} className="h-20 w-full" />
                ))}
              </div>
              <Skeleton className="h-24 w-full" />
            </div>
          ) : (
            <>
              <div className="grid gap-3 md:grid-cols-4">
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">CustomerScopes</p>
                  <p className="text-2xl font-semibold">{customerScopeSummaryQuery.data?.customerScopeCount ?? 0}</p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">Assigned Objects</p>
                  <p className="text-2xl font-semibold">{customerScopeSummaryQuery.data?.assignedObjectCount ?? 0}</p>
                </div>
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
                  <p className="text-xs text-muted-foreground">Unassigned Objects</p>
                  <p className="text-2xl font-semibold text-destructive">{customerScopeSummaryQuery.data?.unassignedObjectCount ?? 0}</p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">Latest Sync</p>
                  <p className="text-sm font-medium">{formatDate(importSourcesQuery.data?.find(source => source.id === id)?.lastImportAt ?? customerScopeSummaryQuery.data?.latestLastSyncedAt) ?? "-"}</p>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-md border p-3 space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Relationships</p>
                  <CountBadges counts={customerScopeSummaryQuery.data?.relationshipCounts} />
                </div>
                <div className="rounded-md border p-3 space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Confidence</p>
                  <CountBadges counts={customerScopeSummaryQuery.data?.confidenceCounts} />
                </div>
              </div>

              {customerScopeGovernanceSummariesQuery.isError && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
                  Governance summaries could not be loaded.
                </div>
              )}

              {customerScopeGovernanceSummariesQuery.isLoading && (
                <div className="rounded-md border p-3 text-sm text-muted-foreground">
                  Loading governance summaries...
                </div>
              )}

              {!showCustomerScopeTable ? (
                <div className="rounded-md border p-8 text-center text-sm text-muted-foreground">
                  No CustomerScopes synced yet. Sync cached VMs to discover NetBox tenants.
                </div>
              ) : (
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/40">
                        <th className="text-left px-4 py-3 font-medium">Name</th>
                        <th className="text-left px-4 py-3 font-medium">Strategy</th>
                        <th className="text-left px-4 py-3 font-medium">Isolation</th>
                        <th className="text-left px-4 py-3 font-medium">Assignments</th>
                        <th className="text-left px-4 py-3 font-medium">Relationships</th>
                        <th className="text-left px-4 py-3 font-medium">Objects</th>
                        <th className="text-left px-4 py-3 font-medium">Evaluated</th>
                        <th className="text-left px-4 py-3 font-medium">Avg score</th>
                        <th className="text-left px-4 py-3 font-medium">Ready / Not ready</th>
                        <th className="text-left px-4 py-3 font-medium">Block recommendations</th>
                        <th className="text-left px-4 py-3 font-medium">Top finding</th>
                        <th className="text-left px-4 py-3 font-medium">Last synced</th>
                        <th className="text-left px-4 py-3 font-medium">Last evaluated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customerScopeRows.map((scope) => {
                        const governanceSummary = governanceSummariesByScopeId.get(scope.id);
                        return (
                          <tr key={scope.id} className="border-b last:border-0">
                            <td className="px-4 py-3">
                              <div className="font-medium">{scope.displayName ?? scope.name}</div>
                              <div className="text-xs text-muted-foreground font-mono">{scope.externalId}</div>
                            </td>
                            <td className="px-4 py-3">
                              <Badge variant="outline">{scope.strategy === "tenant" ? "NetBox Tenant" : scope.strategy}</Badge>
                            </td>
                            <td className="px-4 py-3">
                              {scope.isolation ? <Badge variant="outline">{scope.isolation}</Badge> : <span className="text-muted-foreground/50">-</span>}
                            </td>
                            <td className="px-4 py-3 font-medium">{scope.assignmentCount}</td>
                            <td className="px-4 py-3">
                              <CountBadges counts={scope.relationshipCounts} />
                            </td>
                            <td className="px-4 py-3">
                              {governanceSummary?.objectCount === 0 ? (
                                <span className="text-muted-foreground">No objects</span>
                              ) : (
                                <span className="font-medium">{governanceSummary?.objectCount ?? "-"}</span>
                              )}
                            </td>
                            <td className="px-4 py-3"><EvaluationCount summary={governanceSummary} /></td>
                            <td className="px-4 py-3"><ScoreBadge summary={governanceSummary} /></td>
                            <td className="px-4 py-3"><ReadinessCounts summary={governanceSummary} /></td>
                            <td className="px-4 py-3"><BlockRecommendationBadge summary={governanceSummary} /></td>
                            <td className="px-4 py-3"><TopFinding summary={governanceSummary} /></td>
                            <td className="px-4 py-3 text-muted-foreground">{formatDate(scope.lastSyncedAt) ?? "-"}</td>
                            <td className="px-4 py-3 text-muted-foreground">{formatDate(governanceSummary?.latestEvaluatedAt) ?? (governanceSummary?.objectCount ? "Not evaluated" : "-")}</td>
                          </tr>
                        );
                      })}
                      {unassignedGovernanceSummary && (
                        <tr className="border-b last:border-0 border-destructive/20 bg-destructive/5">
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium text-destructive">Unassigned</span>
                              <Badge variant="destructive" className="gap-1">
                                <TriangleAlert className="h-3 w-3" />
                                Attention
                              </Badge>
                            </div>
                            <div className="max-w-72 text-xs text-muted-foreground">
                              Objects with no CustomerScope assignment.
                            </div>
                          </td>
                          <td className="px-4 py-3"><span className="text-muted-foreground/50">-</span></td>
                          <td className="px-4 py-3"><span className="text-muted-foreground/50">-</span></td>
                          <td className="px-4 py-3 font-medium">{unassignedGovernanceSummary.unassignedObjectCount}</td>
                          <td className="px-4 py-3">
                            <Badge variant="destructive" className="text-[10px]">unassigned: {unassignedGovernanceSummary.unassignedObjectCount}</Badge>
                          </td>
                          <td className="px-4 py-3 font-medium">{unassignedGovernanceSummary.objectCount}</td>
                          <td className="px-4 py-3"><EvaluationCount summary={unassignedGovernanceSummary} /></td>
                          <td className="px-4 py-3"><ScoreBadge summary={unassignedGovernanceSummary} /></td>
                          <td className="px-4 py-3"><ReadinessCounts summary={unassignedGovernanceSummary} /></td>
                          <td className="px-4 py-3"><BlockRecommendationBadge summary={unassignedGovernanceSummary} /></td>
                          <td className="px-4 py-3"><TopFinding summary={unassignedGovernanceSummary} /></td>
                          <td className="px-4 py-3 text-muted-foreground">{formatDate(customerScopeSummaryQuery.data?.latestLastSyncedAt) ?? "-"}</td>
                          <td className="px-4 py-3 text-muted-foreground">{formatDate(unassignedGovernanceSummary.latestEvaluatedAt) ?? (unassignedGovernanceSummary.objectCount ? "Not evaluated" : "-")}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                  <div className="border-t bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
                    Block recommendations are governance outputs. Actual blocking depends on Automation Inventory enforcement settings.
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="w-5 h-5" />
            Objects
          </CardTitle>
          <CardDescription>
            Select an available object type, then inspect individual CMDB records.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {objectTypesQuery.isError ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm">
              <p className="font-medium text-destructive">Failed to load object types</p>
              <p className="text-muted-foreground">{(objectTypesQuery.error as Error).message}</p>
            </div>
          ) : objectTypesQuery.isLoading ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-28 w-full" />
              ))}
            </div>
          ) : objectTypesQuery.data?.objectTypes.length ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {objectTypesQuery.data.objectTypes.map((type) => (
                <button
                  key={type.objectType}
                  type="button"
                  onClick={() => {
                    setSelectedObjectType(type.objectType);
                    setSelectedObjectId(null);
                  }}
                  className={`text-left rounded-lg border p-4 transition-colors hover:bg-accent ${
                    selectedObjectType === type.objectType ? "border-primary bg-primary/5" : "border-border"
                  }`}
                  data-testid={`card-cmdb-object-type-${type.objectType}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 font-semibold">
                        <Box className="w-4 h-4 text-muted-foreground" />
                        {type.name}
                      </div>
                      <p className="text-xs text-muted-foreground">{type.description}</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Badge variant="outline">{type.count ?? "Live"} objects</Badge>
                    <Badge variant={type.status === "cached" ? "secondary" : "outline"}>{type.status}</Badge>
                    <Badge variant="outline">{type.mode}</Badge>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="rounded-md border p-8 text-center text-muted-foreground">
              No supported object types are available for this CMDB source.
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Server className="w-5 h-5" />
                {selectedType?.name ?? objectsQuery.data?.objectTypeName ?? "Objects"}
              </CardTitle>
              <CardDescription>
                {objectsQuery.isLoading
                  ? "Loading..."
                  : `${filtered.length} of ${objects.length} records`}
                {objectsQuery.data?.mode && (
                  <Badge variant="outline" className="ml-2 align-middle">{objectsQuery.data.mode}</Badge>
                )}
              </CardDescription>
            </div>
            <div className="relative w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search CMDB objects..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="pl-9"
                data-testid="input-search-cmdb-objects"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Dialog open={retryOpen} onOpenChange={setRetryOpen}>
            <DialogContent className="max-w-3xl">
              <DialogHeader>
                <DialogTitle>CMDB retry protocol</DialogTitle>
                <DialogDescription>Request steps and results. Credentials, headers, URLs, and response bodies are excluded.</DialogDescription>
              </DialogHeader>
              <pre role="log" aria-live="polite" className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-4 text-xs">{protocol.join("\n")}</pre>
              <Button onClick={retryObjects} disabled={retryRunning || objectsQuery.isFetching}>{retryRunning ? "Retrying…" : "Retry again"}</Button>
            </DialogContent>
          </Dialog>
          {objectsQuery.isError ? (
            <div className="p-8 text-center text-destructive space-y-2">
              <p className="font-medium">Failed to load CMDB objects</p>
              <p className="text-sm text-muted-foreground">{(objectsQuery.error as Error).message}</p>
              <Button variant="outline" size="sm" onClick={retryObjects} disabled={objectsQuery.isFetching || retryRunning}>
                {objectsQuery.isFetching ? "Retrying…" : "Retry"}
              </Button>
            </div>
          ) : objectsQuery.isLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 8 }).map((_, index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              {search ? "No CMDB objects match your search." : "No objects found for this type."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="text-left px-4 py-3 font-medium">Name</th>
                    <th className="text-left px-4 py-3 font-medium">Status</th>
                    <th className="text-left px-4 py-3 font-medium">Platform</th>
                    <th className="text-left px-4 py-3 font-medium">Primary IP</th>
                    <th className="text-left px-4 py-3 font-medium">NetBox Tenant (source)</th>
                    <th className="text-left px-4 py-3 font-medium">Role</th>
                    <th className="text-left px-4 py-3 font-medium">Cluster / Site</th>
                    <th className="text-left px-4 py-3 font-medium">Last synced/imported</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((vm) => (
                    <tr
                      key={vm.id}
                      className="border-b hover-elevate cursor-pointer"
                      onClick={() => setSelectedObjectId(String(vm.id))}
                      data-testid={`row-cmdb-object-${vm.id}`}
                    >
                      <td className="px-4 py-3 font-medium" data-testid={`text-cmdb-object-name-${vm.id}`}>
                        {vm.name}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={statusVariant(statusValue(vm.status))}>
                          {statusLabel(vm.status) ?? "unknown"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {relationName(vm.platform) ?? <span className="text-muted-foreground/50">-</span>}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {primaryIp(vm) ?? <span className="text-muted-foreground/50">-</span>}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {relationName(vm.tenant) ?? <span className="text-muted-foreground/50">-</span>}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {relationName(vm.role) ?? <span className="text-muted-foreground/50">-</span>}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {relationName(vm.cluster) ?? relationName(vm.site) ?? <span className="text-muted-foreground/50">-</span>}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {formatDate(vm.last_synced) ?? <span className="text-muted-foreground/50">-</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <CmdbObjectDetailSheet
        object={objectDetailQuery.data?.object ?? null}
        cmdbId={id}
        objectType={selectedObjectType}
        sourceName={objectDetailQuery.data?.source.name ?? cmdb?.name ?? "CMDB"}
        objectTypeName={objectDetailQuery.data?.objectTypeName ?? "CMDB object"}
        open={!!selectedObjectId}
        onClose={() => setSelectedObjectId(null)}
      />
    </div>
  );
}

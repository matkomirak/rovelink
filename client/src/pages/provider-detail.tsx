import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  ArrowLeft, Server, Cpu, HardDrive, MemoryStick, Network,
  Search, Filter, RefreshCw, Tag, ChevronRight,
  Info, Layers, Box, TriangleAlert
} from "lucide-react";
import { useState, useMemo } from "react";
import type { ProviderAccount } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface NormalizedVM {
  externalId: string;
  name: string;
  provider: string;
  status?: string;
  platform?: string;
  description?: string;
  vcpus?: number;
  memory?: number;
  disk?: number;
  primaryIp4?: string;
  primaryIp6?: string;
  ipv4?: string[];
  ipv6?: string[];
  tags?: string[];
  tenant?: string;
  site?: string;
  role?: string;
  raw?: Record<string, unknown>;
}

interface ProviderVmsResponse {
  provider: { id: string; name: string; kind: string };
  vms: NormalizedVM[];
}

interface ProviderInventoryObjectType {
  objectType: string;
  label: string;
  count: number;
  lastSyncedAt: string | null;
}

interface ProviderInventoryObjectTypesResponse {
  sourceId: string;
  providerType: string;
  objectTypes: ProviderInventoryObjectType[];
}

interface ProviderInventoryObject {
  id: string;
  providerType?: string;
  objectType: string;
  externalId: string;
  providerNativeId: string | null;
  name: string | null;
  displayName: string | null;
  region: string | null;
  zone: string | null;
  cluster: string | null;
  node: string | null;
  lifecycleState: string | null;
  powerState: string | null;
  tags: unknown;
  labels: unknown;
  metadata?: unknown;
  lastSyncedAt: string | null;
  customerScopeCandidateCount: number;
  customerScopeCandidates?: ProviderCustomerScopeCandidate[];
  relationships?: unknown[];
}

interface ProviderInventoryObjectsResponse {
  sourceId: string;
  providerType: string;
  objectType: string | null;
  objects: ProviderInventoryObject[];
}

interface ProviderCustomerScopeCandidate {
  id: string;
  derivedFrom: string;
  candidateValue: string;
  confidence: string;
  metadata: unknown;
  lastSyncedAt: string | null;
}

// ─── VM Detail Sheet ──────────────────────────────────────────────────────────

function AttrRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === undefined || value === null || value === "" || value === "—") return null;
  return (
    <div className="flex gap-3 py-2 border-b border-border/40 last:border-0">
      <span className="text-xs text-muted-foreground w-44 shrink-0 pt-0.5">{label}</span>
      <span className="text-xs flex-1 break-all">{value}</span>
    </div>
  );
}

function formatDateValue(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function unknownToRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function unknownToTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((tag) => String(tag)).filter(Boolean);
}

function Section({ icon: Icon, title, children }: { icon: any; title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <div className="rounded-md border border-border/50 px-3 py-1">
        {children}
      </div>
    </div>
  );
}

function InventoryObjectDetailSheet({
  providerId,
  objectId,
  open,
  onClose,
}: {
  providerId?: string;
  objectId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const detailQuery = useQuery<ProviderInventoryObject>({
    queryKey: ["/api/providers", providerId, "inventory/objects", objectId],
    enabled: open && !!providerId && !!objectId,
  });

  const object = detailQuery.data;
  const displayName = object?.displayName || object?.name || object?.externalId || "Infrastructure Object";
  const tags = unknownToTags(object?.tags);
  const labels = unknownToRecord(object?.labels);
  const metadata = unknownToRecord(object?.metadata);
  const candidates = object?.customerScopeCandidates ?? [];

  return (
    <Sheet open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-2xl p-0 flex flex-col" data-testid="sheet-provider-inventory-object">
        <SheetHeader className="px-6 py-4 border-b">
          <SheetTitle className="flex items-center gap-3">
            <Box className="w-5 h-5 text-muted-foreground shrink-0" />
            <span className="truncate" data-testid="text-provider-inventory-object-name">{displayName}</span>
            {object?.objectType && <Badge variant="outline" className="ml-auto shrink-0">{object.objectType}</Badge>}
          </SheetTitle>
          <p className="text-xs text-muted-foreground">
            Cached provider inventory uses local object id <span className="font-mono">{objectId}</span>.
          </p>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {detailQuery.isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : detailQuery.isError ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm">
              <p className="font-medium text-destructive">Failed to load provider inventory object</p>
              <p className="text-muted-foreground">{(detailQuery.error as Error).message}</p>
            </div>
          ) : object ? (
            <div className="space-y-5 pb-6">
              <Section icon={Info} title="Observed Runtime Object">
                <AttrRow label="Display Name" value={object.displayName || object.name} />
                <AttrRow label="Object Type" value={<Badge variant="outline">{object.objectType}</Badge>} />
                <AttrRow label="Provider Type" value={<Badge variant="outline">{object.providerType}</Badge>} />
                <AttrRow label="External ID" value={<span className="font-mono">{object.externalId}</span>} />
                <AttrRow label="Provider Native ID" value={object.providerNativeId ? <span className="font-mono">{object.providerNativeId}</span> : undefined} />
                <AttrRow label="Region" value={object.region} />
                <AttrRow label="Zone" value={object.zone} />
                <AttrRow label="Cluster" value={object.cluster} />
                <AttrRow label="Node" value={object.node} />
                <AttrRow label="Lifecycle State" value={object.lifecycleState} />
                <AttrRow label="Power State" value={object.powerState} />
                <AttrRow label="Last Synced" value={formatDateValue(object.lastSyncedAt)} />
              </Section>

              {tags.length > 0 && (
                <Section icon={Tag} title="Tags">
                  <div className="py-2 flex flex-wrap gap-1.5">
                    {tags.map((tag, index) => (
                      <Badge key={`${tag}-${index}`} variant="outline" className="text-[10px]">{tag}</Badge>
                    ))}
                  </div>
                </Section>
              )}

              {Object.keys(labels).length > 0 && (
                <Section icon={Tag} title="Labels">
                  <RawDataView raw={labels} />
                </Section>
              )}

              {Object.keys(metadata).length > 0 && (
                <Section icon={Layers} title="Metadata">
                  <RawDataView raw={metadata} />
                </Section>
              )}

              <Section icon={TriangleAlert} title="CustomerScope Candidate Hints">
                <div className="py-2 space-y-3">
                  <p className="text-xs text-muted-foreground">
                    These are provider-derived hints only. They do not create authoritative CustomerScope assignments.
                  </p>
                  {candidates.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No CustomerScope candidate hints were found for this object.</p>
                  ) : (
                    <div className="space-y-2">
                      {candidates.map((candidate) => (
                        <div key={candidate.id} className="rounded-md border border-border/50 p-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline">{candidate.derivedFrom}</Badge>
                            <span className="text-sm font-medium">{candidate.candidateValue}</span>
                            <Badge variant="secondary" className="text-[10px]">{candidate.confidence}</Badge>
                          </div>
                          <div className="mt-2 text-xs text-muted-foreground">
                            Last synced: {formatDateValue(candidate.lastSyncedAt)}
                          </div>
                          {Object.keys(unknownToRecord(candidate.metadata)).length > 0 && (
                            <div className="mt-2">
                              <RawDataView raw={unknownToRecord(candidate.metadata)} />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </Section>

              <Section icon={Network} title="Relationships">
                <div className="py-2 text-xs text-muted-foreground">
                  Relationships are not populated yet.
                </div>
              </Section>
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function RawDataView({ raw }: { raw: Record<string, unknown> }) {
  const [expanded, setExpanded] = useState(false);

  const flattenObject = (obj: Record<string, unknown>, prefix = ""): Array<{ key: string; value: string }> => {
    const rows: Array<{ key: string; value: string }> = [];
    for (const [k, v] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${k}` : k;
      if (v !== null && v !== undefined && typeof v === "object" && !Array.isArray(v)) {
        rows.push(...flattenObject(v as Record<string, unknown>, fullKey));
      } else {
        const val = Array.isArray(v) ? v.join(", ") : String(v ?? "");
        if (val && val !== "undefined" && val !== "null") {
          rows.push({ key: fullKey, value: val });
        }
      }
    }
    return rows;
  };

  const rows = flattenObject(raw);
  const visible = expanded ? rows : rows.slice(0, 15);

  return (
    <div className="space-y-1">
      <div className="rounded-md border border-border/50 px-3 py-1">
        {visible.map(({ key, value }) => (
          <div key={key} className="flex gap-3 py-1.5 border-b border-border/30 last:border-0">
            <span className="text-xs text-muted-foreground font-mono w-52 shrink-0 truncate" title={key}>{key}</span>
            <span className="text-xs font-mono flex-1 break-all text-foreground/80">{value}</span>
          </div>
        ))}
      </div>
      {rows.length > 15 && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-xs"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Show less" : `Show ${rows.length - 15} more fields`}
        </Button>
      )}
    </div>
  );
}

function VmDetailSheet({ vm, open, onClose }: { vm: NormalizedVM | null; open: boolean; onClose: () => void }) {
  if (!vm) return null;

  const getStatusColor = (status?: string) => {
    switch (status) {
      case "running": return "bg-green-500/10 text-green-500 border-green-500/20";
      case "stopped": return "bg-gray-500/10 text-gray-500 border-gray-500/20";
      case "paused": return "bg-yellow-500/10 text-yellow-500 border-yellow-500/20";
      default: return "";
    }
  };

  const allIps = [
    ...(vm.primaryIp4 ? [vm.primaryIp4] : []),
    ...(vm.ipv4?.filter(ip => ip !== vm.primaryIp4) || []),
    ...(vm.primaryIp6 ? [vm.primaryIp6] : []),
    ...(vm.ipv6?.filter(ip => ip !== vm.primaryIp6) || []),
  ];

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl p-0 flex flex-col"
        data-testid="sheet-vm-detail"
      >
        <SheetHeader className="px-6 py-4 border-b">
          <SheetTitle className="flex items-center gap-3">
            <Server className="w-5 h-5 text-muted-foreground shrink-0" />
            <span className="truncate" data-testid="text-sheet-vm-name">{vm.name}</span>
            <Badge className={`ml-auto shrink-0 ${getStatusColor(vm.status)}`}>
              {vm.status || "unknown"}
            </Badge>
          </SheetTitle>
          <p className="text-xs text-muted-foreground font-mono truncate" data-testid="text-sheet-vm-extid">
            {vm.externalId}
          </p>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="space-y-5 pb-6">

            {/* Core Identity */}
            <Section icon={Info} title="Core Information">
              <AttrRow label="Name" value={vm.name} />
              <AttrRow label="External ID" value={<span className="font-mono">{vm.externalId}</span>} />
              <AttrRow label="Provider" value={vm.provider} />
              <AttrRow label="Status" value={
                <Badge className={`text-[10px] ${getStatusColor(vm.status)}`}>{vm.status || "unknown"}</Badge>
              } />
              <AttrRow label="Platform" value={vm.platform} />
              <AttrRow label="Site / Location" value={vm.site} />
              <AttrRow label="Tenant" value={vm.tenant} />
              <AttrRow label="Role" value={vm.role} />
              <AttrRow label="Description" value={vm.description} />
            </Section>

            {/* Compute */}
            {(vm.vcpus || vm.memory || vm.disk) && (
              <Section icon={Cpu} title="Compute">
                <AttrRow label="vCPUs" value={vm.vcpus ? String(vm.vcpus) : undefined} />
                <AttrRow label="Memory" value={vm.memory ? `${vm.memory} MB` : undefined} />
                <AttrRow label="Disk" value={vm.disk ? `${vm.disk} GB` : undefined} />
              </Section>
            )}

            {/* Networking */}
            {allIps.length > 0 && (
              <Section icon={Network} title="Network">
                {vm.primaryIp4 && (
                  <AttrRow label="Primary IPv4" value={<span className="font-mono">{vm.primaryIp4}</span>} />
                )}
                {vm.ipv4?.filter(ip => ip !== vm.primaryIp4).map((ip, i) => (
                  <AttrRow key={i} label={`IPv4 #${i + 2}`} value={<span className="font-mono">{ip}</span>} />
                ))}
                {vm.primaryIp6 && (
                  <AttrRow label="Primary IPv6" value={<span className="font-mono text-[10px]">{vm.primaryIp6}</span>} />
                )}
                {vm.ipv6?.filter(ip => ip !== vm.primaryIp6).map((ip, i) => (
                  <AttrRow key={i} label={`IPv6 #${i + 2}`} value={<span className="font-mono text-[10px]">{ip}</span>} />
                ))}
              </Section>
            )}

            {/* Tags */}
            {vm.tags && vm.tags.length > 0 && (
              <Section icon={Tag} title="Tags">
                <div className="py-2 flex flex-wrap gap-1.5">
                  {vm.tags.map((tag, i) => (
                    <Badge key={i} variant="outline" className="text-[10px]" data-testid={`badge-vm-tag-${i}`}>
                      {tag}
                    </Badge>
                  ))}
                </div>
              </Section>
            )}

            {/* Raw Provider Data */}
            {vm.raw && Object.keys(vm.raw).length > 0 && (
              <Section icon={Layers} title="All Provider Attributes">
                <RawDataView raw={vm.raw} />
              </Section>
            )}

          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ProviderDetail() {
  const { id } = useParams<{ id: string }>();
  const [searchTerm, setSearchTerm] = useState("");
  const [inventorySearchTerm, setInventorySearchTerm] = useState("");
  const [platformFilter, setPlatformFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [selectedInventoryObjectType, setSelectedInventoryObjectType] = useState<string | null>(null);
  const [selectedInventoryObjectId, setSelectedInventoryObjectId] = useState<string | null>(null);
  const [selectedVm, setSelectedVm] = useState<NormalizedVM | null>(null);
  const { toast } = useToast();

  const { data: provider, isLoading: providerLoading } = useQuery<ProviderAccount>({
    queryKey: ["/api/providers", id],
  });

  const { data: vmsData, isLoading: vmsLoading } = useQuery<ProviderVmsResponse>({
    queryKey: ["/api/providers", id, "vms"],
    enabled: !!id,
  });

  const { data: inventoryObjectTypes, isLoading: objectTypesLoading, isError: objectTypesError, error: objectTypesLoadError } = useQuery<ProviderInventoryObjectTypesResponse>({
    queryKey: ["/api/providers", id, "inventory/object-types"],
    enabled: !!id,
  });

  const effectiveInventoryObjectType = selectedInventoryObjectType ?? inventoryObjectTypes?.objectTypes[0]?.objectType ?? null;

  const { data: inventoryObjects, isLoading: inventoryObjectsLoading, isError: inventoryObjectsError, error: inventoryObjectsLoadError } = useQuery<ProviderInventoryObjectsResponse>({
    queryKey: ["/api/providers", id, "inventory/objects", effectiveInventoryObjectType ? `objectType=${effectiveInventoryObjectType}` : ""],
    enabled: !!id && !!effectiveInventoryObjectType,
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/providers/${id}/sync`);
    },
    onSuccess: async (response) => {
      const data = await response.json();
      toast({
        title: "Sync Started",
        description: `Sync run ${data.runId} has been queued`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/providers", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/providers", id, "vms"] });
    },
    onError: (error: any) => {
      toast({
        title: "Sync Failed",
        description: error.message || "Failed to start sync",
        variant: "destructive",
      });
    },
  });

  const inventorySyncMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/providers/${id}/inventory/sync`);
    },
    onSuccess: async (response) => {
      const data = await response.json();
      queryClient.invalidateQueries({ queryKey: ["/api/providers", id, "inventory/object-types"] });
      queryClient.invalidateQueries({ queryKey: ["/api/providers", id, "inventory/objects"] });
      toast({
        title: "Cached Inventory Synced",
        description: `Upserted ${data.objectsUpserted ?? 0} observed runtime objects. No CMDB or cloud provider writes were performed.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Inventory Sync Failed",
        description: error.message || "Failed to sync cached provider inventory",
        variant: "destructive",
      });
    },
  });

  const filteredVms = useMemo(() => {
    if (!vmsData?.vms) return [];
    return vmsData.vms.filter(vm => {
      const matchesSearch = searchTerm === "" ||
        vm.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        vm.ipv4?.some(ip => ip.includes(searchTerm)) ||
        vm.externalId.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesPlatform = !platformFilter || vm.platform === platformFilter;
      const matchesStatus = !statusFilter || vm.status === statusFilter;
      return matchesSearch && matchesPlatform && matchesStatus;
    });
  }, [vmsData?.vms, searchTerm, platformFilter, statusFilter]);

  const platforms = useMemo(() => {
    if (!vmsData?.vms) return [];
    return Array.from(new Set(vmsData.vms.map(vm => vm.platform).filter((p): p is string => Boolean(p))));
  }, [vmsData?.vms]);

  const statuses = useMemo(() => {
    if (!vmsData?.vms) return [];
    return Array.from(new Set(vmsData.vms.map(vm => vm.status).filter((s): s is string => Boolean(s))));
  }, [vmsData?.vms]);

  const stats = useMemo(() => {
    if (!vmsData?.vms) return { total: 0, linux: 0, windows: 0, running: 0, stopped: 0 };
    const vms = vmsData.vms;
    return {
      total: vms.length,
      linux: vms.filter(vm => vm.platform?.toLowerCase() === "linux").length,
      windows: vms.filter(vm => vm.platform?.toLowerCase() === "windows").length,
      running: vms.filter(vm => vm.status === "running").length,
      stopped: vms.filter(vm => vm.status === "stopped").length,
    };
  }, [vmsData?.vms]);

  const filteredInventoryObjects = useMemo(() => {
    const objects = inventoryObjects?.objects ?? [];
    const query = inventorySearchTerm.trim().toLowerCase();
    if (!query) return objects;
    return objects.filter((object) => {
      const haystack = [
        object.name,
        object.displayName,
        object.objectType,
        object.externalId,
        object.providerNativeId,
        object.region,
        object.zone,
        object.cluster,
        object.node,
        object.lifecycleState,
        object.powerState,
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(query);
    });
  }, [inventoryObjects?.objects, inventorySearchTerm]);

  const formatBytes = (bytes: number | undefined, unit: "MB" | "GB" = "MB") => {
    if (!bytes) return "—";
    if (unit === "GB") return `${bytes} GB`;
    return `${bytes} MB`;
  };

  const getStatusBadge = (status: string | undefined) => {
    switch (status) {
      case "running":
        return <Badge className="bg-green-500/10 text-green-500 border-green-500/20">Running</Badge>;
      case "stopped":
        return <Badge className="bg-gray-500/10 text-gray-500 border-gray-500/20">Stopped</Badge>;
      case "paused":
        return <Badge className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">Paused</Badge>;
      default:
        return <Badge variant="outline">{status || "Unknown"}</Badge>;
    }
  };

  const getPlatformBadge = (platform: string | undefined) => {
    const p = platform?.toLowerCase();
    switch (p) {
      case "linux":
        return <Badge variant="outline" className="text-orange-500 border-orange-500/30">Linux</Badge>;
      case "windows":
        return <Badge variant="outline" className="text-blue-500 border-blue-500/30">Windows</Badge>;
      default:
        return <Badge variant="outline">{platform || "Unknown"}</Badge>;
    }
  };

  if (providerLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  if (!provider) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="p-12 text-center">
            <p className="text-muted-foreground">Provider not found</p>
            <Link href="/providers">
              <Button variant="outline" className="mt-4">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Providers
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-4">
          <Link href="/providers">
            <Button variant="ghost" size="icon" data-testid="button-back">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold" data-testid="text-provider-name">{provider.name}</h1>
            <div className="text-muted-foreground flex items-center gap-2 flex-wrap mt-1">
              <Badge variant="outline">{provider.kind}</Badge>
              {provider.enabled ? (
                <Badge className="bg-green-500/10 text-green-500 border-green-500/20">Enabled</Badge>
              ) : (
                <Badge variant="secondary">Disabled</Badge>
              )}
            </div>
          </div>
        </div>
        <Button
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending}
          data-testid="button-sync-provider"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${syncMutation.isPending ? "animate-spin" : ""}`} />
          Sync Now
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-5 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Server className="w-8 h-8 text-muted-foreground" />
            <div>
              <p className="text-2xl font-bold" data-testid="text-total-vms">{stats.total}</p>
              <p className="text-xs text-muted-foreground">Total VMs</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-orange-500/10 flex items-center justify-center">
              <span className="text-orange-500 text-sm font-bold">L</span>
            </div>
            <div>
              <p className="text-2xl font-bold" data-testid="text-linux-count">{stats.linux}</p>
              <p className="text-xs text-muted-foreground">Linux</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center">
              <span className="text-blue-500 text-sm font-bold">W</span>
            </div>
            <div>
              <p className="text-2xl font-bold" data-testid="text-windows-count">{stats.windows}</p>
              <p className="text-xs text-muted-foreground">Windows</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-green-500" />
            <div>
              <p className="text-2xl font-bold" data-testid="text-running-count">{stats.running}</p>
              <p className="text-xs text-muted-foreground">Running</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-gray-500" />
            <div>
              <p className="text-2xl font-bold" data-testid="text-stopped-count">{stats.stopped}</p>
              <p className="text-xs text-muted-foreground">Stopped</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card data-testid="card-provider-inventory-objects">
        <CardHeader className="space-y-3">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Box className="w-5 h-5" />
                Inventory Objects
                {provider.kind === "fake" && <Badge variant="secondary">Fake Demo</Badge>}
              </CardTitle>
              <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                <p>Provider inventory is observed runtime state, not CMDB truth.</p>
                <p>CustomerScope candidates are hints until mapped or confirmed.</p>
                {provider.kind === "fake" && <p>This provider uses deterministic demo data.</p>}
              </div>
            </div>
            {provider.kind === "fake" && (
              <Button
                variant="outline"
                onClick={() => inventorySyncMutation.mutate()}
                disabled={inventorySyncMutation.isPending}
                data-testid="button-sync-provider-inventory"
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${inventorySyncMutation.isPending ? "animate-spin" : ""}`} />
                Sync Cached Inventory
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {objectTypesError ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm">
              <p className="font-medium text-destructive">Failed to load cached provider inventory</p>
              <p className="text-muted-foreground">{(objectTypesLoadError as Error).message}</p>
            </div>
          ) : objectTypesLoading ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-28 w-full" />
              ))}
            </div>
          ) : !inventoryObjectTypes?.objectTypes.length ? (
            <div className="rounded-md border p-8 text-center text-sm text-muted-foreground">
              No cached provider inventory yet. Run normalized inventory sync to populate observed runtime objects.
            </div>
          ) : (
            <>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {inventoryObjectTypes.objectTypes.map((type) => (
                  <button
                    key={type.objectType}
                    type="button"
                    onClick={() => {
                      setSelectedInventoryObjectType(type.objectType);
                      setSelectedInventoryObjectId(null);
                    }}
                    className={`text-left rounded-lg border p-4 transition-colors hover:bg-accent ${
                      effectiveInventoryObjectType === type.objectType ? "border-primary bg-primary/5" : "border-border"
                    }`}
                    data-testid={`card-provider-inventory-object-type-${type.objectType}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 font-semibold">
                          <Box className="w-4 h-4 text-muted-foreground" />
                          {type.label}
                        </div>
                        <p className="text-xs text-muted-foreground font-mono">{type.objectType}</p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Badge variant="outline">{type.count} objects</Badge>
                      <Badge variant="secondary">cached</Badge>
                    </div>
                    <p className="mt-3 text-xs text-muted-foreground">
                      Last synced: {formatDateValue(type.lastSyncedAt)}
                    </p>
                  </button>
                ))}
              </div>

              <div className="rounded-md border">
                <div className="flex items-center justify-between gap-4 flex-wrap border-b p-4">
                  <div>
                    <h3 className="font-semibold">
                      {inventoryObjectTypes.objectTypes.find((type) => type.objectType === effectiveInventoryObjectType)?.label ?? "Objects"}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Cached normalized provider objects. Open a row to inspect local object identity and hints.
                    </p>
                  </div>
                  <div className="relative w-72">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="Search inventory objects..."
                      value={inventorySearchTerm}
                      onChange={(event) => setInventorySearchTerm(event.target.value)}
                      className="pl-9"
                      data-testid="input-search-provider-inventory"
                    />
                  </div>
                </div>

                {inventoryObjectsError ? (
                  <div className="p-8 text-center text-destructive space-y-2">
                    <p className="font-medium">Failed to load inventory objects</p>
                    <p className="text-sm text-muted-foreground">{(inventoryObjectsLoadError as Error).message}</p>
                  </div>
                ) : inventoryObjectsLoading ? (
                  <div className="p-4 space-y-2">
                    {Array.from({ length: 6 }).map((_, index) => (
                      <Skeleton key={index} className="h-10 w-full" />
                    ))}
                  </div>
                ) : filteredInventoryObjects.length === 0 ? (
                  <div className="p-10 text-center text-sm text-muted-foreground">
                    {inventorySearchTerm ? "No cached provider inventory objects match your search." : "No cached objects found for this type."}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Power</TableHead>
                          <TableHead>Lifecycle</TableHead>
                          <TableHead>Location</TableHead>
                          <TableHead>Candidate Hints</TableHead>
                          <TableHead>Last Synced</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredInventoryObjects.map((object) => (
                          <TableRow
                            key={object.id}
                            className="cursor-pointer hover-elevate"
                            onClick={() => setSelectedInventoryObjectId(object.id)}
                            data-testid={`row-provider-inventory-object-${object.id}`}
                          >
                            <TableCell className="min-w-64">
                              <div className="font-medium">{object.displayName || object.name || object.externalId}</div>
                              <div className="text-xs text-muted-foreground font-mono break-all">
                                {object.externalId}
                              </div>
                              {object.providerNativeId && object.providerNativeId !== object.externalId && (
                                <div className="text-xs text-muted-foreground font-mono break-all">
                                  Native: {object.providerNativeId}
                                </div>
                              )}
                            </TableCell>
                            <TableCell><Badge variant="outline">{object.objectType}</Badge></TableCell>
                            <TableCell>{object.powerState ? <Badge variant="outline">{object.powerState}</Badge> : <span className="text-muted-foreground/50">-</span>}</TableCell>
                            <TableCell>{object.lifecycleState ? <Badge variant="outline">{object.lifecycleState}</Badge> : <span className="text-muted-foreground/50">-</span>}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {[object.region, object.zone, object.cluster, object.node].filter(Boolean).join(" / ") || <span className="text-muted-foreground/50">-</span>}
                            </TableCell>
                            <TableCell>
                              <Badge variant={object.customerScopeCandidateCount > 0 ? "secondary" : "outline"}>
                                {object.customerScopeCandidateCount} hints
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">{formatDateValue(object.lastSyncedAt)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
                <div className="border-t bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
                  External IDs and provider native IDs are provider identities. Detail actions use local infrastructure object IDs.
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* VM Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
          <CardTitle className="flex items-center gap-2">
            <Server className="w-5 h-5" />
            Live / Generated VM Preview
          </CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search VMs..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8 w-64"
                data-testid="input-search-vms"
              />
            </div>
            {platformFilter && (
              <Badge
                variant="secondary"
                className="cursor-pointer"
                onClick={() => setPlatformFilter(null)}
                data-testid="badge-platform-filter"
              >
                {platformFilter} ×
              </Badge>
            )}
            {statusFilter && (
              <Badge
                variant="secondary"
                className="cursor-pointer"
                onClick={() => setStatusFilter(null)}
                data-testid="badge-status-filter"
              >
                {statusFilter} ×
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {vmsLoading ? (
            <div className="space-y-2">
              {[...Array(10)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filteredVms.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              {searchTerm || platformFilter || statusFilter ? (
                <p>No VMs match the current filters</p>
              ) : (
                <p>No VMs discovered. Try running a sync.</p>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>External ID</TableHead>
                  <TableHead
                    className="cursor-pointer hover-elevate"
                    onClick={() => setPlatformFilter(platformFilter ? null : platforms[0])}
                  >
                    <div className="flex items-center gap-1">
                      Platform
                      <Filter className="w-3 h-3" />
                    </div>
                  </TableHead>
                  <TableHead
                    className="cursor-pointer hover-elevate"
                    onClick={() => setStatusFilter(statusFilter ? null : statuses[0])}
                  >
                    <div className="flex items-center gap-1">
                      Status
                      <Filter className="w-3 h-3" />
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center gap-1">
                      <Cpu className="w-3 h-3" />
                      vCPUs
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center gap-1">
                      <MemoryStick className="w-3 h-3" />
                      Memory
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center gap-1">
                      <HardDrive className="w-3 h-3" />
                      Disk
                    </div>
                  </TableHead>
                  <TableHead>
                    <div className="flex items-center gap-1">
                      <Network className="w-3 h-3" />
                      IPs
                    </div>
                  </TableHead>
                  <TableHead>Tags</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredVms.map((vm) => (
                  <TableRow
                    key={vm.externalId}
                    data-testid={`row-vm-${vm.externalId}`}
                    className="cursor-pointer hover-elevate"
                    onClick={() => setSelectedVm(vm)}
                  >
                    <TableCell className="font-medium" data-testid={`text-vm-name-${vm.externalId}`}>
                      <button
                        className="flex items-center gap-1.5 text-left hover:text-primary transition-colors group"
                        data-testid={`button-vm-detail-${vm.externalId}`}
                        onClick={(e) => { e.stopPropagation(); setSelectedVm(vm); }}
                      >
                        {vm.name}
                        <ChevronRight className="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity shrink-0" />
                      </button>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {vm.externalId.length > 20 ? `${vm.externalId.slice(0, 20)}...` : vm.externalId}
                    </TableCell>
                    <TableCell>{getPlatformBadge(vm.platform)}</TableCell>
                    <TableCell>{getStatusBadge(vm.status)}</TableCell>
                    <TableCell>{vm.vcpus || "—"}</TableCell>
                    <TableCell>{formatBytes(vm.memory)}</TableCell>
                    <TableCell>{formatBytes(vm.disk, "GB")}</TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-0.5 text-xs">
                        {vm.primaryIp4 && (
                          <span className="font-mono">{vm.primaryIp4}</span>
                        )}
                        {vm.ipv4?.filter(ip => ip !== vm.primaryIp4).slice(0, 1).map((ip, i) => (
                          <span key={i} className="font-mono text-muted-foreground">{ip}</span>
                        ))}
                        {(vm.ipv4?.length || 0) > 2 && (
                          <span className="text-muted-foreground">+{(vm.ipv4?.length || 0) - 2} more</span>
                        )}
                        {vm.primaryIp6 && (
                          <span className="font-mono text-muted-foreground text-[10px]">{vm.primaryIp6.slice(0, 24)}...</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {vm.tags?.slice(0, 3).map((tag, i) => (
                          <Badge key={i} variant="outline" className="text-[10px]">{tag}</Badge>
                        ))}
                        {(vm.tags?.length || 0) > 3 && (
                          <Badge variant="secondary" className="text-[10px]">+{(vm.tags?.length || 0) - 3}</Badge>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {filteredVms.length > 0 && (
            <div className="mt-4 text-sm text-muted-foreground">
              Showing {filteredVms.length} of {vmsData?.vms?.length || 0} VMs — click any row to see full details
            </div>
          )}
        </CardContent>
      </Card>

      {/* VM Detail Sheet */}
      <VmDetailSheet
        vm={selectedVm}
        open={!!selectedVm}
        onClose={() => setSelectedVm(null)}
      />
      <InventoryObjectDetailSheet
        providerId={id}
        objectId={selectedInventoryObjectId}
        open={!!selectedInventoryObjectId}
        onClose={() => setSelectedInventoryObjectId(null)}
      />
    </div>
  );
}

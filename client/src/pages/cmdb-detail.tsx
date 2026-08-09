import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
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
  sourceName,
  objectTypeName,
  open,
  onClose,
}: {
  object: NetBoxVmObject | null;
  sourceName: string;
  objectTypeName: string;
  open: boolean;
  onClose: () => void;
}) {
  if (!object) return null;
  const tags = tagsFor(object);
  const raw = object.raw ?? {};
  const customFields = object.custom_fields ?? {};

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
              <AttrRow label="Tenant / Customer" value={relationName(object.tenant)} />
              <AttrRow label="Role" value={relationName(object.role)} />
              <AttrRow label="Cluster" value={relationName(object.cluster)} />
              <AttrRow label="Site" value={relationName(object.site)} />
              <AttrRow label="Last synced/imported" value={formatDate(object.last_synced)} />
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
  const [search, setSearch] = useState("");
  const [selectedObjectType, setSelectedObjectType] = useState<"netbox_vm">("netbox_vm");
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);

  const { data: cmdbs = [] } = useQuery<CmdbAccount[]>({
    queryKey: ["/api/cmdbs"],
  });
  const cmdb = cmdbs.find((candidate) => candidate.id === id);

  const objectTypesQuery = useQuery<CmdbObjectTypesResponse>({
    queryKey: ["/api/cmdbs", id, "object-types"],
    enabled: !!id,
  });

  const objectsQuery = useQuery<CmdbObjectsResponse>({
    queryKey: ["/api/cmdbs", id, "objects", selectedObjectType],
    enabled: !!id && !!selectedObjectType,
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
          onClick={() => {
            objectTypesQuery.refetch();
            objectsQuery.refetch();
          }}
          disabled={objectsQuery.isFetching || objectTypesQuery.isFetching}
          data-testid="button-refresh-cmdb-objects"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${objectsQuery.isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

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
          {objectsQuery.isError ? (
            <div className="p-8 text-center text-destructive space-y-2">
              <p className="font-medium">Failed to load CMDB objects</p>
              <p className="text-sm text-muted-foreground">{(objectsQuery.error as Error).message}</p>
              <Button variant="outline" size="sm" onClick={() => objectsQuery.refetch()}>
                Retry
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
                    <th className="text-left px-4 py-3 font-medium">Tenant / Customer</th>
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
        sourceName={objectDetailQuery.data?.source.name ?? cmdb?.name ?? "CMDB"}
        objectTypeName={objectDetailQuery.data?.objectTypeName ?? "CMDB object"}
        open={!!selectedObjectId}
        onClose={() => setSelectedObjectId(null)}
      />
    </div>
  );
}

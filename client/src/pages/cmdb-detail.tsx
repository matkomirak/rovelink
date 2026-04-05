import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, RefreshCw, Server, Search } from "lucide-react";
import { useState, useMemo } from "react";

interface CmdbAccount {
  id: string;
  kind: string;
  name: string;
  enabled: boolean;
  config: any;
}

interface NetBoxVm {
  id: number;
  name: string;
  status: { value: string; label: string };
  platform?: { id: number; name: string } | null;
  primary_ip?: { id: number; address: string } | null;
  primary_ip4?: { id: number; address: string } | null;
  cluster?: { id: number; name: string } | null;
  tenant?: { id: number; name: string } | null;
  site?: { id: number; name: string } | null;
  vcpus?: number | null;
  memory?: number | null;
  disk?: number | null;
  custom_fields?: Record<string, any>;
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "active": return "default";
    case "offline": return "destructive";
    case "staged": return "secondary";
    default: return "outline";
  }
}

export default function CmdbDetail() {
  const { id } = useParams<{ id: string }>();
  const [search, setSearch] = useState("");

  const { data: cmdbs = [] } = useQuery<CmdbAccount[]>({
    queryKey: ["/api/cmdbs"],
  });
  const cmdb = cmdbs.find((c) => c.id === id);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<{ vms: NetBoxVm[]; total: number }>({
    queryKey: ["/api/cmdbs", id, "vms"],
    queryFn: async () => {
      const res = await fetch(`/api/cmdbs/${id}/vms`, { credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Failed to fetch VMs");
      }
      return res.json();
    },
    enabled: !!id,
  });

  const vms = data?.vms ?? [];

  const filtered = useMemo(() => {
    if (!search.trim()) return vms;
    const q = search.toLowerCase();
    return vms.filter(
      (vm) =>
        vm.name.toLowerCase().includes(q) ||
        vm.status?.label?.toLowerCase().includes(q) ||
        vm.platform?.name?.toLowerCase().includes(q) ||
        vm.cluster?.name?.toLowerCase().includes(q) ||
        vm.tenant?.name?.toLowerCase().includes(q) ||
        vm.primary_ip?.address?.includes(q) ||
        vm.primary_ip4?.address?.includes(q)
    );
  }, [vms, search]);

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
            Virtual machines from this CMDB
            {data && (
              <span className="ml-2 text-sm">— {data.total} total</span>
            )}
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => refetch()}
          disabled={isFetching}
          data-testid="button-refresh-vms"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Server className="w-5 h-5" />
                Virtual Machines
              </CardTitle>
              <CardDescription>
                {isLoading ? "Loading..." : `${filtered.length} of ${vms.length} VMs`}
              </CardDescription>
            </div>
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search VMs..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                data-testid="input-search-vms"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isError ? (
            <div className="p-8 text-center text-destructive space-y-2">
              <p className="font-medium">Failed to load VMs</p>
              <p className="text-sm text-muted-foreground">{(error as Error).message}</p>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                Retry
              </Button>
            </div>
          ) : isLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              {search ? "No VMs match your search." : "No virtual machines found in this CMDB."}
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
                    <th className="text-left px-4 py-3 font-medium">Cluster</th>
                    <th className="text-left px-4 py-3 font-medium">Tenant</th>
                    <th className="text-left px-4 py-3 font-medium">vCPUs</th>
                    <th className="text-left px-4 py-3 font-medium">Memory (MB)</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((vm) => {
                    const ip = vm.primary_ip?.address ?? vm.primary_ip4?.address;
                    return (
                      <tr
                        key={vm.id}
                        className="border-b hover-elevate"
                        data-testid={`row-vm-${vm.id}`}
                      >
                        <td className="px-4 py-3 font-medium" data-testid={`text-vm-name-${vm.id}`}>
                          {vm.name}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={statusVariant(vm.status?.value)}>
                            {vm.status?.label ?? vm.status?.value ?? "—"}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {vm.platform?.name ?? <span className="text-muted-foreground/50">—</span>}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">
                          {ip ?? <span className="text-muted-foreground/50">—</span>}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {vm.cluster?.name ?? <span className="text-muted-foreground/50">—</span>}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {vm.tenant?.name ?? <span className="text-muted-foreground/50">—</span>}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {vm.vcpus ?? <span className="text-muted-foreground/50">—</span>}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {vm.memory ?? <span className="text-muted-foreground/50">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Server, Cpu, HardDrive, MemoryStick, Network, Search, Filter, RefreshCw } from "lucide-react";
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

export default function ProviderDetail() {
  const { id } = useParams<{ id: string }>();
  const [searchTerm, setSearchTerm] = useState("");
  const [platformFilter, setPlatformFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const { toast } = useToast();

  const { data: provider, isLoading: providerLoading } = useQuery<ProviderAccount>({
    queryKey: ["/api/providers", id],
  });

  const { data: vmsData, isLoading: vmsLoading } = useQuery<ProviderVmsResponse>({
    queryKey: ["/api/providers", id, "vms"],
    enabled: !!id,
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
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-4">
          <Link href="/providers">
            <Button variant="ghost" size="icon" data-testid="button-back">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold" data-testid="text-provider-name">{provider.name}</h1>
            <p className="text-muted-foreground">
              <Badge variant="outline" className="mr-2">{provider.kind}</Badge>
              {provider.enabled ? (
                <Badge className="bg-green-500/10 text-green-500 border-green-500/20">Enabled</Badge>
              ) : (
                <Badge variant="secondary">Disabled</Badge>
              )}
            </p>
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

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <Server className="w-5 h-5" />
            Virtual Machines
          </CardTitle>
          <div className="flex items-center gap-2">
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
              >
                {platformFilter} ×
              </Badge>
            )}
            {statusFilter && (
              <Badge 
                variant="secondary" 
                className="cursor-pointer"
                onClick={() => setStatusFilter(null)}
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
                  <TableRow key={vm.externalId} data-testid={`row-vm-${vm.externalId}`}>
                    <TableCell className="font-medium" data-testid={`text-vm-name-${vm.externalId}`}>
                      {vm.name}
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
              Showing {filteredVms.length} of {vmsData?.vms?.length || 0} VMs
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

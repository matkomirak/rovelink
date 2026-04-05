import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ArrowLeft, Edit, RefreshCw, Server, Users, ChevronRight, Download, ShieldCheck, ShieldOff, AlertTriangle, Settings, Lock, ToggleRight } from "lucide-react";
import { type AutomationInventory, type EligibilityPolicy } from "@shared/schema";
import { useState } from "react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface InventoryStructure {
  groups: Array<{
    name: string;
    hostsCount: number;
    hosts: string[];
  }>;
  hosts: Array<{
    name: string;
    ansible_host?: string;
    groups: string[];
    vars: Record<string, string>;
  }>;
}

interface GateStats {
  allowed: number;
  blocked: number;
  total: number;
  lastEvaluated: string | null;
}

interface BlockedAsset {
  asset_id: string;
  name: string;
  source: string;
  missing: string[];
  blocked_reason: string;
  last_evaluated: string;
  // Provider tracking fields
  gateProviderId?: string | null;
  clusterName?: string | null;
  providerState?: string | null;
}

interface BlockedResponse {
  blocked: BlockedAsset[];
  count: number;
  source: string;
  lastEvaluated: string | null;
}

interface CoreRule {
  key: string;
  label: string;
  enforced: boolean;
}

interface PolicyResponse {
  coreRules: CoreRule[];
  policy: {
    requireRole: boolean;
    requireContacts: boolean;
  };
}

export default function AutomationInventoryDetail() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [selectedHost, setSelectedHost] = useState<string | null>(null);
  const { toast } = useToast();

  const { data: inventory, isLoading: inventoryLoading } = useQuery<AutomationInventory>({
    queryKey: ["/api/inventories", id],
  });

  const { data: structure, isLoading: structureLoading, error: structureError } = useQuery<InventoryStructure>({
    queryKey: ["/api/inventories", id, "structure"],
  });

  const { data: gateStats } = useQuery<GateStats>({
    queryKey: ["/api/inventories", id, "gate-stats"],
    enabled: inventory?.type === "linked",
  });

  const { data: blockedData } = useQuery<BlockedResponse>({
    queryKey: ["/api/inventories", id, "blocked"],
    enabled: inventory?.type === "linked",
  });

  const { data: policyData } = useQuery<PolicyResponse>({
    queryKey: ["/api/inventories", id, "policy"],
    enabled: inventory?.type === "linked",
  });

  const updatePolicyMutation = useMutation({
    mutationFn: async (updates: Partial<EligibilityPolicy>) => {
      return apiRequest("PATCH", `/api/inventories/${id}/policy`, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventories", id, "policy"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventories", id, "gate-stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventories", id, "blocked"] });
      toast({
        title: "Policy Updated",
        description: "Eligibility policy has been updated. Gate will re-evaluate on next refresh.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update policy",
        variant: "destructive",
      });
    },
  });

  const handleDownloadAutomation = () => {
    window.location.href = `/api/inventories/${id}/automation.yml`;
  };

  const handleDownloadBlocked = () => {
    window.location.href = `/api/inventories/${id}/blocked.json`;
  };

  const handleToggleRule = (rule: keyof EligibilityPolicy) => {
    if (!policyData) return;
    const currentValue = policyData.policy[rule];
    updatePolicyMutation.mutate({ [rule]: !currentValue });
  };

  if (inventoryLoading || structureLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!inventory) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle>Inventory Not Found</CardTitle>
            <CardDescription>The requested inventory does not exist.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (structureError) {
    const errorMessage = structureError instanceof Error ? structureError.message : "Unknown error occurred";
    let parsedError: any = null;
    
    try {
      const match = errorMessage.match(/\{.*\}/);
      if (match) {
        parsedError = JSON.parse(match[0]);
      }
    } catch {}
    
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-destructive">Error Loading Inventory Structure</CardTitle>
            <CardDescription>
              {parsedError?.message || errorMessage}
            </CardDescription>
          </CardHeader>
          {parsedError?.hint && (
            <CardContent>
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-md p-4">
                <p className="text-sm font-medium text-blue-400 mb-2">How to Fix</p>
                <p className="text-sm text-muted-foreground">{parsedError.hint}</p>
                {parsedError.cmdb_name && (
                  <p className="text-xs text-muted-foreground mt-2">
                    CMDB: <span className="font-mono">{parsedError.cmdb_name}</span>
                    {parsedError.cmdb_url && ` (${parsedError.cmdb_url})`}
                  </p>
                )}
              </div>
            </CardContent>
          )}
        </Card>
      </div>
    );
  }

  const selectedGroupData = structure?.groups.find(g => g.name === selectedGroup);
  const selectedHostData = structure?.hosts.find(h => h.name === selectedHost);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setLocation("/automation-inventories")}
            data-testid="button-back"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold" data-testid="text-inventory-name">{inventory.name}</h1>
            <p className="text-muted-foreground">
              {inventory.type === "linked" ? "Inventory Source: CMDB" : `File-based (${inventory.fileFormat?.toUpperCase()})`}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {inventory.type === "linked" && (
            <Button
              variant="outline"
              size="sm"
              data-testid="button-refresh"
              onClick={() => {
                queryClient.invalidateQueries({ queryKey: ["/api/inventories", id] });
                queryClient.invalidateQueries({ queryKey: ["/api/inventories", id, "structure"] });
                queryClient.invalidateQueries({ queryKey: ["/api/inventories", id, "gate-stats"] });
                queryClient.invalidateQueries({ queryKey: ["/api/inventories", id, "blocked"] });
                queryClient.invalidateQueries({ queryKey: ["/api/inventories", id, "policy"] });
                toast({
                  title: "Refreshing",
                  description: "Inventory data is being refreshed...",
                });
              }}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLocation(`/inventories/${id}/edit`)}
            data-testid="button-edit"
          >
            <Edit className="h-4 w-4 mr-2" />
            Edit
          </Button>
        </div>
      </div>

      {inventory.type === "linked" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="border-green-500/30">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-green-500" />
                <CardTitle>Allowed Automation Inventory</CardTitle>
              </div>
              <CardDescription>
                Assets that passed the gate and are safe to automate
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-3xl font-bold text-green-500" data-testid="text-allowed-count">
                    {gateStats?.allowed ?? inventory.hostsCount ?? 0}
                  </div>
                  <div className="text-sm text-muted-foreground">allowed assets</div>
                </div>
                <Button
                  onClick={handleDownloadAutomation}
                  className="gap-2"
                  data-testid="button-download-automation"
                >
                  <Download className="h-4 w-4" />
                  Download automation.yml
                </Button>
              </div>
              {gateStats?.lastEvaluated && (
                <div className="text-xs text-muted-foreground">
                  Last evaluated: {new Date(gateStats.lastEvaluated).toLocaleString()}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-orange-500/30">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <ShieldOff className="h-5 w-5 text-orange-500" />
                <CardTitle>Blocked Assets</CardTitle>
              </div>
              <CardDescription>
                Assets blocked by gate due to missing governance data
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-3xl font-bold text-orange-500" data-testid="text-blocked-count">
                    {gateStats?.blocked ?? 0}
                  </div>
                  <div className="text-sm text-muted-foreground">blocked assets</div>
                </div>
                <Button
                  variant="outline"
                  onClick={handleDownloadBlocked}
                  className="gap-2"
                  data-testid="button-download-blocked"
                  disabled={!gateStats?.blocked}
                >
                  <Download className="h-4 w-4" />
                  Download blocked.json
                </Button>
              </div>
              <div className="bg-orange-500/10 border border-orange-500/20 rounded-md p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-orange-500 mt-0.5" />
                  <div className="text-sm text-muted-foreground">
                    To allow automation, assign tenant and role in the CMDB and add the automatable tag.
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {inventory.type === "linked" && policyData && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Settings className="h-5 w-5 text-muted-foreground" />
              <CardTitle>Eligibility Rules</CardTitle>
            </div>
            <CardDescription>
              Configure which governance requirements VMs must meet before automation is allowed
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Lock className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Core Rules (Always Enforced)</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {policyData.coreRules.map((rule: CoreRule) => (
                  <div
                    key={rule.key}
                    className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted/50 border"
                    data-testid={`core-rule-${rule.key}`}
                  >
                    <ShieldCheck className="h-4 w-4 text-green-500" />
                    <span className="text-sm">{rule.label}</span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                These rules cannot be disabled. VMs must have tenant, platform, primary IP, automatable=true, and active provider state.
              </p>
            </div>

            <div className="border-t pt-4">
              <div className="flex items-center gap-2 mb-3">
                <ToggleRight className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Optional Rules</span>
              </div>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 rounded-md border hover-elevate">
                  <div className="space-y-1">
                    <div className="text-sm font-medium">Require Role</div>
                    <div className="text-xs text-muted-foreground">
                      VMs must have a NetBox Role assigned (e.g., web-server, database)
                    </div>
                  </div>
                  <Switch
                    checked={policyData.policy.requireRole}
                    onCheckedChange={() => handleToggleRule("requireRole")}
                    disabled={updatePolicyMutation.isPending}
                    data-testid="switch-require-role"
                  />
                </div>
                <div className="flex items-center justify-between p-3 rounded-md border hover-elevate">
                  <div className="space-y-1">
                    <div className="text-sm font-medium">Require Contacts</div>
                    <div className="text-xs text-muted-foreground">
                      VMs must have at least one contact assigned (Customer, Service Owner, or Technical Owner)
                    </div>
                  </div>
                  <Switch
                    checked={policyData.policy.requireContacts}
                    onCheckedChange={() => handleToggleRule("requireContacts")}
                    disabled={updatePolicyMutation.isPending}
                    data-testid="switch-require-contacts"
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                Enable optional rules to add stricter governance requirements for this inventory.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Groups</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-groups-count">{inventory.groupsCount || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Hosts</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-hosts-count">{inventory.hostsCount || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Last Updated</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm" data-testid="text-last-updated">
              {inventory.lastRefreshedAt
                ? new Date(inventory.lastRefreshedAt).toLocaleString()
                : "Never"}
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="hosts" className="w-full">
        <TabsList>
          <TabsTrigger value="hosts" data-testid="tab-hosts">
            <Server className="h-4 w-4 mr-2" />
            Hosts
          </TabsTrigger>
          <TabsTrigger value="groups" data-testid="tab-groups">
            <Users className="h-4 w-4 mr-2" />
            Groups
          </TabsTrigger>
          {inventory.type === "linked" && blockedData && blockedData.count > 0 && (
            <TabsTrigger value="blocked" data-testid="tab-blocked">
              <ShieldOff className="h-4 w-4 mr-2" />
              Blocked by Gate – Not Automatable ({blockedData.count})
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="groups" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Inventory Groups</CardTitle>
              <CardDescription>
                {selectedGroup
                  ? `Viewing hosts in group: ${selectedGroup}`
                  : "Click a group to view its hosts"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {selectedGroup && selectedGroupData ? (
                <div className="space-y-4">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedGroup(null)}
                    data-testid="button-back-to-groups"
                  >
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Back to Groups
                  </Button>
                  <div className="space-y-2">
                    {selectedGroupData.hosts.map((hostName) => {
                      const hostData = structure?.hosts.find(h => h.name === hostName);
                      return (
                        <div
                          key={hostName}
                          className="flex items-center justify-between p-3 rounded-lg border hover-elevate cursor-pointer"
                          onClick={() => setSelectedHost(hostName)}
                          data-testid={`host-item-${hostName}`}
                        >
                          <div className="flex items-center gap-3">
                            <Server className="h-4 w-4 text-muted-foreground" />
                            <div>
                              <div className="font-medium">{hostName}</div>
                              {hostData?.ansible_host && (
                                <div className="text-sm text-muted-foreground">
                                  {hostData.ansible_host}
                                </div>
                              )}
                            </div>
                          </div>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {structure?.groups.map((group) => (
                    <div
                      key={group.name}
                      className="flex items-center justify-between p-3 rounded-lg border hover-elevate cursor-pointer"
                      onClick={() => setSelectedGroup(group.name)}
                      data-testid={`group-item-${group.name}`}
                    >
                      <div className="flex items-center gap-3">
                        <Users className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <div className="font-medium">{group.name}</div>
                          <div className="text-sm text-muted-foreground">
                            {group.hostsCount} {group.hostsCount === 1 ? "host" : "hosts"}
                          </div>
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="hosts" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Inventory Hosts</CardTitle>
              <CardDescription>
                {selectedHost
                  ? `Viewing details for: ${selectedHost}`
                  : "Click a host to view its details"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {selectedHost && selectedHostData ? (
                <div className="space-y-4">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedHost(null)}
                    data-testid="button-back-to-hosts"
                  >
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Back to Hosts
                  </Button>
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-lg font-semibold mb-2">Host Information</h3>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <div className="text-sm text-muted-foreground">Hostname</div>
                          <div className="font-medium" data-testid="text-host-name">{selectedHostData.name}</div>
                        </div>
                        {selectedHostData.ansible_host && (
                          <div>
                            <div className="text-sm text-muted-foreground">IP Address</div>
                            <div className="font-medium" data-testid="text-host-ip">{selectedHostData.ansible_host}</div>
                          </div>
                        )}
                      </div>
                    </div>

                    <div>
                      <h3 className="text-lg font-semibold mb-2">Groups</h3>
                      <div className="flex flex-wrap gap-2">
                        {selectedHostData.groups.map((group) => (
                          <Badge key={group} variant="secondary" data-testid={`badge-group-${group}`}>
                            {group}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    {Object.keys(selectedHostData.vars).length > 0 && (
                      <div>
                        <h3 className="text-lg font-semibold mb-2">Variables</h3>
                        <div className="space-y-2">
                          {Object.entries(selectedHostData.vars).map(([key, value]) => (
                            <div key={key} className="flex items-center gap-2">
                              <code className="text-sm bg-muted px-2 py-1 rounded">{key}</code>
                              <span>=</span>
                              <code className="text-sm bg-muted px-2 py-1 rounded">{value}</code>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {structure?.hosts.map((host) => (
                    <div
                      key={host.name}
                      className="flex items-center justify-between p-3 rounded-lg border hover-elevate cursor-pointer"
                      onClick={() => setSelectedHost(host.name)}
                      data-testid={`host-item-${host.name}`}
                    >
                      <div className="flex items-center gap-3">
                        <Server className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <div className="font-medium">{host.name}</div>
                          <div className="text-sm text-muted-foreground">
                            {host.ansible_host || "No IP"} - {host.groups.length}{" "}
                            {host.groups.length === 1 ? "group" : "groups"}
                          </div>
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {inventory.type === "linked" && blockedData && blockedData.count > 0 && (
          <TabsContent value="blocked" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldOff className="h-5 w-5 text-orange-500" />
                  Blocked by Gate – Not Automatable
                </CardTitle>
                <CardDescription>
                  These assets are blocked due to missing governance data in NetBox.
                  To enable automation, set the required fields in NetBox directly.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {blockedData.blocked.map((asset) => {
                    const missingAutomatable = asset.missing.includes("automatable");
                    const missingTenant = asset.missing.includes("tenant");
                    const missingRole = asset.missing.includes("role");
                    const missingStatus = asset.missing.includes("status:active");
                    const providerMissing = asset.missing.includes("provider_state:missing");
                    
                    return (
                      <div
                        key={asset.asset_id}
                        className="p-4 rounded-lg border border-orange-500/20 bg-orange-500/5"
                        data-testid={`blocked-asset-${asset.name}`}
                      >
                        <div className="flex items-start justify-between flex-wrap gap-2">
                          <div>
                            <div className="font-medium flex items-center gap-2">
                              <Server className="h-4 w-4 text-muted-foreground" />
                              {asset.name}
                            </div>
                            <div className="text-sm text-muted-foreground mt-1">
                              Source: {asset.source}
                            </div>
                          </div>
                          <Badge variant="outline" className="border-orange-500/50 text-orange-500">
                            Blocked by gate
                          </Badge>
                        </div>
                        <div className="mt-3">
                          <div className="text-sm font-medium text-muted-foreground mb-1">Missing governance:</div>
                          <div className="flex flex-wrap gap-1">
                            {providerMissing && (
                              <Badge variant="secondary" className="text-xs bg-red-500/10 text-red-600 border-red-500/30">
                                Not present in provider
                              </Badge>
                            )}
                            {missingStatus && (
                              <Badge variant="secondary" className="text-xs bg-red-500/10 text-red-600 border-red-500/30">
                                VM offline
                              </Badge>
                            )}
                            {missingTenant && (
                              <Badge variant="secondary" className="text-xs">
                                Tenant not assigned
                              </Badge>
                            )}
                            {missingRole && (
                              <Badge variant="secondary" className="text-xs">
                                Role not assigned
                              </Badge>
                            )}
                            {missingAutomatable && (
                              <Badge variant="secondary" className="text-xs bg-orange-500/10 text-orange-600 border-orange-500/30">
                                Automation not explicitly permitted
                              </Badge>
                            )}
                          </div>
                        </div>
                        {providerMissing && (
                          <div className="text-xs text-red-600 mt-2 bg-red-500/5 p-2 rounded">
                            This VM is no longer present in the provider inventory (provider_state = missing). It has been marked offline automatically.
                          </div>
                        )}
                        {!providerMissing && missingAutomatable && (
                          <div className="text-xs text-orange-600 mt-2 bg-orange-500/5 p-2 rounded">
                            Set <code className="bg-orange-500/20 px-1 rounded">automatable = true</code> on this VM in NetBox to allow automation.
                          </div>
                        )}
                        {/* Provider tracking info */}
                        {(asset.gateProviderId || asset.clusterName) && (
                          <div className="text-xs text-muted-foreground mt-2 font-mono bg-muted/30 p-2 rounded">
                            {asset.gateProviderId && <span>Provider: {asset.gateProviderId}</span>}
                            {asset.gateProviderId && asset.clusterName && <span className="mx-2">|</span>}
                            {asset.clusterName && <span>Cluster: {asset.clusterName}</span>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

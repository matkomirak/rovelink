import { useQuery } from "@tanstack/react-query";
import { useParams, useLocation, Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Edit, RefreshCw, Server, Users, ChevronRight } from "lucide-react";
import { type AutomationInventory } from "@shared/schema";
import { useState } from "react";

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

export default function AutomationInventoryDetail() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [selectedHost, setSelectedHost] = useState<string | null>(null);

  const { data: inventory, isLoading: inventoryLoading } = useQuery<AutomationInventory>({
    queryKey: ["/api/inventories", id],
  });

  const { data: structure, isLoading: structureLoading, error: structureError } = useQuery<InventoryStructure>({
    queryKey: ["/api/inventories", id, "structure"],
  });

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
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle>Error Loading Inventory Structure</CardTitle>
            <CardDescription className="text-destructive">
              {structureError instanceof Error ? structureError.message : "Unknown error occurred"}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const selectedGroupData = structure?.groups.find(g => g.name === selectedGroup);
  const selectedHostData = structure?.hosts.find(h => h.name === selectedHost);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
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
              {inventory.type === "linked" ? "Linked to CMDB" : `File-based (${inventory.fileFormat?.toUpperCase()})`}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {inventory.type === "linked" && (
            <Button variant="outline" size="sm" data-testid="button-refresh">
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          )}
          {inventory.type === "file" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLocation(`/inventories/${id}/edit`)}
              data-testid="button-edit"
            >
              <Edit className="h-4 w-4 mr-2" />
              Edit
            </Button>
          )}
        </div>
      </div>

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

      <Tabs defaultValue="groups" className="w-full">
        <TabsList>
          <TabsTrigger value="groups" data-testid="tab-groups">
            <Users className="h-4 w-4 mr-2" />
            Groups
          </TabsTrigger>
          <TabsTrigger value="hosts" data-testid="tab-hosts">
            <Server className="h-4 w-4 mr-2" />
            Hosts
          </TabsTrigger>
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
                            {host.ansible_host || "No IP"} • {host.groups.length}{" "}
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
      </Tabs>
    </div>
  );
}

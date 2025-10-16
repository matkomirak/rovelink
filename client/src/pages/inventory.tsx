import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Server, AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface NetBoxGroup {
  name: string;
  count: number;
}

interface NetBoxHost {
  name: string;
  primary_ip4?: string;
  tags?: string[];
  patch_wave?: string;
  patch_subwave?: string;
  ansible_user?: string;
}

interface PreflightResult {
  matched: number;
  warnings: string[];
}

export default function Inventory() {
  const [selectedGroup, setSelectedGroup] = useState<string>("");
  const [limitExpr, setLimitExpr] = useState<string>("");

  const { data: groups, isLoading: groupsLoading } = useQuery<NetBoxGroup[]>({
    queryKey: ["/api/inventory/groups"],
  });

  const { data: hosts, isLoading: hostsLoading } = useQuery<NetBoxHost[]>({
    queryKey: ["/api/inventory/hosts", selectedGroup],
    enabled: !!selectedGroup,
  });

  const { data: preflight, isLoading: preflightLoading } = useQuery<PreflightResult>({
    queryKey: ["/api/inventory/preflight", limitExpr],
    enabled: limitExpr.length > 2,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="text-page-title">Inventory</h1>
        <p className="text-sm text-muted-foreground">Browse NetBox inventory and validate host selections</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Groups Panel */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Groups</CardTitle>
          </CardHeader>
          <CardContent>
            {groupsLoading ? (
              <div className="space-y-2">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="h-10 bg-muted animate-pulse rounded" />
                ))}
              </div>
            ) : groups && groups.length > 0 ? (
              <div className="space-y-1">
                {groups.map((group) => (
                  <Button
                    key={group.name}
                    variant={selectedGroup === group.name ? "secondary" : "ghost"}
                    className="w-full justify-between"
                    onClick={() => setSelectedGroup(group.name)}
                    data-testid={`button-group-${group.name}`}
                  >
                    <span className="truncate">{group.name}</span>
                    <Badge variant="outline" className="ml-2">
                      {group.count}
                    </Badge>
                  </Button>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Server className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p className="text-sm">No groups found</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Hosts Table */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg">
              {selectedGroup ? `Hosts in ${selectedGroup}` : "Select a group"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!selectedGroup ? (
              <div className="text-center py-12 text-muted-foreground">
                <Server className="h-16 w-16 mx-auto mb-4 opacity-50" />
                <p>Select a group to view hosts</p>
              </div>
            ) : hostsLoading ? (
              <div className="space-y-2">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="h-12 bg-muted animate-pulse rounded" />
                ))}
              </div>
            ) : hosts && hosts.length > 0 ? (
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Host</TableHead>
                      <TableHead>IP Address</TableHead>
                      <TableHead>Tags</TableHead>
                      <TableHead>Patch Wave</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {hosts.map((host) => (
                      <TableRow key={host.name} data-testid={`row-host-${host.name}`}>
                        <TableCell className="font-mono text-sm">{host.name}</TableCell>
                        <TableCell className="font-mono text-sm">
                          {host.primary_ip4 || (
                            <span className="text-muted-foreground">N/A</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {host.tags && host.tags.length > 0 ? (
                            <div className="flex gap-1 flex-wrap">
                              {host.tags.slice(0, 3).map((tag) => (
                                <Badge key={tag} variant="outline" className="text-xs">
                                  {tag}
                                </Badge>
                              ))}
                              {host.tags.length > 3 && (
                                <Badge variant="outline" className="text-xs">
                                  +{host.tags.length - 3}
                                </Badge>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-sm">None</span>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {host.patch_wave || <span className="text-muted-foreground">N/A</span>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <p className="text-sm">No hosts in this group</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Preflight Panel */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Preflight Check</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-2 block">Limit Expression</label>
            <Input
              value={limitExpr}
              onChange={(e) => setLimitExpr(e.target.value)}
              placeholder="e.g., tag_customer_x:&tag_os_linux"
              className="font-mono"
              data-testid="input-limit-expr"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Test your limit expression to see which hosts will be affected
            </p>
          </div>

          {preflight && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                <span className="text-sm font-medium">
                  {preflight.matched} host{preflight.matched !== 1 ? "s" : ""} matched
                </span>
              </div>

              {preflight.warnings.length > 0 && (
                <div className="space-y-2">
                  {preflight.warnings.map((warning, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-2 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg"
                      data-testid={`warning-${i}`}
                    >
                      <AlertTriangle className="h-4 w-4 text-yellow-500 mt-0.5 flex-shrink-0" />
                      <p className="text-sm text-yellow-600 dark:text-yellow-400">{warning}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

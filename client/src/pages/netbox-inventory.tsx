import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Download, RefreshCw, Server } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { NetboxVm } from "@shared/schema";

export default function NetBoxInventory() {
  const { toast } = useToast();
  const [importing, setImporting] = useState(false);

  const { data: vms = [], isLoading } = useQuery<NetboxVm[]>({
    queryKey: ["/api/netbox/vms"],
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      setImporting(true);
      const response = await apiRequest("POST", "/api/netbox/import");
      return await response.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Import Successful",
        description: data.message || `Imported ${data.count} VMs from NetBox`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/netbox/vms"] });
      setImporting(false);
    },
    onError: (error: any) => {
      toast({
        title: "Import Failed",
        description: error.message || "Failed to import VMs from NetBox",
        variant: "destructive",
      });
      setImporting(false);
    },
  });

  const handleImport = () => {
    importMutation.mutate();
  };

  const getOsBadgeVariant = (os: string | null) => {
    if (!os) return "secondary";
    if (os === "Linux") return "default";
    if (os === "Windows") return "outline";
    return "secondary";
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">NetBox Inventory</h1>
          <p className="text-muted-foreground mt-1">
            Import and view virtual machines from NetBox
          </p>
        </div>
        <Button 
          onClick={handleImport} 
          disabled={importing}
          data-testid="button-import-vms"
        >
          {importing ? (
            <>
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              Importing...
            </>
          ) : (
            <>
              <Download className="mr-2 h-4 w-4" />
              Import from NetBox
            </>
          )}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Server className="h-5 w-5" />
                Virtual Machines
              </CardTitle>
              <CardDescription>
                {vms.length} VMs imported from NetBox inventory
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">
              Loading VMs...
            </div>
          ) : vms.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No VMs imported yet. Click "Import from NetBox" to get started.
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>IP Address</TableHead>
                    <TableHead>Operating System</TableHead>
                    <TableHead>Tags</TableHead>
                    <TableHead>Custom Fields</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {vms.map((vm) => (
                    <TableRow key={vm.id} data-testid={`row-vm-${vm.netboxId}`}>
                      <TableCell className="font-medium" data-testid={`text-vm-name-${vm.netboxId}`}>
                        {vm.name}
                      </TableCell>
                      <TableCell data-testid={`text-vm-ip-${vm.netboxId}`}>
                        {vm.ip || <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        <Badge 
                          variant={getOsBadgeVariant(vm.operatingSystem)}
                          data-testid={`badge-vm-os-${vm.netboxId}`}
                        >
                          {vm.operatingSystem || "Unknown"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {vm.tags && vm.tags.length > 0 ? (
                            vm.tags.map((tag, idx) => (
                              <Badge 
                                key={idx} 
                                variant="outline"
                                className="text-xs"
                                data-testid={`badge-vm-tag-${vm.netboxId}-${idx}`}
                              >
                                {tag}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-muted-foreground text-sm">No tags</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {vm.customFields && Object.keys(vm.customFields).length > 0 ? (
                          <div className="text-sm space-y-1">
                            {Object.entries(vm.customFields).map(([key, value]) => (
                              <div key={key} className="flex gap-2">
                                <span className="text-muted-foreground">{key}:</span>
                                <span className="font-medium">
                                  {value === null ? "null" : 
                                   typeof value === "object" ? JSON.stringify(value) : 
                                   String(value)}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-sm">No custom fields</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Plus, 
  RefreshCw, 
  Eye, 
  Edit, 
  Trash2,
  Database,
  FileText,
  Code,
  Star
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { AutomationInventory } from "@shared/schema";
import { format } from "date-fns";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function AutomationInventories() {
  const { toast } = useToast();
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: inventories, isLoading } = useQuery<AutomationInventory[]>({
    queryKey: ["/api/inventories"],
  });

  const { data: currentUser } = useQuery<{ role: string }>({
    queryKey: ["/api/auth/me"],
  });

  const userRole = currentUser?.role || "viewer";

  const refreshInventory = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("POST", `/api/inventories/${id}/refresh`, {});
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventories"] });
      toast({ title: "Success", description: "Inventory refreshed" });
    },
    onError: (error: any) => {
      toast({ 
        title: "Error", 
        description: error.message || "Failed to refresh inventory",
        variant: "destructive" 
      });
    },
  });

  const deleteInventory = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("DELETE", `/api/inventories/${id}`, {});
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventories"] });
      toast({ title: "Success", description: "Inventory deleted" });
      setDeleteId(null);
    },
    onError: (error: any) => {
      toast({ 
        title: "Error", 
        description: error.message || "Failed to delete inventory",
        variant: "destructive" 
      });
    },
  });

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "linked":
        return <Database className="h-4 w-4" />;
      case "file":
        return <FileText className="h-4 w-4" />;
      case "script":
        return <Code className="h-4 w-4" />;
      default:
        return <Database className="h-4 w-4" />;
    }
  };

  const getTypeBadge = (type: string) => {
    const variant = type === "linked" ? "default" : type === "file" ? "secondary" : "outline";
    return (
      <Badge variant={variant} className="capitalize">
        {type}
      </Badge>
    );
  };

  const getSourceBadge = (inventory: AutomationInventory) => {
    if (inventory.type !== "linked") return null;
    return (
      <Badge variant="outline" className="capitalize text-xs">
        {inventory.sourceType || "Unknown"}
      </Badge>
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-page-title">
            Automation Inventories
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Prepare governed targets for automation. Configured Governance and GATE checks determine eligibility at execution; inventory setup alone does not grant readiness.
          </p>
        </div>
        {userRole === "admin" && (
          <Link href="/inventories/new">
            <Button data-testid="button-create-inventory">
              <Plus className="h-4 w-4 mr-2" />
              New Inventory
            </Button>
          </Link>
        )}
      </div>

      {/* Inventories List */}
      <Card>
        <CardHeader>
          <CardTitle>Inventory Sources</CardTitle>
        </CardHeader>
        <CardContent>
          {!inventories || inventories.length === 0 ? (
            <div className="text-center py-12">
              <Database className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground mb-4">
                No inventories configured yet
              </p>
              {userRole === "admin" && (
                <Link href="/inventories/new">
                  <Button data-testid="button-create-first">
                    <Plus className="h-4 w-4 mr-2" />
                    Create your first inventory
                  </Button>
                </Link>
              )}
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead className="text-right">Groups</TableHead>
                    <TableHead className="text-right">Hosts</TableHead>
                    <TableHead>Last Refreshed</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inventories.map((inventory) => (
                    <TableRow key={inventory.id} data-testid={`row-inventory-${inventory.id}`}>
                      <TableCell>
                        <Link href={`/inventories/${inventory.id}`}>
                          <div className="flex items-center gap-2 hover-elevate cursor-pointer p-1 rounded">
                            {getTypeIcon(inventory.type)}
                            <span className="font-medium" data-testid={`link-inventory-name-${inventory.id}`}>{inventory.name}</span>
                            {inventory.isDefault && (
                              <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />
                            )}
                          </div>
                        </Link>
                      </TableCell>
                      <TableCell>
                        {getTypeBadge(inventory.type)}
                      </TableCell>
                      <TableCell>
                        {getSourceBadge(inventory)}
                        {inventory.type === "file" && inventory.fileFormat && (
                          <Badge variant="outline" className="text-xs uppercase">
                            {inventory.fileFormat}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {inventory.groupsCount}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {inventory.hostsCount}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {inventory.lastRefreshedAt 
                          ? format(new Date(inventory.lastRefreshedAt), "MMM d, yyyy HH:mm")
                          : "Never"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          {inventory.type === "linked" && userRole !== "viewer" && (
                            <Button 
                              variant="ghost" 
                              size="sm"
                              onClick={() => refreshInventory.mutate(inventory.id)}
                              disabled={refreshInventory.isPending}
                              data-testid={`button-refresh-${inventory.id}`}
                            >
                              <RefreshCw className={`h-4 w-4 ${refreshInventory.isPending ? "animate-spin" : ""}`} />
                            </Button>
                          )}
                          
                          {inventory.type === "file" && userRole === "admin" && (
                            <Link href={`/inventories/${inventory.id}/edit`}>
                              <Button 
                                variant="ghost" 
                                size="sm"
                                data-testid={`button-edit-${inventory.id}`}
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                            </Link>
                          )}
                          
                          {userRole === "admin" && (
                            <Button 
                              variant="ghost" 
                              size="sm"
                              onClick={() => setDeleteId(inventory.id)}
                              data-testid={`button-delete-${inventory.id}`}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Inventory?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this inventory source. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId && deleteInventory.mutate(deleteId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

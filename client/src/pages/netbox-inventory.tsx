import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Download, RefreshCw, Plus, Pencil, Trash2, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { NetboxInventorySource } from "@shared/schema";
import { insertNetboxInventorySourceSchema } from "@shared/schema";

const sourceFormSchema = insertNetboxInventorySourceSchema.extend({
  name: z.string().min(1, "Name is required"),
  url: z.string().url("Must be a valid URL"),
  token: z.string().min(1, "Token is required"),
});

type SourceForm = z.infer<typeof sourceFormSchema>;

export default function NetBoxInventories() {
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<NetboxInventorySource | null>(null);
  const [testingSource, setTestingSource] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<Record<string, "success" | "error" | "idle">>({});

  const { data: sources = [], isLoading } = useQuery<NetboxInventorySource[]>({
    queryKey: ["/api/netbox-sources"],
  });

  const form = useForm<SourceForm>({
    resolver: zodResolver(sourceFormSchema),
    defaultValues: {
      name: "",
      url: "",
      token: "",
      enabled: true,
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: SourceForm) => {
      const response = await apiRequest("POST", "/api/netbox-sources", data);
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/netbox-sources"] });
      toast({ title: "NetBox source created successfully" });
      setIsDialogOpen(false);
      form.reset();
    },
    onError: (error: any) => {
      toast({ variant: "destructive", title: "Failed to create source", description: error.message });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: { id: string; updates: Partial<SourceForm> }) => {
      const response = await apiRequest("PATCH", `/api/netbox-sources/${data.id}`, data.updates);
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/netbox-sources"] });
      toast({ title: "NetBox source updated successfully" });
      setIsDialogOpen(false);
      setEditingSource(null);
      form.reset();
    },
    onError: (error: any) => {
      toast({ variant: "destructive", title: "Failed to update source", description: error.message });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/netbox-sources/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/netbox-sources"] });
      toast({ title: "NetBox source deleted successfully" });
    },
    onError: (error: any) => {
      toast({ variant: "destructive", title: "Failed to delete source", description: error.message });
    },
  });

  const handleSubmit = (data: SourceForm) => {
    if (editingSource) {
      updateMutation.mutate({ id: editingSource.id, updates: data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleEdit = (source: NetboxInventorySource) => {
    setEditingSource(source);
    form.reset({
      name: source.name,
      url: source.url,
      token: source.token,
      enabled: source.enabled,
    });
    setIsDialogOpen(true);
  };

  const handleDelete = (id: string) => {
    if (confirm("Are you sure you want to delete this NetBox source? All imported VMs from this source will also be deleted.")) {
      deleteMutation.mutate(id);
    }
  };

  const handleTestConnection = async (source: NetboxInventorySource) => {
    setTestingSource(source.id);
    setTestStatus({ ...testStatus, [source.id]: "idle" });
    
    try {
      const response = await fetch(`${source.url}/api/`, {
        headers: {
          "Authorization": `Token ${source.token}`,
        },
      });
      
      if (response.ok) {
        setTestStatus({ ...testStatus, [source.id]: "success" });
        toast({ title: "Connection successful", description: "NetBox API is reachable" });
      } else {
        setTestStatus({ ...testStatus, [source.id]: "error" });
        toast({ variant: "destructive", title: "Connection failed", description: `HTTP ${response.status}` });
      }
    } catch (error: any) {
      setTestStatus({ ...testStatus, [source.id]: "error" });
      toast({ variant: "destructive", title: "Connection failed", description: error.message });
    } finally {
      setTestingSource(null);
    }
  };

  const handleImport = async (source: NetboxInventorySource) => {
    try {
      const response = await apiRequest("POST", "/api/netbox/import", { sourceId: source.id });
      const data = await response.json();
      toast({ title: "Import successful", description: data.message });
      queryClient.invalidateQueries({ queryKey: ["/api/netbox-sources"] });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Import failed", description: error.message });
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">NetBox Inventories</h1>
          <p className="text-muted-foreground mt-1">
            Manage multiple NetBox inventory sources
          </p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) {
            setEditingSource(null);
            form.reset();
          }
        }}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-source">
              <Plus className="mr-2 h-4 w-4" />
              Add Source
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editingSource ? "Edit NetBox Source" : "Add NetBox Source"}</DialogTitle>
              <DialogDescription>
                Configure a NetBox instance to import virtual machines from.
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Production NetBox" data-testid="input-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="url"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>NetBox URL</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="https://netbox.example.com" data-testid="input-url" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="token"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>API Token</FormLabel>
                      <FormControl>
                        <Input {...field} type="password" placeholder="••••••••" data-testid="input-token" />
                      </FormControl>
                      <FormDescription>Read-only token recommended</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="enabled"
                  render={({ field }) => (
                    <FormItem className="flex items-center gap-2 space-y-0">
                      <FormControl>
                        <Checkbox
                          checked={!!field.value}
                          onCheckedChange={field.onChange}
                          data-testid="checkbox-enabled"
                        />
                      </FormControl>
                      <FormLabel className="!mt-0 cursor-pointer">Enable this source</FormLabel>
                    </FormItem>
                  )}
                />
                <Button 
                  type="submit" 
                  className="w-full" 
                  disabled={createMutation.isPending || updateMutation.isPending}
                  data-testid="button-submit"
                >
                  {(createMutation.isPending || updateMutation.isPending) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {editingSource ? "Update Source" : "Create Source"}
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(2)].map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <div className="h-6 bg-muted animate-pulse rounded w-3/4" />
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="h-4 bg-muted animate-pulse rounded" />
                  <div className="h-4 bg-muted animate-pulse rounded w-1/2" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : sources.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No NetBox sources configured. Click "Add Source" to get started.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {sources.map((source) => (
            <Card key={source.id} data-testid={`card-source-${source.id}`}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle className="flex items-center gap-2">
                      {source.name}
                      <Badge variant={source.enabled ? "default" : "secondary"}>
                        {source.enabled ? "Enabled" : "Disabled"}
                      </Badge>
                    </CardTitle>
                    <CardDescription className="mt-1 font-mono text-xs">
                      {source.url}
                    </CardDescription>
                  </div>
                  <div className="flex gap-1">
                    <Button 
                      size="icon" 
                      variant="ghost" 
                      onClick={() => handleEdit(source)}
                      data-testid={`button-edit-${source.id}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button 
                      size="icon" 
                      variant="ghost" 
                      onClick={() => handleDelete(source.id)}
                      data-testid={`button-delete-${source.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-sm text-muted-foreground">
                  {source.lastImportAt ? (
                    <p>Last import: {new Date(source.lastImportAt).toLocaleString()}</p>
                  ) : (
                    <p>Never imported</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleTestConnection(source)}
                    disabled={testingSource === source.id}
                    data-testid={`button-test-${source.id}`}
                  >
                    {testingSource === source.id ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : testStatus[source.id] === "success" ? (
                      <CheckCircle2 className="mr-2 h-4 w-4 text-green-500" />
                    ) : testStatus[source.id] === "error" ? (
                      <XCircle className="mr-2 h-4 w-4 text-destructive" />
                    ) : null}
                    Test Connection
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => handleImport(source)}
                    disabled={!source.enabled}
                    data-testid={`button-import-${source.id}`}
                  >
                    <Download className="mr-2 h-4 w-4" />
                    Import VMs
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

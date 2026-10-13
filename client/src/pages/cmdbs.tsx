import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link } from "wouter";
import { Plus, TestTube, Settings, Loader2, InfoIcon, Trash2, RefreshCw, X, CaseSensitive } from "lucide-react";
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

interface CmdbAccount {
  id: string;
  kind: string;
  name: string;
  enabled: boolean;
  config: any;
  createdAt: string;
  updatedAt: string;
}

const cmdbFormSchema = z.object({
  kind: z.enum(["netbox", "idoit", "servicenow"]),
  name: z.string().min(1, "Name is required"),
  enabled: z.boolean().default(true),
  config: z.object({
    url: z.string().url("Invalid URL"),
    token: z.string(),
  }),
});

type CmdbFormData = z.infer<typeof cmdbFormSchema>;

export default function CmdbsPage() {
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingCmdb, setEditingCmdb] = useState<CmdbAccount | null>(null);
  const [tokenEditing, setTokenEditing] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [renamingCmdb, setRenamingCmdb] = useState<CmdbAccount | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      apiRequest("PATCH", `/api/cmdbs/${id}`, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cmdbs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pipelines"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventories"] });
      setRenamingCmdb(null);
      toast({ title: "CMDB renamed successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to rename CMDB", description: error.message, variant: "destructive" });
    },
  });

  const { data: cmdbs = [], isLoading } = useQuery<CmdbAccount[]>({
    queryKey: ["/api/cmdbs"],
  });

  const createMutation = useMutation({
    mutationFn: (data: CmdbFormData) => apiRequest("POST", "/api/cmdbs", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cmdbs"] });
      setIsDialogOpen(false);
      toast({ title: "CMDB account created successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to create CMDB account", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CmdbFormData> }) =>
      apiRequest("PATCH", `/api/cmdbs/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cmdbs"] });
      setIsDialogOpen(false);
      setEditingCmdb(null);
      setTokenEditing(false);
      toast({ title: "CMDB account updated successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to update CMDB account", description: error.message, variant: "destructive" });
    },
  });

  const testMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/cmdbs/${id}/test`),
    onSuccess: (data: any) => {
      if (data.ok) {
        toast({
          title: "Connection successful",
          description: `Version: ${data.version || "N/A"}`,
        });
      } else {
        toast({ title: "Connection failed", description: data.error, variant: "destructive" });
      }
      setTestingId(null);
    },
    onError: (error: any) => {
      toast({ title: "Test failed", description: error.message, variant: "destructive" });
      setTestingId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/cmdbs/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cmdbs"] });
      toast({ title: "CMDB account deleted successfully" });
      setDeleteId(null);
    },
    onError: (error: any) => {
      toast({ title: "Failed to delete CMDB account", description: error.message, variant: "destructive" });
      setDeleteId(null);
    },
  });

  const form = useForm<CmdbFormData>({
    resolver: zodResolver(cmdbFormSchema),
    defaultValues: {
      kind: "netbox",
      name: "",
      enabled: true,
      config: {
        url: "",
        token: "",
      },
    },
  });

  const handleAdd = () => {
    setEditingCmdb(null);
    setTokenEditing(true);
    form.reset({
      kind: "netbox",
      name: "",
      enabled: true,
      config: { url: "", token: "" },
    });
    setIsDialogOpen(true);
  };

  const handleEdit = (cmdb: CmdbAccount) => {
    setEditingCmdb(cmdb);
    setTokenEditing(false);
    const config = (cmdb.config as any) || {};
    form.reset({
      kind: cmdb.kind as any,
      name: cmdb.name,
      enabled: cmdb.enabled,
      config: { url: config.url || "", token: "" },
    });
    setIsDialogOpen(true);
  };

  const onSubmit = (data: CmdbFormData) => {
    const needsToken = !editingCmdb || tokenEditing;
    if (needsToken && !data.config.token) {
      form.setError("config.token", { message: "Token is required" });
      return;
    }
    if (editingCmdb) {
      const payload: any = {
        name: data.name,
        enabled: data.enabled,
        config: { url: data.config.url },
      };
      if (tokenEditing && data.config.token) {
        payload.config.token = data.config.token;
      }
      updateMutation.mutate({ id: editingCmdb.id, data: payload });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleTest = (id: string) => {
    setTestingId(id);
    testMutation.mutate(id);
  };

  const handleToggleEnabled = (cmdb: CmdbAccount) => {
    updateMutation.mutate({
      id: cmdb.id,
      data: { enabled: !cmdb.enabled },
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">CMDBs</h1>
          <p className="text-sm text-muted-foreground">Manage NetBox and future CMDB target connections</p>
        </div>
        <Button onClick={handleAdd} data-testid="button-add-cmdb">
          <Plus className="w-4 h-4 mr-2" />
          Add CMDB
        </Button>
      </div>

      <Alert>
        <InfoIcon className="w-4 h-4" />
        <AlertDescription>
          NetBox connections can be tested here before they are used for inventory sync and automation targeting.
        </AlertDescription>
      </Alert>

      {cmdbs.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <p className="font-medium mb-2">No CMDB accounts configured</p>
            <p className="text-sm text-muted-foreground mb-4">Add NetBox to test the API connection and use it as an inventory source.</p>
            <Button onClick={handleAdd} data-testid="button-add-first-cmdb">
              <Plus className="w-4 h-4 mr-2" />
              Add your first CMDB
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>CMDB Accounts</CardTitle>
            <CardDescription>Target systems for infrastructure data synchronization</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-3 font-medium">Name</th>
                    <th className="text-left p-3 font-medium">Kind</th>
                    <th className="text-left p-3 font-medium">Enabled</th>
                    <th className="text-left p-3 font-medium">Status</th>
                    <th className="text-right p-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {cmdbs.map((cmdb) => (
                    <tr key={cmdb.id} className="border-b hover-elevate" data-testid={`row-cmdb-${cmdb.id}`}>
                      <td className="p-3 font-medium" data-testid={`text-cmdb-name-${cmdb.id}`}>
                        <Link
                          href={`/cmdbs/${cmdb.id}`}
                          className="hover:underline text-foreground"
                          data-testid={`link-cmdb-${cmdb.id}`}
                        >
                          {cmdb.name}
                        </Link>
                      </td>
                      <td className="p-3">
                        <Badge variant="outline">{cmdb.kind}</Badge>
                      </td>
                      <td className="p-3">
                        {cmdb.enabled ? (
                          <Badge variant="default">Enabled</Badge>
                        ) : (
                          <Badge variant="secondary">Disabled</Badge>
                        )}
                      </td>
                      <td className="p-3">
                        <Badge variant="secondary">Ready</Badge>
                      </td>
                      <td className="p-3">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleTest(cmdb.id)}
                            disabled={testingId === cmdb.id}
                            data-testid={`button-test-${cmdb.id}`}
                          >
                            {testingId === cmdb.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <TestTube className="w-4 h-4" />
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Rename CMDB"
                            onClick={() => { setRenamingCmdb(cmdb); setRenameValue(cmdb.name); }}
                            data-testid={`button-rename-${cmdb.id}`}
                          >
                            <CaseSensitive className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Edit configuration"
                            onClick={() => handleEdit(cmdb)}
                            data-testid={`button-edit-${cmdb.id}`}
                          >
                            <Settings className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setDeleteId(cmdb.id)}
                            data-testid={`button-delete-${cmdb.id}`}
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                          <Switch
                            checked={cmdb.enabled}
                            onCheckedChange={() => handleToggleEnabled(cmdb)}
                            data-testid={`switch-enabled-${cmdb.id}`}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingCmdb ? "Edit CMDB Account" : "Add CMDB Account"}</DialogTitle>
            <DialogDescription>
              Configure connection to a CMDB system for infrastructure data management
            </DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="kind"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>CMDB Kind</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value} disabled={!!editingCmdb}>
                      <FormControl>
                        <SelectTrigger data-testid="select-cmdb-kind">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="netbox">NetBox</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

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
                name="enabled"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base">Enabled</FormLabel>
                      <FormDescription>Allow this CMDB to receive data</FormDescription>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-enabled" />
                    </FormControl>
                  </FormItem>
                )}
              />

              <div className="border-t pt-4 space-y-4">
                <h4 className="font-medium">Connection Settings</h4>

                <FormField
                  control={form.control}
                  name="config.url"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>URL</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="https://netbox.example.com" data-testid="input-url" />
                      </FormControl>
                      <FormDescription>
                        Base URL, for example https://netbox.example.com. For local Docker development use http://host.docker.internal:8000.
                        Do not include /api at the end. If Rovelink runs in Docker and NetBox runs on the host, localhost points to the Rovelink container.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="config.token"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>API Token</FormLabel>
                      {editingCmdb && !tokenEditing ? (
                        <div className="flex items-center gap-2">
                          <Input
                            value="••••••••••••••••••••"
                            readOnly
                            disabled
                            className="font-mono tracking-widest flex-1"
                            data-testid="input-token-masked"
                          />
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            onClick={() => {
                              setTokenEditing(true);
                              field.onChange("");
                            }}
                            title="Replace token"
                            data-testid="button-edit-token"
                          >
                            <RefreshCw className="w-4 h-4" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <FormControl>
                            <Input
                              {...field}
                              type="password"
                              autoFocus={tokenEditing && !!editingCmdb}
                              placeholder="Raw NetBox token, e.g. nbt_xxx"
                              className="flex-1"
                              data-testid="input-token"
                            />
                          </FormControl>
                          {editingCmdb && tokenEditing && (
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              onClick={() => {
                                setTokenEditing(false);
                                field.onChange("");
                                form.clearErrors("config.token");
                              }}
                              title="Cancel token change"
                              data-testid="button-cancel-token"
                            >
                              <X className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      )}
                      <FormDescription>
                        {editingCmdb && !tokenEditing
                          ? "Token is saved. Click the refresh button to replace it."
                          : editingCmdb
                          ? "Enter a new token to replace the existing one."
                          : "Authentication token for API access."}
                        {" Use the raw NetBox token only, for example nbt_xxx. Do not paste a Bearer or Token prefix."}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => { setIsDialogOpen(false); setTokenEditing(false); }}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending} data-testid="button-submit">
                  {(createMutation.isPending || updateMutation.isPending) && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  {editingCmdb ? "Update" : "Create"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete CMDB Account?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this CMDB account. Any automation inventories linked to this CMDB will need to be reconfigured. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Rename Dialog */}
      <Dialog open={!!renamingCmdb} onOpenChange={(open) => { if (!open) setRenamingCmdb(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename CMDB</DialogTitle>
            <DialogDescription>
              Only the display name changes. All pipelines and automation inventories continue to reference this CMDB by its internal ID.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              placeholder="CMDB name"
              autoFocus
              data-testid="input-rename-cmdb"
              onKeyDown={(e) => {
                if (e.key === "Enter" && renameValue.trim() && renamingCmdb) {
                  renameMutation.mutate({ id: renamingCmdb.id, name: renameValue.trim() });
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenamingCmdb(null)}>Cancel</Button>
            <Button
              onClick={() => {
                if (renameValue.trim() && renamingCmdb) {
                  renameMutation.mutate({ id: renamingCmdb.id, name: renameValue.trim() });
                }
              }}
              disabled={renameMutation.isPending || !renameValue.trim()}
              data-testid="button-confirm-rename-cmdb"
            >
              {renameMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

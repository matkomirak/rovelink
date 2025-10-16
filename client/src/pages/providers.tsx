import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, PlayCircle, TestTube, Loader2, CheckCircle, XCircle, Clock, Eye, Pencil, Trash2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { insertProviderAccountSchema, type ProviderAccount } from "@shared/schema";
import { z } from "zod";

const providerFormSchema = insertProviderAccountSchema.extend({
  base_url: z.string().optional(),
  auth_method: z.enum(["password", "api_token"]).optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  token_id: z.string().optional(),
  token_secret: z.string().optional(),
  realm: z.string().optional(),
  verify_ssl: z.boolean().optional(),
});

export default function Providers() {
  const [open, setOpen] = useState(false);
  const [selectedKind, setSelectedKind] = useState<string>("");
  const { toast } = useToast();

  const { data: providers, isLoading } = useQuery<ProviderAccount[]>({
    queryKey: ["/api/providers"],
  });

  const { data: stats } = useQuery<any[]>({
    queryKey: ["/api/stats/providers"],
    refetchInterval: 10000,
  });

  const form = useForm<z.infer<typeof providerFormSchema>>({
    resolver: zodResolver(providerFormSchema),
    defaultValues: {
      name: "",
      kind: "proxmox",
      enabled: true,
      config: {},
      base_url: "",
      auth_method: "password",
      username: "",
      password: "",
      realm: "pam",
      verify_ssl: true,
    },
  });

  const [editingProvider, setEditingProvider] = useState<ProviderAccount | null>(null);

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const { base_url, auth_method, username, password, token_id, token_secret, realm, verify_ssl, ...providerData } = data;
      
      const config: any = {
        base_url,
        auth_method,
        realm,
        verify_ssl,
      };
      
      if (auth_method === "password") {
        config.username = username;
        config.password = password;
      } else {
        config.username = username;
        config.token_id = token_id;
        config.token_secret = token_secret;
      }
      
      return apiRequest("POST", "/api/providers", {
        ...providerData,
        config,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/providers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats/providers"] });
      setOpen(false);
      form.reset();
      toast({
        title: "Success",
        description: "Provider created successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create provider",
        variant: "destructive",
      });
    },
  });

  const testMutation = useMutation({
    mutationFn: async (providerId: string) => {
      return apiRequest("POST", `/api/providers/${providerId}/test`);
    },
    onSuccess: (data: any) => {
      if (data.ok) {
        toast({
          title: "Connection Successful",
          description: data.details || "Successfully connected to provider",
        });
      } else {
        toast({
          title: "Connection Failed",
          description: data.error || "Failed to connect",
          variant: "destructive",
        });
      }
    },
  });

  const syncMutation = useMutation({
    mutationFn: async (providerId: string) => {
      return apiRequest("POST", `/api/providers/${providerId}/sync`);
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/providers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats/providers"] });
      toast({
        title: "Sync Started",
        description: `Sync run ${data.runId} has been queued`,
      });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      return apiRequest("PATCH", `/api/providers/${id}`, { enabled });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/providers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats/providers"] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const { base_url, auth_method, username, password, token_id, token_secret, realm, verify_ssl, ...providerData } = data;
      const config: any = { base_url, auth_method, realm, verify_ssl };
      if (auth_method === "password") {
        config.username = username;
        config.password = password;
      } else {
        config.username = username;
        config.token_id = token_id;
        config.token_secret = token_secret;
      }
      return apiRequest("PATCH", `/api/providers/${id}`, { ...providerData, config });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/providers"] });
      toast({ title: "Provider updated successfully" });
      setOpen(false);
      setEditingProvider(null);
      form.reset();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/providers/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/providers"] });
      toast({ title: "Provider deleted successfully" });
    },
  });

  const getStatusBadge = (status: string | undefined) => {
    if (!status) return <Badge variant="outline">Never Run</Badge>;
    switch (status) {
      case "ok":
        return <Badge className="bg-green-500/10 text-green-500 border-green-500/20"><CheckCircle className="w-3 h-3 mr-1" />OK</Badge>;
      case "failed":
      case "error":
        return <Badge className="bg-red-500/10 text-red-500 border-red-500/20"><XCircle className="w-3 h-3 mr-1" />Failed</Badge>;
      case "running":
        return <Badge className="bg-blue-500/10 text-blue-500 border-blue-500/20"><Loader2 className="w-3 h-3 mr-1 animate-spin" />Running</Badge>;
      default:
        return <Badge variant="outline"><Clock className="w-3 h-3 mr-1" />Queued</Badge>;
    }
  };

  const formatDate = (date: string | null | undefined) => {
    if (!date) return "—";
    return new Date(date).toLocaleString();
  };

  const handleEdit = (provider: ProviderAccount) => {
    setEditingProvider(provider);
    const config = provider.config as any;
    form.reset({
      name: provider.name,
      kind: provider.kind,
      enabled: provider.enabled,
      config: provider.config,
      base_url: config?.base_url || "",
      auth_method: config?.auth_method || "password",
      username: config?.username || "",
      password: config?.password || "",
      token_id: config?.token_id || "",
      token_secret: config?.token_secret || "",
      realm: config?.realm || "pam",
      verify_ssl: config?.verify_ssl !== false,
    });
    setSelectedKind(provider.kind);
    setOpen(true);
  };

  const handleDelete = (id: string) => {
    if (confirm("Are you sure you want to delete this provider?")) {
      deleteMutation.mutate(id);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-providers-title">Providers</h1>
          <p className="text-muted-foreground mt-1">Manage provider accounts and sync inventory to NetBox</p>
        </div>
        <Dialog open={open} onOpenChange={(isOpen) => {
          setOpen(isOpen);
          if (!isOpen) {
            setEditingProvider(null);
            form.reset();
          }
        }}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-provider">
              <Plus className="w-4 h-4 mr-2" />
              Add Provider
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingProvider ? "Edit" : "Add"} Provider Account</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit((data) => {
                if (editingProvider) {
                  updateMutation.mutate({ id: editingProvider.id, data });
                } else {
                  createMutation.mutate(data);
                }
              })} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Production Proxmox" {...field} data-testid="input-provider-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="kind"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Provider Kind</FormLabel>
                      <Select onValueChange={(value) => { field.onChange(value); setSelectedKind(value); }} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-provider-kind">
                            <SelectValue placeholder="Select provider type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="proxmox">Proxmox</SelectItem>
                          <SelectItem value="vmware" disabled>VMware (Coming Soon)</SelectItem>
                          <SelectItem value="azure" disabled>Azure (Coming Soon)</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {(selectedKind === "proxmox" || form.watch("kind") === "proxmox") && (
                  <>
                    <FormField
                      control={form.control}
                      name="base_url"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Proxmox URL</FormLabel>
                          <FormControl>
                            <Input placeholder="https://proxmox.example.com:8006" {...field} data-testid="input-base-url" />
                          </FormControl>
                          <FormDescription>Base URL of your Proxmox server</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="auth_method"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Authentication Method</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger data-testid="select-auth-method">
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="password">Password</SelectItem>
                              <SelectItem value="api_token">API Token</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="username"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Username</FormLabel>
                          <FormControl>
                            <Input placeholder="root" {...field} data-testid="input-username" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {form.watch("auth_method") === "password" ? (
                      <>
                        <FormField
                          control={form.control}
                          name="password"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Password</FormLabel>
                              <FormControl>
                                <Input type="password" {...field} data-testid="input-password" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="realm"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Realm</FormLabel>
                              <FormControl>
                                <Input placeholder="pam" {...field} data-testid="input-realm" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </>
                    ) : (
                      <>
                        <FormField
                          control={form.control}
                          name="token_id"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Token ID</FormLabel>
                              <FormControl>
                                <Input placeholder="user@pam!tokenid" {...field} data-testid="input-token-id" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="token_secret"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Token Secret</FormLabel>
                              <FormControl>
                                <Input type="password" {...field} data-testid="input-token-secret" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </>
                    )}

                    <FormField
                      control={form.control}
                      name="verify_ssl"
                      render={({ field }) => (
                        <FormItem className="flex items-center justify-between">
                          <div>
                            <FormLabel>Verify SSL</FormLabel>
                            <FormDescription>Enable SSL certificate verification</FormDescription>
                          </div>
                          <FormControl>
                            <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-verify-ssl" />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </>
                )}

                <FormField
                  control={form.control}
                  name="enabled"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between">
                      <div>
                        <FormLabel>Enabled</FormLabel>
                        <FormDescription>Enable this provider for scheduled syncs</FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-enabled" />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <div className="flex justify-end gap-2 pt-4">
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={createMutation.isPending} data-testid="button-create-provider">
                    {createMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                    Create Provider
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center p-12">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : !providers || providers.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center p-12">
            <p className="text-muted-foreground">No providers configured yet.</p>
            <p className="text-sm text-muted-foreground mt-1">Add a provider to start syncing inventory.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Provider Accounts</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Sync</TableHead>
                  <TableHead>Next Run</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {providers.map((provider) => {
                  const stat = stats?.find((s) => s.id === provider.id);
                  return (
                    <TableRow key={provider.id} data-testid={`row-provider-${provider.id}`}>
                      <TableCell className="font-medium">{provider.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{provider.kind}</Badge>
                      </TableCell>
                      <TableCell>{getStatusBadge(stat?.lastSync?.status)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(stat?.lastSync?.finishedAt)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {stat?.nextRun ? formatDate(stat.nextRun) : "—"}
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={provider.enabled}
                          onCheckedChange={(checked) => toggleMutation.mutate({ id: provider.id, enabled: checked })}
                          data-testid={`switch-enabled-${provider.id}`}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => handleEdit(provider)}
                            data-testid={`button-edit-${provider.id}`}
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => handleDelete(provider.id)}
                            data-testid={`button-delete-${provider.id}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => testMutation.mutate(provider.id)}
                            disabled={testMutation.isPending}
                            data-testid={`button-test-${provider.id}`}
                          >
                            <TestTube className="w-4 h-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => syncMutation.mutate(provider.id)}
                            disabled={syncMutation.isPending}
                            data-testid={`button-sync-${provider.id}`}
                          >
                            <PlayCircle className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

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
import { Plus, PlayCircle, TestTube, Loader2, CheckCircle, XCircle, Clock, Eye, Pencil, Trash2, ExternalLink } from "lucide-react";
import { Link } from "wouter";
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
  // Azure provider fields
  subscription_id: z.string().optional(),
  tenant_id: z.string().optional(),
  client_id: z.string().optional(),
  client_secret: z.string().optional(),
  resource_groups: z.string().optional(),
  // Fake provider fields
  variant: z.enum(["proxmox", "vsphere", "azure", "aws"]).optional(),
  seed: z.number().optional(),
  vms: z.number().optional(),
  tenants: z.string().optional(),
  sites: z.string().optional(),
  clusters: z.string().optional(),
  nodes: z.string().optional(),
  linux_pct: z.number().optional(),
  tags_customer: z.string().optional(),
  tags_wave: z.string().optional(),
  tags_role: z.string().optional(),
  nics_min: z.number().optional(),
  nics_max: z.number().optional(),
  ips_min: z.number().optional(),
  ips_max: z.number().optional(),
  ipv4_cidrs: z.string().optional(),
  missing_ip_pct: z.number().optional(),
});

export default function Providers() {
  const [open, setOpen] = useState(false);
  const [selectedKind, setSelectedKind] = useState<string>("");
  const [showAdvanced, setShowAdvanced] = useState(false);
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
      variant: "proxmox",
      seed: 42,
      vms: 100,
      linux_pct: 70,
      missing_ip_pct: 10,
      nics_min: 1,
      nics_max: 1,
      ips_min: 1,
      ips_max: 1,
    },
  });

  const [editingProvider, setEditingProvider] = useState<ProviderAccount | null>(null);

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const { base_url, auth_method, username, password, token_id, token_secret, realm, verify_ssl, subscription_id, tenant_id, client_id, client_secret, resource_groups, variant, seed, vms, tenants, sites, clusters, nodes, linux_pct, tags_customer, tags_wave, tags_role, nics_min, nics_max, ips_min, ips_max, ipv4_cidrs, missing_ip_pct, ...providerData } = data;
      
      let config: any = {};
      
      if (data.kind === "fake") {
        config = {
          variant,
          seed: seed || 42,
          vms: vms || 100,
          linux_pct: linux_pct || 70,
          missing_ip_pct: missing_ip_pct || 10,
        };
        
        if (tenants) config.tenants = tenants.split(",").map((s: string) => s.trim());
        if (sites) config.sites = sites.split(",").map((s: string) => s.trim());
        if (clusters) config.clusters = clusters.split(",").map((s: string) => s.trim());
        if (nodes) config.nodes = nodes.split(",").map((s: string) => s.trim());
        if (ipv4_cidrs) config.ipv4_cidrs = ipv4_cidrs.split(",").map((s: string) => s.trim());
        
        if (tags_customer || tags_wave || tags_role) {
          config.tags = {};
          if (tags_customer) config.tags.customer = tags_customer.split(",").map((s: string) => s.trim());
          if (tags_wave) config.tags.wave = tags_wave.split(",").map((s: string) => s.trim());
          if (tags_role) config.tags.role = tags_role.split(",").map((s: string) => s.trim());
        }
        
        if (nics_min !== undefined || nics_max !== undefined) {
          config.nics_per_vm = { min: nics_min || 1, max: nics_max || 1 };
        }
        
        if (ips_min !== undefined || ips_max !== undefined) {
          config.ips_per_nic = { min: ips_min || 1, max: ips_max || 1 };
        }
      } else if (data.kind === "azure") {
        config = {
          subscription_id,
          tenant_id,
          client_id,
          client_secret,
        };
        if (resource_groups) {
          config.resource_groups = resource_groups.split(",").map((s: string) => s.trim()).filter(Boolean);
        }
      } else {
        config = {
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
      setShowAdvanced(false);
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
      const { base_url, auth_method, username, password, token_id, token_secret, realm, verify_ssl, subscription_id, tenant_id, client_id, client_secret, resource_groups, ...providerData } = data;
      let config: any = {};
      if (data.kind === "azure") {
        config = { subscription_id, tenant_id, client_id, client_secret };
        if (resource_groups) {
          config.resource_groups = resource_groups.split(",").map((s: string) => s.trim()).filter(Boolean);
        }
      } else {
        config = { base_url, auth_method, realm, verify_ssl };
        if (auth_method === "password") {
          config.username = username;
          config.password = password;
        } else {
          config.username = username;
          config.token_id = token_id;
          config.token_secret = token_secret;
        }
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
    
    if (provider.kind === "fake") {
      form.reset({
        name: provider.name,
        kind: provider.kind,
        enabled: provider.enabled,
        variant: config?.variant || "proxmox",
        seed: config?.seed || 42,
        vms: config?.vms || 100,
        linux_pct: config?.linux_pct || 70,
        missing_ip_pct: config?.missing_ip_pct || 10,
        tenants: config?.tenants?.join(",") || "",
        sites: config?.sites?.join(",") || "",
        clusters: config?.clusters?.join(",") || "",
        nodes: config?.nodes?.join(",") || "",
        tags_customer: config?.tags?.customer?.join(",") || "",
        tags_wave: config?.tags?.wave?.join(",") || "",
        tags_role: config?.tags?.role?.join(",") || "",
        nics_min: config?.nics_per_vm?.min || 1,
        nics_max: config?.nics_per_vm?.max || 1,
        ips_min: config?.ips_per_nic?.min || 1,
        ips_max: config?.ips_per_nic?.max || 1,
        ipv4_cidrs: config?.ipv4_cidrs?.join(",") || "",
      });
    } else if (provider.kind === "azure") {
      form.reset({
        name: provider.name,
        kind: provider.kind,
        enabled: provider.enabled,
        subscription_id: config?.subscription_id || "",
        tenant_id: config?.tenant_id || "",
        client_id: config?.client_id || "",
        client_secret: "",
        resource_groups: config?.resource_groups?.join(",") || "",
      });
    } else {
      form.reset({
        name: provider.name,
        kind: provider.kind,
        enabled: provider.enabled,
        base_url: config?.base_url || "",
        auth_method: config?.auth_method || "password",
        username: config?.username || "",
        password: "",
        token_id: config?.token_id || "",
        token_secret: "",
        realm: config?.realm || "pam",
        verify_ssl: config?.verify_ssl !== false,
      });
    }
    
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
            setShowAdvanced(false);
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
                          <SelectItem value="fake">Fake (Generator)</SelectItem>
                          <SelectItem value="azure">Azure</SelectItem>
                          <SelectItem value="vmware" disabled>VMware (Coming Soon)</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {(selectedKind === "fake" || form.watch("kind") === "fake") && (
                  <>
                    <FormField
                      control={form.control}
                      name="variant"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Variant</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger data-testid="select-variant">
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="proxmox">Proxmox</SelectItem>
                              <SelectItem value="vsphere">vSphere</SelectItem>
                              <SelectItem value="azure">Azure</SelectItem>
                              <SelectItem value="aws">AWS</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormDescription>Provider shape to emulate</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="grid grid-cols-3 gap-4">
                      <FormField
                        control={form.control}
                        name="seed"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Seed</FormLabel>
                            <FormControl>
                              <Input type="number" {...field} onChange={(e) => field.onChange(parseInt(e.target.value))} data-testid="input-seed" />
                            </FormControl>
                            <FormDescription>For deterministic output</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      
                      <FormField
                        control={form.control}
                        name="vms"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>VM Count</FormLabel>
                            <FormControl>
                              <Input type="number" {...field} onChange={(e) => field.onChange(parseInt(e.target.value))} data-testid="input-vms" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="linux_pct"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Linux %</FormLabel>
                            <FormControl>
                              <Input type="number" {...field} onChange={(e) => field.onChange(parseInt(e.target.value))} data-testid="input-linux-pct" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="flex items-center gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => setShowAdvanced(!showAdvanced)} data-testid="button-toggle-advanced">
                        {showAdvanced ? "Hide" : "Show"} Advanced Options
                      </Button>
                    </div>

                    {showAdvanced && (
                      <div className="space-y-4 p-4 border rounded-md">
                        <div className="grid grid-cols-2 gap-4">
                          <FormField
                            control={form.control}
                            name="tenants"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Tenants (comma-separated)</FormLabel>
                                <FormControl>
                                  <Input placeholder="Alpha,Beta" {...field} data-testid="input-tenants" />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          <FormField
                            control={form.control}
                            name="sites"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Sites (comma-separated)</FormLabel>
                                <FormControl>
                                  <Input placeholder="PRG-DC1,PRG-DC2" {...field} data-testid="input-sites" />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          <FormField
                            control={form.control}
                            name="clusters"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Clusters</FormLabel>
                                <FormControl>
                                  <Input placeholder="C0,C1" {...field} data-testid="input-clusters" />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          <FormField
                            control={form.control}
                            name="nodes"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Nodes</FormLabel>
                                <FormControl>
                                  <Input placeholder="pve1,pve2" {...field} data-testid="input-nodes" />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          <FormField
                            control={form.control}
                            name="tags_customer"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Tags: Customer</FormLabel>
                                <FormControl>
                                  <Input placeholder="Alpha,Beta,Gamma" {...field} data-testid="input-tags-customer" />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          <FormField
                            control={form.control}
                            name="tags_wave"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Tags: Wave</FormLabel>
                                <FormControl>
                                  <Input placeholder="Wave1,Wave2,Wave3" {...field} data-testid="input-tags-wave" />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          <FormField
                            control={form.control}
                            name="tags_role"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Tags: Role</FormLabel>
                                <FormControl>
                                  <Input placeholder="web,app,db" {...field} data-testid="input-tags-role" />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          <FormField
                            control={form.control}
                            name="ipv4_cidrs"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>IPv4 CIDRs</FormLabel>
                                <FormControl>
                                  <Input placeholder="10.50.0.0/16,10.60.0.0/16" {...field} data-testid="input-ipv4-cidrs" />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          <FormField
                            control={form.control}
                            name="missing_ip_pct"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Missing IP %</FormLabel>
                                <FormControl>
                                  <Input type="number" {...field} onChange={(e) => field.onChange(parseInt(e.target.value))} data-testid="input-missing-ip-pct" />
                                </FormControl>
                                <FormDescription>% of VMs with no guest IPs</FormDescription>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div className="grid grid-cols-2 gap-2">
                            <FormField
                              control={form.control}
                              name="nics_min"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>NICs Min</FormLabel>
                                  <FormControl>
                                    <Input type="number" {...field} onChange={(e) => field.onChange(parseInt(e.target.value))} data-testid="input-nics-min" />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={form.control}
                              name="nics_max"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>NICs Max</FormLabel>
                                  <FormControl>
                                    <Input type="number" {...field} onChange={(e) => field.onChange(parseInt(e.target.value))} data-testid="input-nics-max" />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <FormField
                              control={form.control}
                              name="ips_min"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>IPs Min</FormLabel>
                                  <FormControl>
                                    <Input type="number" {...field} onChange={(e) => field.onChange(parseInt(e.target.value))} data-testid="input-ips-min" />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={form.control}
                              name="ips_max"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>IPs Max</FormLabel>
                                  <FormControl>
                                    <Input type="number" {...field} onChange={(e) => field.onChange(parseInt(e.target.value))} data-testid="input-ips-max" />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}

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
                                <Input type="password" placeholder={editingProvider ? "Leave blank to keep existing" : ""} {...field} data-testid="input-password" />
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
                                <Input type="password" placeholder={editingProvider ? "Leave blank to keep existing" : ""} {...field} data-testid="input-token-secret" />
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

                {(selectedKind === "azure" || form.watch("kind") === "azure") && (
                  <>
                    <FormField
                      control={form.control}
                      name="subscription_id"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Subscription ID</FormLabel>
                          <FormControl>
                            <Input placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" {...field} data-testid="input-subscription-id" />
                          </FormControl>
                          <FormDescription>Your Azure subscription ID</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="tenant_id"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Tenant ID</FormLabel>
                          <FormControl>
                            <Input placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" {...field} data-testid="input-tenant-id" />
                          </FormControl>
                          <FormDescription>Your Azure Active Directory tenant ID</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="client_id"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Client ID</FormLabel>
                            <FormControl>
                              <Input placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" {...field} data-testid="input-client-id" />
                            </FormControl>
                            <FormDescription>Service principal application ID</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="client_secret"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Client Secret</FormLabel>
                            <FormControl>
                              <Input type="password" placeholder={editingProvider ? "Leave blank to keep existing" : "Service principal secret"} {...field} data-testid="input-client-secret" />
                            </FormControl>
                            <FormDescription>Service principal secret value</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <FormField
                      control={form.control}
                      name="resource_groups"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Resource Groups (optional)</FormLabel>
                          <FormControl>
                            <Input placeholder="rg-prod,rg-staging" {...field} data-testid="input-resource-groups" />
                          </FormControl>
                          <FormDescription>Comma-separated list of resource groups to scope. Leave blank to sync all.</FormDescription>
                          <FormMessage />
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
                      <TableCell className="font-medium">
                        <Link href={`/providers/${provider.id}`}>
                          <span className="text-primary hover:underline cursor-pointer" data-testid={`link-provider-${provider.id}`}>
                            {provider.name}
                          </span>
                        </Link>
                      </TableCell>
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

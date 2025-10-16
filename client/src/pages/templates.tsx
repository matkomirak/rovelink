import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileText, Plus, Play, Calendar, Loader2, AlertTriangle } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { insertJobTemplateSchema, type JobTemplate, type InsertJobTemplate, type Project, type Credential } from "@shared/schema";

export default function Templates() {
  const [open, setOpen] = useState(false);
  const [limitExpr, setLimitExpr] = useState("");
  const { toast } = useToast();

  const { data: templates, isLoading } = useQuery<JobTemplate[]>({
    queryKey: ["/api/templates"],
  });

  const { data: projects } = useQuery<Project[]>({
    queryKey: ["/api/projects"],
  });

  const { data: credentials } = useQuery<Credential[]>({
    queryKey: ["/api/credentials"],
  });

  const { data: preflight } = useQuery({
    queryKey: ["/api/inventory/preflight", limitExpr],
    enabled: limitExpr.length > 2,
  });

  const form = useForm<InsertJobTemplate>({
    resolver: zodResolver(insertJobTemplateSchema),
    defaultValues: {
      name: "",
      projectId: "",
      playbook: "",
      credentialId: "",
      limitExpr: "",
      extraVars: {},
      checkMode: false,
      diffMode: false,
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: InsertJobTemplate) => apiRequest("POST", "/api/templates", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/templates"] });
      toast({ title: "Template created successfully" });
      setOpen(false);
      form.reset();
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", title: "Failed to create template", description: error.message });
    },
  });

  const launchMutation = useMutation({
    mutationFn: (templateId: string) => apiRequest("POST", `/api/templates/${templateId}/launch`, {}),
    onSuccess: () => {
      toast({ title: "Job launched successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/runs"] });
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", title: "Failed to launch job", description: error.message });
    },
  });

  const selectedProject = projects?.find(p => p.id === form.watch("projectId"));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-page-title">Job Templates</h1>
          <p className="text-sm text-muted-foreground">Configure and launch automation jobs</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-template">
              <Plus className="h-4 w-4 mr-2" />
              New Template
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create Job Template</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit((data) => createMutation.mutate(data))} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Deploy Web Servers" data-testid="input-template-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="projectId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Project</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-project">
                              <SelectValue placeholder="Select project" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {projects?.map((project) => (
                              <SelectItem key={project.id} value={project.id}>
                                {project.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="playbook"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Playbook</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-playbook">
                              <SelectValue placeholder="Select playbook" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {selectedProject && Array.isArray(selectedProject.playbooks) && selectedProject.playbooks.length > 0 ? (
                              selectedProject.playbooks.map((playbook: string) => (
                                <SelectItem key={playbook} value={playbook}>
                                  {playbook}
                                </SelectItem>
                              ))
                            ) : (
                              <SelectItem value="site.yml" disabled>No playbooks (sync project first)</SelectItem>
                            )}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="credentialId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Credential (Optional)</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value || ""}>
                        <FormControl>
                          <SelectTrigger data-testid="select-credential">
                            <SelectValue placeholder="Select credential" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="">None</SelectItem>
                          {credentials?.map((cred) => (
                            <SelectItem key={cred.id} value={cred.id}>
                              {cred.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="limitExpr"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Limit Expression</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="tag_customer_x:&tag_os_linux"
                          className="font-mono"
                          data-testid="input-limit-expr"
                          onChange={(e) => {
                            field.onChange(e);
                            setLimitExpr(e.target.value);
                          }}
                        />
                      </FormControl>
                      <FormDescription>Pattern to select hosts</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {preflight && limitExpr.length > 2 && (
                  <div className="p-3 bg-muted rounded-lg">
                    <p className="text-sm font-medium mb-1">
                      Preflight: {preflight.matched || 0} host{preflight.matched !== 1 ? "s" : ""} matched
                    </p>
                    {preflight.warnings?.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {preflight.warnings.map((warning: string, i: number) => (
                          <p key={i} className="text-xs text-yellow-600 dark:text-yellow-400 flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            {warning}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <FormField
                  control={form.control}
                  name="extraVars"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Extra Variables (JSON)</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          value={typeof field.value === 'string' ? field.value : JSON.stringify(field.value, null, 2)}
                          onChange={(e) => {
                            try {
                              const parsed = JSON.parse(e.target.value);
                              field.onChange(parsed);
                            } catch {
                              field.onChange(e.target.value);
                            }
                          }}
                          placeholder='{"env": "production"}'
                          className="font-mono text-sm"
                          data-testid="input-extra-vars"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="flex gap-6">
                  <FormField
                    control={form.control}
                    name="checkMode"
                    render={({ field }) => (
                      <FormItem className="flex items-center gap-2 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            data-testid="checkbox-check-mode"
                          />
                        </FormControl>
                        <FormLabel className="!mt-0 cursor-pointer">Check Mode (dry run)</FormLabel>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="diffMode"
                    render={({ field }) => (
                      <FormItem className="flex items-center gap-2 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            data-testid="checkbox-diff-mode"
                          />
                        </FormControl>
                        <FormLabel className="!mt-0 cursor-pointer">Diff Mode (show changes)</FormLabel>
                      </FormItem>
                    )}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={createMutation.isPending} data-testid="button-submit">
                  {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Create Template
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => (
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
      ) : templates && templates.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {templates.map((template) => (
            <Card key={template.id} data-testid={`card-template-${template.id}`}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <FileText className="h-5 w-5 text-primary" />
                    <CardTitle className="text-lg">{template.name}</CardTitle>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Playbook</p>
                    <p className="text-sm font-mono">{template.playbook}</p>
                  </div>
                  {template.limitExpr && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Limit</p>
                      <p className="text-sm font-mono">{template.limitExpr}</p>
                    </div>
                  )}
                  <div className="flex gap-2">
                    {template.checkMode && <Badge variant="outline">Check Mode</Badge>}
                    {template.diffMode && <Badge variant="outline">Diff Mode</Badge>}
                  </div>
                </div>
                <Button
                  variant="default"
                  size="sm"
                  className="w-full"
                  onClick={() => launchMutation.mutate(template.id)}
                  disabled={launchMutation.isPending}
                  data-testid={`button-launch-${template.id}`}
                >
                  <Play className="h-4 w-4 mr-2" />
                  Launch Job
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="text-center py-12">
            <FileText className="h-16 w-16 mx-auto mb-4 opacity-50 text-muted-foreground" />
            <p className="text-muted-foreground mb-2">No templates yet</p>
            <p className="text-sm text-muted-foreground mb-4">Create your first template to get started</p>
            <Button onClick={() => setOpen(true)} data-testid="button-create-first">
              <Plus className="h-4 w-4 mr-2" />
              Create Template
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

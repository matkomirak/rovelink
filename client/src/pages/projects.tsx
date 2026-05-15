import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { FolderGit2, Plus, RefreshCw, CheckCircle2, AlertCircle, Loader2, Pencil, Trash2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { insertProjectSchema, type Project, type InsertProject } from "@shared/schema";

export default function Projects() {
  const [open, setOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const { toast } = useToast();

  const { data: projects, isLoading } = useQuery<Project[]>({
    queryKey: ["/api/projects"],
  });

  const form = useForm<InsertProject>({
    resolver: zodResolver(insertProjectSchema),
    defaultValues: editingProject ? {
      name: editingProject.name,
      gitUrl: editingProject.gitUrl,
      gitRef: editingProject.gitRef,
    } : {
      name: "",
      gitUrl: "",
      gitRef: "main",
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: InsertProject) => apiRequest("POST", "/api/projects", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({ title: "Project created successfully" });
      handleCloseDialog();
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", title: "Failed to create project", description: error.message });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<InsertProject> }) => 
      apiRequest("PATCH", `/api/projects/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({ title: "Project updated successfully" });
      handleCloseDialog();
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", title: "Failed to update project", description: error.message });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/projects/${id}`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({ title: "Project deleted successfully" });
      setDeleteDialogOpen(false);
      setProjectToDelete(null);
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", title: "Failed to delete project", description: error.message });
    },
  });

  const handleCloseDialog = () => {
    setOpen(false);
    setEditingProject(null);
    form.reset();
  };

  const handleEdit = (project: Project) => {
    setEditingProject(project);
    form.reset({
      name: project.name,
      gitUrl: project.gitUrl,
      gitRef: project.gitRef,
    });
    setOpen(true);
  };

  const handleDelete = (project: Project) => {
    setProjectToDelete(project);
    setDeleteDialogOpen(true);
  };

  const handleSubmit = (data: InsertProject) => {
    if (editingProject) {
      updateMutation.mutate({ id: editingProject.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const syncMutation = useMutation({
    mutationFn: (projectId: string) => apiRequest("POST", `/api/projects/${projectId}/sync`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({ title: "Project synced successfully" });
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", title: "Sync failed", description: error.message });
    },
  });

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { variant: "default" | "secondary" | "destructive"; icon: any }> = {
      success: { variant: "default", icon: CheckCircle2 },
      error: { variant: "destructive", icon: AlertCircle },
      syncing: { variant: "secondary", icon: Loader2 },
      pending: { variant: "secondary", icon: RefreshCw },
    };
    const config = variants[status] || variants.pending;
    const Icon = config.icon;
    return (
      <Badge variant={config.variant} className="capitalize">
        <Icon className={`h-3 w-3 mr-1 ${status === "syncing" ? "animate-spin" : ""}`} />
        {status}
      </Badge>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-page-title">Projects</h1>
          <p className="text-sm text-muted-foreground">Manage Git repositories with Ansible playbooks</p>
        </div>
        <Dialog open={open} onOpenChange={handleCloseDialog}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-project">
              <Plus className="h-4 w-4 mr-2" />
              New Project
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingProject ? "Edit Project" : "Create Project"}</DialogTitle>
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
                        <Input {...field} placeholder="My Ansible Project" data-testid="input-project-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="gitUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Git URL</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="https://github.com/user/repo.git"
                          data-testid="input-git-url"
                          className="font-mono text-sm"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="gitRef"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Branch/Tag</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="main" data-testid="input-git-ref" />
                      </FormControl>
                      <FormMessage />
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
                  {editingProject ? "Update Project" : "Create Project"}
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
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
      ) : projects && projects.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((project) => (
            <Card key={project.id} data-testid={`card-project-${project.id}`}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <FolderGit2 className="h-5 w-5 text-primary" />
                    <CardTitle className="text-lg">{project.name}</CardTitle>
                  </div>
                  {getStatusBadge(project.syncStatus || "pending")}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Repository</p>
                  <p className="text-sm font-mono truncate">{project.gitUrl}</p>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Branch</p>
                    <p className="text-sm font-mono">{project.gitRef}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground mb-1">Playbooks</p>
                    <p className="text-sm font-semibold">
                      {Array.isArray(project.playbooks) ? project.playbooks.length : 0}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => syncMutation.mutate(project.id)}
                    disabled={syncMutation.isPending || project.syncStatus === "syncing"}
                    data-testid={`button-sync-${project.id}`}
                  >
                    <RefreshCw className={`h-4 w-4 mr-2 ${syncMutation.isPending ? "animate-spin" : ""}`} />
                    Demo Sync
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleEdit(project)}
                    data-testid={`button-edit-${project.id}`}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDelete(project)}
                    data-testid={`button-delete-${project.id}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="text-center py-12">
            <FolderGit2 className="h-16 w-16 mx-auto mb-4 opacity-50 text-muted-foreground" />
            <p className="text-muted-foreground mb-2">No projects yet</p>
            <p className="text-sm text-muted-foreground mb-4">Create your first project to get started</p>
            <Button onClick={() => setOpen(true)} data-testid="button-create-first">
              <Plus className="h-4 w-4 mr-2" />
              Create Project
            </Button>
          </CardContent>
        </Card>
      )}

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Project</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{projectToDelete?.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => projectToDelete && deleteMutation.mutate(projectToDelete.id)}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

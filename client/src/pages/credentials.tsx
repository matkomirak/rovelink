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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Key, Plus, Loader2, Pencil, Trash2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { insertCredentialSchema, type Credential, type InsertCredential } from "@shared/schema";

const credentialKinds = [
  { value: "ssh_key", label: "SSH Key" },
  { value: "winrm", label: "WinRM" },
  { value: "sudo", label: "Sudo" },
  { value: "vault", label: "Vault" },
];

export default function Credentials() {
  const [open, setOpen] = useState(false);
  const [editingCredential, setEditingCredential] = useState<Credential | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [credentialToDelete, setCredentialToDelete] = useState<Credential | null>(null);
  const { toast } = useToast();

  const { data: credentials, isLoading } = useQuery<Credential[]>({
    queryKey: ["/api/credentials"],
  });

  const form = useForm<InsertCredential>({
    resolver: zodResolver(insertCredentialSchema),
    defaultValues: editingCredential ? {
      name: editingCredential.name,
      kind: editingCredential.kind,
      metadata: editingCredential.metadata || {},
      secretRef: editingCredential.secretRef || "",
    } : {
      name: "",
      kind: "ssh_key",
      metadata: {},
      secretRef: "",
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: InsertCredential) => apiRequest("POST", "/api/credentials", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/credentials"] });
      toast({ title: "Credential created successfully" });
      handleCloseDialog();
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", title: "Failed to create credential", description: error.message });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<InsertCredential> }) => 
      apiRequest("PATCH", `/api/credentials/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/credentials"] });
      toast({ title: "Credential updated successfully" });
      handleCloseDialog();
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", title: "Failed to update credential", description: error.message });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/credentials/${id}`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/credentials"] });
      toast({ title: "Credential deleted successfully" });
      setDeleteDialogOpen(false);
      setCredentialToDelete(null);
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", title: "Failed to delete credential", description: error.message });
    },
  });

  const handleCloseDialog = () => {
    setOpen(false);
    setEditingCredential(null);
    form.reset();
  };

  const handleEdit = (credential: Credential) => {
    setEditingCredential(credential);
    form.reset({
      name: credential.name,
      kind: credential.kind,
      metadata: credential.metadata || {},
      secretRef: credential.secretRef || "",
    });
    setOpen(true);
  };

  const handleDelete = (credential: Credential) => {
    setCredentialToDelete(credential);
    setDeleteDialogOpen(true);
  };

  const handleSubmit = (data: InsertCredential) => {
    if (editingCredential) {
      updateMutation.mutate({ id: editingCredential.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-page-title">Credentials</h1>
          <p className="text-sm text-muted-foreground">Manage authentication credentials (references only)</p>
        </div>
        <Dialog open={open} onOpenChange={handleCloseDialog}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-credential">
              <Plus className="h-4 w-4 mr-2" />
              New Credential
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingCredential ? "Edit Credential" : "Create Credential"}</DialogTitle>
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
                        <Input {...field} placeholder="Production SSH Key" data-testid="input-credential-name" />
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
                      <FormLabel>Type</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-credential-kind">
                            <SelectValue placeholder="Select credential type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {credentialKinds.map((kind) => (
                            <SelectItem key={kind.value} value={kind.value}>
                              {kind.label}
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
                  name="secretRef"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Secret Reference</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="vault://secrets/prod-ssh"
                          data-testid="input-secret-ref"
                          className="font-mono text-sm"
                        />
                      </FormControl>
                      <p className="text-xs text-muted-foreground">External secret manager reference (no real secrets stored)</p>
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
                  {editingCredential ? "Update Credential" : "Create Credential"}
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
                <div className="h-4 bg-muted animate-pulse rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : credentials && credentials.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {credentials.map((cred) => (
            <Card key={cred.id} data-testid={`card-credential-${cred.id}`}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <Key className="h-5 w-5 text-primary" />
                    <CardTitle className="text-lg">{cred.name}</CardTitle>
                  </div>
                  <Badge variant="outline" className="capitalize">
                    {cred.kind.replace("_", " ")}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Secret Reference</p>
                  <p className="text-sm font-mono truncate">
                    {cred.secretRef || <span className="text-muted-foreground">Not configured</span>}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => handleEdit(cred)}
                    data-testid={`button-edit-${cred.id}`}
                  >
                    <Pencil className="h-4 w-4 mr-2" />
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDelete(cred)}
                    data-testid={`button-delete-${cred.id}`}
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
            <Key className="h-16 w-16 mx-auto mb-4 opacity-50 text-muted-foreground" />
            <p className="text-muted-foreground mb-2">No credentials yet</p>
            <p className="text-sm text-muted-foreground mb-4">Create your first credential to get started</p>
            <Button onClick={() => setOpen(true)} data-testid="button-create-first">
              <Plus className="h-4 w-4 mr-2" />
              Create Credential
            </Button>
          </CardContent>
        </Card>
      )}

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Credential</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{credentialToDelete?.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => credentialToDelete && deleteMutation.mutate(credentialToDelete.id)}
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

import { useQuery, useMutation, } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Save, Database, FileText, Info } from "lucide-react";
import { type AutomationInventory } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const linkedFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
});

const fileFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  fileFormat: z.enum(["yaml", "json", "ini"]),
  fileContent: z.string().min(1, "File content is required"),
});

export default function AutomationInventoryEdit() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: inventory, isLoading } = useQuery<AutomationInventory>({
    queryKey: ["/api/inventories", id],
  });

  const linkedForm = useForm<z.infer<typeof linkedFormSchema>>({
    resolver: zodResolver(linkedFormSchema),
    defaultValues: { name: "" },
  });

  const fileForm = useForm<z.infer<typeof fileFormSchema>>({
    resolver: zodResolver(fileFormSchema),
    defaultValues: {
      name: "",
      fileFormat: "yaml",
      fileContent: "",
    },
  });

  useEffect(() => {
    if (!inventory) return;
    if (inventory.type === "linked") {
      linkedForm.reset({ name: inventory.name });
    } else if (inventory.type === "file") {
      fileForm.reset({
        name: inventory.name,
        fileFormat: (inventory.fileFormat as "yaml" | "json" | "ini") || "yaml",
        fileContent: inventory.fileContent || "",
      });
    }
  }, [inventory]);

  const updateMutation = useMutation({
    mutationFn: async (data: Record<string, any>) => {
      return await apiRequest("PATCH", `/api/inventories/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventories"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventories", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/templates"] });
      toast({ title: "Success", description: "Inventory updated successfully" });
      setLocation(`/inventories/${id}`);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update inventory",
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!inventory) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle>Inventory Not Found</CardTitle>
            <CardDescription>The requested inventory does not exist.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const backButton = (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setLocation(`/inventories/${id}`)}
      data-testid="button-back"
    >
      <ArrowLeft className="h-4 w-4" />
    </Button>
  );

  if (inventory.type === "linked") {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-4">
          {backButton}
          <div>
            <h1 className="text-3xl font-bold">Edit Inventory</h1>
            <p className="text-muted-foreground">Rename this linked inventory</p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Database className="h-5 w-5 text-muted-foreground" />
              <CardTitle>Linked Inventory</CardTitle>
              <Badge variant="outline" className="capitalize">{inventory.sourceType || "linked"}</Badge>
            </div>
            <CardDescription>
              You can rename this inventory. Its CMDB source connection is managed by ID and will not be affected.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...linkedForm}>
              <form
                onSubmit={linkedForm.handleSubmit((data) => updateMutation.mutate(data))}
                className="space-y-4"
              >
                <FormField
                  control={linkedForm.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Inventory Name</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="My Inventory" data-testid="input-name" />
                      </FormControl>
                      <FormDescription className="flex items-center gap-1 text-xs">
                        <Info className="h-3 w-3" />
                        Renaming does not affect any job templates or pipelines — they reference this inventory by its internal ID.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setLocation(`/inventories/${id}`)}
                    data-testid="button-cancel"
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={updateMutation.isPending} data-testid="button-save">
                    <Save className="h-4 w-4 mr-2" />
                    {updateMutation.isPending ? "Saving..." : "Save Name"}
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-4">
        {backButton}
        <div>
          <h1 className="text-3xl font-bold">Edit Inventory</h1>
          <p className="text-muted-foreground">Update file-based inventory configuration</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-muted-foreground" />
            <CardTitle>Inventory Details</CardTitle>
          </div>
          <CardDescription>
            Modify the inventory name, format, and content.
            Renaming does not affect any job templates — they reference this inventory by its internal ID.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...fileForm}>
            <form onSubmit={fileForm.handleSubmit((data) => updateMutation.mutate(data))} className="space-y-4">
              <FormField
                control={fileForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Inventory Name</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="My Inventory" data-testid="input-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={fileForm.control}
                name="fileFormat"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>File Format</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-format">
                          <SelectValue placeholder="Select format" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="yaml">YAML</SelectItem>
                        <SelectItem value="json">JSON</SelectItem>
                        <SelectItem value="ini">INI</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={fileForm.control}
                name="fileContent"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>File Content</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        placeholder="Enter inventory content..."
                        className="font-mono text-sm min-h-[400px]"
                        data-testid="textarea-content"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setLocation(`/inventories/${id}`)}
                  data-testid="button-cancel"
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={updateMutation.isPending} data-testid="button-save">
                  <Save className="h-4 w-4 mr-2" />
                  {updateMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}

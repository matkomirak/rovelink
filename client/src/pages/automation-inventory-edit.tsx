import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Save } from "lucide-react";
import { type AutomationInventory } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const editFormSchema = z.object({
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

  const form = useForm<z.infer<typeof editFormSchema>>({
    resolver: zodResolver(editFormSchema),
    defaultValues: {
      name: inventory?.name || "",
      fileFormat: (inventory?.fileFormat as "yaml" | "json" | "ini") || "yaml",
      fileContent: inventory?.fileContent || "",
    },
  });

  // Update form when data loads
  if (inventory && !form.formState.isDirty) {
    form.reset({
      name: inventory.name,
      fileFormat: (inventory.fileFormat as "yaml" | "json" | "ini") || "yaml",
      fileContent: inventory.fileContent || "",
    });
  }

  const updateMutation = useMutation({
    mutationFn: async (data: z.infer<typeof editFormSchema>) => {
      return await apiRequest("/api/inventories/" + id, "PATCH", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventories"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventories", id] });
      toast({
        title: "Success",
        description: "Inventory updated successfully",
      });
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

  if (inventory.type !== "file") {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle>Cannot Edit</CardTitle>
            <CardDescription>Only file-based inventories can be edited.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setLocation(`/inventories/${id}`)}
          data-testid="button-back"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold">Edit Inventory</h1>
          <p className="text-muted-foreground">Update file-based inventory configuration</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Inventory Details</CardTitle>
          <CardDescription>
            Modify the inventory name, format, and content
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((data) => updateMutation.mutate(data))} className="space-y-4">
              <FormField
                control={form.control}
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
                control={form.control}
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
                control={form.control}
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

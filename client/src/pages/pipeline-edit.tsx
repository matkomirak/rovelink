import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Save } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface Pipeline {
  id: string;
  name: string;
  providerAccountId: string;
  cmdbAccountId: string;
  enabled: boolean;
  scheduleCron: string | null;
  version: number;
}

interface Provider {
  id: string;
  name: string;
  kind: string;
}

interface Cmdb {
  id: string;
  name: string;
  kind: string;
}

const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
  providerAccountId: z.string().min(1, "Source provider is required"),
  cmdbAccountId: z.string().min(1, "Target CMDB is required"),
});

type FormValues = z.infer<typeof formSchema>;

export default function PipelineEdit() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: pipeline, isLoading: pipelineLoading } = useQuery<Pipeline>({
    queryKey: ["/api/pipelines", id],
  });

  const { data: providers, isLoading: providersLoading } = useQuery<Provider[]>({
    queryKey: ["/api/providers"],
  });

  const { data: cmdbs, isLoading: cmdbsLoading } = useQuery<Cmdb[]>({
    queryKey: ["/api/cmdbs"],
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      providerAccountId: "",
      cmdbAccountId: "",
    },
  });

  if (pipeline && !form.formState.isDirty) {
    form.reset({
      name: pipeline.name,
      providerAccountId: pipeline.providerAccountId,
      cmdbAccountId: pipeline.cmdbAccountId,
    });
  }

  const updateMutation = useMutation({
    mutationFn: async (data: FormValues) => {
      const response = await apiRequest("PATCH", `/api/pipelines/${id}`, data);
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Failed to update pipeline");
      }
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pipelines"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pipelines", id] });
      toast({ title: "Success", description: "Pipeline updated successfully" });
      setLocation(`/pipelines/${id}`);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update pipeline",
        variant: "destructive",
      });
    },
  });

  const isLoading = pipelineLoading || providersLoading || cmdbsLoading;

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-2xl">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!pipeline) {
    return (
      <div className="max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle>Pipeline Not Found</CardTitle>
            <CardDescription>The requested pipeline does not exist.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setLocation(`/pipelines/${id}`)}
          data-testid="button-back"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold">Edit Pipeline</h1>
          <p className="text-muted-foreground">Update basic pipeline configuration</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pipeline Configuration</CardTitle>
          <CardDescription>
            Modify the pipeline name, source provider, or target CMDB. Mapping rules are managed separately.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit((data) => updateMutation.mutate(data))}
              className="space-y-4"
            >
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Pipeline Name</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="e.g., Proxmox to NetBox" data-testid="input-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="providerAccountId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Source Provider</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-provider">
                          <SelectValue placeholder="Select provider" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {providers?.map((provider) => (
                          <SelectItem key={provider.id} value={provider.id}>
                            {provider.name} ({provider.kind})
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
                name="cmdbAccountId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Target CMDB</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-cmdb">
                          <SelectValue placeholder="Select CMDB" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {cmdbs?.map((cmdb) => (
                          <SelectItem key={cmdb.id} value={cmdb.id}>
                            {cmdb.name} ({cmdb.kind})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setLocation(`/pipelines/${id}`)}
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

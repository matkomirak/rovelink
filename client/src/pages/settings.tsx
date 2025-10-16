import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { Settings as SettingsIcon, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

const settingsSchema = z.object({
  netboxUrl: z.string().url("Must be a valid URL"),
  netboxToken: z.string().min(1, "Token is required"),
});

type SettingsForm = z.infer<typeof settingsSchema>;

export default function Settings() {
  const [testStatus, setTestStatus] = useState<"idle" | "success" | "error">("idle");
  const { toast } = useToast();

  const { data: settings, isLoading } = useQuery({
    queryKey: ["/api/settings"],
  });

  const form = useForm<SettingsForm>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      netboxUrl: settings?.netboxUrl || "",
      netboxToken: settings?.netboxToken || "",
    },
  });

  // Update form when settings load
  useEffect(() => {
    if (settings) {
      form.reset({
        netboxUrl: settings.netboxUrl || "",
        netboxToken: settings.netboxToken || "",
      });
    }
  }, [settings, form]);

  const saveMutation = useMutation({
    mutationFn: (data: SettingsForm) => apiRequest("POST", "/api/settings", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({ title: "Settings saved successfully" });
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", title: "Failed to save settings", description: error.message });
    },
  });

  const testMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/settings/test-connection", {}),
    onSuccess: () => {
      setTestStatus("success");
      toast({ title: "Connection successful", description: "NetBox API is reachable" });
    },
    onError: (error: Error) => {
      setTestStatus("error");
      toast({ variant: "destructive", title: "Connection failed", description: error.message });
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="text-page-title">Settings</h1>
        <p className="text-sm text-muted-foreground">Configure NetBox integration and system preferences</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SettingsIcon className="h-5 w-5 text-primary" />
            NetBox Configuration
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              {[...Array(2)].map((_, i) => (
                <div key={i} className="space-y-2">
                  <div className="h-4 bg-muted animate-pulse rounded w-1/4" />
                  <div className="h-10 bg-muted animate-pulse rounded" />
                </div>
              ))}
            </div>
          ) : (
            <Form {...form}>
              <form onSubmit={form.handleSubmit((data) => saveMutation.mutate(data))} className="space-y-6">
                <FormField
                  control={form.control}
                  name="netboxUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>NetBox URL</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="https://netbox.example.com"
                          className="font-mono"
                          data-testid="input-netbox-url"
                        />
                      </FormControl>
                      <FormDescription>Base URL of your NetBox instance (no /api suffix)</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="netboxToken"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>NetBox API Token</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="password"
                          placeholder="••••••••••••••••"
                          className="font-mono"
                          data-testid="input-netbox-token"
                        />
                      </FormControl>
                      <FormDescription>Read-only API token for inventory access</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex items-center gap-3">
                  <Button
                    type="submit"
                    disabled={saveMutation.isPending}
                    data-testid="button-save-settings"
                  >
                    {saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Save Settings
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => testMutation.mutate()}
                    disabled={testMutation.isPending}
                    data-testid="button-test-connection"
                  >
                    {testMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : testStatus === "success" ? (
                      <CheckCircle2 className="mr-2 h-4 w-4 text-green-500" />
                    ) : testStatus === "error" ? (
                      <XCircle className="mr-2 h-4 w-4 text-red-500" />
                    ) : null}
                    Test Connection
                  </Button>

                  {testStatus === "success" && (
                    <Badge variant="default">
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      Connected
                    </Badge>
                  )}
                  {testStatus === "error" && (
                    <Badge variant="destructive">
                      <XCircle className="h-3 w-3 mr-1" />
                      Failed
                    </Badge>
                  )}
                </div>
              </form>
            </Form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Environment Variables</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
            <span className="text-sm font-medium">NETBOX_URL</span>
            <Badge variant="outline" className="font-mono">
              {import.meta.env.VITE_NETBOX_URL ? "Set" : "Not Set"}
            </Badge>
          </div>
          <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
            <span className="text-sm font-medium">NETBOX_TOKEN</span>
            <Badge variant="outline" className="font-mono">
              {import.meta.env.VITE_NETBOX_TOKEN ? "••••••••" : "Not Set"}
            </Badge>
          </div>
          <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
            <span className="text-sm font-medium">DATABASE_URL</span>
            <Badge variant="outline" className="font-mono">
              {import.meta.env.VITE_DATABASE_URL ? "Configured" : "Not Set"}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-4">
            Environment variables are managed through Replit Secrets and loaded automatically
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

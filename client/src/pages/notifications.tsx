import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Bell, Mail, Webhook, Plus, Trash2 } from "lucide-react";
import type { Notification, JobTemplate } from "@shared/schema";
import { insertNotificationSchema } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { z } from "zod";

const formSchema = insertNotificationSchema.extend({
  webhookHeaders: z.string().optional(),
});

export default function Notifications() {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

  const { data: notifications, isLoading } = useQuery<Notification[]>({
    queryKey: ["/api/notifications"],
  });

  const { data: templates } = useQuery<JobTemplate[]>({
    queryKey: ["/api/templates"],
  });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      type: "email",
      enabled: true,
      onSuccess: false,
      onFailure: true,
      templateIds: [],
      emailTo: "",
      emailSubject: "Job {{run.status}}: Run {{run.id}}",
      emailBody: "Run {{run.id}} completed with status {{run.status}}",
      webhookUrl: "",
      webhookMethod: "POST",
      webhookHeaders: "{}",
      webhookBody: '{"run_id": "{{run.id}}", "status": "{{run.status}}"}',
      webhookRetryCount: 3,
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: z.infer<typeof formSchema>) => {
      const payload = {
        ...data,
        webhookHeaders: data.webhookHeaders ? JSON.parse(data.webhookHeaders) : undefined,
      };
      return apiRequest("POST", "/api/notifications", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      toast({ title: "Notification created successfully" });
      setOpen(false);
      form.reset();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/notifications/${id}`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      toast({ title: "Notification deleted successfully" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      apiRequest("PATCH", `/api/notifications/${id}`, { enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    },
  });

  const onSubmit = (data: z.infer<typeof formSchema>) => {
    createMutation.mutate(data);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-page-title">Notifications</h1>
          <p className="text-sm text-muted-foreground">Configure email and webhook notifications for job runs</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-notification">
              <Plus className="h-4 w-4 mr-2" />
              Add Notification
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create Notification</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-notification-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Type</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-notification-type">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="email">Email</SelectItem>
                          <SelectItem value="webhook">Webhook</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="onSuccess"
                    render={({ field }) => (
                      <FormItem className="flex items-center justify-between rounded-lg border p-4">
                        <div>
                          <FormLabel>On Success</FormLabel>
                          <p className="text-sm text-muted-foreground">Trigger when run succeeds</p>
                        </div>
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-on-success" />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="onFailure"
                    render={({ field }) => (
                      <FormItem className="flex items-center justify-between rounded-lg border p-4">
                        <div>
                          <FormLabel>On Failure</FormLabel>
                          <p className="text-sm text-muted-foreground">Trigger when run fails</p>
                        </div>
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-on-failure" />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>

                {form.watch("type") === "email" && (
                  <>
                    <FormField
                      control={form.control}
                      name="emailTo"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Email To</FormLabel>
                          <FormControl>
                            <Input {...field} value={field.value || ""} placeholder="admin@example.com" data-testid="input-email-to" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="emailSubject"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Subject</FormLabel>
                          <FormControl>
                            <Input {...field} value={field.value || ""} data-testid="input-email-subject" />
                          </FormControl>
                          <p className="text-xs text-muted-foreground">Use {"{{run.id}}"}, {"{{run.status}}"}, {"{{run.templateId}}"}</p>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="emailBody"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Body</FormLabel>
                          <FormControl>
                            <Textarea {...field} value={field.value || ""} rows={4} data-testid="input-email-body" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </>
                )}

                {form.watch("type") === "webhook" && (
                  <>
                    <FormField
                      control={form.control}
                      name="webhookUrl"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Webhook URL</FormLabel>
                          <FormControl>
                            <Input {...field} value={field.value || ""} placeholder="https://api.example.com/webhook" data-testid="input-webhook-url" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="webhookMethod"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>HTTP Method</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value || "POST"}>
                            <FormControl>
                              <SelectTrigger data-testid="select-webhook-method">
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="POST">POST</SelectItem>
                              <SelectItem value="PUT">PUT</SelectItem>
                              <SelectItem value="PATCH">PATCH</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="webhookBody"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Request Body</FormLabel>
                          <FormControl>
                            <Textarea {...field} value={field.value || ""} rows={4} data-testid="input-webhook-body" />
                          </FormControl>
                          <p className="text-xs text-muted-foreground">Use {"{{run.id}}"}, {"{{run.status}}"}, {"{{run.templateId}}"}</p>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="webhookRetryCount"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Retry Count</FormLabel>
                          <FormControl>
                            <Input type="number" {...field} value={field.value || 3} onChange={(e) => field.onChange(parseInt(e.target.value))} data-testid="input-webhook-retry" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </>
                )}

                <Button type="submit" className="w-full" disabled={createMutation.isPending} data-testid="button-submit-notification">
                  Create Notification
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="p-6">
            <p>Loading notifications...</p>
          </CardContent>
        </Card>
      ) : !notifications || notifications.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center">
            <Bell className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">No notifications configured</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {notifications.map((notification) => (
            <Card key={notification.id} data-testid={`card-notification-${notification.id}`}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {notification.type === "email" ? (
                      <Mail className="h-5 w-5 text-blue-500" />
                    ) : (
                      <Webhook className="h-5 w-5 text-purple-500" />
                    )}
                    <div>
                      <CardTitle className="text-lg">{notification.name}</CardTitle>
                      <p className="text-sm text-muted-foreground">
                        {notification.type === "email" ? notification.emailTo : notification.webhookUrl}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={notification.enabled}
                      onCheckedChange={(enabled) => toggleMutation.mutate({ id: notification.id, enabled })}
                      data-testid={`switch-enable-${notification.id}`}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteMutation.mutate(notification.id)}
                      data-testid={`button-delete-${notification.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2">
                  {notification.onSuccess && <Badge variant="outline">On Success</Badge>}
                  {notification.onFailure && <Badge variant="outline">On Failure</Badge>}
                  {!notification.enabled && <Badge variant="secondary">Disabled</Badge>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

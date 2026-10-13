import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Database, FileText, ArrowLeft } from "lucide-react";
import type { CmdbAccount } from "@shared/schema";

export default function AutomationInventoryNew() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  const [type, setType] = useState<"linked" | "file">("linked");
  const [name, setName] = useState("");
  const [sourceRef, setSourceRef] = useState("");
  const [fileContent, setFileContent] = useState("");
  const [fileFormat, setFileFormat] = useState<"yaml" | "json" | "ini">("yaml");
  const [isDefault, setIsDefault] = useState(false);

  const { data: cmdbAccounts } = useQuery<CmdbAccount[]>({
    queryKey: ["/api/cmdbs"],
  });

  const createInventory = useMutation({
    mutationFn: async () => {
      let payload: any = {
        name,
        type,
        isDefault,
      };

      if (type === "linked") {
        const selectedCmdb = cmdbAccounts?.find(c => c.id === sourceRef);
        payload.sourceRef = sourceRef;
        payload.sourceType = selectedCmdb?.kind;
      } else if (type === "file") {
        payload.fileContent = fileContent;
        payload.fileFormat = fileFormat;
      }

      const response = await apiRequest("POST", "/api/inventories", payload);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to create inventory");
      }
      return await response.json();
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Inventory created successfully" });
      setLocation("/automation-inventories");
    },
    onError: (error: any) => {
      toast({ 
        title: "Error", 
        description: error.message || "Failed to create inventory",
        variant: "destructive" 
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!name) {
      toast({ title: "Error", description: "Name is required", variant: "destructive" });
      return;
    }

    if (type === "linked" && !sourceRef) {
      toast({ title: "Error", description: "Please select a CMDB source", variant: "destructive" });
      return;
    }

    if (type === "file" && !fileContent) {
      toast({ title: "Error", description: "File content is required", variant: "destructive" });
      return;
    }

    createInventory.mutate();
  };

  const fileFormatExamples = {
    yaml: `# Example YAML inventory
all:
  hosts:
    web-01:
      ansible_host: 10.0.1.10
    web-02:
      ansible_host: 10.0.1.11
  children:
    webservers:
      hosts:
        web-01:
        web-02:`,
    json: `{
  "webservers": {
    "hosts": ["web-01", "web-02"],
    "vars": {
      "http_port": 80
    }
  },
  "_meta": {
    "hostvars": {
      "web-01": {"ansible_host": "10.0.1.10"},
      "web-02": {"ansible_host": "10.0.1.11"}
    }
  }
}`,
    ini: `[webservers]
web-01 ansible_host=10.0.1.10
web-02 ansible_host=10.0.1.11

[databases]
db-01 ansible_host=10.0.2.10`,
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setLocation("/automation-inventories")}
          data-testid="button-back"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold">Create Inventory</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Add a new inventory source for Ansible automation
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Type Selection */}
        <Card>
          <CardHeader>
            <CardTitle>Inventory Type</CardTitle>
            <CardDescription>
              Choose the type of inventory source
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <button
                type="button"
                onClick={() => setType("linked")}
                className={`p-6 border-2 rounded-lg transition-all ${
                  type === "linked"
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50"
                }`}
                data-testid="button-type-linked"
              >
                <Database className="h-8 w-8 mx-auto mb-2" />
                <h3 className="font-semibold">Linked (CMDB)</h3>
                <p className="text-xs text-muted-foreground mt-1">
                    Source from NetBox (alpha support)
                </p>
              </button>

              <button
                type="button"
                onClick={() => setType("file")}
                className={`p-6 border-2 rounded-lg transition-all ${
                  type === "file"
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50"
                }`}
                data-testid="button-type-file"
              >
                <FileText className="h-8 w-8 mx-auto mb-2" />
                <h3 className="font-semibold">File-based</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Upload YAML, JSON, or INI inventory file
                </p>
              </button>
            </div>
          </CardContent>
        </Card>

        {/* Basic Configuration */}
        <Card>
          <CardHeader>
            <CardTitle>Basic Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Production NetBox Inventory"
                required
                data-testid="input-name"
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Set as Default</Label>
                <p className="text-xs text-muted-foreground">
                  Use this inventory in templates by default
                </p>
              </div>
              <Switch
                checked={isDefault}
                onCheckedChange={setIsDefault}
                data-testid="switch-default"
              />
            </div>
          </CardContent>
        </Card>

        {/* Type-Specific Configuration */}
        {type === "linked" && (
          <Card>
            <CardHeader>
              <CardTitle>CMDB Source</CardTitle>
              <CardDescription>
                Select the CMDB account to link this inventory to
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="source">CMDB Account</Label>
                <Select value={sourceRef} onValueChange={setSourceRef}>
                  <SelectTrigger id="source" data-testid="select-cmdb">
                    <SelectValue placeholder="Select a CMDB account" />
                  </SelectTrigger>
                  <SelectContent>
                    {cmdbAccounts?.map((cmdb) => (
                      <SelectItem key={cmdb.id} value={cmdb.id}>
                        {cmdb.name} ({cmdb.kind})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {(!cmdbAccounts || cmdbAccounts.length === 0) && (
                  <p className="text-xs text-muted-foreground">
                    No CMDB accounts configured. Create one in the CMDBs section first.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {type === "file" && (
          <Card>
            <CardHeader>
              <CardTitle>File Content</CardTitle>
              <CardDescription>
                Paste your inventory file content below
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="format">File Format</Label>
                <Select value={fileFormat} onValueChange={(v: any) => setFileFormat(v)}>
                  <SelectTrigger id="format" data-testid="select-format">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="yaml">YAML</SelectItem>
                    <SelectItem value="json">JSON</SelectItem>
                    <SelectItem value="ini">INI</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="content">Content</Label>
                <Textarea
                  id="content"
                  value={fileContent}
                  onChange={(e) => setFileContent(e.target.value)}
                  placeholder={fileFormatExamples[fileFormat]}
                  className="font-mono text-sm min-h-[300px]"
                  data-testid="textarea-content"
                />
                <p className="text-xs text-muted-foreground">
                  Example format shown in placeholder
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => setLocation("/automation-inventories")}
          >
            Cancel
          </Button>
          <Button 
            type="submit"
            disabled={createInventory.isPending}
            data-testid="button-create"
          >
            {createInventory.isPending ? "Creating..." : "Create Inventory"}
          </Button>
        </div>
      </form>
    </div>
  );
}

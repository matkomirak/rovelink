import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";

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

interface ObjectTypesResponse {
  providerId: string;
  types: string[];
}

export default function PipelineNew() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  
  // Step 1: Select endpoints
  const [pipelineName, setPipelineName] = useState("");
  const [selectedProvider, setSelectedProvider] = useState<string>("");
  const [selectedCmdb, setSelectedCmdb] = useState<string>("");
  
  // Step 2: Select type pairs
  const [sourceType, setSourceType] = useState<string>("");
  const [targetType, setTargetType] = useState<string>("");
  
  // Created pipeline ID (after step 1)
  const [pipelineId, setPipelineId] = useState<string | null>(null);

  const { data: providers, isLoading: loadingProviders } = useQuery<Provider[]>({
    queryKey: ["/api/providers"],
  });

  const { data: cmdbs, isLoading: loadingCmdbs } = useQuery<Cmdb[]>({
    queryKey: ["/api/cmdbs"],
  });

  // Get source types from provider
  const { data: sourceTypes } = useQuery<ObjectTypesResponse>({
    queryKey: ["/api/providers", selectedProvider, "object-types"],
    enabled: !!selectedProvider,
  });

  // Get target types from CMDB (we'll use hardcoded list for now)
  const getTargetTypes = () => {
    const cmdb = cmdbs?.find((c) => c.id === selectedCmdb);
    if (!cmdb) return [];
    
    if (cmdb.kind === "netbox") {
      return ["VirtualMachine", "IPAddress", "Interface", "VMInterface", "Tenant", "Site", "Cluster", "Platform", "Tag"];
    } else if (cmdb.kind === "idoit") {
      return ["VirtualServer", "Server", "Client"];
    }
    return [];
  };

  const createPipeline = useMutation({
    mutationFn: async (data: { name: string; providerAccountId: string; cmdbAccountId: string }) => {
      const response = await apiRequest("POST", "/api/pipelines", data);
      return await response.json();
    },
    onSuccess: (data) => {
      setPipelineId(data.id);
      queryClient.invalidateQueries({ queryKey: ["/api/pipelines"] });
      setStep(2);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create pipeline",
        variant: "destructive",
      });
    },
  });

  const createMapping = useMutation({
    mutationFn: async (data: { sourceType: string; targetType: string }) => {
      const response = await apiRequest("POST", `/api/pipelines/${pipelineId}/mappings`, data);
      return await response.json();
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Mapping created successfully",
      });
      setStep(3);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create mapping",
        variant: "destructive",
      });
    },
  });

  const handleStep1Next = () => {
    if (!pipelineName || !selectedProvider || !selectedCmdb) {
      toast({
        title: "Validation Error",
        description: "Please fill in all fields",
        variant: "destructive",
      });
      return;
    }

    createPipeline.mutate({
      name: pipelineName,
      providerAccountId: selectedProvider,
      cmdbAccountId: selectedCmdb,
    });
  };

  const handleStep2Next = () => {
    if (!sourceType || !targetType) {
      toast({
        title: "Validation Error",
        description: "Please select source and target types",
        variant: "destructive",
      });
      return;
    }

    createMapping.mutate({
      sourceType,
      targetType,
    });
  };

  const handleStep3Complete = () => {
    toast({
      title: "Pipeline created",
      description: "Your pipeline is ready to configure",
    });
    setLocation(`/pipelines/${pipelineId}`);
  };

  if (loadingProviders || loadingCmdbs) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-64" />
            <Skeleton className="h-4 w-96" />
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setLocation("/pipelines")}
          data-testid="button-back"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold">New Pipeline</h1>
          <p className="text-muted-foreground mt-1">
            Step {step} of 3
          </p>
        </div>
      </div>

      {/* Progress indicator */}
      <div className="flex gap-2">
        {[1, 2, 3].map((s) => (
          <div
            key={s}
            className={`h-2 flex-1 rounded-full ${
              s <= step ? "bg-primary" : "bg-muted"
            }`}
          />
        ))}
      </div>

      {/* Step 1: Select endpoints */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Select Endpoints</CardTitle>
            <CardDescription>
              Choose the source provider and target CMDB for this pipeline
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Pipeline Name</Label>
              <Input
                id="name"
                placeholder="e.g., Proxmox to NetBox"
                value={pipelineName}
                onChange={(e) => setPipelineName(e.target.value)}
                data-testid="input-pipeline-name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="provider">Source Provider</Label>
              <Select value={selectedProvider} onValueChange={setSelectedProvider}>
                <SelectTrigger id="provider" data-testid="select-provider">
                  <SelectValue placeholder="Select provider" />
                </SelectTrigger>
                <SelectContent>
                  {providers?.map((provider) => (
                    <SelectItem key={provider.id} value={provider.id}>
                      {provider.name} ({provider.kind})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="cmdb">Target CMDB</Label>
              <Select value={selectedCmdb} onValueChange={setSelectedCmdb}>
                <SelectTrigger id="cmdb" data-testid="select-cmdb">
                  <SelectValue placeholder="Select CMDB" />
                </SelectTrigger>
                <SelectContent>
                  {cmdbs?.map((cmdb) => (
                    <SelectItem key={cmdb.id} value={cmdb.id}>
                      {cmdb.name} ({cmdb.kind})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex justify-end pt-4">
              <Button
                onClick={handleStep1Next}
                disabled={createPipeline.isPending}
                data-testid="button-step1-next"
              >
                Next
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Select type pairs */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Select Type Pairs</CardTitle>
            <CardDescription>
              Map source object types to target object types
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="source-type">Source Type</Label>
              <Select value={sourceType} onValueChange={setSourceType}>
                <SelectTrigger id="source-type" data-testid="select-source-type">
                  <SelectValue placeholder="Select source type" />
                </SelectTrigger>
                <SelectContent>
                  {sourceTypes?.types.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="target-type">Target Type</Label>
              <Select value={targetType} onValueChange={setTargetType}>
                <SelectTrigger id="target-type" data-testid="select-target-type">
                  <SelectValue placeholder="Select target type" />
                </SelectTrigger>
                <SelectContent>
                  {getTargetTypes().map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex justify-between pt-4">
              <Button
                variant="outline"
                onClick={() => setStep(1)}
                data-testid="button-step2-back"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
              <Button
                onClick={handleStep2Next}
                disabled={createMapping.isPending}
                data-testid="button-step2-next"
              >
                Next
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Success */}
      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle>Pipeline Created</CardTitle>
            <CardDescription>
              Your pipeline has been created successfully
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-center py-8">
              <div className="flex flex-col items-center gap-4">
                <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                  <Check className="h-8 w-8 text-primary" />
                </div>
                <div className="text-center">
                  <h3 className="text-lg font-semibold">{pipelineName}</h3>
                  <p className="text-muted-foreground text-sm">
                    Ready to configure mapping rules
                  </p>
                </div>
              </div>
            </div>

            <div className="flex justify-end">
              <Button onClick={handleStep3Complete} data-testid="button-configure">
                Configure Mappings
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

import { useState } from "react";
import { useParams, Link, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  ArrowLeft, 
  Plus, 
  Trash2, 
  Save, 
  FileCode, 
  Play,
  ChevronRight,
  ChevronDown,
  Copy
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface FieldRule {
  source?: string;
  target: string;
  transforms?: TransformConfig[];
  defaultValue?: any;
  required?: boolean;
  conflictPolicy?: string;
}

interface TransformConfig {
  type: string;
  params?: any;
}

interface MappingRules {
  target: string;
  matchBy?: string[];
  fields: FieldRule[];
  conflicts?: {
    defaultPolicy?: string;
    fieldPolicies?: Record<string, string>;
  };
  lookupTables?: Record<string, Record<string, any>>;
}

interface Sample {
  id: string;
  type: string;
  data: any;
}

interface TransformDialog {
  open: boolean;
  type: string | null;
  ruleIndex: number | null;
  existingParams?: any;
}

export default function MappingEditor() {
  const { pipelineId, mapId } = useParams();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  
  const [selectedSampleId, setSelectedSampleId] = useState<string | null>(null);
  const [rules, setRules] = useState<MappingRules>({ target: "", fields: [] });
  const [transformDialog, setTransformDialog] = useState<TransformDialog>({
    open: false,
    type: null,
    ruleIndex: null,
  });
  const [showPresetDialog, setShowPresetDialog] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState("");
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

  // Fetch mapping details
  const { data: mapping, isLoading } = useQuery<any>({
    queryKey: ["/api/pipelines", pipelineId, "mappings", mapId],
  });

  // Fetch samples for the source type
  const { data: samplesData } = useQuery<{ items: Sample[] }>({
    queryKey: mapping
      ? ["/api/providers", mapping.pipelineId, "samples", mapping.sourceType]
      : [],
    enabled: !!mapping,
  });

  // Fetch presets
  const { data: presetsData } = useQuery<{ items: any[] }>({
    queryKey: ["/api/pipelines/presets"],
  });

  // Test transformation on sample
  const { data: preview, refetch: refetchPreview } = useQuery({
    queryKey: selectedSampleId
      ? ["/api/pipelines", pipelineId, "mappings", mapId, "test", selectedSampleId]
      : [],
    enabled: false,
  });

  const saveRules = useMutation({
    mutationFn: async (newRules: MappingRules) => {
      const response = await apiRequest(
        "PATCH",
        `/api/pipelines/${pipelineId}/mappings/${mapId}`,
        { rules: newRules }
      );
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pipelines", pipelineId, "mappings"] });
      toast({ title: "Success", description: "Mapping rules saved" });
    },
  });

  const loadPreset = useMutation({
    mutationFn: async (presetId: string) => {
      const response = await apiRequest("GET", `/api/pipelines/presets/${presetId}`, undefined);
      return await response.json();
    },
    onSuccess: (presetRules) => {
      setRules(presetRules);
      setShowPresetDialog(false);
      toast({ title: "Preset Loaded", description: "Rules have been updated" });
    },
  });

  if (isLoading) {
    return (
      <div className="container mx-auto p-6 space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!mapping) {
    return <div className="text-center py-12">Mapping not found</div>;
  }

  // Initialize rules from mapping
  if (mapping.rules && rules.fields.length === 0) {
    setRules(mapping.rules);
  }

  const samples = samplesData?.items || [];
  const presets = presetsData?.items || [];
  const selectedSample = samples.find(s => s.id === selectedSampleId);

  const addRule = () => {
    setRules({
      ...rules,
      fields: [
        ...rules.fields,
        {
          source: "",
          target: "",
          transforms: [],
          conflictPolicy: "provider-wins",
        },
      ],
    });
  };

  const updateRule = (index: number, updates: Partial<FieldRule>) => {
    const newFields = [...rules.fields];
    newFields[index] = { ...newFields[index], ...updates };
    setRules({ ...rules, fields: newFields });
  };

  const deleteRule = (index: number) => {
    setRules({
      ...rules,
      fields: rules.fields.filter((_, i) => i !== index),
    });
  };

  const addTransform = (ruleIndex: number, transform: TransformConfig) => {
    const newFields = [...rules.fields];
    const existingTransforms = newFields[ruleIndex].transforms || [];
    newFields[ruleIndex].transforms = [...existingTransforms, transform];
    setRules({ ...rules, fields: newFields });
  };

  const removeTransform = (ruleIndex: number, transformIndex: number) => {
    const newFields = [...rules.fields];
    newFields[ruleIndex].transforms = newFields[ruleIndex].transforms?.filter(
      (_, i) => i !== transformIndex
    );
    setRules({ ...rules, fields: newFields });
  };

  const togglePath = (path: string) => {
    const newExpanded = new Set(expandedPaths);
    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);
    }
    setExpandedPaths(newExpanded);
  };

  const renderJsonTree = (obj: any, path: string = "", level: number = 0): JSX.Element[] => {
    if (!obj || typeof obj !== "object") {
      return [];
    }

    return Object.entries(obj).flatMap(([key, value]) => {
      const currentPath = path ? `${path}.${key}` : key;
      const isObject = value !== null && typeof value === "object" && !Array.isArray(value);
      const isExpanded = expandedPaths.has(currentPath);
      const hasChildren = isObject && Object.keys(value).length > 0;

      return [
        <div
          key={currentPath}
          className="flex items-center gap-2 py-1 hover-elevate px-2 rounded cursor-pointer"
          style={{ paddingLeft: `${level * 16 + 8}px` }}
          data-testid={`tree-node-${currentPath}`}
        >
          {hasChildren && (
            <button
              onClick={() => togglePath(currentPath)}
              className="text-muted-foreground"
            >
              {isExpanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
            </button>
          )}
          {!hasChildren && <div className="w-3" />}
          <span className="font-mono text-sm text-primary">{key}</span>
          <span className="text-muted-foreground">:</span>
          {!isObject && (
            <span className="font-mono text-xs text-muted-foreground">
              {JSON.stringify(value)}
            </span>
          )}
          <button
            onClick={() => {
              navigator.clipboard.writeText(currentPath);
              toast({ description: `Copied: ${currentPath}` });
            }}
            className="ml-auto opacity-0 group-hover:opacity-100"
          >
            <Copy className="h-3 w-3" />
          </button>
        </div>,
        ...(isExpanded && hasChildren ? renderJsonTree(value, currentPath, level + 1) : []),
      ];
    });
  };

  const transformOptions = [
    { value: "lower", label: "Lowercase" },
    { value: "upper", label: "Uppercase" },
    { value: "title", label: "Title Case" },
    { value: "strip", label: "Strip Whitespace" },
    { value: "to_slug", label: "To Slug" },
    { value: "concat", label: "Concatenate", needsDialog: true },
    { value: "map", label: "Map Values", needsDialog: true },
    { value: "regex_extract", label: "Regex Extract", needsDialog: true },
    { value: "lookup_table", label: "Lookup Table", needsDialog: true },
    { value: "datetime_parse", label: "Parse DateTime" },
    { value: "pick_primary_ipv4", label: "Pick Primary IPv4" },
  ];

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href={`/pipelines/${pipelineId}`}>
          <Button variant="ghost" size="icon" data-testid="button-back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">
            Mapping Editor: {mapping.sourceType} → {mapping.targetType}
          </h1>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setShowPresetDialog(true)}
            data-testid="button-load-preset"
          >
            <FileCode className="h-4 w-4 mr-2" />
            Load Preset
          </Button>
          <Button
            variant="outline"
            onClick={() => refetchPreview()}
            disabled={!selectedSampleId}
            data-testid="button-test"
          >
            <Play className="h-4 w-4 mr-2" />
            Test
          </Button>
          <Button
            onClick={() => saveRules.mutate(rules)}
            disabled={saveRules.isPending}
            data-testid="button-save"
          >
            <Save className="h-4 w-4 mr-2" />
            Save Rules
          </Button>
        </div>
      </div>

      {/* 3-Pane Layout */}
      <div className="grid grid-cols-12 gap-4" style={{ height: "calc(100vh - 200px)" }}>
        {/* Left Pane - Source Sample & JSON Tree */}
        <Card className="col-span-3 flex flex-col overflow-hidden">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Source Sample</CardTitle>
            <Select value={selectedSampleId || ""} onValueChange={setSelectedSampleId}>
              <SelectTrigger data-testid="select-sample">
                <SelectValue placeholder="Select a sample" />
              </SelectTrigger>
              <SelectContent>
                {samples.map((sample) => (
                  <SelectItem key={sample.id} value={sample.id}>
                    {sample.type} #{sample.id.slice(0, 8)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto">
            {selectedSample ? (
              <div className="space-y-1 group">{renderJsonTree(selectedSample.data)}</div>
            ) : (
              <div className="text-center text-muted-foreground py-8">
                Select a sample to view
              </div>
            )}
          </CardContent>
        </Card>

        {/* Middle Pane - Rules Table */}
        <Card className="col-span-5 flex flex-col overflow-hidden">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Field Mapping Rules</CardTitle>
              <Button size="sm" onClick={addRule} data-testid="button-add-rule">
                <Plus className="h-4 w-4 mr-1" />
                Add Rule
              </Button>
            </div>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-card">
                <TableRow>
                  <TableHead className="w-[200px]">Source Path</TableHead>
                  <TableHead className="w-[200px]">Transforms</TableHead>
                  <TableHead className="w-[180px]">Target Field</TableHead>
                  <TableHead className="w-[140px]">Policy</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.fields.map((field, index) => (
                  <TableRow key={index}>
                    <TableCell>
                      <Input
                        value={field.source || ""}
                        onChange={(e) => updateRule(index, { source: e.target.value })}
                        placeholder="e.g., name"
                        className="h-8"
                        data-testid={`input-source-${index}`}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {field.transforms?.map((transform, tIndex) => (
                          <Badge
                            key={tIndex}
                            variant="secondary"
                            className="cursor-pointer"
                            onClick={() => removeTransform(index, tIndex)}
                          >
                            {transform.type}
                            <Trash2 className="h-3 w-3 ml-1" />
                          </Badge>
                        ))}
                        <Select
                          value=""
                          onValueChange={(value) => {
                            const option = transformOptions.find((o) => o.value === value);
                            if (option?.needsDialog) {
                              setTransformDialog({
                                open: true,
                                type: value,
                                ruleIndex: index,
                              });
                            } else {
                              addTransform(index, { type: value });
                            }
                          }}
                        >
                          <SelectTrigger className="h-6 w-20 text-xs">
                            <SelectValue placeholder="+ Add" />
                          </SelectTrigger>
                          <SelectContent>
                            {transformOptions.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Input
                        value={field.target}
                        onChange={(e) => updateRule(index, { target: e.target.value })}
                        placeholder="e.g., name"
                        className="h-8"
                        data-testid={`input-target-${index}`}
                      />
                    </TableCell>
                    <TableCell>
                      <Select
                        value={field.conflictPolicy || "provider-wins"}
                        onValueChange={(value) => updateRule(index, { conflictPolicy: value })}
                      >
                        <SelectTrigger className="h-8" data-testid={`select-policy-${index}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="provider-wins">Provider Wins</SelectItem>
                          <SelectItem value="cmdb-wins">CMDB Wins</SelectItem>
                          <SelectItem value="manual-only">Manual Only</SelectItem>
                          <SelectItem value="merge">Merge</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteRule(index)}
                        data-testid={`button-delete-${index}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {rules.fields.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                      No rules defined. Click "Add Rule" to get started.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Right Pane - Target Preview */}
        <Card className="col-span-4 flex flex-col overflow-hidden">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Target Preview</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto">
            {preview ? (
              <div className="space-y-4">
                <div>
                  <h4 className="text-sm font-medium mb-2">Result</h4>
                  <pre className="text-xs bg-muted p-3 rounded overflow-x-auto">
                    {JSON.stringify(preview, null, 2)}
                  </pre>
                </div>
              </div>
            ) : (
              <div className="text-center text-muted-foreground py-8">
                {selectedSampleId
                  ? "Click 'Test' to preview transformation"
                  : "Select a sample and click 'Test'"}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Load Preset Dialog */}
      <Dialog open={showPresetDialog} onOpenChange={setShowPresetDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Load Preset Mapping</DialogTitle>
            <DialogDescription>
              Choose a pre-configured mapping template
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Preset</Label>
              <Select value={selectedPreset} onValueChange={setSelectedPreset}>
                <SelectTrigger data-testid="select-preset">
                  <SelectValue placeholder="Select a preset" />
                </SelectTrigger>
                <SelectContent>
                  {presets.map((preset) => (
                    <SelectItem key={preset.id} value={preset.id}>
                      {preset.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPresetDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => selectedPreset && loadPreset.mutate(selectedPreset)}
              disabled={!selectedPreset || loadPreset.isPending}
              data-testid="button-apply-preset"
            >
              Apply Preset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Transform Configuration Dialog (concat, map, regex, lookup) */}
      <Dialog open={transformDialog.open} onOpenChange={(open) => setTransformDialog({ ...transformDialog, open })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Configure {transformDialog.type}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Transform configuration UI coming soon
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransformDialog({ ...transformDialog, open: false })}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (transformDialog.ruleIndex !== null && transformDialog.type) {
                  addTransform(transformDialog.ruleIndex, { type: transformDialog.type, params: {} });
                  setTransformDialog({ open: false, type: null, ruleIndex: null });
                }
              }}
            >
              Add Transform
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}

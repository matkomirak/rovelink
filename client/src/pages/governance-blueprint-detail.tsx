import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { ArrowLeft, ClipboardCheck, Loader2, PlayCircle, RefreshCw, ShieldCheck } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { GovernanceEvaluationLauncher } from "@/components/governance-evaluation-launcher";
import { GovernanceBlueprintRuns } from "@/components/governance-blueprint-runs";
import {
  activateGovernanceBlueprintVersion,
  createGovernanceBlueprintVersion,
  getGovernanceBlueprint,
  governanceKeys,
  listGovernanceBlueprintVersions,
  listGovernanceNetBoxSources,
  type GovernanceNetBoxSourceSummary,
} from "@/lib/governance-api";
import type { GovernanceBlueprint, GovernanceBlueprintVersion } from "@shared/schema";
import {
  DEFAULT_CUSTOMER_SCOPE_GOVERNANCE_POLICY,
  type CustomerScopeGovernancePolicy,
  type CustomerScopePolicyMode,
  type GovernanceBlueprintRules,
} from "@shared/governance";

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "active") return "default";
  if (status === "archived") return "outline";
  return "secondary";
}

const customerScopeModeCopy: Record<CustomerScopePolicyMode, string> = {
  visibility_only: "Reports CustomerScope issues only. Does not affect score, readiness, or automation blocking.",
  score_only: "May affect governance/data-management score. Does not affect automation readiness or automation blocking.",
  readiness: "May mark objects as not automation-ready. Does not recommend block_automation.",
  enforce: "Evaluation recommends block_automation. Actual blocking depends on Automation Inventory governance enforcement settings.",
};

const policyModeLabels: Record<CustomerScopePolicyMode, string> = {
  visibility_only: "Visibility only",
  score_only: "Score only",
  readiness: "Readiness",
  enforce: "Enforce",
};

type EditableCustomerScopePolicy = Pick<
  CustomerScopeGovernancePolicy,
  | "mode"
  | "requireCustomerScopeAssignment"
  | "allowUnassigned"
  | "allowInternal"
  | "allowShared"
  | "requireAuthoritativeConfidence"
  | "treatMissingScopeReferenceAsBlocker"
  | "scoreWeight"
>;

function getEffectiveCustomerScopePolicy(rules: GovernanceBlueprintRules): CustomerScopeGovernancePolicy {
  return {
    ...DEFAULT_CUSTOMER_SCOPE_GOVERNANCE_POLICY,
    ...(rules.customerScope ?? {}),
  };
}

function toEditableCustomerScopePolicy(policy: CustomerScopeGovernancePolicy): EditableCustomerScopePolicy {
  return {
    mode: policy.mode,
    requireCustomerScopeAssignment: policy.requireCustomerScopeAssignment,
    allowUnassigned: policy.allowUnassigned,
    allowInternal: policy.allowInternal,
    allowShared: policy.allowShared,
    requireAuthoritativeConfidence: policy.requireAuthoritativeConfidence,
    treatMissingScopeReferenceAsBlocker: policy.treatMissingScopeReferenceAsBlocker,
    scoreWeight: policy.scoreWeight,
  };
}

function buildCustomerScopePolicy(form: EditableCustomerScopePolicy): CustomerScopeGovernancePolicy {
  return {
    ...DEFAULT_CUSTOMER_SCOPE_GOVERNANCE_POLICY,
    ...form,
    scoreWeight: Math.max(0, Number.isFinite(form.scoreWeight) ? form.scoreWeight : 0),
  };
}

function PolicyValue({ label, value }: { label: string; value: string | number | boolean }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-medium">{typeof value === "boolean" ? (value ? "Yes" : "No") : value}</div>
    </div>
  );
}

function PolicySwitch({
  id,
  label,
  description,
  checked,
  onCheckedChange,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border p-3">
      <div className="space-y-1">
        <Label htmlFor={id}>{label}</Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

function CustomerScopePolicyCard({
  activeVersion,
  hasNewerInactiveVersion,
  onEdit,
}: {
  activeVersion: GovernanceBlueprintVersion | undefined;
  hasNewerInactiveVersion: boolean;
  onEdit: () => void;
}) {
  if (!activeVersion) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-5 w-5" />
            CustomerScope Policy
          </CardTitle>
          <CardDescription>No active version is available for CustomerScope policy editing.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" disabled>Edit Policy</Button>
        </CardContent>
      </Card>
    );
  }

  const rules = activeVersion.rules as GovernanceBlueprintRules;
  const policy = getEffectiveCustomerScopePolicy(rules);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-5 w-5" />
              CustomerScope Policy
            </CardTitle>
            <CardDescription>
              Effective policy for active version v{activeVersion.version}.
            </CardDescription>
          </div>
          <Button variant="outline" onClick={onEdit} data-testid="button-edit-customer-scope-policy">
            Edit Policy
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border bg-muted/30 p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={policy.mode === "enforce" ? "destructive" : "outline"}>
              Mode: {policy.mode}
            </Badge>
            <span className="text-muted-foreground">{customerScopeModeCopy[policy.mode]}</span>
          </div>
          <p className="mt-2 text-xs font-medium">
            Blueprint enforce recommends blocking. Automation Inventory enforce decides whether automation actually blocks.
          </p>
          {policy.mode === "enforce" && (
            <p className="mt-1 text-xs text-muted-foreground">
              Operational blocking still depends on Automation Inventory governance enforcement settings.
            </p>
          )}
        </div>

        <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
          <p className="font-medium">Evaluations currently use this active version only.</p>
          <p className="mt-1 text-muted-foreground">
            Saving policy changes creates a new inactive version. Activate that version before running evaluations with the changed policy.
          </p>
          {hasNewerInactiveVersion && (
            <p className="mt-2 font-medium">
              A newer inactive version exists. It will not affect evaluations until activated.
            </p>
          )}
        </div>

        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <PolicyValue label="Require assignment" value={policy.requireCustomerScopeAssignment} />
          <PolicyValue label="Allow unassigned" value={policy.allowUnassigned} />
          <PolicyValue label="Allow internal" value={policy.allowInternal} />
          <PolicyValue label="Allow shared" value={policy.allowShared} />
          <PolicyValue label="Require authoritative" value={policy.requireAuthoritativeConfidence} />
          <PolicyValue label="Missing reference as blocker" value={policy.treatMissingScopeReferenceAsBlocker} />
          <PolicyValue label="Score weight" value={policy.scoreWeight} />
        </div>
      </CardContent>
    </Card>
  );
}

function CustomerScopePolicyDialog({
  open,
  onOpenChange,
  initialPolicy,
  onSave,
  isSaving,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialPolicy: CustomerScopeGovernancePolicy;
  onSave: (policy: CustomerScopeGovernancePolicy) => void;
  isSaving: boolean;
}) {
  const [form, setForm] = useState<EditableCustomerScopePolicy>(() => toEditableCustomerScopePolicy(initialPolicy));

  useEffect(() => {
    if (open) setForm(toEditableCustomerScopePolicy(initialPolicy));
  }, [initialPolicy, open]);

  const update = <K extends keyof EditableCustomerScopePolicy>(key: K, value: EditableCustomerScopePolicy[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>CustomerScope Policy</DialogTitle>
          <DialogDescription>
            Save changes as a new blueprint version. The new version is not activated automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="customer-scope-policy-mode">Mode</Label>
            <Select value={form.mode} onValueChange={(value) => update("mode", value as CustomerScopePolicyMode)}>
              <SelectTrigger id="customer-scope-policy-mode" data-testid="select-customer-scope-policy-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(policyModeLabels).map(([mode, label]) => (
                  <SelectItem key={mode} value={mode}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{customerScopeModeCopy[form.mode]}</p>
            <p className="text-xs font-medium">
              Blueprint enforce recommends blocking. Automation Inventory enforce decides whether automation actually blocks.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <PolicySwitch
              id="customer-scope-require-assignment"
              label="Require CustomerScope assignment"
              description="Report objects without a customer/environment assignment."
              checked={form.requireCustomerScopeAssignment}
              onCheckedChange={(checked) => update("requireCustomerScopeAssignment", checked)}
            />
            <PolicySwitch
              id="customer-scope-allow-unassigned"
              label="Allow unassigned"
              description="Permit explicit unassigned source results."
              checked={form.allowUnassigned}
              onCheckedChange={(checked) => update("allowUnassigned", checked)}
            />
            <PolicySwitch
              id="customer-scope-allow-internal"
              label="Allow internal"
              description="Treat internal objects as acceptable when marked internal."
              checked={form.allowInternal}
              onCheckedChange={(checked) => update("allowInternal", checked)}
            />
            <PolicySwitch
              id="customer-scope-allow-shared"
              label="Allow shared"
              description="Permit objects assigned to multiple CustomerScopes."
              checked={form.allowShared}
              onCheckedChange={(checked) => update("allowShared", checked)}
            />
            <PolicySwitch
              id="customer-scope-require-authoritative"
              label="Require authoritative confidence"
              description="Flag mapped or manual assignments."
              checked={form.requireAuthoritativeConfidence}
              onCheckedChange={(checked) => update("requireAuthoritativeConfidence", checked)}
            />
            <PolicySwitch
              id="customer-scope-missing-reference"
              label="Treat missing scope reference as blocker"
              description="Apply policy impact when an assignment points to a missing CustomerScope."
              checked={form.treatMissingScopeReferenceAsBlocker}
              onCheckedChange={(checked) => update("treatMissingScopeReferenceAsBlocker", checked)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="customer-scope-score-weight">Score weight</Label>
            <Input
              id="customer-scope-score-weight"
              type="number"
              min={0}
              step={1}
              value={form.scoreWeight}
              onChange={(event) => update("scoreWeight", Number(event.target.value))}
              data-testid="input-customer-scope-score-weight"
            />
            <p className="text-xs text-muted-foreground">
              Used by score_only mode as a bounded data-management score penalty. Use 0 for no score impact.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            onClick={() => onSave(buildCustomerScopePolicy(form))}
            disabled={isSaving}
            data-testid="button-save-customer-scope-policy"
          >
            {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save New Version
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RulesPreview({ rules }: { rules: GovernanceBlueprintRules }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Data & Management</CardTitle>
          <CardDescription>{rules.dataManagement.length} field rules</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {rules.dataManagement.map((rule) => (
            <div key={rule.fieldKey} className="rounded-md border p-3">
              <div className="font-medium">{rule.fieldKey}</div>
              <div className="text-muted-foreground">mode: {rule.managementMode}</div>
              <div className="text-muted-foreground">required: {rule.required ? "yes" : "no"} | weight: {rule.weight}</div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ownership</CardTitle>
          <CardDescription>{rules.ownership.length} role rules</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {rules.ownership.map((rule) => (
            <div key={rule.role} className="rounded-md border p-3">
              <div className="font-medium">{rule.role}</div>
              <div className="text-muted-foreground">required: {rule.required ? "yes" : "no"} | weight: {rule.weight}</div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Relevance</CardTitle>
          <CardDescription>0 none, 3 mandatory</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {Object.entries(rules.relevance).map(([dimension, score]) => (
            <div key={dimension} className="flex items-center justify-between rounded-md border px-3 py-2">
              <span className="font-medium">{dimension}</span>
              <Badge variant="outline">{score}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="lg:col-span-3">
        <CardHeader>
          <CardTitle className="text-base">Raw Rules</CardTitle>
          <CardDescription>Read-only JSON until the rule editor is added.</CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="max-h-96 overflow-auto rounded-md bg-muted p-4 text-xs">
            {JSON.stringify(rules, null, 2)}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}

export default function GovernanceBlueprintDetail() {
  const { id = "" } = useParams<{ id: string }>();
  const { toast } = useToast();
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [policyDialogOpen, setPolicyDialogOpen] = useState(false);
  const [savedPolicyVersionId, setSavedPolicyVersionId] = useState<string | null>(null);

  const {
    data: blueprint,
    isLoading: blueprintLoading,
    isError: blueprintError,
    error,
  } = useQuery<GovernanceBlueprint>({
    queryKey: governanceKeys.blueprint(id),
    queryFn: () => getGovernanceBlueprint(id),
    enabled: Boolean(id),
  });

  const {
    data: versions = [],
    isLoading: versionsLoading,
    isError: versionsError,
    error: versionsErrorDetail,
    refetch: refetchVersions,
    isFetching: versionsFetching,
  } = useQuery<GovernanceBlueprintVersion[]>({
    queryKey: governanceKeys.versions(id),
    queryFn: () => listGovernanceBlueprintVersions(id),
    enabled: Boolean(id),
  });

  const { data: sources = [] } = useQuery<GovernanceNetBoxSourceSummary[]>({
    queryKey: governanceKeys.netboxSources,
    queryFn: listGovernanceNetBoxSources,
  });
  const boundSourceName = blueprint?.sourceType === "netbox_inventory_source" && blueprint.sourceId
    ? sources.find((source) => source.id === blueprint.sourceId)?.name ?? "Bound NetBox source"
    : null;

  const activeVersion = useMemo(
    () => versions.find((version) => version.id === blueprint?.activeVersionId),
    [blueprint?.activeVersionId, versions],
  );
  const newestInactiveVersion = useMemo(() => {
    if (!activeVersion) return undefined;
    return versions
      .filter((version) => version.id !== activeVersion.id && version.version > activeVersion.version)
      .sort((a, b) => b.version - a.version)[0];
  }, [activeVersion, versions]);

  const activateMutation = useMutation({
    mutationFn: (versionId: string) => activateGovernanceBlueprintVersion(id, versionId),
    onSuccess: () => {
      setSavedPolicyVersionId(null);
      queryClient.invalidateQueries({ queryKey: governanceKeys.blueprint(id) });
      queryClient.invalidateQueries({ queryKey: governanceKeys.blueprints });
      toast({ title: "Blueprint version activated" });
    },
    onError: (mutationError: Error) => {
      toast({ variant: "destructive", title: "Activation failed", description: mutationError.message });
    },
  });

  const createVersionMutation = useMutation({
    mutationFn: (customerScope: CustomerScopeGovernancePolicy) => {
      if (!activeVersion) throw new Error("Blueprint has no active version");
      const currentRules = activeVersion.rules as GovernanceBlueprintRules;
      return createGovernanceBlueprintVersion(id, {
        ...currentRules,
        customerScope,
      });
    },
    onSuccess: (version) => {
      setSavedPolicyVersionId(version.id);
      queryClient.invalidateQueries({ queryKey: governanceKeys.versions(id) });
      queryClient.invalidateQueries({ queryKey: governanceKeys.blueprint(id) });
      queryClient.invalidateQueries({ queryKey: governanceKeys.blueprints });
      toast({
        title: "CustomerScope policy saved",
        description: `CustomerScope policy saved as version v${version.version}. It is not active yet. Activate v${version.version} before running evaluations with this policy.`,
      });
      setPolicyDialogOpen(false);
    },
    onError: (mutationError: Error) => {
      toast({ variant: "destructive", title: "Could not save CustomerScope policy", description: mutationError.message });
    },
  });

  const activeRules = activeVersion?.rules as GovernanceBlueprintRules | undefined;
  const activeCustomerScopePolicy = useMemo(
    () => activeRules ? getEffectiveCustomerScopePolicy(activeRules) : DEFAULT_CUSTOMER_SCOPE_GOVERNANCE_POLICY,
    [activeRules],
  );

  if (blueprintError) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" asChild>
          <Link href="/governance"><ArrowLeft className="h-4 w-4 mr-2" />Back</Link>
        </Button>
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {(error as Error).message}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/governance"><ArrowLeft className="h-4 w-4 mr-2" />Back to Governance</Link>
          </Button>
          <div>
            <h1 className="text-2xl font-semibold">{blueprintLoading ? "Governance Blueprint" : blueprint?.name}</h1>
            <p className="text-sm text-muted-foreground">
              Review versions and apply this blueprint to cached NetBox VMs from a selected source.
            </p>
          </div>
        </div>
        <Button
          onClick={() => setLauncherOpen(true)}
          disabled={!blueprint?.activeVersionId}
          data-testid="button-run-governance-evaluation"
        >
          <PlayCircle className="h-4 w-4 mr-2" />
          Run Evaluation
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5" />
            Blueprint Metadata
          </CardTitle>
        </CardHeader>
        <CardContent>
          {blueprintLoading ? (
            <div className="grid gap-3 md:grid-cols-4">
              {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-12" />)}
            </div>
          ) : blueprint ? (
            <div className="grid gap-4 md:grid-cols-5">
              <div>
                <div className="text-xs text-muted-foreground">Object Type</div>
                <Badge variant="outline">{blueprint.objectType}</Badge>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Bound Source</div>
                <div className="font-medium">{boundSourceName ?? "No bound source"}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Status</div>
                <Badge variant={statusVariant(blueprint.status)}>{blueprint.status}</Badge>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Active Version</div>
                <div className="font-medium">{activeVersion ? `v${activeVersion.version}` : "-"}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Updated</div>
                <div className="font-medium">{formatDate(blueprint.updatedAt)}</div>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Versions</CardTitle>
          <CardDescription>Blueprint versions are read-only here; activation is explicit. Evaluations use the active version only.</CardDescription>
        </CardHeader>
        <CardContent>
          {versionsError ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
              <p className="font-medium">Failed to load blueprint versions</p>
              <p className="mt-1 text-muted-foreground">{(versionsErrorDetail as Error).message}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => refetchVersions()}
                disabled={versionsFetching}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${versionsFetching ? "animate-spin" : ""}`} />
                Retry
              </Button>
            </div>
          ) : versionsLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-12 w-full" />)}
            </div>
          ) : versions.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              No versions found for this blueprint.
            </div>
          ) : (
            <div className="space-y-3">
              {(savedPolicyVersionId || newestInactiveVersion) && (
                <Alert>
                  <AlertTitle>Inactive policy version saved</AlertTitle>
                  <AlertDescription>
                    {savedPolicyVersionId
                      ? "The saved CustomerScope policy version is inactive. Activate it before evaluation."
                      : "Latest saved version is inactive. Activate it before evaluation."}
                  </AlertDescription>
                </Alert>
              )}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Version</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {versions.map((version) => {
                    const isActive = version.id === blueprint?.activeVersionId;
                    const isSavedPolicyVersion = version.id === savedPolicyVersionId;
                    const isNewestInactiveVersion = !isActive && version.id === newestInactiveVersion?.id;
                    return (
                      <TableRow
                        key={version.id}
                        className={isSavedPolicyVersion || isNewestInactiveVersion ? "bg-primary/5" : undefined}
                      >
                        <TableCell className="font-medium">
                          <div className="flex flex-wrap items-center gap-2">
                            <span>v{version.version}</span>
                            {isSavedPolicyVersion && <Badge variant="secondary">New policy version</Badge>}
                          </div>
                        </TableCell>
                        <TableCell>{formatDate(version.createdAt)}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-2">
                            {isActive ? <Badge>Active</Badge> : <Badge variant="outline">Inactive</Badge>}
                            {!isActive && <Badge variant="secondary">Activate to use</Badge>}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={isActive || activateMutation.isPending}
                            onClick={() => activateMutation.mutate(version.id)}
                            title={isActive ? "This version is already active." : "Make this version the active evaluation policy."}
                          >
                            Activate
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {activeVersion ? (
        <>
          <CustomerScopePolicyCard
            activeVersion={activeVersion}
            hasNewerInactiveVersion={Boolean(newestInactiveVersion)}
            onEdit={() => setPolicyDialogOpen(true)}
          />
          <RulesPreview rules={activeVersion.rules as GovernanceBlueprintRules} />
        </>
      ) : (
        <CustomerScopePolicyCard
          activeVersion={activeVersion}
          hasNewerInactiveVersion={Boolean(newestInactiveVersion)}
          onEdit={() => setPolicyDialogOpen(true)}
        />
      )}
      {blueprint && <GovernanceBlueprintRuns blueprintId={id} />}
      <GovernanceEvaluationLauncher open={launcherOpen} onOpenChange={setLauncherOpen} fixedBlueprintId={id} fixedBlueprint={blueprint} />
      <CustomerScopePolicyDialog
        open={policyDialogOpen}
        onOpenChange={setPolicyDialogOpen}
        initialPolicy={activeCustomerScopePolicy}
        onSave={(policy) => createVersionMutation.mutate(policy)}
        isSaving={createVersionMutation.isPending}
      />
    </div>
  );
}

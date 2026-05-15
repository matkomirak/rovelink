/**
 * Runner Dispatcher — selects AWX or local runner based on job template config.
 * This replaces FakeRunner in all route handlers.
 */

import { db } from "../db";
import { settings } from "../../shared/schema";
import { storage } from "../storage";
import { AwxRunner } from "./awx-runner";
import { LocalRunner } from "./local-runner";
import { decryptSecret } from "./secrets";
import { resolveSafePlaybookPath, validatePlaybookPathSyntax } from "./safe-playbook-path";
import { createInventoryForRunWithSnapshot } from "./inventory-generator";
import type { JobRun } from "../../shared/schema";

export interface RunResult {
  status: "ok" | "failed" | "error" | "cancelled";
  summary: { hosts: number; ok: number; changed: number; failed: number };
  logs: string;
}

export async function dispatchRun(run: JobRun, onLog: (line: string) => void): Promise<RunResult> {
  // Tenant safety: fail closed unconditionally if orgId is missing
  if (!run.orgId) {
    throw new Error("Job run is missing orgId — cannot dispatch safely");
  }

  // Use tenant-aware storage to prevent cross-tenant template access
  const template = await storage.getJobTemplate(run.templateId, run.orgId);

  if (!template) throw new Error(`Job template ${run.templateId} not found`);

  if (template.runnerMode === "awx") {
    return runViaAwx(run, template, onLog);
  }
  return runLocally(run, template, onLog);
}

async function runViaAwx(
  run: JobRun,
  template: any,
  onLog: (line: string) => void
): Promise<RunResult> {
  const rows = await db.select().from(settings);
  const settingsMap = Object.fromEntries(rows.map((r: any) => [r.key, r.value]));

  const awxUrl = settingsMap["awx_url"];
  const awxTokenEnc = settingsMap["awx_token"];
  const verifySsl = settingsMap["awx_verify_ssl"] !== "false";

  if (!awxUrl || !awxTokenEnc) {
    throw new Error("AWX not configured. Set awx_url and awx_token in Settings.");
  }

  const runner = new AwxRunner({
    url: awxUrl,
    token: decryptSecret(awxTokenEnc),
    verifySsl,
  });

  const result = await runner.launch(
    {
      templateId: template.awxTemplateId!,
      inventoryId: template.awxInventoryId ?? undefined,
      limitExpr: run.limitExpr ?? undefined,
      extraVars: (template.extraVars as Record<string, any>) ?? {},
      checkMode: template.checkMode ?? false,
    },
    onLog
  );

  return {
    status: result.status === "cancelled" ? "failed" : result.status,
    summary: result.summary,
    logs: result.logs,
  };
}

async function runLocally(
  run: JobRun,
  template: any,
  onLog: (line: string) => void
): Promise<RunResult> {
  // Fail closed: local execution requires a real project checkout on disk.
  // Without checkoutPath, we cannot safely resolve playbook paths (no traversal
  // protection, no symlink guard, no existence check). Demo/simulation runs must
  // use runnerMode="awx" pointing at AWX, not LocalRunner.
  if (!template.projectId) {
    throw new Error(
      "Local execution requires a project to be set on the job template."
    );
  }

  const project = await storage.getProject(template.projectId, run.orgId!);
  if (!project?.checkoutPath) {
    throw new Error(
      `Project ${template.projectId} has no checkoutPath on disk. ` +
      "Real Git sync must be implemented before local Ansible execution is enabled."
    );
  }

  // Disk-level path safety: rejects traversal, symlinks outside root, and non-YAML files.
  const resolvedPlaybookPath = await resolveSafePlaybookPath(
    project.checkoutPath,
    template.playbook
  );

  // Generate and write a per-org/run inventory file — never accept a path from the client.
  // Gate policy is enforced fresh from DB; blocked hosts are excluded.
  // The returned snapshot is persisted on the run for durable audit trail.
  const { inventoryPath, gateSnapshot } = await createInventoryForRunWithSnapshot({
    orgId: run.orgId!,
    runId: run.id,
    templateId: template.id,
    inventoryId: template.inventoryId ?? null,
    limitExpr: run.limitExpr ?? null,
  });

  // Persist gate snapshot on the run record for durable audit trail
  await storage.updateJobRun(run.id, { gateSnapshot } as any, run.orgId!);

  const runner = new LocalRunner();
  const result = await runner.execute(
    {
      playbookPath: resolvedPlaybookPath,
      inventoryPath,
      limitExpr: run.limitExpr ?? undefined,
      extraVars: (template.extraVars as Record<string, any>) ?? {},
      checkMode: template.checkMode ?? false,
      diffMode: template.diffMode ?? false,
    },
    onLog
  );

  return {
    status: result.status,
    summary: result.summary,
    logs: result.logs,
  };
}

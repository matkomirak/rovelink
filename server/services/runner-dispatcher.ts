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
import type { JobRun } from "../../shared/schema";

export interface RunResult {
  status: "ok" | "failed" | "error" | "cancelled";
  summary: { hosts: number; ok: number; changed: number; failed: number };
  logs: string;
}

export async function dispatchRun(run: JobRun, onLog: (line: string) => void): Promise<RunResult> {
  // Tenant safety: fail closed in production if orgId is missing
  if (!run.orgId) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Job run is missing orgId — cannot dispatch safely in production");
    }
    console.warn(`[dispatchRun] run ${run.id} has no orgId — falling back to unscoped template lookup`);
  }

  // Use tenant-aware storage instead of raw db query to prevent cross-tenant template access
  const template = run.orgId
    ? await storage.getJobTemplate(run.templateId, run.orgId)
    : await storage.getJobTemplate(run.templateId);

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
  // Attempt to resolve a disk-safe playbook path when the project has been checked out.
  // Fall back to syntax-only validation when no real checkout exists (demo/simulation mode).
  let resolvedPlaybookPath: string = template.playbook;

  // resolveSafePlaybookPath requires project.checkoutPath (added when real Git sync is implemented).
  // Until then, validatePlaybookPathSyntax enforces syntax-level safety on all paths.
  validatePlaybookPathSyntax(template.playbook);

  // Generate a per-org/run inventory path — never accept a path from the client
  const inventoryPath = run.orgId
    ? `runtime/inventories/${run.orgId}/${run.id}/inventory.yml`
    : `runtime/inventories/default/${run.id}/inventory.yml`;

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

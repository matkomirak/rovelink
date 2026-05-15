/**
 * Runner Dispatcher — selects AWX or local runner based on job template config.
 * This replaces FakeRunner in all route handlers.
 */

import { db } from "../db";
import { jobTemplates, settings } from "../../shared/schema";
import { eq } from "drizzle-orm";
import { AwxRunner } from "./awx-runner";
import { LocalRunner } from "./local-runner";
import { decryptSecret } from "./secrets";
import { validatePlaybookPathSyntax } from "./safe-playbook-path";
import type { JobRun } from "../../shared/schema";

export interface RunResult {
  status: "ok" | "failed" | "error" | "cancelled";
  summary: { hosts: number; ok: number; changed: number; failed: number };
  logs: string;
}

export async function dispatchRun(run: JobRun, onLog: (line: string) => void): Promise<RunResult> {
  const template = await db.query.jobTemplates.findFirst({
    where: eq(jobTemplates.id, run.templateId),
  });
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
  // Validate playbook path before spawning to prevent path traversal
  validatePlaybookPathSyntax(template.playbook);

  const runner = new LocalRunner();
  const result = await runner.execute(
    {
      playbookPath: template.playbook,
      inventoryPath: "inventory/netbox.yml",
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

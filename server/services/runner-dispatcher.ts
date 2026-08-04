/**
 * Runner Dispatcher — selects AWX or local runner based on job template config.
 * This replaces FakeRunner in all route handlers.
 */

import { db } from "../db";
import { settings } from "../../shared/schema";
import { storage } from "../storage";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { AwxRunner } from "./awx-runner";
import { isLocalRunnerEnabled, LocalRunner } from "./local-runner";
import { decryptSecret } from "./secrets";
import { resolveSafePlaybookPath } from "./safe-playbook-path";
import { createInventoryForRunWithSnapshot } from "./inventory-generator";
import {
  cleanupRuntimeCredentialDir,
  loadAndMaterializeSshCredential,
  type MaterializedSshCredential,
} from "./ssh-credential-materializer";
import type { JobRun } from "../../shared/schema";

export interface RunResult {
  status: "ok" | "failed" | "error" | "cancelled";
  summary: { hosts: number; ok: number; changed: number; failed: number };
  logs: string;
}

export async function resolveProjectPlaybook(
  project: { checkoutPath?: string | null },
  playbookPath: string
): Promise<string> {
  if (!project.checkoutPath) {
    throw new Error(
      "Project has no checkoutPath on disk. Sync the project before local Ansible execution."
    );
  }

  return resolveSafePlaybookPath(project.checkoutPath, playbookPath);
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
  if (!isLocalRunnerEnabled()) {
    throw new Error("Local runner is disabled. Set ROVELINK_LOCAL_RUNNER_ENABLED=true to enable local Ansible execution.");
  }

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
  if (!project) {
    throw new Error(`Project ${template.projectId} not found`);
  }

  // Disk-level path safety: rejects traversal, symlinks outside root, and non-YAML files.
  const resolvedPlaybookPath = await resolveProjectPlaybook(
    project,
    template.playbook
  );
  const localhostOnly = await isLocalhostOnlyPlaybook(resolvedPlaybookPath);
  let sshCredential: MaterializedSshCredential | undefined;

  try {
    if (!localhostOnly) {
      sshCredential = await loadAndMaterializeSshCredential({
        credentialId: template.credentialId,
        orgId: run.orgId!,
        runId: run.id,
      });
    }

  // Generate and write a per-org/run inventory file — never accept a path from the client.
  // Gate policy is enforced fresh from DB; blocked hosts are excluded.
  // The returned snapshot is persisted on the run for durable audit trail.
  const { inventoryPath, gateSnapshot } = await createInventoryForRunWithSnapshot({
    orgId: run.orgId!,
    runId: run.id,
    templateId: template.id,
    inventoryId: template.inventoryId ?? null,
    limitExpr: run.limitExpr ?? null,
    ansibleUser: sshCredential?.username ?? null,
    ansiblePort: sshCredential?.sshPort ?? null,
  });

  // Persist gate snapshot on the run record for durable audit trail
  await storage.updateJobRun(run.id, { gateSnapshot } as any, run.orgId!);

  const executionInventoryPath = localhostOnly
    ? await createLocalhostInventoryForRun(run.orgId!, run.id)
    : inventoryPath;

  if (localhostOnly) {
    onLog("[rovelink] Localhost-only playbook detected; using local connection inventory.\n");
  }

  const runner = new LocalRunner();
  const result = await runner.execute(
    {
      playbookPath: resolvedPlaybookPath,
      inventoryPath: executionInventoryPath,
      workingDirectory: project.checkoutPath ?? undefined,
      limitExpr: run.limitExpr ?? undefined,
      extraVars: (template.extraVars as Record<string, any>) ?? {},
      checkMode: template.checkMode ?? false,
      diffMode: template.diffMode ?? false,
      credentialPath: sshCredential?.privateKeyPath,
      strictHostKeyChecking: sshCredential?.strictHostKeyChecking,
    },
    onLog
  );

  return {
    status: result.status,
    summary: result.summary,
    logs: result.logs,
  };
  } finally {
    if (sshCredential) {
      try {
        await cleanupRuntimeCredentialDir(run.orgId!, run.id);
      } catch {
        onLog("[rovelink] Failed to clean up temporary SSH credential files.\n");
      }
    }
  }
}

export async function isLocalhostOnlyPlaybook(playbookPath: string): Promise<boolean> {
  const content = await readFile(playbookPath, "utf8");
  const head = content.slice(0, 65536);
  const hostPatterns = Array.from(head.matchAll(/^\s*-\s*hosts\s*:\s*["']?([^"'\n#]+)["']?/gm))
    .map((match) => match[1].trim());

  return hostPatterns.length > 0 && hostPatterns.every(isLocalhostPattern);
}

function isLocalhostPattern(pattern: string): boolean {
  return ["localhost", "127.0.0.1", "::1"].includes(pattern);
}

async function createLocalhostInventoryForRun(orgId: string, runId: string): Promise<string> {
  const dir = path.resolve(process.cwd(), "runtime", "inventories", orgId, runId);
  await mkdir(dir, { recursive: true });

  const inventoryPath = path.join(dir, "localhost.yml");
  await writeFile(
    inventoryPath,
    [
      "---",
      "# Generated by Rovelink for localhost-only playbook execution",
      "all:",
      "  hosts:",
      "    localhost:",
      "      ansible_connection: local",
      "",
    ].join("\n"),
    { mode: 0o600 }
  );

  return inventoryPath;
}

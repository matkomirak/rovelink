/**
 * Local Ansible runner — spawns ansible-playbook as a child process.
 *
 * Requirements on the host:
 *   - ansible-playbook must be in PATH
 *   - The inventory file referenced in the job template must exist
 *   - SSH keys / credentials must be pre-configured on the host
 *
 * Security note: args are passed as an array to spawn(), never interpolated into a shell string.
 */

import { spawn } from "child_process";

export interface LocalRunOptions {
  playbookPath: string;
  inventoryPath: string;
  limitExpr?: string;
  extraVars?: Record<string, any>;
  checkMode?: boolean;
  diffMode?: boolean;
  credentialPath?: string;
}

export interface LocalRunResult {
  status: "ok" | "failed" | "error";
  exitCode: number;
  logs: string;
  summary: {
    hosts: number;
    ok: number;
    changed: number;
    failed: number;
    unreachable: number;
  };
}

export class LocalRunner {
  async execute(options: LocalRunOptions, onLog: (line: string) => void): Promise<LocalRunResult> {
    const args: string[] = ["-i", options.inventoryPath, options.playbookPath];

    if (options.limitExpr) args.push("--limit", options.limitExpr);
    if (options.checkMode) args.push("--check");
    if (options.diffMode) args.push("--diff");
    if (options.credentialPath) args.push("--private-key", options.credentialPath);
    if (options.extraVars) {
      args.push("--extra-vars", JSON.stringify(options.extraVars));
    }

    return new Promise((resolve) => {
      const logs: string[] = [];
      const summary = { hosts: 0, ok: 0, changed: 0, failed: 0, unreachable: 0 };

      const proc = spawn("ansible-playbook", args, {
        env: { ...process.env, ANSIBLE_FORCE_COLOR: "0", ANSIBLE_NOCOLOR: "1" },
      });

      const handleLine = (line: string) => {
        logs.push(line);
        onLog(line + "\n");
        const recapMatch = line.match(
          /^(\S+)\s+:\s+ok=(\d+)\s+changed=(\d+)\s+unreachable=(\d+)\s+failed=(\d+)/
        );
        if (recapMatch) {
          summary.hosts += 1;
          summary.ok += parseInt(recapMatch[2], 10);
          summary.changed += parseInt(recapMatch[3], 10);
          summary.unreachable += parseInt(recapMatch[4], 10);
          summary.failed += parseInt(recapMatch[5], 10);
        }
      };

      proc.stdout.on("data", (chunk: Buffer) => {
        chunk.toString().split("\n").filter(Boolean).forEach(handleLine);
      });
      proc.stderr.on("data", (chunk: Buffer) => {
        chunk
          .toString()
          .split("\n")
          .filter(Boolean)
          .forEach((l) => handleLine(`[stderr] ${l}`));
      });

      proc.on("close", (code) => {
        resolve({
          status: code === 0 ? "ok" : "failed",
          exitCode: code ?? 1,
          logs: logs.join("\n"),
          summary,
        });
      });

      proc.on("error", (err) => {
        onLog(`[rovelink] Failed to start ansible-playbook: ${err.message}\n`);
        resolve({ status: "error", exitCode: -1, logs: err.message, summary });
      });
    });
  }
}

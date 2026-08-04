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
import { isLocalDevRuntime } from "./runtime-config";

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;

export interface LocalRunOptions {
  playbookPath: string;
  inventoryPath: string;
  workingDirectory?: string;
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

export interface LocalRunnerOptions {
  command?: string;
  commandArgsPrefix?: string[];
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export class LocalRunner {
  private readonly command: string;
  private readonly commandArgsPrefix: string[];
  private readonly timeoutMs: number;
  private readonly maxOutputBytes: number;

  constructor(options: LocalRunnerOptions = {}) {
    this.command = options.command ?? "ansible-playbook";
    this.commandArgsPrefix = options.commandArgsPrefix ?? [];
    this.timeoutMs = options.timeoutMs ?? readPositiveIntEnv("ROVELINK_LOCAL_RUNNER_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
    this.maxOutputBytes = options.maxOutputBytes ?? readPositiveIntEnv("ROVELINK_LOCAL_RUNNER_MAX_OUTPUT_BYTES", DEFAULT_MAX_OUTPUT_BYTES);
  }

  async execute(options: LocalRunOptions, onLog: (line: string) => void): Promise<LocalRunResult> {
    const args: string[] = [...this.commandArgsPrefix, "-i", options.inventoryPath, options.playbookPath];

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
      let outputBytes = 0;
      let outputTruncated = false;
      let settled = false;

      const proc = spawn(this.command, args, {
        cwd: options.workingDirectory,
        env: { ...process.env, ANSIBLE_FORCE_COLOR: "0", ANSIBLE_NOCOLOR: "1" },
      });

      const finish = (result: LocalRunResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(result);
      };

      const handleLine = (line: string) => {
        if (outputBytes >= this.maxOutputBytes) {
          if (!outputTruncated) {
            outputTruncated = true;
            const notice = "[rovelink] Output truncated after reaching the local runner log limit.";
            logs.push(notice);
            onLog(notice + "\n");
          }
          return;
        }

        const lineBytes = Buffer.byteLength(line, "utf8");
        outputBytes += lineBytes;
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

      const timeout = setTimeout(() => {
        proc.kill("SIGTERM");
        const message = `Local runner timed out after ${this.timeoutMs}ms`;
        logs.push(`[rovelink] ${message}`);
        finish({ status: "error", exitCode: -1, logs: logs.join("\n"), summary });
      }, this.timeoutMs);

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
        finish({
          status: code === 0 ? "ok" : "failed",
          exitCode: code ?? 1,
          logs: logs.join("\n"),
          summary,
        });
      });

      proc.on("error", (err) => {
        onLog(`[rovelink] Failed to start ${this.command}: ${err.message}\n`);
        finish({ status: "error", exitCode: -1, logs: err.message, summary });
      });
    });
  }
}

export function isLocalRunnerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.ROVELINK_LOCAL_RUNNER_ENABLED === "true") {
    return true;
  }

  return env.NODE_ENV !== "production" || isLocalDevRuntime(env);
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * AWX Runner — launches AWX job templates via REST API and streams output.
 *
 * AWX API reference: https://docs.ansible.com/automation-controller/latest/html/controllerapi/
 *
 * Flow:
 *   1. POST /api/v2/job_templates/:id/launch/  → returns { job: { id } }
 *   2. Poll GET /api/v2/jobs/:jobId/            → wait for status != "pending" | "waiting" | "running"
 *   3. Stream GET /api/v2/jobs/:jobId/stdout/?format=txt  → pipe to onLog callback
 *   4. Return final status and summary
 */

import axios, { AxiosInstance } from "axios";
import https from "https";

export interface AwxConfig {
  url: string;
  token: string;
  verifySsl: boolean;
}

export interface AwxLaunchOptions {
  templateId: number;
  inventoryId?: number;
  limitExpr?: string;
  extraVars?: Record<string, any>;
  checkMode?: boolean;
}

export interface AwxRunResult {
  status: "ok" | "failed" | "error" | "cancelled";
  jobId: number;
  summary: {
    hosts: number;
    ok: number;
    changed: number;
    failed: number;
    unreachable: number;
  };
  logs: string;
}

export class AwxRunner {
  private client: AxiosInstance;

  constructor(config: AwxConfig) {
    this.client = axios.create({
      baseURL: config.url.replace(/\/$/, ""),
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      httpsAgent: new https.Agent({ rejectUnauthorized: config.verifySsl }),
      timeout: 30000,
    });
  }

  async testConnection(): Promise<{ ok: boolean; version?: string; error?: string }> {
    try {
      const res = await this.client.get("/api/v2/ping/");
      return { ok: true, version: res.data?.version };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  async launch(options: AwxLaunchOptions, onLog: (line: string) => void): Promise<AwxRunResult> {
    const payload: Record<string, any> = {};
    if (options.inventoryId) payload.inventory = options.inventoryId;
    if (options.limitExpr) payload.limit = options.limitExpr;
    if (options.extraVars) payload.extra_vars = JSON.stringify(options.extraVars);
    if (options.checkMode) payload.job_type = "check";

    const launchRes = await this.client.post(
      `/api/v2/job_templates/${options.templateId}/launch/`,
      payload
    );
    const jobId: number = launchRes.data.job;
    onLog(`[rovelink] AWX job ${jobId} launched\n`);

    const terminalStatuses = new Set(["successful", "failed", "error", "canceled"]);
    let jobData: any;
    while (true) {
      await new Promise((r) => setTimeout(r, 3000));
      const statusRes = await this.client.get(`/api/v2/jobs/${jobId}/`);
      jobData = statusRes.data;
      if (terminalStatuses.has(jobData.status)) break;
    }

    try {
      const stdoutRes = await this.client.get(`/api/v2/jobs/${jobId}/stdout/`, {
        params: { format: "txt" },
        responseType: "text",
      });
      const lines: string[] = (stdoutRes.data as string).split("\n");
      for (const line of lines) {
        onLog(line + "\n");
      }
    } catch {
      onLog("[rovelink] Could not retrieve job stdout\n");
    }

    const hostSummary = jobData.summary_fields?.hosts || {};
    const totals = Object.values(hostSummary as Record<string, any>).reduce(
      (acc: any, h: any) => {
        acc.ok += h.ok || 0;
        acc.changed += h.changed || 0;
        acc.failed += h.failures || 0;
        acc.unreachable += h.unreachable || 0;
        acc.hosts += 1;
        return acc;
      },
      { hosts: 0, ok: 0, changed: 0, failed: 0, unreachable: 0 }
    );

    const statusMap: Record<string, AwxRunResult["status"]> = {
      successful: "ok",
      failed: "failed",
      error: "error",
      canceled: "cancelled",
    };

    return {
      status: statusMap[jobData.status] ?? "error",
      jobId,
      summary: totals,
      logs: "",
    };
  }
}

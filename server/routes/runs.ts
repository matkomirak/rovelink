import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { storage } from "../storage";

interface AuthRequest extends Request {
  userId?: string;
  orgId?: string;
  user?: any;
}

const router = Router();

interface UnifiedRun {
  id: string;
  runType: "playbook-run" | "bdp-sync" | "provider-sync";
  status: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  logs: string | null;
  summary: any;
  archived: boolean;
  sourceId: string | null;
  sourceName: string | null;
  sourceType: string | null;
}

router.get("/", async (req: AuthRequest, res) => {
  try {
    const { status, archived, startDate, endDate, type } = req.query;
    const typeFilter = type && type !== "_all" ? (type as string) : null;
    const statusFilter = status && status !== "_all" ? (status as string) : null;

    const [jobRunsData, pipelineRunsData, syncRunsData, pipelinesData, providersData] =
      await Promise.all([
        storage.getJobRuns({}, 1, 100),
        storage.getAllPipelineRuns(100),
        storage.getAllSyncRuns(100),
        storage.getPipelines(),
        storage.getProviders(),
      ]);

    const pipelineNameMap = new Map(
      pipelinesData.map((p: { id: string; name: string }) => [p.id, p.name])
    );
    const providerNameMap = new Map(
      providersData.map((p: { id: string; name: string }) => [p.id, p.name])
    );

    const unifiedRuns: UnifiedRun[] = [];

    for (const run of jobRunsData) {
      unifiedRuns.push({
        id: run.id,
        runType: "playbook-run",
        status: run.status,
        startedAt: run.startedAt,
        finishedAt: run.completedAt,
        createdAt: run.createdAt,
        logs: run.logs,
        summary: run.resultSummary,
        archived: run.archived || false,
        sourceId: run.templateId,
        sourceName: null,
        sourceType: "template",
      });
    }

    for (const run of pipelineRunsData) {
      unifiedRuns.push({
        id: run.id,
        runType: "bdp-sync",
        status: run.status,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        createdAt: run.createdAt,
        logs: run.logs,
        summary: run.summary,
        archived: false,
        sourceId: run.pipelineId,
        sourceName: pipelineNameMap.get(run.pipelineId) || "Unknown Pipeline",
        sourceType: "pipeline",
      });
    }

    for (const run of syncRunsData) {
      unifiedRuns.push({
        id: run.id,
        runType: "provider-sync",
        status: run.status,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        createdAt: run.createdAt,
        logs: run.logs,
        summary: run.counts,
        archived: false,
        sourceId: run.providerAccountId,
        sourceName: providerNameMap.get(run.providerAccountId) || "Unknown Provider",
        sourceType: "provider",
      });
    }

    unifiedRuns.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    let filteredRuns = unifiedRuns;
    if (typeFilter) filteredRuns = filteredRuns.filter((r) => r.runType === typeFilter);
    if (statusFilter) filteredRuns = filteredRuns.filter((r) => r.status === statusFilter);
    if (archived) {
      const showArchived = archived === "true";
      filteredRuns = filteredRuns.filter((r) => r.archived === showArchived);
    }
    if (startDate) {
      const start = new Date(startDate as string);
      filteredRuns = filteredRuns.filter((r) => new Date(r.createdAt) >= start);
    }
    if (endDate) {
      const end = new Date(endDate as string);
      filteredRuns = filteredRuns.filter((r) => new Date(r.createdAt) <= end);
    }

    res.json(filteredRuns);
  } catch (error: any) {
    res.status(500).json({ message: error.message || "Failed to fetch runs" });
  }
});

router.get("/:id", async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const jobRun = await storage.getJobRun(id, req.orgId);
    if (jobRun) {
      return res.json({
        ...jobRun,
        runType: "playbook-run",
        sourceType: "template",
        finishedAt: jobRun.completedAt,
      });
    }

    const pipelineRun = await storage.getPipelineRun(id);
    if (pipelineRun) {
      const pipeline = await storage.getPipeline(pipelineRun.pipelineId);
      return res.json({
        ...pipelineRun,
        runType: "bdp-sync",
        sourceType: "pipeline",
        sourceName: pipeline?.name || "Unknown Pipeline",
      });
    }

    const syncRun = await storage.getSyncRun(id);
    if (syncRun) {
      const provider = await storage.getProvider(syncRun.providerAccountId);
      return res.json({
        ...syncRun,
        runType: "provider-sync",
        sourceType: "provider",
        sourceName: provider?.name || "Unknown Provider",
      });
    }

    return res.status(404).json({ message: "Run not found" });
  } catch (error: any) {
    res.status(500).json({ message: error.message || "Failed to fetch run" });
  }
});

router.post("/:id/archive", async (req: AuthRequest, res) => {
  try {
    const run = await storage.getJobRun(req.params.id, req.orgId);
    if (!run) return res.status(404).json({ message: "Run not found" });
    await storage.updateJobRun(req.params.id, { archived: true }, req.orgId);
    res.json({ message: "Run archived successfully" });
  } catch (error: any) {
    res.status(500).json({ message: error.message || "Failed to archive run" });
  }
});

router.post("/:id/unarchive", async (req: AuthRequest, res) => {
  try {
    const run = await storage.getJobRun(req.params.id, req.orgId);
    if (!run) return res.status(404).json({ message: "Run not found" });
    await storage.updateJobRun(req.params.id, { archived: false }, req.orgId);
    res.json({ message: "Run unarchived successfully" });
  } catch (error: any) {
    res.status(500).json({ message: error.message || "Failed to unarchive run" });
  }
});

router.get("/:id/csv", async (req: AuthRequest, res) => {
  try {
    const run = await storage.getJobRun(req.params.id, req.orgId);
    if (!run) return res.status(404).json({ message: "Run not found" });

    const csv =
      `Run ID,Status,Started,Completed,Hosts,OK,Changed,Failed\n` +
      `${run.id},${run.status},${run.startedAt || ""},${run.completedAt || ""},` +
      `${(run.resultSummary as any)?.hosts || 0},${(run.resultSummary as any)?.ok || 0},` +
      `${(run.resultSummary as any)?.changed || 0},${(run.resultSummary as any)?.failed || 0}`;

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="run-${run.id}.csv"`);
    res.send(csv);
  } catch (error: any) {
    res.status(500).json({ message: error.message || "Failed to generate CSV" });
  }
});

export default router;

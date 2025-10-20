/**
 * Pipeline routes - CRUD, dry-run, sync, and runs
 */

import { Router, type Request, type Response } from "express";
import { storage } from "../storage";
import { insertPipelineSchema, insertPipelineRunSchema } from "@shared/schema";
import { NetBoxAdapter } from "../services/netbox-adapter";
import { IdoitAdapter } from "../services/idoit-adapter";
import { rulesEngine } from "../services/rules-engine";
import { getSamples, getObjectTypes } from "../services/sample-fixtures";
import { getPresets, getPreset } from "../services/preset-rules";

const router = Router();

interface AuthRequest extends Request {
  userId?: string;
  user?: any;
}

// Helper to get CMDB adapter instance
async function getCmdbAdapter(cmdbAccountId: string) {
  const cmdb = await storage.getCmdbAccount(cmdbAccountId);
  if (!cmdb) {
    throw new Error("CMDB account not found");
  }

  if (cmdb.kind === "netbox") {
    const config = cmdb.config as { url: string; token: string };
    return new NetBoxAdapter(config);
  } else if (cmdb.kind === "idoit") {
    const config = cmdb.config as { url: string; apiKey: string };
    return new IdoitAdapter(config);
  } else {
    throw new Error(`Unsupported CMDB kind: ${cmdb.kind}`);
  }
}

// GET /api/pipelines - List all pipelines
router.get("/", async (req: AuthRequest, res: Response) => {
  try {
    const pipelines = await storage.getPipelines();
    
    // Enrich with last run info
    const enriched = await Promise.all(
      pipelines.map(async (pipeline) => {
        const runs = await storage.getPipelineRuns(pipeline.id, 1);
        const lastRun = runs[0] || null;
        
        return {
          ...pipeline,
          lastRun: lastRun ? {
            id: lastRun.id,
            status: lastRun.status,
            started_at: lastRun.startedAt,
            finished_at: lastRun.finishedAt,
            summary: lastRun.summary,
          } : null,
        };
      })
    );

    res.json(enriched);
  } catch (error: any) {
    res.status(500).json({ error: "internal", message: error.message });
  }
});

// POST /api/pipelines - Create pipeline
router.post("/", async (req: AuthRequest, res: Response) => {
  try {
    const data = insertPipelineSchema.parse(req.body);
    
    // Validate provider and CMDB exist
    const provider = await storage.getProvider(data.providerAccountId);
    if (!provider) {
      return res.status(400).json({ error: "validation_error", message: "Provider account not found" });
    }
    
    const cmdb = await storage.getCmdbAccount(data.cmdbAccountId);
    if (!cmdb) {
      return res.status(400).json({ error: "validation_error", message: "CMDB account not found" });
    }

    const pipeline = await storage.createPipeline({
      ...data,
      createdBy: req.userId,
    });

    res.status(201).json(pipeline);
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: "validation_error", details: error.errors });
    }
    res.status(500).json({ error: "internal", message: error.message });
  }
});

// GET /api/pipelines/:id - Get pipeline details
router.get("/:id", async (req: AuthRequest, res: Response) => {
  try {
    const pipeline = await storage.getPipeline(req.params.id);
    if (!pipeline) {
      return res.status(404).json({ error: "not_found" });
    }

    // Get last run
    const runs = await storage.getPipelineRuns(pipeline.id, 1);
    const lastRun = runs[0] || null;

    res.json({
      ...pipeline,
      lastRun: lastRun ? {
        id: lastRun.id,
        status: lastRun.status,
        started_at: lastRun.startedAt,
        finished_at: lastRun.finishedAt,
        summary: lastRun.summary,
      } : null,
    });
  } catch (error: any) {
    res.status(500).json({ error: "internal", message: error.message });
  }
});

// PATCH /api/pipelines/:id - Update pipeline
router.patch("/:id", async (req: AuthRequest, res: Response) => {
  try {
    const pipeline = await storage.updatePipeline(req.params.id, req.body);
    if (!pipeline) {
      return res.status(404).json({ error: "not_found" });
    }
    res.json(pipeline);
  } catch (error: any) {
    res.status(500).json({ error: "internal", message: error.message });
  }
});

// DELETE /api/pipelines/:id - Delete pipeline
router.delete("/:id", async (req: AuthRequest, res: Response) => {
  try {
    await storage.deletePipeline(req.params.id);
    res.status(204).send();
  } catch (error: any) {
    res.status(500).json({ error: "internal", message: error.message });
  }
});

// GET /api/pipelines/:id/runs - Get pipeline runs
router.get("/:id/runs", async (req: AuthRequest, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const runs = await storage.getPipelineRuns(req.params.id, limit);
    
    const items = runs.map(run => ({
      id: run.id,
      status: run.status,
      dry_run: run.dryRun,
      started_at: run.startedAt,
      finished_at: run.finishedAt,
      summary: run.summary,
    }));

    res.json({ items });
  } catch (error: any) {
    res.status(500).json({ error: "internal", message: error.message });
  }
});

// POST /api/pipelines/:id/dry-run - Execute dry-run
router.post("/:id/dry-run", async (req: AuthRequest, res: Response) => {
  try {
    const pipeline = await storage.getPipeline(req.params.id);
    if (!pipeline) {
      return res.status(404).json({ error: "not_found" });
    }

    // Create dry-run pipeline run
    const run = await storage.createPipelineRun({
      pipelineId: pipeline.id,
      status: "running",
      dryRun: true,
    });

    // Execute dry-run (stubbed for now - would invoke worker)
    const counts = {
      created: 0,
      updated: 0,
      unchanged: 0,
      removed: 0,
      errors: 0,
    };

    const notes: string[] = [];
    const examples: any[] = [];

    // Get mappings for this pipeline
    const mappings = await storage.getPipelineMappings(pipeline.id);
    if (mappings.length === 0) {
      notes.push("No mappings configured");
    } else {
      // Simulate processing sample objects
      const provider = await storage.getProvider(pipeline.providerAccountId);
      if (provider) {
        const samples = getSamples(provider.kind, mappings[0].sourceType, 10);
        counts.unchanged = samples.length;
        notes.push(`Processed ${samples.length} sample objects`);
      }
    }

    // Update run
    await storage.updatePipelineRun(run.id, {
      status: "ok",
      startedAt: new Date(),
      finishedAt: new Date(),
      summary: counts,
    });

    res.json({
      status: "ok",
      counts,
      notes,
      examples,
      runId: run.id,
    });
  } catch (error: any) {
    res.status(500).json({ error: "internal", message: error.message });
  }
});

// POST /api/pipelines/:id/sync - Enqueue sync worker
router.post("/:id/sync", async (req: AuthRequest, res: Response) => {
  try {
    const pipeline = await storage.getPipeline(req.params.id);
    if (!pipeline) {
      return res.status(404).json({ error: "not_found" });
    }

    // Create pipeline run
    const run = await storage.createPipelineRun({
      pipelineId: pipeline.id,
      status: "queued",
      dryRun: false,
    });

    // TODO: Enqueue bdp-sync worker
    // For now, just mark as queued

    res.status(202).json({ runId: run.id });
  } catch (error: any) {
    res.status(500).json({ error: "internal", message: error.message });
  }
});

// GET /api/pipelines/presets - List preset rules
router.get("/presets", async (req: AuthRequest, res: Response) => {
  try {
    const presets = getPresets();
    res.json({ items: presets });
  } catch (error: any) {
    res.status(500).json({ error: "internal", message: error.message });
  }
});

// GET /api/pipelines/presets/:id - Get preset rules
router.get("/presets/:id", async (req: AuthRequest, res: Response) => {
  try {
    const preset = getPreset(req.params.id);
    if (!preset) {
      return res.status(404).json({ error: "not_found" });
    }
    res.json(preset.rules);
  } catch (error: any) {
    res.status(500).json({ error: "internal", message: error.message });
  }
});

export default router;

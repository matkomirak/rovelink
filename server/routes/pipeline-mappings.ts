/**
 * Pipeline Mapping routes - CRUD and test transformations
 */

import { Router, type Request, type Response } from "express";
import { storage } from "../storage";
import { insertPipelineMappingSchema } from "@shared/schema";
import { NetBoxAdapter } from "../services/netbox-adapter";
import { IdoitAdapter } from "../services/idoit-adapter";
import { decryptCmdbConfig } from "../services/secrets";
import { rulesEngine } from "../services/rules-engine";
import { getSample } from "../services/sample-fixtures";

const router = Router();

interface AuthRequest extends Request {
  userId?: string;
  orgId?: string;
  user?: any;
}

// Helper to get CMDB adapter instance — tenant-aware
async function getCmdbAdapter(cmdbAccountId: string, orgId?: string) {
  const cmdb = await storage.getCmdbAccount(cmdbAccountId, orgId ?? "");
  if (!cmdb) {
    throw new Error("CMDB account not found");
  }

  const config = decryptCmdbConfig(cmdb.config as Record<string, any>);

  if (cmdb.kind === "netbox") {
    return new NetBoxAdapter(config as { url: string; token: string });
  } else if (cmdb.kind === "idoit") {
    return new IdoitAdapter(config as { url: string; apiKey: string });
  } else {
    throw new Error(`Unsupported CMDB kind: ${cmdb.kind}`);
  }
}

// POST /api/pipelines/:pipelineId/mappings - Create mapping (verify pipeline ownership)
router.post("/:pipelineId/mappings", async (req: AuthRequest, res: Response) => {
  try {
    const pipeline = await storage.getPipeline(req.params.pipelineId, req.orgId!);
    if (!pipeline) {
      return res.status(404).json({ error: "not_found", message: "Pipeline not found" });
    }

    const data = insertPipelineMappingSchema.parse({
      ...req.body,
      pipelineId: req.params.pipelineId,
    });

    const mapping = await storage.createPipelineMapping(data);
    res.status(201).json(mapping);
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: "validation_error", details: error.errors });
    }
    res.status(500).json({ error: "internal", message: error.message });
  }
});

// GET /api/pipelines/:pipelineId/mappings - List mappings (verify pipeline ownership)
router.get("/:pipelineId/mappings", async (req: AuthRequest, res: Response) => {
  try {
    const pipeline = await storage.getPipeline(req.params.pipelineId, req.orgId!);
    if (!pipeline) {
      return res.status(404).json({ error: "not_found", message: "Pipeline not found" });
    }
    const mappings = await storage.getPipelineMappings(pipeline.id);
    res.json({ items: mappings });
  } catch (error: any) {
    res.status(500).json({ error: "internal", message: error.message });
  }
});

// GET /api/pipelines/:pipelineId/mappings/:mapId - Get specific mapping
router.get("/:pipelineId/mappings/:mapId", async (req: AuthRequest, res: Response) => {
  try {
    const pipeline = await storage.getPipeline(req.params.pipelineId, req.orgId!);
    if (!pipeline) {
      return res.status(404).json({ error: "not_found" });
    }
    const mapping = await storage.getPipelineMapping(req.params.mapId);
    if (!mapping || mapping.pipelineId !== pipeline.id) {
      return res.status(404).json({ error: "not_found" });
    }
    res.json(mapping);
  } catch (error: any) {
    res.status(500).json({ error: "internal", message: error.message });
  }
});

// PATCH /api/pipelines/:pipelineId/mappings/:mapId - Update mapping rules
router.patch("/:pipelineId/mappings/:mapId", async (req: AuthRequest, res: Response) => {
  try {
    const pipeline = await storage.getPipeline(req.params.pipelineId, req.orgId!);
    if (!pipeline) {
      return res.status(404).json({ error: "not_found" });
    }
    const mapping = await storage.getPipelineMapping(req.params.mapId);
    if (!mapping || mapping.pipelineId !== pipeline.id) {
      return res.status(404).json({ error: "not_found" });
    }

    const updated = await storage.updatePipelineMapping(req.params.mapId, req.body);
    await storage.incrementPipelineVersion(req.params.pipelineId);

    const refreshedPipeline = await storage.getPipeline(req.params.pipelineId, req.orgId!);

    res.json({
      ...updated,
      pipelineVersion: refreshedPipeline?.version,
    });
  } catch (error: any) {
    res.status(500).json({ error: "internal", message: error.message });
  }
});

// DELETE /api/pipelines/:pipelineId/mappings/:mapId - Delete mapping
router.delete("/:pipelineId/mappings/:mapId", async (req: AuthRequest, res: Response) => {
  try {
    const pipeline = await storage.getPipeline(req.params.pipelineId, req.orgId!);
    if (!pipeline) {
      return res.status(404).json({ error: "not_found" });
    }
    const mapping = await storage.getPipelineMapping(req.params.mapId);
    if (!mapping || mapping.pipelineId !== pipeline.id) {
      return res.status(404).json({ error: "not_found" });
    }

    await storage.deletePipelineMapping(req.params.mapId);
    res.status(204).send();
  } catch (error: any) {
    res.status(500).json({ error: "internal", message: error.message });
  }
});

// POST /api/pipelines/:pipelineId/mappings/:mapId/test - Test transformation
router.post("/:pipelineId/mappings/:mapId/test", async (req: AuthRequest, res: Response) => {
  try {
    const pipeline = await storage.getPipeline(req.params.pipelineId, req.orgId!);
    if (!pipeline) {
      return res.status(404).json({ error: "not_found", message: "Pipeline not found" });
    }

    const mapping = await storage.getPipelineMapping(req.params.mapId);
    if (!mapping || mapping.pipelineId !== pipeline.id) {
      return res.status(404).json({ error: "not_found" });
    }

    const { sampleId } = req.body;
    if (!sampleId) {
      return res.status(400).json({ error: "validation_error", message: "sampleId is required" });
    }

    const sample = getSample(sampleId);
    if (!sample) {
      return res.status(404).json({ error: "not_found", message: "Sample not found" });
    }

    // Use org-scoped CMDB adapter
    const adapter = await getCmdbAdapter(pipeline.cmdbAccountId, req.orgId!);

    const rules = mapping.rules as any;
    if (!rules || !rules.fields) {
      return res.status(400).json({ 
        error: "validation_error", 
        message: "Mapping has no rules configured" 
      });
    }

    const transformed = rulesEngine.transformObject(sample.normalized, rules);
    const validation = adapter.validate(mapping.targetType, transformed);

    res.json({
      ok: validation.errors.length === 0,
      targetType: mapping.targetType,
      transformed,
      validation,
    });
  } catch (error: any) {
    if (error.message.includes("not implemented")) {
      return res.status(422).json({ error: "transform_error", message: error.message });
    }
    res.status(500).json({ error: "internal", message: error.message });
  }
});

export default router;

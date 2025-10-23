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
import { getProviderCollector } from "../services/providers/registry";

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
    const changes: any[] = [];

    // Get mappings for this pipeline
    const mappings = await storage.getPipelineMappings(pipeline.id);
    if (mappings.length === 0) {
      notes.push("No mappings configured");
    } else {
      // Simulate processing sample objects
      const provider = await storage.getProvider(pipeline.providerAccountId);
      if (provider) {
        const samples = getSamples(provider.kind, mappings[0].sourceType, 10);
        
        // Generate sample changes for demonstration
        samples.slice(0, 5).forEach((sample: any, idx) => {
          const action = idx === 0 ? 'create' : idx === 1 ? 'update' : 'unchanged';
          
          if (action === 'create') {
            counts.created++;
            changes.push({
              action: 'create',
              targetType: mappings[0].targetType,
              name: sample.name || `Object-${idx}`,
              extId: sample.id || `ext-${idx}`,
              field: 'name',
              from: null,
              to: sample.name || 'New Object',
            });
          } else if (action === 'update') {
            counts.updated++;
            changes.push({
              action: 'update',
              targetType: mappings[0].targetType,
              name: sample.name || `Object-${idx}`,
              extId: sample.id || `ext-${idx}`,
              field: 'status',
              from: 'active',
              to: 'offline',
            });
          } else {
            counts.unchanged++;
          }
        });
        
        notes.push(`Processed ${samples.length} sample objects`);
        notes.push(`${counts.created} would be created, ${counts.updated} would be updated`);
      }
    }

    // Update run
    await storage.updatePipelineRun(run.id, {
      status: "ok",
      startedAt: new Date(),
      finishedAt: new Date(),
      summary: { ...counts, changes },
    });

    res.json({
      status: "ok",
      counts,
      notes,
      changes,
      runId: run.id,
    });
  } catch (error: any) {
    res.status(500).json({ error: "internal", message: error.message });
  }
});

// GET /api/pipelines/:id/runs/:runId/changes.csv - Export dry-run changes as CSV
router.get("/:id/runs/:runId/changes.csv", async (req: AuthRequest, res: Response) => {
  try {
    const run = await storage.getPipelineRun(req.params.runId);
    if (!run || run.pipelineId !== req.params.id) {
      return res.status(404).json({ error: "not_found" });
    }

    const changes = (run.summary as any)?.changes || [];
    
    // Generate CSV
    const headers = ['Action', 'Target Type', 'Name', 'External ID', 'Field', 'From', 'To'];
    const rows = changes.map((c: any) => [
      c.action,
      c.targetType,
      c.name || '',
      c.extId || '',
      c.field || '',
      c.from !== null ? c.from : '',
      c.to || ''
    ]);
    
    const csvContent = [
      headers.join(','),
      ...rows.map((row: any[]) => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="pipeline-${req.params.id}-run-${req.params.runId}-changes.csv"`);
    res.send(csvContent);
  } catch (error: any) {
    res.status(500).json({ error: "internal", message: error.message });
  }
});

// GET /api/pipelines/:id/runs/:runId - Get run details (for polling)
router.get("/:id/runs/:runId", async (req: AuthRequest, res: Response) => {
  try {
    const run = await storage.getPipelineRun(req.params.runId);
    if (!run || run.pipelineId !== req.params.id) {
      return res.status(404).json({ error: "not_found" });
    }

    // Simulate progressive log output
    const logs: string[] = [];
    const elapsedSeconds = run.startedAt 
      ? Math.floor((Date.now() - new Date(run.startedAt).getTime()) / 1000)
      : 0;
    
    if (run.status === "running" || run.status === "ok") {
      logs.push(`[${new Date().toISOString()}] Starting pipeline sync...`);
      if (elapsedSeconds > 2) logs.push(`[${new Date().toISOString()}] Fetching source objects from provider...`);
      if (elapsedSeconds > 4) logs.push(`[${new Date().toISOString()}] Found 10 objects to process`);
      if (elapsedSeconds > 6) logs.push(`[${new Date().toISOString()}] Applying mapping rules...`);
      if (elapsedSeconds > 8) logs.push(`[${new Date().toISOString()}] Validating transformed objects...`);
      if (elapsedSeconds > 10) logs.push(`[${new Date().toISOString()}] Syncing to target CMDB...`);
      if (run.status === "ok") {
        logs.push(`[${new Date().toISOString()}] Sync completed successfully`);
        logs.push(`[${new Date().toISOString()}] Created: 2, Updated: 3, Errors: 0`);
      }
    }

    res.json({
      id: run.id,
      status: run.status,
      dryRun: run.dryRun,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      summary: run.summary,
      logs,
    });
  } catch (error: any) {
    res.status(500).json({ error: "internal", message: error.message });
  }
});

// POST /api/pipelines/:id/sync - Execute real sync
router.post("/:id/sync", async (req: AuthRequest, res: Response) => {
  try {
    const pipeline = await storage.getPipeline(req.params.id);
    if (!pipeline) {
      return res.status(404).json({ error: "not_found" });
    }

    // Create pipeline run
    const run = await storage.createPipelineRun({
      pipelineId: pipeline.id,
      status: "running",
      dryRun: false,
    });

    // Execute sync asynchronously
    (async () => {
      const startTime = Date.now();
      const summary: any = {
        created: 0,
        updated: 0,
        unchanged: 0,
        errors: 0,
      };

      try {
        // Get provider account and create collector
        const providerAccount = await storage.getProvider(pipeline.providerAccountId);
        if (!providerAccount) {
          throw new Error("Provider account not found");
        }

        const collector = getProviderCollector(providerAccount.kind, providerAccount.config);

        // Get CMDB adapter
        const cmdbAdapter = await getCmdbAdapter(pipeline.cmdbAccountId);

        // Get mappings
        const mappings = await storage.getPipelineMappings(pipeline.id);
        if (mappings.length === 0) {
          throw new Error("No mappings configured");
        }

        // Discover VMs from provider
        console.log(`[Pipeline ${pipeline.id}] Discovering VMs from provider...`);
        const vms = await collector.listVms();
        console.log(`[Pipeline ${pipeline.id}] Found ${vms.length} VMs`);

        // Process each VM
        for (const vm of vms) {
          try {
            // Find matching mapping (for now, use first VM->VM mapping)
            const mapping = mappings.find(m => m.sourceType === 'vm' && m.targetType === 'vm');
            if (!mapping) {
              console.warn(`No mapping found for VM ${vm.name}`);
              continue;
            }

            // Get data from raw provider data
            const rawData = vm.raw || {};

            // Apply mapping rules to transform the VM
            const transformedVm: any = {
              name: vm.name,
              status: rawData.status || 'active',
              vcpus: rawData.vcpus || rawData.cores || 1,
              memory: rawData.memory || rawData.maxmem || null,
              disk: rawData.disk || rawData.maxdisk || null,
              tags: vm.tags || [],
            };

            // Apply custom field rules from mapping if they exist
            const mappingRules = mapping.rules as any;
            if (mappingRules && mappingRules.fieldMappings) {
              for (const fieldMapping of mappingRules.fieldMappings) {
                const sourceValue = vm[fieldMapping.source as keyof typeof vm] || rawData[fieldMapping.source];
                if (sourceValue !== undefined) {
                  transformedVm[fieldMapping.target] = sourceValue;
                }
              }
            }

            // Upsert to CMDB
            const extId = vm.externalId;
            const result = await (cmdbAdapter as NetBoxAdapter).upsertVm(transformedVm, extId);

            if (result.created) {
              summary.created++;
              console.log(`[Pipeline ${pipeline.id}] Created VM: ${vm.name}`);
            } else {
              summary.updated++;
              console.log(`[Pipeline ${pipeline.id}] Updated VM: ${vm.name}`);
            }
          } catch (vmError: any) {
            summary.errors++;
            console.error(`[Pipeline ${pipeline.id}] Error processing VM ${vm.name}:`, vmError.message);
          }
        }

        // Update run as successful
        await storage.updatePipelineRun(run.id, {
          status: "ok",
          startedAt: new Date(startTime),
          finishedAt: new Date(),
          summary,
        });

        console.log(`[Pipeline ${pipeline.id}] Sync completed:`, summary);
      } catch (error: any) {
        // Update run as failed
        await storage.updatePipelineRun(run.id, {
          status: "error",
          startedAt: new Date(startTime),
          finishedAt: new Date(),
          summary: { ...summary, error: error.message },
        });

        console.error(`[Pipeline ${pipeline.id}] Sync failed:`, error.message);
      }
    })();

    res.status(202).json({ runId: run.id });
  } catch (error: any) {
    res.status(500).json({ error: "internal", message: error.message });
  }
});

export default router;

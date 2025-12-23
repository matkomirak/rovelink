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

    // Return actual logs from the database
    const logs = run.logs ? run.logs.split('\n').filter(Boolean) : [];

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
      let logs = "";
      const summary: any = {
        created: 0,
        updated: 0,
        unchanged: 0,
        errors: 0,
      };

      // Helper to add log and update database
      const addLog = async (message: string, updateDb = true) => {
        const timestamp = new Date().toISOString();
        const logLine = `[${timestamp}] ${message}`;
        logs += logLine + "\n";
        console.log(`[Pipeline ${pipeline.id}] ${message}`);
        if (updateDb) {
          try {
            await storage.updatePipelineRun(run.id, { logs });
          } catch (e) {
            // Ignore log update errors
          }
        }
      };

      try {
        await addLog("Starting pipeline sync...");

        // Get provider account and create collector
        const providerAccount = await storage.getProvider(pipeline.providerAccountId);
        if (!providerAccount) {
          throw new Error("Provider account not found");
        }

        await addLog(`Connecting to provider: ${providerAccount.name} (${providerAccount.kind})`);
        const collector = getProviderCollector(providerAccount.kind, providerAccount.config);

        // Get CMDB adapter
        await addLog("Connecting to CMDB...");
        const cmdbAdapter = await getCmdbAdapter(pipeline.cmdbAccountId);

        // Ensure NetBox has required custom fields (ext_id, etc.)
        if (cmdbAdapter instanceof NetBoxAdapter) {
          await addLog("Checking NetBox custom fields...");
          const cfResult = await cmdbAdapter.ensureCustomFields();
          if (!cfResult.success) {
            await addLog(`WARNING: ${cfResult.message}`);
            await addLog("Sync will attempt to continue, but may fail if ext_id field is missing.");
          } else {
            await addLog(cfResult.message);
          }

          // Ensure default cluster exists
          await addLog("Ensuring default cluster exists for VM creation...");
          try {
            const clusterId = await cmdbAdapter.ensureDefaultCluster();
            await addLog(`Using cluster ID: ${clusterId} (Bridge-Default)`);
          } catch (clusterError: any) {
            await addLog(`WARNING: Could not create default cluster - ${clusterError.message}`);
          }
        }

        // Get mappings
        const mappings = await storage.getPipelineMappings(pipeline.id);
        if (mappings.length === 0) {
          throw new Error("No mappings configured");
        }

        // Discover VMs from provider
        await addLog("Discovering VMs from provider...");
        const vms = await collector.listVms();
        await addLog(`Found ${vms.length} VMs to process`);

        await addLog(`Loaded ${mappings.length} mapping rule(s): ${mappings.map(m => `${m.sourceType} -> ${m.targetType}`).join(', ')}`);
        await addLog("Starting sync to target CMDB...");

        // Process each VM
        let processedCount = 0;
        for (const vm of vms) {
          processedCount++;
          try {
            // Find matching mapping - check for VM-like source types case-insensitively
            const mapping = mappings.find(m => {
              const srcType = (m.sourceType || '').toLowerCase();
              const tgtType = (m.targetType || '').toLowerCase();
              
              const isVmSource = srcType === 'vm' || 
                                 srcType === 'virtualmachine' || 
                                 srcType.includes('vm') ||
                                 srcType.includes('virtualmachine');
              
              const isVmTarget = tgtType === 'vm' || 
                                 tgtType === 'virtualmachine' ||
                                 tgtType.includes('vm') ||
                                 tgtType.includes('virtualmachine');
              
              return isVmSource && isVmTarget;
            });
            
            if (!mapping) {
              await addLog(`SKIP: No mapping found for VM ${vm.name}`, false);
              continue;
            }

                // Apply mapping rules to transform the VM using normalized fields
            const transformedVm: any = {
              name: vm.name,
              status: vm.status || 'active',
              vcpus: vm.vcpus || 1,
              memory: vm.memory || null,
              disk: vm.disk || null,
              tags: vm.tags || [],
              comments: vm.description || null,
              platform: vm.platform ? { name: vm.platform } : null,
            };

            // Apply custom field rules from mapping if they exist
            const mappingRules = mapping.rules as any;
            if (mappingRules && mappingRules.fieldMappings) {
              const rawData = vm.raw || {};
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

            // Sync primary IP address if available
            const primaryIp = vm.primaryIp4;
            if (primaryIp && result.id && cmdbAdapter instanceof NetBoxAdapter) {
              try {
                await (cmdbAdapter as NetBoxAdapter).syncVmPrimaryIp(result.id, primaryIp);
              } catch (ipError: any) {
                // Log IP sync error but don't fail the VM sync
                await addLog(`[${processedCount}/${vms.length}] WARNING: Could not sync IP ${primaryIp} for ${vm.name}: ${ipError.message}`, false);
              }
            }

            if (result.created) {
              summary.created++;
              await addLog(`[${processedCount}/${vms.length}] CREATED: ${vm.name}${primaryIp ? ` (IP: ${primaryIp})` : ''}`);
            } else if (result.unchanged) {
              summary.unchanged++;
              // Log unchanged every 20 to reduce noise
              if (summary.unchanged % 20 === 0) {
                await addLog(`[${processedCount}/${vms.length}] ${summary.unchanged} VM(s) unchanged...`);
              }
            } else {
              summary.updated++;
              // Log updates every 10 VMs to reduce log noise
              if (summary.updated % 10 === 0 || summary.updated === 1) {
                await addLog(`[${processedCount}/${vms.length}] Updated ${summary.updated} VM(s) so far...`);
              }
            }
          } catch (vmError: any) {
            summary.errors++;
            await addLog(`[${processedCount}/${vms.length}] ERROR: ${vm.name} - ${vmError.message}`);
          }
        }

        // Final summary
        await addLog(`Sync completed: Created ${summary.created}, Updated ${summary.updated}, Unchanged ${summary.unchanged}, Errors ${summary.errors}`);

        // Update run as successful
        await storage.updatePipelineRun(run.id, {
          status: summary.errors > 0 ? "ok" : "ok",
          startedAt: new Date(startTime),
          finishedAt: new Date(),
          summary,
          logs,
        });
      } catch (error: any) {
        await addLog(`FATAL ERROR: ${error.message}`);
        
        // Update run as failed
        await storage.updatePipelineRun(run.id, {
          status: "error",
          startedAt: new Date(startTime),
          finishedAt: new Date(),
          summary: { ...summary, error: error.message },
          logs,
        });
      }
    })();

    res.status(202).json({ runId: run.id });
  } catch (error: any) {
    res.status(500).json({ error: "internal", message: error.message });
  }
});

export default router;

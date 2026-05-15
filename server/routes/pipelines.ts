/**
 * Pipeline routes - CRUD, dry-run, sync, and runs
 */

import { Router, type Request, type Response } from "express";
import { storage } from "../storage";
import { insertPipelineSchema, insertPipelineRunSchema } from "@shared/schema";
import { NetBoxAdapter } from "../services/netbox-adapter";
import { IdoitAdapter } from "../services/idoit-adapter";
import { ServiceNowAdapter } from "../services/servicenow-adapter";
import { decryptCmdbConfig, decryptProviderConfig } from "../services/secrets";
import { rulesEngine } from "../services/rules-engine";
import { getSamples, getObjectTypes } from "../services/sample-fixtures";
import { getPresets, getPreset } from "../services/preset-rules";
import { getProviderCollector } from "../services/providers/registry";

/**
 * Transform provider tags by adding provider prefix.
 * 
 * NON-NEGOTIABLE RULE: Provider tags MUST NOT be written to NetBox verbatim.
 * All provider-originated tags must be prefixed with the provider name.
 */
function namespaceTags(tags: string[], providerKind: string): string[] {
  const prefix = providerKind.toLowerCase();
  return tags.map(tag => {
    if (tag.startsWith(`${prefix}_`)) {
      return tag;
    }
    return `${prefix}_${tag}`;
  });
}

const router = Router();

interface AuthRequest extends Request {
  userId?: string;
  orgId?: string;
  user?: any;
}

// Helper to get CMDB adapter instance with decrypted secrets — tenant-aware
async function getCmdbAdapter(cmdbAccountId: string, orgId?: string) {
  const cmdb = await storage.getCmdbAccount(cmdbAccountId, orgId);
  if (!cmdb) {
    throw new Error("CMDB account not found");
  }

  const config = decryptCmdbConfig(cmdb.config as Record<string, any>);

  if (cmdb.kind === "netbox") {
    return new NetBoxAdapter(config as { url: string; token: string });
  } else if (cmdb.kind === "idoit") {
    return new IdoitAdapter(config as { url: string; apiKey: string });
  } else if (cmdb.kind === "servicenow") {
    return new ServiceNowAdapter(config as { url: string; username: string; password: string });
  } else {
    throw new Error(`Unsupported CMDB kind: ${cmdb.kind}`);
  }
}

// GET /api/pipelines - List all pipelines (org-scoped)
router.get("/", async (req: AuthRequest, res: Response) => {
  try {
    const pipelines = await storage.getPipelines(req.orgId);
    
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

// POST /api/pipelines - Create pipeline (org-scoped)
router.post("/", async (req: AuthRequest, res: Response) => {
  try {
    const { orgId: _o, ...safeBody } = req.body;
    const data = insertPipelineSchema.parse(safeBody);
    
    // Validate provider and CMDB belong to the same org
    const provider = await storage.getProvider(data.providerAccountId, req.orgId);
    if (!provider) {
      return res.status(400).json({ error: "validation_error", message: "Provider account not found" });
    }
    
    const cmdb = await storage.getCmdbAccount(data.cmdbAccountId, req.orgId);
    if (!cmdb) {
      return res.status(400).json({ error: "validation_error", message: "CMDB account not found" });
    }

    const pipeline = await storage.createPipeline({
      ...data,
      orgId: req.orgId,
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
router.get("/presets", async (_req: AuthRequest, res: Response) => {
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

// GET /api/pipelines/:id - Get pipeline details (org-scoped)
router.get("/:id", async (req: AuthRequest, res: Response) => {
  try {
    const pipeline = await storage.getPipeline(req.params.id, req.orgId);
    if (!pipeline) {
      return res.status(404).json({ error: "not_found" });
    }

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

// PATCH /api/pipelines/:id - Update pipeline (org-scoped)
router.patch("/:id", async (req: AuthRequest, res: Response) => {
  try {
    const pipeline = await storage.updatePipeline(req.params.id, req.body, req.orgId);
    if (!pipeline) {
      return res.status(404).json({ error: "not_found" });
    }
    res.json(pipeline);
  } catch (error: any) {
    res.status(500).json({ error: "internal", message: error.message });
  }
});

// DELETE /api/pipelines/:id - Delete pipeline (org-scoped)
router.delete("/:id", async (req: AuthRequest, res: Response) => {
  try {
    await storage.deletePipeline(req.params.id, req.orgId);
    res.status(204).send();
  } catch (error: any) {
    res.status(500).json({ error: "internal", message: error.message });
  }
});

// GET /api/pipelines/:id/runs - Get pipeline runs (verify pipeline ownership first)
router.get("/:id/runs", async (req: AuthRequest, res: Response) => {
  try {
    const pipeline = await storage.getPipeline(req.params.id, req.orgId);
    if (!pipeline) {
      return res.status(404).json({ error: "not_found" });
    }
    const limit = parseInt(req.query.limit as string) || 50;
    const runs = await storage.getPipelineRuns(pipeline.id, limit);
    
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

// POST /api/pipelines/:id/dry-run - Execute dry-run (org-scoped)
router.post("/:id/dry-run", async (req: AuthRequest, res: Response) => {
  try {
    const pipeline = await storage.getPipeline(req.params.id, req.orgId);
    if (!pipeline) {
      return res.status(404).json({ error: "not_found" });
    }

    const run = await storage.createPipelineRun({
      pipelineId: pipeline.id,
      status: "running",
      dryRun: true,
    });

    const counts = { created: 0, updated: 0, unchanged: 0, removed: 0, errors: 0 };
    const notes: string[] = [];
    const changes: any[] = [];

    const mappings = await storage.getPipelineMappings(pipeline.id);
    if (mappings.length === 0) {
      notes.push("No mappings configured");
    } else {
      const provider = await storage.getProvider(pipeline.providerAccountId, req.orgId);
      if (provider) {
        const samples = getSamples(provider.kind, mappings[0].sourceType, 10);
        
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

    await storage.updatePipelineRun(run.id, {
      status: "ok",
      startedAt: new Date(),
      finishedAt: new Date(),
      summary: { ...counts, changes },
    });

    res.json({ status: "ok", counts, notes, changes, runId: run.id });
  } catch (error: any) {
    res.status(500).json({ error: "internal", message: error.message });
  }
});

// GET /api/pipelines/:id/runs/:runId/changes.csv - Export dry-run changes (org-scoped)
router.get("/:id/runs/:runId/changes.csv", async (req: AuthRequest, res: Response) => {
  try {
    const pipeline = await storage.getPipeline(req.params.id, req.orgId);
    if (!pipeline) {
      return res.status(404).json({ error: "not_found" });
    }

    const run = await storage.getPipelineRun(req.params.runId);
    if (!run || run.pipelineId !== pipeline.id) {
      return res.status(404).json({ error: "not_found" });
    }

    const changes = (run.summary as any)?.changes || [];
    
    const headers = ['Action', 'Target Type', 'Name', 'External ID', 'Field', 'From', 'To'];
    const rows = changes.map((c: any) => [
      c.action, c.targetType, c.name || '', c.extId || '', c.field || '',
      c.from !== null ? c.from : '', c.to || ''
    ]);
    
    const csvContent = [
      headers.join(','),
      ...rows.map((row: any[]) => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="pipeline-${pipeline.id}-run-${run.id}-changes.csv"`);
    res.send(csvContent);
  } catch (error: any) {
    res.status(500).json({ error: "internal", message: error.message });
  }
});

// GET /api/pipelines/:id/runs/:runId - Get run details (org-scoped via parent pipeline)
router.get("/:id/runs/:runId", async (req: AuthRequest, res: Response) => {
  try {
    const pipeline = await storage.getPipeline(req.params.id, req.orgId);
    if (!pipeline) {
      return res.status(404).json({ error: "not_found" });
    }

    const run = await storage.getPipelineRun(req.params.runId);
    if (!run || run.pipelineId !== pipeline.id) {
      return res.status(404).json({ error: "not_found" });
    }

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

// POST /api/pipelines/:id/sync - Execute real sync (org-scoped)
router.post("/:id/sync", async (req: AuthRequest, res: Response) => {
  try {
    const pipeline = await storage.getPipeline(req.params.id, req.orgId);
    if (!pipeline) {
      return res.status(404).json({ error: "not_found" });
    }

    const run = await storage.createPipelineRun({
      pipelineId: pipeline.id,
      status: "running",
      dryRun: false,
    });

    // Execute sync asynchronously — capture orgId from pipeline for use in closures
    const pipelineOrgId = pipeline.orgId;

    (async () => {
      const startTime = Date.now();
      let logs = "";
      const summary: any = { created: 0, updated: 0, unchanged: 0, errors: 0 };

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

        // Use pipeline's own orgId for all sub-lookups (not req.orgId which may not be available in async closure)
        const providerAccount = await storage.getProvider(pipeline.providerAccountId, pipelineOrgId ?? undefined);
        if (!providerAccount) {
          throw new Error("Provider account not found");
        }

        await addLog(`Connecting to provider: ${providerAccount.name} (${providerAccount.kind})`);
        const decryptedProviderConfig = decryptProviderConfig(providerAccount.config as Record<string, any>);
        const collector = getProviderCollector(providerAccount.kind, decryptedProviderConfig);

        await addLog("Connecting to CMDB...");
        const cmdbAdapter = await getCmdbAdapter(pipeline.cmdbAccountId, pipelineOrgId ?? undefined);

        if (cmdbAdapter instanceof NetBoxAdapter) {
          await addLog("Checking NetBox custom fields...");
          const cfResult = await cmdbAdapter.ensureCustomFields();
          if (!cfResult.success) {
            await addLog(`WARNING: ${cfResult.message}`);
            await addLog("Sync will attempt to continue, but may fail if ext_id field is missing.");
          } else {
            await addLog(cfResult.message);
          }

          await addLog("Ensuring default cluster exists for VM creation...");
          try {
            const clusterId = await cmdbAdapter.ensureDefaultCluster();
            await addLog(`Using cluster ID: ${clusterId} (Bridge-Default)`);
          } catch (clusterError: any) {
            await addLog(`WARNING: Could not create default cluster - ${clusterError.message}`);
          }
        }

        const mappings = await storage.getPipelineMappings(pipeline.id);
        if (mappings.length === 0) {
          throw new Error("No mappings configured");
        }

        await addLog("Discovering VMs from provider...");
        const vms = await collector.listVms();
        await addLog(`Found ${vms.length} VMs to process`);

        const seenExtIds = new Set<string>();

        await addLog(`Loaded ${mappings.length} mapping rule(s): ${mappings.map(m => `${m.sourceType} -> ${m.targetType}`).join(', ')}`);
        await addLog("Starting sync to target CMDB...");

        let processedCount = 0;
        for (const vm of vms) {
          processedCount++;
          try {
            const mapping = mappings.find(m => {
              const srcType = (m.sourceType || '').toLowerCase();
              const tgtType = (m.targetType || '').toLowerCase();
              
              const isVmSource = srcType === 'vm' || srcType === 'virtualmachine' || srcType.includes('vm') || srcType.includes('virtualmachine');
              const isVmTarget = tgtType === 'vm' || tgtType === 'virtualmachine' || tgtType.includes('vm') || tgtType.includes('virtualmachine');
              
              return isVmSource && isVmTarget;
            });
            
            if (!mapping) {
              await addLog(`SKIP: No mapping found for VM ${vm.name}`, false);
              continue;
            }

            const namespacedTags = namespaceTags(vm.tags || [], providerAccount.kind);

            const netboxStatus = vm.status === 'running' ? 'active' : 'offline';

            const transformedVm: any = {
              name: vm.name,
              status: netboxStatus,
              vcpus: vm.vcpus || 1,
              memory: vm.memory || null,
              disk: vm.disk || null,
              tags: namespacedTags,
              comments: vm.description || null,
              platform: vm.platform ? { name: vm.platform } : null,
            };

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

            const extId = `${providerAccount.kind}:${vm.externalId}`;
            seenExtIds.add(extId);
            
            const providerId = providerAccount.id;
            const clusterName = 'Bridge-Default';
            
            const result = await (cmdbAdapter as NetBoxAdapter).upsertVm(transformedVm, extId, providerId, clusterName);
            
            if (result.skipped) {
              await addLog(`[${processedCount}/${vms.length}] SKIPPED: ${vm.name} - ${result.skipReason}`);
              continue;
            }

            const primaryIp = vm.primaryIp4;
            if (primaryIp && result.id && cmdbAdapter instanceof NetBoxAdapter) {
              try {
                await (cmdbAdapter as NetBoxAdapter).syncVmPrimaryIp(result.id, primaryIp);
              } catch (ipError: any) {
                await addLog(`[${processedCount}/${vms.length}] WARNING: Could not sync IP ${primaryIp} for ${vm.name}: ${ipError.message}`, false);
              }
            }

            if (result.created) {
              summary.created++;
              await addLog(`[${processedCount}/${vms.length}] CREATED: ${vm.name}${primaryIp ? ` (IP: ${primaryIp})` : ''}`);
            } else if (result.unchanged) {
              summary.unchanged++;
              if (summary.unchanged % 20 === 0) {
                await addLog(`[${processedCount}/${vms.length}] ${summary.unchanged} VM(s) unchanged...`);
              }
            } else {
              summary.updated++;
              if (summary.updated % 10 === 0 || summary.updated === 1) {
                await addLog(`[${processedCount}/${vms.length}] Updated ${summary.updated} VM(s) so far...`);
              }
            }
          } catch (vmError: any) {
            summary.errors++;
            await addLog(`[${processedCount}/${vms.length}] ERROR: ${vm.name} - ${vmError.message}`);
          }
        }

        // MISSING CI DETECTION
        if (cmdbAdapter instanceof NetBoxAdapter) {
          await addLog("Checking for missing CIs (VMs no longer in provider)...");
          
          try {
            const syncedVms = await cmdbAdapter.getSyncedVms();
            const currentProviderId = providerAccount.id;
            const currentClusterName = 'Bridge-Default';
            
            let missingCount = 0;
            let skippedOwnershipCount = 0;
            let skippedClusterCount = 0;
            
            for (const netboxVm of syncedVms) {
              if (!seenExtIds.has(netboxVm.extId)) {
                if (netboxVm.gateProviderId && netboxVm.gateProviderId !== currentProviderId) {
                  skippedOwnershipCount++;
                  continue;
                }
                
                if (netboxVm.clusterName && netboxVm.clusterName !== currentClusterName) {
                  skippedClusterCount++;
                  continue;
                }
                
                if (netboxVm.providerState === 'missing' && netboxVm.status === 'offline') {
                  continue;
                }
                
                await (cmdbAdapter as NetBoxAdapter).markVmAsMissing(netboxVm.id, netboxVm.name ?? String(netboxVm.id));
                missingCount++;
              }
            }
            
            if (missingCount > 0) {
              await addLog(`Marked ${missingCount} VM(s) as missing (offline)`);
            }
            if (skippedOwnershipCount > 0) {
              await addLog(`Skipped ${skippedOwnershipCount} VM(s) owned by different provider`);
            }
          } catch (missingError: any) {
            await addLog(`WARNING: Missing CI detection failed: ${missingError.message}`);
          }
        }

        const elapsed = Math.round((Date.now() - startTime) / 1000);
        await addLog(`Sync complete in ${elapsed}s: ${summary.created} created, ${summary.updated} updated, ${summary.unchanged} unchanged, ${summary.errors} errors`);

        await storage.updatePipelineRun(run.id, {
          status: summary.errors > 0 && summary.created + summary.updated + summary.unchanged === 0 ? "error" : "ok",
          startedAt: new Date(startTime),
          finishedAt: new Date(),
          summary,
          logs,
        });
      } catch (error: any) {
        await addLog(`FATAL: ${error.message}`);
        await storage.updatePipelineRun(run.id, {
          status: "error",
          startedAt: new Date(startTime),
          finishedAt: new Date(),
          summary,
          logs,
        });
      }
    })();

    res.json({ runId: run.id, status: "running" });
  } catch (error: any) {
    res.status(500).json({ error: "internal", message: error.message });
  }
});

export default router;

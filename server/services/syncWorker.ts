import { db } from "../db";
import { providerAccounts, syncRuns, externalObjects } from "../../shared/schema";
import { eq } from "drizzle-orm";
import { getProviderCollector } from "./providers/registry";
import { AzureCollector } from "./providers/azure";
import { decryptProviderConfig } from "./secrets";

/**
 * ARCHITECTURE NOTE
 * -----------------
 * Provider sync  = collect and cache source inventory inside Rovelink (external_objects).
 *                  It does NOT write to any CMDB or NetBox.
 *
 * Pipeline sync  = move approved/transformed source data from Rovelink into the target CMDB.
 *                  It is the ONLY supported path for CMDB writes (server/routes/pipelines.ts).
 */

interface SyncCounts {
  created: number;
  updated: number;
  unchanged: number;
  removed: number;
  errors: number;
  noIp: number;
}

export class SyncWorker {
  private logs: string[] = [];

  private log(message: string) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}`;
    this.logs.push(logEntry);
    console.log(logEntry);
  }

  async executeSyncRun(syncRunId: string): Promise<void> {
    try {
      // Get sync run details
      const syncRun = await db.query.syncRuns.findFirst({
        where: eq(syncRuns.id, syncRunId),
        with: {
          providerAccount: true,
        },
      });

      if (!syncRun) {
        throw new Error(`Sync run ${syncRunId} not found`);
      }

      // Update status to running
      await db
        .update(syncRuns)
        .set({
          status: "running",
          startedAt: new Date(),
        })
        .where(eq(syncRuns.id, syncRunId));

      const counts: SyncCounts = {
        created: 0,
        updated: 0,
        unchanged: 0,
        removed: 0,
        errors: 0,
        noIp: 0,
      };

      try {
        // ─────────────────────────────────────────────────────────────────────
        // PHASE 1: Validate provider connection
        // ─────────────────────────────────────────────────────────────────────
        this.log(`=== Phase 1: Provider Validation ===`);
        this.log(`Connecting to provider: ${syncRun.providerAccount.name} (${syncRun.providerAccount.kind})`);

        const decryptedProviderConfig = decryptProviderConfig(
          syncRun.providerAccount.config as Record<string, any>
        );
        const collector = getProviderCollector(
          syncRun.providerAccount.kind,
          decryptedProviderConfig
        );

        const testResult = await collector.testConnection();
        if (!testResult.ok) {
          throw new Error(`Provider connection failed: ${testResult.error || "Unknown error"}`);
        }

        this.log(`Provider connection OK${testResult.details ? `: ${testResult.details}` : testResult.version ? ` (version: ${testResult.version})` : ""}`);

        // ─────────────────────────────────────────────────────────────────────
        // PHASE 2: Collect inventory from provider
        // ─────────────────────────────────────────────────────────────────────
        this.log(`=== Phase 2: Collecting from Provider ===`);
        const vms = await collector.listVms();
        this.log(`Collected ${vms.length} VMs from provider`);

        // ─────────────────────────────────────────────────────────────────────
        // PHASE 3: Rovelink Cache Update
        // Provider data is stored only in Rovelink (external_objects).
        // No data is written to NetBox or any CMDB here.
        // Use pipeline sync (/api/pipelines/:id/sync) to push data into a CMDB.
        // ─────────────────────────────────────────────────────────────────────
        this.log(`=== Phase 3: Rovelink Cache Update ===`);
        const isAzure = syncRun.providerAccount.kind === "azure";

        if (isAzure && collector instanceof AzureCollector) {
          // ─── Azure: run full discovery and cache results in Rovelink ──────────
          this.log(`Azure provider detected — running full subscription discovery...`);
          this.log(`Collecting VMs, VNets, Subnets, NICs, and Public IPs...`);

          const discovery = await collector.discoverAll();
          this.log(`Discovery complete: ${discovery.vms.length} VMs, ${discovery.vnets.length} VNets, ${discovery.nics.length} NICs, ${discovery.publicIps.length} Public IPs`);

          this.log(`Caching ${discovery.vms.length} Azure VMs in Rovelink...`);

          const seenExternalIds = new Set<string>();

          for (const vm of discovery.vms) {
            try {
              seenExternalIds.add(vm.id);

              const existing = await db.query.externalObjects.findFirst({
                where: eq(externalObjects.externalId, vm.id),
              });

              const payload = {
                name: vm.name,
                location: vm.location,
                resourceGroup: vm.resourceGroup,
                vmSize: (vm as any).vmSize,
              };

              await db
                .insert(externalObjects)
                .values({
                  providerAccountId: syncRun.providerAccountId,
                  providerKind: "azure",
                  externalId: vm.id,
                  cachedPayload: payload,
                })
                .onConflictDoUpdate({
                  target: [externalObjects.providerAccountId, externalObjects.externalId],
                  set: {
                    cachedPayload: payload,
                    lastSyncedAt: new Date(),
                  },
                });

              if (existing) {
                counts.updated++;
              } else {
                counts.created++;
                this.log(`Cached: ${vm.name}`);
              }
            } catch (error: any) {
              counts.errors++;
              this.log(`Error caching Azure VM ${vm.name}: ${error.message}`);
            }
          }

          // Detect removed Azure VMs (in Rovelink cache but no longer in provider)
          const existingObjects = await db.query.externalObjects.findMany({
            where: eq(externalObjects.providerAccountId, syncRun.providerAccountId),
          });
          for (const obj of existingObjects) {
            if (!seenExternalIds.has(obj.externalId)) {
              counts.removed++;
              this.log(`VM removed from provider (no longer seen): ${obj.externalId}`);
            }
          }

          this.log(`Azure cache summary: cached=${discovery.vms.length} VNets=${discovery.vnets.length} NICs=${discovery.nics.length} PublicIPs=${discovery.publicIps.length}`);
        } else {
          // ─── Standard providers (Proxmox / Fake / vSphere) ───────────────────
          this.log(`Caching ${vms.length} provider objects in Rovelink...`);

          const seenExternalIds = new Set<string>();

          for (const vm of vms) {
            try {
              seenExternalIds.add(vm.externalId);

              if (!vm.primaryIp4) counts.noIp++;

              const existing = await db.query.externalObjects.findFirst({
                where: eq(externalObjects.externalId, vm.externalId),
              });

              await db
                .insert(externalObjects)
                .values({
                  providerAccountId: syncRun.providerAccountId,
                  providerKind: syncRun.providerAccount.kind,
                  externalId: vm.externalId,
                  cachedPayload: vm.raw || {
                    name: vm.name,
                    status: vm.status,
                    vcpus: vm.vcpus,
                    memory: vm.memory,
                    disk: vm.disk,
                    primaryIp4: vm.primaryIp4,
                    tags: vm.tags,
                  },
                })
                .onConflictDoUpdate({
                  target: [externalObjects.providerAccountId, externalObjects.externalId],
                  set: {
                    cachedPayload: vm.raw || {
                      name: vm.name,
                      status: vm.status,
                      vcpus: vm.vcpus,
                      memory: vm.memory,
                      disk: vm.disk,
                      primaryIp4: vm.primaryIp4,
                      tags: vm.tags,
                    },
                    lastSyncedAt: new Date(),
                  },
                });

              if (existing) {
                counts.updated++;
              } else {
                counts.created++;
                this.log(`Cached: ${vm.name} (${vm.externalId})`);
              }
            } catch (error: any) {
              counts.errors++;
              this.log(`Error caching VM ${vm.name}: ${error.message}`);
            }
          }

          // Detect removed VMs (in Rovelink cache but no longer in provider)
          const existingObjects = await db.query.externalObjects.findMany({
            where: eq(externalObjects.providerAccountId, syncRun.providerAccountId),
          });
          for (const obj of existingObjects) {
            if (!seenExternalIds.has(obj.externalId)) {
              counts.removed++;
              this.log(`VM removed from provider (no longer seen): ${obj.externalId}`);
            }
          }
        }

        this.log(`Provider sync completed without CMDB write`);
        this.log(`=== Sync Complete ===`);
        this.log(`Cached: ${counts.created + counts.updated}, Removed: ${counts.removed}, Errors: ${counts.errors}`);

        if (counts.noIp > 0) {
          this.log(`Note: ${counts.noIp} VMs have no primary IP address`);
        }

        // Update sync run with success
        await db
          .update(syncRuns)
          .set({
            status: counts.errors > 0 ? "failed" : "ok",
            finishedAt: new Date(),
            counts: counts as any,
            logs: this.logs.join("\n"),
          })
          .where(eq(syncRuns.id, syncRunId));
      } catch (error: any) {
        counts.errors++;
        this.log(`Sync failed: ${error.message}`);

        await db
          .update(syncRuns)
          .set({
            status: "error",
            finishedAt: new Date(),
            counts: counts as any,
            error: error.message,
            logs: this.logs.join("\n"),
          })
          .where(eq(syncRuns.id, syncRunId));

        throw error;
      }
    } catch (error: any) {
      this.log(`Fatal error: ${error.message}`);
      console.error("Sync worker error:", error);
      throw error;
    }
  }
}

/**
 * Create a sync run record and execute it in the background using SyncWorker.
 *
 * This only caches provider inventory in Rovelink.
 * To push provider data into a CMDB, use pipeline sync instead.
 */
export async function runProviderSyncWithWorker(providerAccountId: string): Promise<string> {
  const [run] = await db
    .insert(syncRuns)
    .values({
      providerAccountId,
      type: "provider-sync",
      status: "queued",
    })
    .returning();

  // Execute sync in background — errors are logged and recorded by the worker
  (async () => {
    const worker = new SyncWorker();
    try {
      await worker.executeSyncRun(run.id);
    } catch (err) {
      // Errors already logged and persisted by the worker
    }
  })();

  return run.id;
}

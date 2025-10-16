import { db } from "../db";
import { providerAccounts, syncRuns, externalObjects } from "../../shared/schema";
import { eq } from "drizzle-orm";
import { getProviderCollector } from "./providers/registry";
import { netboxService } from "./netbox";

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

      this.log(`Starting sync for provider: ${syncRun.providerAccount.name} (${syncRun.providerAccount.kind})`);

      const counts: SyncCounts = {
        created: 0,
        updated: 0,
        unchanged: 0,
        removed: 0,
        errors: 0,
        noIp: 0,
      };

      try {
        // Get provider collector
        const collector = getProviderCollector(
          syncRun.providerAccount.kind,
          syncRun.providerAccount.config
        );

        // List VMs from provider
        this.log("Fetching VMs from provider...");
        const vms = await collector.listVms();
        this.log(`Found ${vms.length} VMs`);

        // Track seen external IDs for cleanup
        const seenExternalIds = new Set<string>();

        // Upsert each VM to NetBox
        for (const vm of vms) {
          try {
            seenExternalIds.add(vm.externalId);

            // Upsert VM to NetBox
            const result = await netboxService.upsertVm({
              externalId: vm.externalId,
              name: vm.name,
              provider: vm.provider,
              primaryIp4: vm.primaryIp4,
              tags: vm.tags,
              customFields: {
                ext_id: vm.externalId,
                ext_provider: vm.provider,
              },
            });

            if (!vm.primaryIp4) {
              counts.noIp++;
            }

            if (result.created) {
              counts.created++;
              this.log(`Created: ${vm.name} (${vm.externalId})`);
            } else {
              counts.updated++;
              this.log(`Updated: ${vm.name} (${vm.externalId})`);
            }

            // Update external_objects tracking
            await db
              .insert(externalObjects)
              .values({
                providerAccountId: syncRun.providerAccountId,
                providerKind: syncRun.providerAccount.kind,
                externalId: vm.externalId,
                netboxType: "virtualization.virtual_machines",
                netboxId: result.id,
                cachedPayload: vm.raw || {},
              })
              .onConflictDoUpdate({
                target: [externalObjects.providerAccountId, externalObjects.externalId],
                set: {
                  netboxId: result.id,
                  cachedPayload: vm.raw || {},
                  lastSyncedAt: new Date(),
                },
              });
          } catch (error: any) {
            counts.errors++;
            this.log(`Error upserting VM ${vm.name}: ${error.message}`);
          }
        }

        // Check for removed VMs (in external_objects but not in current sync)
        const existingObjects = await db.query.externalObjects.findMany({
          where: eq(externalObjects.providerAccountId, syncRun.providerAccountId),
        });

        for (const obj of existingObjects) {
          if (!seenExternalIds.has(obj.externalId)) {
            counts.removed++;
            this.log(`VM removed from provider: ${obj.externalId}`);
            // In real implementation, would mark as deleted or remove from NetBox
          }
        }

        counts.unchanged = Math.max(0, vms.length - counts.created - counts.updated);

        this.log(`Sync completed. Created: ${counts.created}, Updated: ${counts.updated}, Unchanged: ${counts.unchanged}, Removed: ${counts.removed}, Errors: ${counts.errors}`);
        
        if (counts.noIp > 0) {
          this.log(`Warning: ${counts.noIp} VMs have no IP address (agent not available)`);
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

        // Update sync run with failure
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

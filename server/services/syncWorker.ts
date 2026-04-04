import { db } from "../db";
import { providerAccounts, syncRuns, externalObjects, cmdbAccounts } from "../../shared/schema";
import { eq, and } from "drizzle-orm";
import { getProviderCollector } from "./providers/registry";
import { NetBoxAdapter } from "./netbox-adapter";
import { AzureCollector } from "./providers/azure";
import { AzureNetBoxSyncService } from "./azure-netbox-sync";
import { decryptCmdbConfig, decryptProviderConfig } from "./secrets";

/**
 * Transform provider tags by adding provider prefix.
 * 
 * NON-NEGOTIABLE RULE: Provider tags MUST NOT be written to NetBox verbatim.
 * All provider-originated tags must be prefixed with the provider name.
 * 
 * Example transformations:
 * - "customer/acme" -> "proxmox_customer/acme"
 * - "role/web" -> "vsphere_role/web"
 * - "wave/1" -> "azure_wave/1"
 * 
 * @param tags - Original tags from provider
 * @param providerKind - Provider type (e.g., "proxmox", "vsphere", "azure", "fake")
 * @returns Prefixed tags safe for NetBox
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
        // PHASE 2: Collect VMs from provider
        // ─────────────────────────────────────────────────────────────────────
        this.log(`=== Phase 2: Collecting from Provider ===`);
        const vms = await collector.listVms();
        this.log(`Collected ${vms.length} VMs from provider`);

        // ─────────────────────────────────────────────────────────────────────
        // PHASE 3: NetBox import
        // ─────────────────────────────────────────────────────────────────────
        this.log(`=== Phase 3: NetBox Import ===`);
        const isAzure = syncRun.providerAccount.kind === "azure";

        // Resolve NetBox config: prefer first enabled NetBox CMDB account in DB,
        // fall back to environment variables.
        let netboxUrl = process.env.NETBOX_URL || "";
        let netboxToken = process.env.NETBOX_TOKEN || "";

        const netboxCmdb = await db.query.cmdbAccounts.findFirst({
          where: and(
            eq(cmdbAccounts.kind, "netbox"),
            eq(cmdbAccounts.enabled, true)
          ),
        });

        if (netboxCmdb) {
          const cfg = decryptCmdbConfig(netboxCmdb.config as Record<string, any>);
          if (cfg?.url) netboxUrl = cfg.url as string;
          if (cfg?.token) netboxToken = cfg.token as string;
          this.log(`Using NetBox CMDB account: ${netboxCmdb.name}`);
        } else if (netboxUrl) {
          this.log(`Using NetBox from environment configuration`);
        } else {
          throw new Error(
            "No NetBox CMDB account configured. Please add a NetBox account under CMDBs first."
          );
        }

        const netbox = new NetBoxAdapter({ url: netboxUrl, token: netboxToken });

        // Test NetBox connectivity
        const netboxTest = await netbox.test();
        if (!netboxTest.ok) {
          throw new Error(`NetBox connection failed: ${netboxTest.error}`);
        }
        this.log(`NetBox connected (version: ${netboxTest.version || "unknown"})`);

        // ─── Azure: full discovery path ──────────────────────────────────────
        if (isAzure && collector instanceof AzureCollector) {
          this.log(`Azure provider detected — running full subscription discovery...`);
          this.log(`Collecting VMs, VNets, Subnets, NICs, and Public IPs...`);

          const discovery = await collector.discoverAll();
          this.log(`Discovery complete: ${discovery.vms.length} VMs, ${discovery.vnets.length} VNets, ${discovery.nics.length} NICs, ${discovery.publicIps.length} Public IPs`);

          const azureSync = new AzureNetBoxSyncService(netbox);
          const azureCounts = await azureSync.importAll(discovery);

          // Merge Azure counts into standard counts
          counts.created += azureCounts.vms.created + azureCounts.prefixes.created + azureCounts.interfaces.created + azureCounts.ips.created;
          counts.updated += azureCounts.vms.updated + azureCounts.prefixes.updated + azureCounts.interfaces.updated + azureCounts.ips.updated;
          counts.unchanged += azureCounts.vms.unchanged + azureCounts.prefixes.unchanged;
          counts.errors += azureCounts.vms.errors + azureCounts.prefixes.errors + azureCounts.interfaces.errors + azureCounts.ips.errors;

          // Append Azure sync logs
          for (const l of azureSync.getLogs()) {
            this.logs.push(l);
          }

          this.log(`=== Azure Sync Summary ===`);
          this.log(`VMs: created=${azureCounts.vms.created} updated=${azureCounts.vms.updated} unchanged=${azureCounts.vms.unchanged} errors=${azureCounts.vms.errors}`);
          this.log(`Interfaces: created=${azureCounts.interfaces.created} updated=${azureCounts.interfaces.updated} errors=${azureCounts.interfaces.errors}`);
          this.log(`IP Addresses: created=${azureCounts.ips.created} updated=${azureCounts.ips.updated} errors=${azureCounts.ips.errors}`);
          this.log(`Prefixes: created=${azureCounts.prefixes.created} updated=${azureCounts.prefixes.updated} unchanged=${azureCounts.prefixes.unchanged} errors=${azureCounts.prefixes.errors}`);

          // Update external_objects tracking for VMs
          for (const vm of discovery.vms) {
            try {
              await db
                .insert(externalObjects)
                .values({
                  providerAccountId: syncRun.providerAccountId,
                  providerKind: "azure",
                  externalId: vm.id,
                  netboxType: "virtualization.virtual_machines",
                  netboxId: 0,
                  cachedPayload: { name: vm.name, location: vm.location, resourceGroup: vm.resourceGroup },
                })
                .onConflictDoUpdate({
                  target: [externalObjects.providerAccountId, externalObjects.externalId],
                  set: {
                    cachedPayload: { name: vm.name, location: vm.location, resourceGroup: vm.resourceGroup },
                    lastSyncedAt: new Date(),
                  },
                });
            } catch {
              // Non-fatal tracking failure
            }
          }
        } else {
          // ─── Standard (Proxmox / Fake / vSphere) import path ────────────────
          this.log(`Importing ${vms.length} VMs into NetBox...`);

          const seenExternalIds = new Set<string>();

          for (const vm of vms) {
            try {
              const extId = `${syncRun.providerAccount.kind}:${vm.externalId}`;
              seenExternalIds.add(vm.externalId);

              // NON-NEGOTIABLE: Provider tags MUST be prefixed before writing to NetBox
              const namespacedTags = namespaceTags(vm.tags, syncRun.providerAccount.kind);

              const vmData = {
                name: vm.name,
                status: vm.status === "running" ? "active" : "offline",
                vcpus: vm.vcpus,
                memory: vm.memory,
                disk: vm.disk,
                platform: vm.platform ? { name: vm.platform } : undefined,
                tags: namespacedTags.map((t: string) => ({ name: t })),
                custom_fields: {
                  ext_id: extId,
                  ext_provider: syncRun.providerAccount.kind,
                },
                comments: `Synced from ${syncRun.providerAccount.kind} by Bridge`,
              };

              if (!vm.primaryIp4) counts.noIp++;

              const result = await netbox.upsertVm(vmData, extId);

              if (result.created) {
                counts.created++;
                this.log(`Created: ${vm.name} (${extId})`);
              } else if (result.unchanged) {
                counts.unchanged++;
                this.log(`Unchanged: ${vm.name}`);
              } else {
                counts.updated++;
                this.log(`Updated: ${vm.name} (NetBox ID: ${result.id})`);
              }

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

          // Check for removed VMs
          const existingObjects = await db.query.externalObjects.findMany({
            where: eq(externalObjects.providerAccountId, syncRun.providerAccountId),
          });
          for (const obj of existingObjects) {
            if (!seenExternalIds.has(obj.externalId)) {
              counts.removed++;
              this.log(`VM removed from provider: ${obj.externalId}`);
            }
          }
        }

        this.log(`=== Sync Complete ===`);
        this.log(`Created: ${counts.created}, Updated: ${counts.updated}, Unchanged: ${counts.unchanged}, Removed: ${counts.removed}, Errors: ${counts.errors}`);

        if (counts.noIp > 0) {
          this.log(`Warning: ${counts.noIp} VMs have no IP address`);
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

/**
 * Create a sync run record and execute it in the background using SyncWorker.
 * Replaces the old runProviderSync which only supported Proxmox.
 */
export async function runProviderSyncWithWorker(providerAccountId: string): Promise<string> {
  // Create sync run record
  const [run] = await db
    .insert(syncRuns)
    .values({
      providerAccountId,
      type: "provider-sync",
      status: "queued",
    })
    .returning();

  // Execute sync in background
  (async () => {
    const worker = new SyncWorker();
    try {
      await worker.executeSyncRun(run.id);
    } catch (err) {
      // Errors are already logged and recorded by the worker
    }
  })();

  return run.id;
}

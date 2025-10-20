/**
 * Provider Sync Worker
 * Handles synchronization from providers to NetBox
 */

import { storage } from '../storage';
import { ProxmoxCollector, type ProxmoxConfig, type ProxmoxVm } from './proxmox-collector';
import { NetBoxAdapter, type NetBoxConfig } from './netbox-adapter';

export interface SyncOptions {
  providerAccountId: string;
  dryRun?: boolean;
}

export interface SyncResult {
  success: boolean;
  counts: {
    created: number;
    updated: number;
    unchanged: number;
    removed: number;
    errors: number;
  };
  error?: string;
  logs: string[];
}

export class ProviderSyncWorker {
  private logs: string[] = [];

  private log(message: string) {
    this.logs.push(`[${new Date().toISOString()}] ${message}`);
    console.log(message);
  }

  /**
   * Sync a provider account to NetBox
   */
  async sync(options: SyncOptions): Promise<SyncResult> {
    this.logs = [];
    const counts = {
      created: 0,
      updated: 0,
      unchanged: 0,
      removed: 0,
      errors: 0,
    };

    try {
      // Get provider account
      const provider = await storage.getProvider(options.providerAccountId);
      if (!provider) {
        throw new Error('Provider account not found');
      }

      this.log(`Starting sync for provider: ${provider.name} (${provider.kind})`);

      // Get NetBox config from environment or settings
      const netboxUrl = process.env.NETBOX_URL || '';
      const netboxToken = process.env.NETBOX_TOKEN || '';

      if (!netboxUrl || !netboxToken) {
        throw new Error('NetBox URL or Token not configured');
      }

      const netbox = new NetBoxAdapter({
        url: netboxUrl,
        token: netboxToken,
      });

      // Test NetBox connection
      const netboxTest = await netbox.test();
      if (!netboxTest.ok) {
        throw new Error(`NetBox connection failed: ${netboxTest.error}`);
      }
      this.log(`NetBox connection OK (version: ${netboxTest.version || 'unknown'})`);

      // Collect VMs based on provider kind
      let vms: ProxmoxVm[] = [];

      if (provider.kind === 'proxmox') {
        const collector = new ProxmoxCollector(provider.config as ProxmoxConfig);
        
        // Test connection
        const testResult = await collector.test();
        if (!testResult.ok) {
          throw new Error(`Provider connection failed: ${testResult.error}`);
        }
        this.log(`Connected to Proxmox (nodes: ${testResult.nodes?.join(', ')})`);

        // Collect VMs
        vms = await collector.listVms();
        this.log(`Collected ${vms.length} VMs from Proxmox`);
      } else {
        throw new Error(`Unsupported provider kind: ${provider.kind}`);
      }

      // Sync each VM to NetBox
      for (const vm of vms) {
        try {
          const extId = `${provider.kind}:${vm.externalId}`;

          if (options.dryRun) {
            this.log(`[DRY-RUN] Would sync VM: ${vm.name} (${extId})`);
            counts.unchanged++;
            continue;
          }

          // Prepare VM data for NetBox
          const vmData: any = {
            name: vm.name,
            status: vm.status === 'running' ? 'active' : 'offline',
            vcpus: vm.cores,
            memory: vm.memory ? Math.floor(vm.memory / (1024 * 1024)) : undefined, // Convert to MB
            tags: vm.tags.map(t => ({ name: t })),
            custom_fields: {
              ext_id: extId,
              ext_provider: provider.kind,
            },
            comments: `Synced from ${provider.kind} by Bridge`,
          };

          // Upsert to NetBox
          const result = await netbox.upsertVm(vmData, extId);
          
          if (result.created) {
            counts.created++;
            this.log(`Created VM: ${vm.name} (NetBox ID: ${result.id})`);
          } else {
            counts.updated++;
            this.log(`Updated VM: ${vm.name} (NetBox ID: ${result.id})`);
          }
        } catch (error: any) {
          counts.errors++;
          this.log(`ERROR syncing VM ${vm.name}: ${error.message}`);
        }
      }

      this.log(`Sync complete: ${counts.created} created, ${counts.updated} updated, ${counts.errors} errors`);

      return {
        success: counts.errors === 0,
        counts,
        logs: this.logs,
      };
    } catch (error: any) {
      this.log(`FATAL ERROR: ${error.message}`);
      return {
        success: false,
        counts,
        error: error.message,
        logs: this.logs,
      };
    }
  }
}

/**
 * Run a provider sync and record the run
 */
export async function runProviderSync(providerAccountId: string): Promise<string> {
  // Create sync run record
  const run = await storage.createSyncRun({
    providerAccountId,
    type: 'provider-sync',
    status: 'running',
  });

  // Execute sync in background
  (async () => {
    const worker = new ProviderSyncWorker();
    const result = await worker.sync({ providerAccountId });

    // Update run with results
    await storage.updateSyncRun(run.id, {
      status: result.success ? 'ok' : 'failed',
      finishedAt: new Date(),
      counts: result.counts,
      error: result.error,
      logs: result.logs.join('\n'),
    });
  })();

  return run.id;
}

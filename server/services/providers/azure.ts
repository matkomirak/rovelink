// Providers MUST remain governance-blind.
// Any logic beyond factual observation is forbidden here.
// Providers emit raw observed data only - they do NOT know about:
// - Tenants (governance)
// - Automation (gate decisions)
// - Gating (CMDB governance)

import axios from "axios";
import { IProviderCollector, NormalizedVm, TestConnectionResult } from "./types";

export interface AzureConfig {
  subscription_id: string;
  tenant_id: string;
  client_id: string;
  client_secret: string;
  resource_groups?: string[]; // Optional filter by resource group(s)
}

interface AzureTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface AzureVm {
  id: string;
  name: string;
  location: string;
  properties?: {
    provisioningState?: string;
    powerState?: string;
    hardwareProfile?: { vmSize?: string };
    storageProfile?: {
      osDisk?: { osType?: string; diskSizeGB?: number };
    };
    osProfile?: { computerName?: string };
    networkProfile?: {
      networkInterfaces?: Array<{ id: string }>;
    };
  };
  tags?: Record<string, string>;
}

interface AzureVmInstanceView {
  statuses?: Array<{ code: string; displayStatus?: string }>;
}

interface AzureNic {
  properties?: {
    ipConfigurations?: Array<{
      properties?: {
        privateIPAddress?: string;
        publicIPAddress?: { id?: string };
      };
    }>;
  };
}

export class AzureCollector implements IProviderCollector {
  private config: AzureConfig;
  private accessToken?: string;

  constructor(config: AzureConfig) {
    this.config = config;
  }

  private async authenticate(): Promise<void> {
    const url = `https://login.microsoftonline.com/${this.config.tenant_id}/oauth2/v2.0/token`;
    const params = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.config.client_id,
      client_secret: this.config.client_secret,
      scope: "https://management.azure.com/.default",
    });

    const response = await axios.post<AzureTokenResponse>(url, params.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    this.accessToken = response.data.access_token;
  }

  private authHeaders() {
    return { Authorization: `Bearer ${this.accessToken}` };
  }

  async testConnection(): Promise<TestConnectionResult> {
    try {
      await this.authenticate();

      // Try to list subscriptions to confirm access
      const response = await axios.get(
        `https://management.azure.com/subscriptions/${this.config.subscription_id}?api-version=2022-12-01`,
        { headers: this.authHeaders() }
      );

      const sub = response.data;
      return {
        ok: true,
        details: `Connected to subscription: ${sub.displayName || this.config.subscription_id} (${sub.state || "Enabled"})`,
      };
    } catch (err: any) {
      const msg =
        err?.response?.data?.error?.message ||
        err?.response?.data?.error_description ||
        err?.message ||
        "Unknown error";
      return { ok: false, error: msg };
    }
  }

  async listVms(): Promise<NormalizedVm[]> {
    await this.authenticate();

    const baseUrl = "https://management.azure.com";
    const apiVersion = "2023-03-01";
    const results: NormalizedVm[] = [];

    // Build list of resource group scopes or use subscription-wide
    let vmListUrl: string;
    if (this.config.resource_groups && this.config.resource_groups.length > 0) {
      // Collect from each resource group individually
      for (const rg of this.config.resource_groups) {
        const rgUrl = `${baseUrl}/subscriptions/${this.config.subscription_id}/resourceGroups/${rg}/providers/Microsoft.Compute/virtualMachines?api-version=${apiVersion}`;
        const vms = await this.fetchAllVms(rgUrl);
        results.push(...vms);
      }
      return results;
    } else {
      vmListUrl = `${baseUrl}/subscriptions/${this.config.subscription_id}/providers/Microsoft.Compute/virtualMachines?api-version=${apiVersion}`;
      return await this.fetchAllVms(vmListUrl);
    }
  }

  private async fetchAllVms(url: string): Promise<NormalizedVm[]> {
    const baseUrl = "https://management.azure.com";
    const apiVersion = "2023-03-01";
    const results: NormalizedVm[] = [];
    let nextLink: string | undefined = url;

    while (nextLink) {
      const response = await axios.get<{ value: AzureVm[]; nextLink?: string }>(
        nextLink,
        { headers: this.authHeaders() }
      );
      const vms: AzureVm[] = response.data.value || [];
      nextLink = response.data.nextLink;

      for (const vm of vms) {
        const normalized = await this.normalizeVm(vm, baseUrl, apiVersion);
        results.push(normalized);
      }
    }

    return results;
  }

  private async normalizeVm(vm: AzureVm, baseUrl: string, apiVersion: string): Promise<NormalizedVm> {
    // Get power state via instance view
    let status = "unknown";
    try {
      const ivUrl = `${baseUrl}${vm.id}/instanceView?api-version=${apiVersion}`;
      const ivResp = await axios.get<AzureVmInstanceView>(ivUrl, {
        headers: this.authHeaders(),
      });
      const statuses = ivResp.data.statuses || [];
      const powerStatus = statuses.find((s) => s.code?.startsWith("PowerState/"));
      if (powerStatus) {
        const code = powerStatus.code.replace("PowerState/", "").toLowerCase();
        status = code === "running" ? "running" : "stopped";
      }
    } catch {
      // Best effort - keep unknown
    }

    // Get primary IP from NIC
    let primaryIp4: string | undefined;
    const nicRefs = vm.properties?.networkProfile?.networkInterfaces || [];
    if (nicRefs.length > 0) {
      try {
        const nicId = nicRefs[0].id;
        const nicUrl = `${baseUrl}${nicId}?api-version=2023-05-01`;
        const nicResp = await axios.get<AzureNic>(nicUrl, {
          headers: this.authHeaders(),
        });
        const ipConfigs = nicResp.data.properties?.ipConfigurations || [];
        if (ipConfigs.length > 0) {
          primaryIp4 = ipConfigs[0].properties?.privateIPAddress;
        }
      } catch {
        // Best effort
      }
    }

    // OS type
    const osType = vm.properties?.storageProfile?.osDisk?.osType?.toLowerCase();
    let platform: string | undefined;
    if (osType === "linux") platform = "linux";
    else if (osType === "windows") platform = "windows";

    // Disk size
    const diskGb = vm.properties?.storageProfile?.osDisk?.diskSizeGB;

    // Resource group from VM id: /subscriptions/.../resourceGroups/RG_NAME/...
    const idParts = (vm.id || "").split("/");
    const rgIdx = idParts.findIndex((p) => p.toLowerCase() === "resourcegroups");
    const resourceGroup = rgIdx >= 0 ? idParts[rgIdx + 1] : undefined;

    // Tags as array of "key:value" strings
    const tags: string[] = [];
    if (vm.tags) {
      for (const [k, v] of Object.entries(vm.tags)) {
        tags.push(`${k}:${v}`);
      }
    }

    return {
      externalId: vm.id || vm.name,
      name: vm.name,
      provider: "azure",
      status,
      primaryIp4,
      platform,
      disk: diskGb,
      description: vm.properties?.hardwareProfile?.vmSize,
      site: vm.location,
      tags,
      raw: vm,
    };
  }
}

export function createAzureCollector(config: AzureConfig): AzureCollector {
  return new AzureCollector(config);
}

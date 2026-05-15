/**
 * VMware vCenter Provider
 * Uses the vSphere REST API (available since vCenter 6.7u3+)
 * API docs: https://developer.vmware.com/apis/vsphere-automation/latest/
 *
 * Authentication: session-based. Calls POST /api/session to get a session token,
 * then sends it as vmware-api-session-id header.
 */

import axios, { AxiosInstance } from "axios";
import https from "https";
import {
  IProviderCollector,
  NormalizedVm,
  TestConnectionResult,
  ProviderOutput,
  ObservedAsset,
} from "./types";

export interface VCenterConfig {
  url: string;
  username: string;
  password: string;
  verify_ssl: boolean;
  datacenter?: string;
  cluster?: string;
}

interface VSphereVm {
  vm: string;
  name: string;
  power_state: string;
  cpu_count?: number;
  memory_size_MiB?: number;
}

interface VSphereVmDetails {
  identity?: { name?: string; instance_uuid?: string };
  power_state?: { state?: string };
  cpu?: { count?: number };
  memory?: { size_MiB?: number };
  guest_OS?: string;
  nics?: Record<string, { mac_address?: string }>;
}

interface VSphereGuestInfo {
  ip_address?: string;
  host_name?: string;
  family?: string;
  full_name?: { default_message?: string };
}

export class VCenterCollector implements IProviderCollector {
  private config: VCenterConfig;
  private client: AxiosInstance;
  private sessionToken?: string;

  constructor(config: VCenterConfig) {
    this.config = config;
    this.client = axios.create({
      baseURL: config.url.replace(/\/$/, ""),
      httpsAgent: new https.Agent({ rejectUnauthorized: config.verify_ssl }),
      timeout: 30000,
    });
  }

  private async authenticate(): Promise<void> {
    if (this.sessionToken) return;

    const res = await this.client.post(
      "/api/session",
      {},
      {
        auth: { username: this.config.username, password: this.config.password },
      }
    );
    this.sessionToken = (res.data as string).replace(/"/g, "");
    this.client.defaults.headers.common["vmware-api-session-id"] = this.sessionToken;
  }

  private async refreshSession(): Promise<void> {
    this.sessionToken = undefined;
    await this.authenticate();
  }

  async testConnection(): Promise<TestConnectionResult> {
    try {
      await this.authenticate();
      const res = await this.client.get("/api/vcenter/datacenter");
      const datacenters = res.data as Array<{ name: string }>;
      return {
        ok: true,
        details: `Connected. Datacenters: ${datacenters.map((d) => d.name).join(", ")}`,
      };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  async listVms(): Promise<NormalizedVm[]> {
    const outputs = await this.listVmsWithHints();
    return outputs.map((o) => ({
      externalId: o.observed.provider_id,
      name: o.observed.name,
      provider: "vcenter",
      primaryIp4: o.observed.primaryIp4,
      vcpus: o.observed.vcpus,
      memory: o.observed.memory,
      platform: o.observed.platform,
      status: o.observed.status,
      description: o.observed.description,
      tags: [],
      raw: o.hints?.raw,
    }));
  }

  async listVmsWithHints(): Promise<ProviderOutput[]> {
    await this.authenticate();

    const vmListRes = await this.client.get("/api/vcenter/vm", {}).catch(async (e) => {
      if (e.response?.status === 401) {
        await this.refreshSession();
        return this.client.get("/api/vcenter/vm", {});
      }
      throw e;
    });

    const vms: VSphereVm[] = vmListRes.data;
    const outputs: ProviderOutput[] = [];

    for (const vm of vms) {
      try {
        const detailRes = await this.client.get(`/api/vcenter/vm/${vm.vm}`);
        const detail: VSphereVmDetails = detailRes.data;

        let guestIp: string | undefined;
        let platform: string | undefined;
        try {
          const guestRes = await this.client.get(`/api/vcenter/vm/${vm.vm}/guest/identity`);
          const guest: VSphereGuestInfo = guestRes.data;
          guestIp = guest.ip_address;
          platform = guest.family?.toLowerCase().includes("windows") ? "windows" : "linux";
        } catch {
          // Guest tools not running — acceptable
        }

        const powerMap: Record<string, string> = {
          POWERED_ON: "running",
          POWERED_OFF: "offline",
          SUSPENDED: "staged",
        };

        const observed: ObservedAsset = {
          provider_id: vm.vm,
          name: vm.name,
          provider: "vcenter",
          status: powerMap[vm.power_state] ?? "offline",
          last_seen_at: new Date(),
          primaryIp4: guestIp,
          vcpus: detail.cpu?.count ?? vm.cpu_count,
          memory: detail.memory?.size_MiB ?? vm.memory_size_MiB,
          platform,
          cluster: this.config.cluster,
          site: this.config.datacenter,
        };

        outputs.push({
          observed,
          hints: { raw: { vm, detail } },
        });
      } catch (err: any) {
        console.error(
          `[vcenter] Failed to fetch details for VM ${vm.vm} (${vm.name}): ${err.message}`
        );
      }
    }

    return outputs;
  }
}

export function createVCenterCollector(config: any): IProviderCollector {
  return new VCenterCollector(config as VCenterConfig);
}

import axios, { AxiosInstance } from "axios";
import https from "https";
import { IProviderCollector, NormalizedVm, TestConnectionResult, ProviderOutput } from "./types";

interface ProxmoxConfig {
  base_url: string;
  auth_method: "password" | "api_token";
  username?: string;
  password?: string;
  token_id?: string;
  token_secret?: string;
  realm?: string;
  verify_ssl?: boolean;
  include_nodes?: string[];
  exclude_nodes?: string[];
}

interface ProxmoxNode {
  node: string;
  status: string;
}

interface ProxmoxVm {
  vmid: number;
  name: string;
  status: string;
  node?: string;
}

interface ProxmoxNetworkInterface {
  name: string;
  'ip-addresses'?: Array<{
    'ip-address': string;
    'ip-address-type': string;
    prefix: number;
  }>;
}

export class ProxmoxCollector implements IProviderCollector {
  private config: ProxmoxConfig;
  private client: AxiosInstance;
  private ticket?: string;
  private csrfToken?: string;

  constructor(config: ProxmoxConfig) {
    this.config = {
      realm: "pam",
      verify_ssl: true,
      ...config,
    };

    // Create axios client with SSL verification settings
    this.client = axios.create({
      baseURL: this.config.base_url,
      httpsAgent: new https.Agent({
        rejectUnauthorized: this.config.verify_ssl,
      }),
    });
  }

  private async authenticate(): Promise<void> {
    if (this.config.auth_method === "api_token") {
      // API token doesn't need authentication
      this.client.defaults.headers.common["Authorization"] =
        `PVEAPIToken=${this.config.username}!${this.config.token_id}=${this.config.token_secret}`;
    } else if (this.config.auth_method === "password") {
      // Get ticket and CSRF token
      const response = await this.client.post("/api2/json/access/ticket", {
        username: `${this.config.username}@${this.config.realm}`,
        password: this.config.password,
      });

      this.ticket = response.data.data.ticket;
      this.csrfToken = response.data.data.CSRFPreventionToken;

      this.client.defaults.headers.common["Cookie"] = `PVEAuthCookie=${this.ticket}`;
      this.client.defaults.headers.common["CSRFPreventionToken"] = this.csrfToken;
    }
  }

  async testConnection(): Promise<TestConnectionResult> {
    try {
      await this.authenticate();

      const response = await this.client.get("/api2/json/nodes");
      const nodes = response.data.data as ProxmoxNode[];

      // Try to get version info
      let version: string | undefined;
      try {
        const versionResp = await this.client.get("/api2/json/version");
        version = versionResp.data.data?.version;
      } catch {
        // Version endpoint might not be available
      }

      return {
        ok: true,
        details: `Connected successfully. Found ${nodes.length} node(s)`,
        version,
      };
    } catch (error: any) {
      return {
        ok: false,
        error: error.message || "Connection failed",
      };
    }
  }

  async listVms(): Promise<NormalizedVm[]> {
    try {
      await this.authenticate();

      // Get all nodes
      const nodesResp = await this.client.get("/api2/json/nodes");
      let nodes = (nodesResp.data.data as ProxmoxNode[]).map((n) => n.node);

      // Filter nodes if configured
      if (this.config.include_nodes && this.config.include_nodes.length > 0) {
        nodes = nodes.filter((n) => this.config.include_nodes!.includes(n));
      }
      if (this.config.exclude_nodes && this.config.exclude_nodes.length > 0) {
        nodes = nodes.filter((n) => !this.config.exclude_nodes!.includes(n));
      }

      const allVms: NormalizedVm[] = [];

      // For each node, get VMs
      for (const node of nodes) {
        try {
          const vmsResp = await this.client.get(`/api2/json/nodes/${node}/qemu`);
          const vms = vmsResp.data.data as ProxmoxVm[];

          for (const vm of vms) {
            let primaryIp4: string | undefined;

            // Try to get IP from agent
            try {
              const agentResp = await this.client.get(
                `/api2/json/nodes/${node}/qemu/${vm.vmid}/agent/network-get-interfaces`
              );
              const interfaces = agentResp.data.data?.result as ProxmoxNetworkInterface[];

              // Find first IPv4 address that's not loopback
              for (const iface of interfaces || []) {
                if (iface.name === "lo") continue;
                const ipv4 = iface["ip-addresses"]?.find(
                  (ip) => ip["ip-address-type"] === "ipv4" && !ip["ip-address"].startsWith("127.")
                );
                if (ipv4) {
                  primaryIp4 = ipv4["ip-address"];
                  break;
                }
              }
            } catch {
              // Agent not available or not running
            }

            allVms.push({
              externalId: `${node}-${vm.vmid}`,
              name: vm.name,
              provider: "proxmox",
              primaryIp4,
              tags: [`provider/proxmox`, `node/${node}`],
              raw: vm,
            });
          }
        } catch (error: any) {
          console.error(`Failed to get VMs from node ${node}:`, error.message);
        }
      }

      return allVms;
    } catch (error: any) {
      // If authentication fails with ticket, retry once
      if (error.response?.status === 401 && this.config.auth_method === "password") {
        this.ticket = undefined;
        this.csrfToken = undefined;
        return this.listVms(); // Retry with fresh authentication
      }
      throw error;
    }
  }

  async listVmsWithHints(): Promise<ProviderOutput[]> {
    const vms = await this.listVms();
    return vms.map((vm) => ({
      observed: {
        provider_id: vm.externalId,
        name: vm.name,
        provider: "proxmox",
        status: vm.status ?? "running",
        last_seen_at: new Date(),
        primaryIp4: vm.primaryIp4,
        vcpus: vm.vcpus,
        memory: vm.memory,
        platform: vm.platform,
        cluster: undefined,
        site: undefined,
      },
      hints: {
        provider_tags: vm.tags,
        raw: vm.raw,
      },
    }));
  }
}

export function createProxmoxCollector(config: any): IProviderCollector {
  return new ProxmoxCollector(config as ProxmoxConfig);
}

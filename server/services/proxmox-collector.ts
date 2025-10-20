/**
 * Proxmox VE Collector
 * Connects to Proxmox API to collect VM inventory
 */

import axios, { type AxiosInstance } from 'axios';
import https from 'https';

export interface ProxmoxConfig {
  base_url: string;
  auth_method: 'password' | 'api_token';
  username?: string;
  password?: string;
  token_id?: string;
  token_secret?: string;
  realm?: string;
  verify_ssl?: boolean;
  include_nodes?: string[];
  exclude_nodes?: string[];
}

export interface ProxmoxVm {
  externalId: string; // "node-vmid"
  name: string;
  provider: string; // "proxmox"
  primaryIp4?: string;
  tags: string[];
  node: string;
  vmid: number;
  status: string;
  cores?: number;
  memory?: number;
  guest?: {
    os?: string;
  };
  interfaces?: Array<{
    name: string;
    mac: string;
    ips?: string[];
  }>;
}

interface ProxmoxTicketResponse {
  data: {
    ticket: string;
    CSRFPreventionToken: string;
    username: string;
  };
}

interface ProxmoxNode {
  node: string;
  status: string;
  [key: string]: any;
}

interface ProxmoxQemuVm {
  vmid: number;
  name: string;
  status: string;
  cpus?: number;
  maxmem?: number;
  tags?: string;
  [key: string]: any;
}

export class ProxmoxCollector {
  private config: ProxmoxConfig;
  private client: AxiosInstance;
  private ticket?: string;
  private csrf?: string;

  constructor(config: ProxmoxConfig) {
    this.config = config;
    
    // Create axios instance with SSL verification config
    this.client = axios.create({
      baseURL: this.config.base_url,
      httpsAgent: new https.Agent({
        rejectUnauthorized: this.config.verify_ssl !== false,
      }),
      timeout: 30000,
    });
  }

  /**
   * Authenticate with Proxmox API
   */
  private async authenticate(): Promise<void> {
    if (this.config.auth_method === 'api_token') {
      // API token doesn't need authentication
      this.client.defaults.headers.common['Authorization'] = 
        `PVEAPIToken=${this.config.token_id}=${this.config.token_secret}`;
    } else {
      // Password authentication - get ticket
      try {
        const response = await this.client.post<ProxmoxTicketResponse>('/api2/json/access/ticket', {
          username: `${this.config.username}@${this.config.realm || 'pam'}`,
          password: this.config.password,
        });

        this.ticket = response.data.data.ticket;
        this.csrf = response.data.data.CSRFPreventionToken;

        // Set ticket in cookies
        this.client.defaults.headers.common['Cookie'] = `PVEAuthCookie=${this.ticket}`;
        this.client.defaults.headers.common['CSRFPreventionToken'] = this.csrf;
      } catch (error: any) {
        throw new Error(`Proxmox authentication failed: ${error.message}`);
      }
    }
  }

  /**
   * Test connection to Proxmox
   */
  async test(): Promise<{ ok: boolean; nodes?: string[]; version?: string; error?: string }> {
    try {
      await this.authenticate();

      // Get nodes to verify connection
      const response = await this.client.get<{ data: ProxmoxNode[] }>('/api2/json/nodes');
      const nodes = response.data.data.map(n => n.node);

      // Try to get version
      const versionResponse = await this.client.get<{ data: { version: string } }>('/api2/json/version');
      const version = versionResponse.data.data.version;

      return {
        ok: true,
        nodes,
        version,
      };
    } catch (error: any) {
      return {
        ok: false,
        error: error.message || 'Connection failed',
      };
    }
  }

  /**
   * List all VMs from Proxmox
   */
  async listVms(): Promise<ProxmoxVm[]> {
    await this.authenticate();

    // Get all nodes
    const nodesResponse = await this.client.get<{ data: ProxmoxNode[] }>('/api2/json/nodes');
    const allNodes = nodesResponse.data.data.map(n => n.node);

    // Filter nodes based on include/exclude
    let nodes = allNodes;
    if (this.config.include_nodes && this.config.include_nodes.length > 0) {
      nodes = nodes.filter(n => this.config.include_nodes!.includes(n));
    }
    if (this.config.exclude_nodes && this.config.exclude_nodes.length > 0) {
      nodes = nodes.filter(n => !this.config.exclude_nodes!.includes(n));
    }

    // Collect VMs from each node
    const allVms: ProxmoxVm[] = [];

    for (const node of nodes) {
      try {
        // Get QEMU VMs on this node
        const vmsResponse = await this.client.get<{ data: ProxmoxQemuVm[] }>(
          `/api2/json/nodes/${node}/qemu`
        );

        for (const vm of vmsResponse.data.data) {
          const normalized = await this.normalizeVm(node, vm);
          allVms.push(normalized);
        }
      } catch (error: any) {
        console.error(`Failed to get VMs from node ${node}:`, error.message);
        // Continue with other nodes
      }
    }

    return allVms;
  }

  /**
   * Normalize a Proxmox VM to standard format
   */
  private async normalizeVm(node: string, vm: ProxmoxQemuVm): Promise<ProxmoxVm> {
    const externalId = `${node}-${vm.vmid}`;
    
    // Parse tags
    const tags: string[] = [];
    if (vm.tags) {
      tags.push(...vm.tags.split(';').map(t => t.trim()).filter(Boolean));
    }
    tags.push(`node/${node}`);
    tags.push('provider/proxmox');

    // Try to get agent IP if possible (optional, may fail if agent not running)
    let primaryIp4: string | undefined;
    let interfaces: Array<{ name: string; mac: string; ips?: string[] }> | undefined;

    try {
      const agentResponse = await this.client.get(
        `/api2/json/nodes/${node}/qemu/${vm.vmid}/agent/network-get-interfaces`
      );
      
      if (agentResponse.data?.data?.result) {
        const ifaces = agentResponse.data.data.result;
        interfaces = [];

        for (const iface of ifaces) {
          if (iface.name === 'lo') continue; // Skip loopback
          
          const ips: string[] = [];
          if (iface['ip-addresses']) {
            for (const ipAddr of iface['ip-addresses']) {
              if (ipAddr['ip-address-type'] === 'ipv4') {
                ips.push(ipAddr['ip-address']);
                if (!primaryIp4) {
                  primaryIp4 = ipAddr['ip-address'];
                }
              }
            }
          }

          interfaces.push({
            name: iface.name,
            mac: iface['hardware-address'] || '',
            ips,
          });
        }
      }
    } catch (error) {
      // Agent not available or not responding - this is OK
    }

    return {
      externalId,
      name: vm.name,
      provider: 'proxmox',
      primaryIp4,
      tags,
      node,
      vmid: vm.vmid,
      status: vm.status,
      cores: vm.cpus,
      memory: vm.maxmem,
      interfaces,
    };
  }
}

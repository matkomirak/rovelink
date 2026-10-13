// Providers MUST remain governance-blind.
// Any logic beyond factual observation is forbidden here.
// Providers emit raw observed data only - they do NOT know about:
// - Tenants (governance)
// - Automation (gate decisions)
// - Gating (CMDB governance)

import { generateFakeAzureDiscovery } from "./fake-azure-demo";
import { IProviderCollector, TestConnectionResult, NormalizedVm } from "./types";

export interface FakeConfig {
  scenario?: "azure" | "proxmox" | "generic";
  variant: "proxmox" | "vsphere" | "azure" | "aws";
  seed: number;
  vms: number;
  tenants?: string[];
  sites?: string[];
  clusters?: string[];
  nodes?: string[];
  linux_pct?: number;
  tags?: Record<string, string[]>;
  nics_per_vm?: { min: number; max: number };
  ips_per_nic?: { min: number; max: number };
  ipv4_cidrs?: string[];
  missing_ip_pct?: number;
}

class SeededRandom {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
  }

  next(): number {
    let t = (this.seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  pick<T>(arr: T[]): T {
    return arr[this.nextInt(0, arr.length - 1)];
  }

  shuffle<T>(arr: T[]): T[] {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }
}

export class FakeCollector implements IProviderCollector {
  private config: FakeConfig;

  constructor(config: FakeConfig) {
    this.config = {
      tenants: ["Alpha", "Beta"],
      sites: ["PRG-DC1", "PRG-DC2"],
      clusters: ["C0", "C1"],
      nodes: ["pve1", "pve2"],
      linux_pct: 70,
      tags: {
        customer: ["Alpha", "Beta", "Gamma"],
        wave: ["Wave1", "Wave2", "Wave3"],
        role: ["web", "app", "db"],
      },
      nics_per_vm: { min: 1, max: 2 },
      ips_per_nic: { min: 1, max: 2 },
      ipv4_cidrs: ["10.50.0.0/16", "10.60.0.0/16"],
      missing_ip_pct: 10,
      ...config,
    };
  }

  async testConnection(): Promise<TestConnectionResult> {
    return {
      ok: true,
      details: `Fake provider (${this.config.variant}) will generate ${this.config.vms} VMs`,
      version: `fake-${this.config.variant}-1.0`,
    };
  }

  async listVms(): Promise<NormalizedVm[]> {
    if (this.config.scenario === "azure") {
      return generateFakeAzureDiscovery().flatMap(discovery => discovery.vms.map(vm => ({
        externalId: vm.id, name: vm.name, provider: "azure", status: vm.status,
        primaryIp4: vm.primaryIp4, vcpus: vm.vcpus, memory: (vm.ramGiB ?? 0) * 1024,
        disk: vm.disk, platform: vm.platform,
        tags: Object.entries(vm.tags).map(([key, value]) => `${key}:${value}`), raw: { vm },
      })));
    }
    const rng = new SeededRandom(this.config.seed);
    const vms: NormalizedVm[] = [];

    for (let i = 0; i < this.config.vms; i++) {
      const vm = this.generateVm(i, rng);
      vms.push(vm);
    }

    return vms;
  }

  // NOTE: listVmsWithHints() was REMOVED.
  // Providers MUST remain governance-blind.
  // They emit raw observed data only, with no knowledge of
  // tenants, automation, or gating concepts.

  private generateVm(index: number, rng: SeededRandom): NormalizedVm {
    switch (this.config.variant) {
      case "proxmox":
        return this.generateProxmoxVm(index, rng);
      case "vsphere":
        return this.generateVSphereVm(index, rng);
      case "azure":
        return this.generateAzureVm(index, rng);
      case "aws":
        return this.generateAwsVm(index, rng);
      default:
        throw new Error(`Unknown variant: ${this.config.variant}`);
    }
  }

  private generateProxmoxVm(index: number, rng: SeededRandom): NormalizedVm {
    const isLinux = rng.next() * 100 < (this.config.linux_pct || 70);
    const customer = rng.pick(this.config.tags?.customer || ["Alpha"]);
    const wave = rng.pick(this.config.tags?.wave || ["Wave1"]);
    const role = rng.pick(this.config.tags?.role || ["web"]);
    const node = rng.pick(this.config.nodes || ["pve1"]);
    const vmid = 100 + index;
    
    const name = `${customer.toLowerCase()}-${role}-${String(index + 1).padStart(3, "0")}`;
    const status = rng.next() > 0.1 ? "running" : "stopped";
    
    const interfaces = this.generateInterfaces(rng);
    const ips = this.generateIps(interfaces, rng);
    const ipv6 = this.generateIpv6(rng);
    
    const vcpus = rng.pick([1, 2, 4, 8, 16]);
    const memory = rng.pick([512, 1024, 2048, 4096, 8192, 16384]);
    const disk = rng.pick([20, 40, 80, 100, 200, 500]);
    const platform = isLinux ? "linux" : "windows";
    const description = `${customer} ${role} server - ${wave} - Managed by Rovelink`;

    return {
      externalId: `${node}-${vmid}`,
      name,
      provider: "proxmox",
      primaryIp4: ips.length > 0 ? ips[0].split("/")[0] : undefined,
      primaryIp6: ipv6,
      vcpus,
      memory,
      disk,
      platform,
      description,
      status,
      tags: [`provider/proxmox`, `node/${node}`, `customer/${customer}`, `wave/${wave}`, `role/${role}`],
      tenant: customer,
      site: rng.pick(this.config.sites || ["PRG-DC1"]),
      role,
      raw: {
        vm: {
          name,
          status,
          vcpus,
          memory,
          disk,
          guest: { os: platform },
          tags: { customer, wave, role },
          node,
          vmid,
          interfaces: interfaces.map((intf, idx) => ({
            name: intf.name,
            mac: intf.mac,
            ips: intf.ips,
          })),
        },
      },
    };
  }

  private generateVSphereVm(index: number, rng: SeededRandom): NormalizedVm {
    const isLinux = rng.next() * 100 < (this.config.linux_pct || 70);
    const customer = rng.pick(this.config.tags?.customer || ["Alpha"]);
    const wave = rng.pick(this.config.tags?.wave || ["Wave1"]);
    const role = rng.pick(this.config.tags?.role || ["web"]);
    const datacenter = rng.pick(this.config.sites || ["DC1"]);
    const cluster = rng.pick(this.config.clusters || ["C0"]);
    
    const name = `${customer.toLowerCase()}-${role}-${String(index + 1).padStart(3, "0")}`;
    const powerState = rng.next() > 0.1 ? "poweredOn" : "poweredOff";
    const uuid = this.generateUuid(index, rng);
    
    const interfaces = this.generateInterfaces(rng);
    const ips = this.generateIps(interfaces, rng);
    const guestFullName = isLinux
      ? rng.pick(["Ubuntu Linux (64-bit)", "Red Hat Enterprise Linux 8 (64-bit)", "Debian GNU/Linux 11 (64-bit)"])
      : rng.pick(["Microsoft Windows Server 2019 (64-bit)", "Microsoft Windows Server 2022 (64-bit)"]);

    return {
      externalId: uuid,
      name,
      provider: "vsphere",
      primaryIp4: ips.length > 0 ? ips[0].split("/")[0] : undefined,
      tags: [`customer:${customer}`, `wave:${wave}`, `role:${role}`, `datacenter:${datacenter}`, `cluster:${cluster}`],
      tenant: customer,
      site: datacenter,
      role,
      raw: {
        vm: {
          name,
          power_state: powerState,
          guest_full_name: guestFullName,
          tags: [`customer:${customer}`, `wave:${wave}`, `role:${role}`],
          datacenter,
          cluster,
          instance_uuid: uuid,
          nics: interfaces.map((intf) => ({
            label: intf.name,
            macAddress: intf.mac,
          })),
          guest_ip_addresses: ips,
        },
        custom_attributes: { customer },
      },
    };
  }

  private generateAzureVm(index: number, rng: SeededRandom): NormalizedVm {
    const isLinux = rng.next() * 100 < (this.config.linux_pct || 70);
    const customer = rng.pick(this.config.tags?.customer || ["Alpha"]);
    const wave = rng.pick(this.config.tags?.wave || ["Wave1"]);
    const role = rng.pick(this.config.tags?.role || ["web"]);
    const location = rng.pick(this.config.sites || ["PRG-DC1"]).toLowerCase();
    const resourceGroup = `rg-${customer.toLowerCase()}-prod`;
    
    const name = `${customer.toLowerCase()}-${role}-${String(index + 1).padStart(2, "0")}`;
    const powerState = rng.next() > 0.1 ? "PowerState/running" : "PowerState/stopped";
    const id = `/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/${resourceGroup}/providers/Microsoft.Compute/virtualMachines/${name}`;
    
    const interfaces = this.generateInterfaces(rng);
    const ips = this.generateIps(interfaces, rng);

    return {
      externalId: id,
      name,
      provider: "azure",
      primaryIp4: ips.length > 0 ? ips[0].split("/")[0] : undefined,
      tags: [`customer:${customer}`, `wave:${wave}`, `role:${role}`, `location:${location}`],
      tenant: customer,
      site: location,
      role,
      raw: {
        vm: {
          id,
          name,
          location,
          resourceGroup,
          instanceView: { powerState },
          storageProfile: { osDisk: { osType: isLinux ? "Linux" : "Windows" } },
          tags: { customer, wave, role },
          networkProfile: {
            networkInterfaces: interfaces.map((intf) => ({
              name: `nic-${name}-${intf.name}`,
              macAddress: intf.mac,
            })),
          },
          nicIpConfigs: ips.map((ip) => ({ privateIpAddress: ip })),
        },
      },
    };
  }

  private generateAwsVm(index: number, rng: SeededRandom): NormalizedVm {
    const isLinux = rng.next() * 100 < (this.config.linux_pct || 70);
    const customer = rng.pick(this.config.tags?.customer || ["Alpha"]);
    const wave = rng.pick(this.config.tags?.wave || ["Wave1"]);
    const role = rng.pick(this.config.tags?.role || ["web"]);
    const region = rng.pick(this.config.sites || ["us-east-1"]);
    
    const name = `${customer.toLowerCase()}-${role}-${String(index + 1).padStart(3, "0")}`;
    const instanceId = `i-${this.generateHex(17, rng)}`;
    const state = rng.next() > 0.1 ? "running" : "stopped";
    
    const interfaces = this.generateInterfaces(rng);
    const ips = this.generateIps(interfaces, rng);

    return {
      externalId: instanceId,
      name,
      provider: "aws",
      primaryIp4: ips.length > 0 ? ips[0].split("/")[0] : undefined,
      tags: [`customer:${customer}`, `wave:${wave}`, `role:${role}`, `region:${region}`],
      tenant: customer,
      site: region,
      role,
      raw: {
        instance: {
          InstanceId: instanceId,
          InstanceType: rng.pick(["t3.medium", "t3.large", "m5.large"]),
          State: { Name: state },
          Platform: isLinux ? undefined : "windows",
          Tags: [
            { Key: "Name", Value: name },
            { Key: "customer", Value: customer },
            { Key: "wave", Value: wave },
            { Key: "role", Value: role },
          ],
          NetworkInterfaces: interfaces.map((intf) => ({
            MacAddress: intf.mac,
            PrivateIpAddresses: intf.ips.map((ip) => ({ PrivateIpAddress: ip.split("/")[0] })),
          })),
        },
      },
    };
  }

  private generateInterfaces(rng: SeededRandom): Array<{ name: string; mac: string; ips: string[] }> {
    const nicCount = rng.nextInt(
      this.config.nics_per_vm?.min || 1,
      this.config.nics_per_vm?.max || 1
    );
    
    const interfaces: Array<{ name: string; mac: string; ips: string[] }> = [];
    
    for (let i = 0; i < nicCount; i++) {
      const mac = this.generateMac(rng);
      const ipCount = rng.nextInt(
        this.config.ips_per_nic?.min || 1,
        this.config.ips_per_nic?.max || 1
      );
      
      const ips: string[] = [];
      for (let j = 0; j < ipCount; j++) {
        ips.push(this.generateIp(rng));
      }
      
      interfaces.push({
        name: `net${i}`,
        mac,
        ips,
      });
    }
    
    return interfaces;
  }

  private generateIps(interfaces: Array<{ name: string; mac: string; ips: string[] }>, rng: SeededRandom): string[] {
    const hasMissingIp = rng.next() * 100 < (this.config.missing_ip_pct || 10);
    if (hasMissingIp) {
      return [];
    }
    
    const allIps: string[] = [];
    for (const intf of interfaces) {
      allIps.push(...intf.ips);
    }
    return allIps;
  }

  private generateMac(rng: SeededRandom): string {
    const oui = this.config.variant === "vsphere" ? "00:50:56" : "52:54:00";
    const suffix = Array.from({ length: 3 }, () =>
      rng.nextInt(0, 255).toString(16).padStart(2, "0")
    ).join(":");
    return `${oui}:${suffix}`;
  }

  private generateIp(rng: SeededRandom): string {
    const cidrs = this.config.ipv4_cidrs || ["10.50.0.0/16"];
    const cidr = rng.pick(cidrs);
    const [baseIp, prefixLen] = cidr.split("/");
    const [o1, o2] = baseIp.split(".").map(Number);
    
    const o3 = rng.nextInt(0, 255);
    const o4 = rng.nextInt(1, 254);
    
    return `${o1}.${o2}.${o3}.${o4}/24`;
  }

  private generateIpv6(rng: SeededRandom): string | undefined {
    // 30% chance of having IPv6
    if (rng.next() > 0.3) {
      return undefined;
    }
    
    // Generate a random ULA (Unique Local Address) fd00::/8
    const segments = [
      'fd' + this.generateHex(2, rng),
      this.generateHex(4, rng),
      this.generateHex(4, rng),
      this.generateHex(4, rng),
      '0000',
      '0000',
      '0000',
      this.generateHex(4, rng),
    ];
    
    return segments.join(':');
  }

  private generateUuid(index: number, rng: SeededRandom): string {
    const hex = (n: number) => n.toString(16).padStart(2, "0");
    const parts = [
      this.generateHex(8, rng),
      this.generateHex(4, rng),
      "4" + this.generateHex(3, rng),
      this.generateHex(4, rng),
      this.generateHex(12, rng),
    ];
    return parts.join("-");
  }

  private generateHex(length: number, rng: SeededRandom): string {
    return Array.from({ length }, () => rng.nextInt(0, 15).toString(16)).join("");
  }
}

export function createFakeCollector(config: any): IProviderCollector {
  return new FakeCollector(config as FakeConfig);
}

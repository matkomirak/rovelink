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

// ─── Raw Azure API shapes ────────────────────────────────────────────────────

interface AzureRawVm {
  id: string;
  name: string;
  location: string;
  zones?: string[];
  tags?: Record<string, string>;
  properties?: {
    provisioningState?: string;
    hardwareProfile?: { vmSize?: string };
    storageProfile?: {
      osDisk?: { osType?: string; diskSizeGB?: number; name?: string };
      imageReference?: {
        publisher?: string;
        offer?: string;
        sku?: string;
        exactVersion?: string;
      };
    };
    osProfile?: {
      computerName?: string;
      adminUsername?: string;
    };
    networkProfile?: {
      networkInterfaces?: Array<{ id: string; properties?: { primary?: boolean } }>;
    };
    securityProfile?: {
      securityType?: string;
      uefiSettings?: {
        secureBootEnabled?: boolean;
        vTpmEnabled?: boolean;
      };
    };
    additionalCapabilities?: {
      hibernationEnabled?: boolean;
    };
    availabilitySet?: { id?: string };
    virtualMachineScaleSet?: { id?: string };
    proximityPlacementGroup?: { id?: string };
    capacityReservation?: { capacityReservationGroup?: { id?: string } };
    hostGroup?: { id?: string };
    host?: { id?: string };
    evictionPolicy?: string;
    priority?: string; // Spot / Regular
    diagnosticsProfile?: {
      bootDiagnostics?: { enabled?: boolean };
    };
    storageProfile2?: {
      dataDisks?: any[];
      diskControllerType?: string;
    };
  };
}

interface AzureVmInstanceView {
  statuses?: Array<{ code: string; displayStatus?: string }>;
  vmAgent?: { extensionHandlers?: Array<{ type: string; status?: { displayStatus?: string } }> };
  extensions?: Array<{ name?: string; type?: string }>;
  hyperVGeneration?: string;
  hyperVArchitecture?: string;
}

interface AzureNicRaw {
  id: string;
  name: string;
  location?: string;
  tags?: Record<string, string>;
  properties?: {
    macAddress?: string;
    virtualMachine?: { id?: string };
    ipConfigurations?: Array<{
      name?: string;
      properties?: {
        privateIPAddress?: string;
        privateIPAddressVersion?: string;
        subnet?: { id?: string };
        publicIPAddress?: { id?: string };
        primary?: boolean;
      };
    }>;
  };
}

interface AzurePublicIpRaw {
  id: string;
  name: string;
  location?: string;
  tags?: Record<string, string>;
  properties?: {
    ipAddress?: string;
    publicIPAddressVersion?: string;
    dnsSettings?: { fqdn?: string; domainNameLabel?: string };
    ipConfiguration?: { id?: string };
  };
}

interface AzureVNetRaw {
  id: string;
  name: string;
  location?: string;
  tags?: Record<string, string>;
  properties?: {
    addressSpace?: { addressPrefixes?: string[] };
    subnets?: AzureSubnetRaw[];
  };
}

interface AzureSubnetRaw {
  id: string;
  name: string;
  properties?: {
    addressPrefix?: string;
    addressPrefixes?: string[];
    networkSecurityGroup?: { id?: string };
    routeTable?: { id?: string };
  };
}

// ─── Normalized discovery shapes ─────────────────────────────────────────────

export interface AzureNormalizedVm {
  // Core identity
  id: string;
  name: string;
  location: string;
  resourceGroup: string;
  subscriptionId: string;

  // Power state
  status: "running" | "stopped" | "unknown";

  // OS
  platform?: "linux" | "windows";
  computerName?: string;

  // Hardware
  vmSize?: string;
  vcpus?: number;
  ramGiB?: number;
  disk?: number;

  // Storage
  osDiskName?: string;
  diskControllerType?: string;
  dataDisksCount?: number;
  imagePublisher?: string;
  imageOffer?: string;
  imagePlan?: string;

  // Networking
  primaryIp4?: string;
  primaryIp6?: string;
  nics: AzureNormalizedNic[];
  dnsName?: string;

  // Security
  securityType?: string;
  secureBoot?: boolean;
  vtpm?: boolean;
  integrityMonitoring?: boolean;

  // Availability / placement
  availabilityZone?: string;
  availabilitySet?: string;
  scaleSet?: string;
  proximityPlacementGroup?: string;
  capacityReservationGroup?: string;
  hostGroup?: string;
  host?: string;

  // Spot
  spot?: boolean;
  spotEvictionPolicy?: string;

  // VM generation/arch (from instance view)
  generation?: string;
  architecture?: string;

  // Hibernation
  hibernation?: string;

  // Extensions
  extensions?: string[];

  // Auto-shutdown
  autoShutdown?: string;
  scheduledShutdown?: string;

  // Encryption
  encryptionAtHost?: boolean;
  diskEncryption?: string;
  ephemeralOsDisk?: string;

  // Tags
  tags: Record<string, string>;

  // Raw for debugging
  raw?: any;
}

export interface AzureNormalizedNic {
  id: string;
  name: string;
  resourceGroup: string;
  macAddress?: string;
  vmId?: string;
  vmName?: string;
  privateIps: string[]; // CIDR or plain
  publicIps: string[];
  subnetName?: string;
  virtualNetworkName?: string;
  primary?: boolean;
}

export interface AzureNormalizedPublicIp {
  id: string;
  name: string;
  resourceGroup: string;
  location?: string;
  ipAddress?: string;
  ipVersion?: string;
  fqdn?: string;
  associatedNicId?: string;
  tags?: Record<string, string>;
}

export interface AzureNormalizedVNet {
  id: string;
  name: string;
  resourceGroup: string;
  location?: string;
  addressSpaces: string[];
  subnets: AzureNormalizedSubnet[];
  tags?: Record<string, string>;
}

export interface AzureNormalizedSubnet {
  id: string;
  name: string;
  resourceGroup: string;
  virtualNetworkName: string;
  addressPrefix?: string;
  addressPrefixes?: string[];
}

export interface AzureDiscoveryResult {
  vms: AzureNormalizedVm[];
  nics: AzureNormalizedNic[];
  publicIps: AzureNormalizedPublicIp[];
  vnets: AzureNormalizedVNet[];
  subscriptionId: string;
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function extractResourceGroup(id: string): string {
  const parts = id.split("/");
  const idx = parts.findIndex((p) => p.toLowerCase() === "resourcegroups");
  return idx >= 0 ? parts[idx + 1] : "";
}

function extractLastSegment(id: string): string {
  return id.split("/").pop() || id;
}

const ARM_BASE = "https://management.azure.com";
const VM_API = "2023-03-01";
const NET_API = "2023-05-01";
const PIP_API = "2023-05-01";

// ─── VM size spec shape ───────────────────────────────────────────────────────

interface VmSizeSpec {
  name: string;
  numberOfCores: number;
  memoryInMB: number;
}

// ─── Azure Collector ──────────────────────────────────────────────────────────

export class AzureCollector implements IProviderCollector {
  private config: AzureConfig;
  private accessToken?: string;
  private tokenExpiry?: Date;
  // Cache VM size specs per location (keyed by lower-case location → lower-case size name → spec)
  private vmSizeCache: Map<string, Map<string, VmSizeSpec>> = new Map();

  constructor(config: AzureConfig) {
    this.config = config;
  }

  private async authenticate(): Promise<void> {
    if (this.accessToken && this.tokenExpiry && this.tokenExpiry > new Date()) {
      return;
    }
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
    const expiresIn = response.data.expires_in || 3600;
    this.tokenExpiry = new Date(Date.now() + (expiresIn - 60) * 1000);
  }

  private headers() {
    return { Authorization: `Bearer ${this.accessToken}` };
  }

  private async getAll<T>(url: string): Promise<T[]> {
    type Page = { value: T[]; nextLink?: string };
    const results: T[] = [];
    let nextLink: string | undefined = url;
    while (nextLink) {
      const res: { data: Page } = await axios.get<Page>(nextLink, {
        headers: this.headers(),
      });
      results.push(...(res.data.value || []));
      nextLink = res.data.nextLink;
    }
    return results;
  }

  private async getOne<T>(url: string): Promise<T | null> {
    try {
      const res = await axios.get<T>(url, { headers: this.headers() });
      return res.data;
    } catch {
      return null;
    }
  }

  // ─── IProviderCollector interface ───────────────────────────────────────────

  async testConnection(): Promise<TestConnectionResult> {
    try {
      await this.authenticate();
      const res = await axios.get(
        `${ARM_BASE}/subscriptions/${this.config.subscription_id}?api-version=2022-12-01`,
        { headers: this.headers() }
      );
      const sub = res.data;
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

  /** Basic VM list for the IProviderCollector interface (used by gate, inventory) */
  async listVms(): Promise<NormalizedVm[]> {
    await this.authenticate();
    const rawVms = await this.fetchRawVms();
    const nicMap = await this.fetchNicMap();

    // Pre-fetch VM size specs so vCPU/RAM are populated even in the basic list view
    const uniqueLocations = Array.from(new Set(rawVms.map((v) => v.location).filter(Boolean)));
    const vmSizeMaps = await Promise.all(uniqueLocations.map((loc) => this.fetchVmSizes(loc)));
    const globalSizeMap = new Map<string, VmSizeSpec>();
    for (const sizeMap of vmSizeMaps) {
      sizeMap.forEach((v, k) => globalSizeMap.set(k, v));
    }

    return rawVms.map((vm) => this.toNormalizedVm(vm, nicMap, globalSizeMap));
  }

  /** Full Azure discovery: VMs + networking resources */
  async discoverAll(): Promise<AzureDiscoveryResult> {
    await this.authenticate();

    const [rawVms, rawNics, rawPublicIps, rawVnets] = await Promise.all([
      this.fetchRawVms(),
      this.fetchRawNics(),
      this.fetchRawPublicIps(),
      this.fetchRawVNets(),
    ]);

    // Build public IP map (id → normalized)
    const publicIpMap = new Map<string, AzureNormalizedPublicIp>();
    for (const pip of rawPublicIps) {
      publicIpMap.set(pip.id.toLowerCase(), this.normalizePublicIp(pip));
    }

    // Normalize NICs (resolve public IPs)
    const normalizedNics = rawNics.map((nic) => this.normalizeNic(nic, publicIpMap));
    const nicMap = new Map<string, AzureNormalizedNic>();
    for (const nic of normalizedNics) {
      nicMap.set(nic.id.toLowerCase(), nic);
    }

    // Pre-fetch VM size specs for all unique locations so we know vCPU / RAM per size SKU
    const uniqueLocations = Array.from(new Set(rawVms.map((v) => v.location).filter(Boolean)));
    const vmSizeMaps = await Promise.all(uniqueLocations.map((loc) => this.fetchVmSizes(loc)));
    // Merge all size maps into one (size names are globally unique across locations for same SKU)
    const globalSizeMap = new Map<string, VmSizeSpec>();
    for (const sizeMap of vmSizeMaps) {
      sizeMap.forEach((v, k) => globalSizeMap.set(k, v));
    }

    // Normalize VMs with full details (instance view per VM)
    const normalizedVms = await Promise.all(
      rawVms.map((vm) => this.normalizeVmFull(vm, nicMap, globalSizeMap))
    );

    // Normalize VNets (with subnets already embedded)
    const normalizedVnets = rawVnets.map((vnet) => this.normalizeVNet(vnet));

    return {
      vms: normalizedVms,
      nics: normalizedNics,
      publicIps: Array.from(publicIpMap.values()),
      vnets: normalizedVnets,
      subscriptionId: this.config.subscription_id,
    };
  }

  // ─── Raw fetchers ────────────────────────────────────────────────────────────

  private async fetchRawVms(): Promise<AzureRawVm[]> {
    const rgs = this.config.resource_groups;
    if (rgs && rgs.length > 0) {
      const results: AzureRawVm[] = [];
      for (const rg of rgs) {
        const url = `${ARM_BASE}/subscriptions/${this.config.subscription_id}/resourceGroups/${rg}/providers/Microsoft.Compute/virtualMachines?api-version=${VM_API}`;
        results.push(...await this.getAll<AzureRawVm>(url));
      }
      return results;
    }
    const url = `${ARM_BASE}/subscriptions/${this.config.subscription_id}/providers/Microsoft.Compute/virtualMachines?api-version=${VM_API}`;
    return this.getAll<AzureRawVm>(url);
  }

  private async fetchRawNics(): Promise<AzureNicRaw[]> {
    const url = `${ARM_BASE}/subscriptions/${this.config.subscription_id}/providers/Microsoft.Network/networkInterfaces?api-version=${NET_API}`;
    return this.getAll<AzureNicRaw>(url);
  }

  private async fetchRawPublicIps(): Promise<AzurePublicIpRaw[]> {
    const url = `${ARM_BASE}/subscriptions/${this.config.subscription_id}/providers/Microsoft.Network/publicIPAddresses?api-version=${PIP_API}`;
    return this.getAll<AzurePublicIpRaw>(url);
  }

  private async fetchRawVNets(): Promise<AzureVNetRaw[]> {
    const url = `${ARM_BASE}/subscriptions/${this.config.subscription_id}/providers/Microsoft.Network/virtualNetworks?api-version=${NET_API}`;
    return this.getAll<AzureVNetRaw>(url);
  }

  private async fetchNicMap(): Promise<Map<string, AzureNicRaw>> {
    const nics = await this.fetchRawNics();
    const map = new Map<string, AzureNicRaw>();
    for (const nic of nics) {
      map.set(nic.id.toLowerCase(), nic);
    }
    return map;
  }

  /**
   * Fetch VM size specs for a given location (cached per collector instance).
   * Returns a map keyed by lower-case size name → { numberOfCores, memoryInMB }.
   */
  private async fetchVmSizes(location: string): Promise<Map<string, VmSizeSpec>> {
    const key = location.toLowerCase();
    if (this.vmSizeCache.has(key)) return this.vmSizeCache.get(key)!;

    const url = `${ARM_BASE}/subscriptions/${this.config.subscription_id}/providers/Microsoft.Compute/locations/${location}/vmSizes?api-version=${VM_API}`;
    try {
      await this.authenticate();
      const res = await axios.get<{ value: VmSizeSpec[] }>(url, { headers: this.headers() });
      const sizeMap = new Map<string, VmSizeSpec>();
      for (const spec of res.data.value || []) {
        sizeMap.set(spec.name.toLowerCase(), spec);
      }
      this.vmSizeCache.set(key, sizeMap);
      return sizeMap;
    } catch {
      // If the call fails (e.g. missing permission), return an empty map and continue
      const empty = new Map<string, VmSizeSpec>();
      this.vmSizeCache.set(key, empty);
      return empty;
    }
  }

  // ─── Normalizers ─────────────────────────────────────────────────────────────

  private toNormalizedVm(
    vm: AzureRawVm,
    nicMap: Map<string, AzureNicRaw>,
    sizeMap?: Map<string, VmSizeSpec>
  ): NormalizedVm {
    const rg = extractResourceGroup(vm.id);
    let primaryIp4: string | undefined;
    const nicRefs = vm.properties?.networkProfile?.networkInterfaces || [];
    for (const ref of nicRefs) {
      const nic = nicMap.get(ref.id?.toLowerCase() || "");
      if (nic) {
        const ipCfgs = nic.properties?.ipConfigurations || [];
        for (const cfg of ipCfgs) {
          if (cfg.properties?.privateIPAddress) {
            primaryIp4 = cfg.properties.privateIPAddress;
            break;
          }
        }
        if (primaryIp4) break;
      }
    }
    const osType = vm.properties?.storageProfile?.osDisk?.osType?.toLowerCase();
    const platform = osType === "linux" ? "linux" : osType === "windows" ? "windows" : undefined;
    const tagArr: string[] = [];
    for (const [k, v] of Object.entries(vm.tags || {})) tagArr.push(`${k}:${v}`);

    const vmSize = vm.properties?.hardwareProfile?.vmSize;
    const sizeSpec = vmSize && sizeMap ? sizeMap.get(vmSize.toLowerCase()) : undefined;

    return {
      externalId: vm.id,
      name: vm.name,
      provider: "azure",
      status: "unknown",
      primaryIp4,
      platform,
      vcpus: sizeSpec?.numberOfCores,
      memory: sizeSpec ? sizeSpec.memoryInMB : undefined,
      disk: vm.properties?.storageProfile?.osDisk?.diskSizeGB,
      description: vmSize,
      site: vm.location,
      tags: tagArr,
      raw: vm,
    };
  }

  private async normalizeVmFull(
    vm: AzureRawVm,
    nicMap: Map<string, AzureNormalizedNic>,
    sizeMap?: Map<string, VmSizeSpec>
  ): Promise<AzureNormalizedVm> {
    const rg = extractResourceGroup(vm.id);

    // Instance view (power state, generation, extensions)
    let status: "running" | "stopped" | "unknown" = "unknown";
    let generation: string | undefined;
    let architecture: string | undefined;
    let extensions: string[] = [];

    const iv = await this.getOne<AzureVmInstanceView>(
      `${ARM_BASE}${vm.id}/instanceView?api-version=${VM_API}`
    );
    if (iv) {
      const ps = (iv.statuses || []).find((s) => s.code?.startsWith("PowerState/"));
      if (ps) {
        const code = ps.code.replace("PowerState/", "").toLowerCase();
        status = code === "running" ? "running" : "stopped";
      }
      if (iv.hyperVGeneration) generation = iv.hyperVGeneration;
      if ((iv as any).hyperVArchitecture || (iv as any).architecture) {
        architecture = (iv as any).hyperVArchitecture || (iv as any).architecture;
      }
      extensions = (iv.extensions || []).map((e) => e.type || e.name || "").filter(Boolean);
    }

    // NICs
    const nicRefs = vm.properties?.networkProfile?.networkInterfaces || [];
    const nics: AzureNormalizedNic[] = [];
    let primaryIp4: string | undefined;

    for (const ref of nicRefs) {
      const nic = nicMap.get(ref.id?.toLowerCase() || "");
      if (nic) {
        const nicWithVm = { ...nic, vmId: vm.id, vmName: vm.name };
        nics.push(nicWithVm);
        if (!primaryIp4 && nic.privateIps.length > 0) {
          primaryIp4 = nic.privateIps[0].split("/")[0];
        }
      }
    }

    // OS platform
    const osType = vm.properties?.storageProfile?.osDisk?.osType?.toLowerCase();
    const platform =
      osType === "linux" ? "linux" : osType === "windows" ? "windows" : undefined;

    // Image
    const imgRef = vm.properties?.storageProfile?.imageReference;

    // Disk controller (buried in additionalCapabilities in some versions)
    const storProps = vm.properties as any;

    // Security
    const secProf = vm.properties?.securityProfile;

    // Availability zone
    const zone = vm.zones?.[0];

    // Spot
    const priority = vm.properties?.priority;
    const isSpot = priority?.toLowerCase() === "spot";

    // Helper to get last segment of resource ID
    const idName = (id?: string) => (id ? extractLastSegment(id) : undefined);

    // Look up vCPU and RAM from size catalog
    const vmSize = vm.properties?.hardwareProfile?.vmSize;
    const sizeSpec = vmSize && sizeMap ? sizeMap.get(vmSize.toLowerCase()) : undefined;
    const vcpus = sizeSpec?.numberOfCores;
    const ramGiB = sizeSpec ? Math.round(sizeSpec.memoryInMB / 1024) : undefined;

    return {
      id: vm.id,
      name: vm.name,
      location: vm.location,
      resourceGroup: rg,
      subscriptionId: this.config.subscription_id,
      status,
      platform,
      computerName: vm.properties?.osProfile?.computerName,
      vmSize,
      vcpus,
      ramGiB,
      disk: vm.properties?.storageProfile?.osDisk?.diskSizeGB,
      osDiskName: vm.properties?.storageProfile?.osDisk?.name,
      imagePublisher: imgRef?.publisher,
      imageOffer: imgRef?.offer,
      imagePlan: imgRef?.sku,
      diskControllerType: storProps?.storageProfile?.diskControllerType,
      dataDisksCount: (storProps?.storageProfile?.dataDisks || []).length,
      primaryIp4,
      nics,
      securityType: secProf?.securityType,
      secureBoot: secProf?.uefiSettings?.secureBootEnabled,
      vtpm: secProf?.uefiSettings?.vTpmEnabled,
      availabilityZone: zone,
      availabilitySet: idName(vm.properties?.availabilitySet?.id),
      scaleSet: idName(vm.properties?.virtualMachineScaleSet?.id),
      proximityPlacementGroup: idName(vm.properties?.proximityPlacementGroup?.id),
      capacityReservationGroup: idName(
        vm.properties?.capacityReservation?.capacityReservationGroup?.id
      ),
      hostGroup: idName(vm.properties?.hostGroup?.id),
      host: idName(vm.properties?.host?.id),
      spot: isSpot,
      spotEvictionPolicy: vm.properties?.evictionPolicy,
      generation,
      architecture,
      hibernation: (vm.properties?.additionalCapabilities?.hibernationEnabled)
        ? "Enabled"
        : "Disabled",
      extensions,
      tags: vm.tags || {},
      raw: vm,
    };
  }

  private normalizeNic(
    nic: AzureNicRaw,
    publicIpMap: Map<string, AzureNormalizedPublicIp>
  ): AzureNormalizedNic {
    const rg = extractResourceGroup(nic.id);
    const privateIps: string[] = [];
    const publicIps: string[] = [];
    let subnetName: string | undefined;
    let vnetName: string | undefined;

    for (const cfg of nic.properties?.ipConfigurations || []) {
      const p = cfg.properties;
      if (p?.privateIPAddress) {
        privateIps.push(p.privateIPAddress);
      }
      if (p?.publicIPAddress?.id) {
        const pip = publicIpMap.get(p.publicIPAddress.id.toLowerCase());
        if (pip?.ipAddress) {
          publicIps.push(pip.ipAddress);
        }
      }
      if (p?.subnet?.id) {
        const parts = p.subnet.id.split("/");
        const snIdx = parts.findIndex((x) => x.toLowerCase() === "subnets");
        if (snIdx >= 0) subnetName = parts[snIdx + 1];
        const vnIdx = parts.findIndex((x) => x.toLowerCase() === "virtualnetworks");
        if (vnIdx >= 0) vnetName = parts[vnIdx + 1];
      }
    }

    const vmId = nic.properties?.virtualMachine?.id;

    return {
      id: nic.id,
      name: nic.name,
      resourceGroup: rg,
      macAddress: nic.properties?.macAddress,
      vmId,
      vmName: vmId ? extractLastSegment(vmId) : undefined,
      privateIps,
      publicIps,
      subnetName,
      virtualNetworkName: vnetName,
    };
  }

  private normalizePublicIp(pip: AzurePublicIpRaw): AzureNormalizedPublicIp {
    const rg = extractResourceGroup(pip.id);
    return {
      id: pip.id,
      name: pip.name,
      resourceGroup: rg,
      location: pip.location,
      ipAddress: pip.properties?.ipAddress,
      ipVersion: pip.properties?.publicIPAddressVersion,
      fqdn: pip.properties?.dnsSettings?.fqdn,
      associatedNicId: pip.properties?.ipConfiguration?.id
        ? pip.properties.ipConfiguration.id.split("/ipConfigurations/")[0]
        : undefined,
      tags: pip.tags,
    };
  }

  private normalizeVNet(vnet: AzureVNetRaw): AzureNormalizedVNet {
    const rg = extractResourceGroup(vnet.id);
    const subnets: AzureNormalizedSubnet[] = (
      vnet.properties?.subnets || []
    ).map((sn) => ({
      id: sn.id,
      name: sn.name,
      resourceGroup: rg,
      virtualNetworkName: vnet.name,
      addressPrefix: sn.properties?.addressPrefix,
      addressPrefixes: sn.properties?.addressPrefixes,
    }));

    return {
      id: vnet.id,
      name: vnet.name,
      resourceGroup: rg,
      location: vnet.location,
      addressSpaces: vnet.properties?.addressSpace?.addressPrefixes || [],
      subnets,
      tags: vnet.tags,
    };
  }

  /** Object types this provider supports for discovery */
  getObjectTypes(): string[] {
    return ["Vm", "VirtualNetwork", "Subnet", "NetworkInterface", "PublicIp"];
  }

  /** Get samples of a specific object type */
  async getSamples(objectType: string, limit: number = 20): Promise<any[]> {
    // Returns static samples (used for pipeline mapping preview without real credentials)
    const { getSamples } = await import("../sample-fixtures");
    return getSamples("azure", objectType, limit).map((s) => s.normalized);
  }
}

export function createAzureCollector(config: AzureConfig): AzureCollector {
  return new AzureCollector(config);
}

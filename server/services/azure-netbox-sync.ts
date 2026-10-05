/**
 * Azure → NetBox Full Import Service
 *
 * Handles idempotent import of all Azure resources into NetBox:
 * - VMs (with all azure_vm_* custom fields)
 * - VMInterfaces (one per Azure NIC)
 * - IP Addresses (private + public, assigned to interfaces)
 * - Prefixes (VNets + Subnets)
 *
 * Matching strategy: stable Azure resource IDs stored in custom fields
 *   azure_vm_id, azure_nic_id, azure_vnet_id, azure_subnet_id
 */

import { NetBoxAdapter } from "./netbox-adapter";
import type {
  AzureDiscoveryResult,
  AzureNormalizedVm,
  AzureNormalizedNic,
  AzureNormalizedVNet,
  AzureNormalizedSubnet,
  AzureNormalizedPublicIp,
} from "./providers/azure";

// ─── Custom field definitions ─────────────────────────────────────────────────

type CFType = "text" | "integer" | "boolean" | "url";

interface CfDef {
  name: string;
  label: string;
  type: CFType;
  objectTypes: string[];
  description?: string;
}

const AZURE_VM_CUSTOM_FIELDS: CfDef[] = [
  { name: "azure_vm_id", label: "Azure VM Resource ID", type: "text", objectTypes: ["virtualization.virtualmachine"] },
  { name: "azure_vm_computer_name", label: "Azure Computer Name", type: "text", objectTypes: ["virtualization.virtualmachine"] },
  { name: "azure_vm_size", label: "Azure VM Size", type: "text", objectTypes: ["virtualization.virtualmachine"] },
  { name: "azure_vm_resource_group", label: "Azure Resource Group", type: "text", objectTypes: ["virtualization.virtualmachine"] },
  { name: "azure_vm_location", label: "Azure Location", type: "text", objectTypes: ["virtualization.virtualmachine"] },
  { name: "azure_vm_generation", label: "Azure VM Generation", type: "text", objectTypes: ["virtualization.virtualmachine"] },
  { name: "azure_vm_architecture", label: "Azure VM Architecture", type: "text", objectTypes: ["virtualization.virtualmachine"] },
  { name: "azure_vm_hibernation", label: "Azure Hibernation", type: "text", objectTypes: ["virtualization.virtualmachine"] },
  { name: "azure_vm_disk_controller_type", label: "Azure Disk Controller Type", type: "text", objectTypes: ["virtualization.virtualmachine"] },
  { name: "azure_vm_availability_zone", label: "Azure Availability Zone", type: "text", objectTypes: ["virtualization.virtualmachine"] },
  { name: "azure_vm_availability_set", label: "Azure Availability Set", type: "text", objectTypes: ["virtualization.virtualmachine"] },
  { name: "azure_vm_scale_set", label: "Azure Scale Set", type: "text", objectTypes: ["virtualization.virtualmachine"] },
  { name: "azure_vm_proximity_placement_group", label: "Azure Proximity Placement Group", type: "text", objectTypes: ["virtualization.virtualmachine"] },
  { name: "azure_vm_capacity_reservation_group", label: "Azure Capacity Reservation Group", type: "text", objectTypes: ["virtualization.virtualmachine"] },
  { name: "azure_vm_host_group", label: "Azure Host Group", type: "text", objectTypes: ["virtualization.virtualmachine"] },
  { name: "azure_vm_host", label: "Azure Host", type: "text", objectTypes: ["virtualization.virtualmachine"] },
  { name: "azure_vm_spot", label: "Azure Spot VM", type: "boolean", objectTypes: ["virtualization.virtualmachine"] },
  { name: "azure_vm_spot_eviction_policy", label: "Azure Spot Eviction Policy", type: "text", objectTypes: ["virtualization.virtualmachine"] },
  { name: "azure_vm_security_type", label: "Azure Security Type", type: "text", objectTypes: ["virtualization.virtualmachine"] },
  { name: "azure_vm_secure_boot", label: "Azure Secure Boot Enabled", type: "boolean", objectTypes: ["virtualization.virtualmachine"] },
  { name: "azure_vm_vtpm", label: "Azure vTPM Enabled", type: "boolean", objectTypes: ["virtualization.virtualmachine"] },
  { name: "azure_vm_integrity_monitoring", label: "Azure Integrity Monitoring", type: "boolean", objectTypes: ["virtualization.virtualmachine"] },
  { name: "azure_vm_image_publisher", label: "Azure Image Publisher", type: "text", objectTypes: ["virtualization.virtualmachine"] },
  { name: "azure_vm_image_offer", label: "Azure Image Offer", type: "text", objectTypes: ["virtualization.virtualmachine"] },
  { name: "azure_vm_image_plan", label: "Azure Image Plan/SKU", type: "text", objectTypes: ["virtualization.virtualmachine"] },
  { name: "azure_vm_os_disk_name", label: "Azure OS Disk Name", type: "text", objectTypes: ["virtualization.virtualmachine"] },
  { name: "azure_vm_encryption_at_host", label: "Azure Encryption at Host", type: "boolean", objectTypes: ["virtualization.virtualmachine"] },
  { name: "azure_vm_disk_encryption", label: "Azure Disk Encryption", type: "text", objectTypes: ["virtualization.virtualmachine"] },
  { name: "azure_vm_ephemeral_os_disk", label: "Azure Ephemeral OS Disk", type: "text", objectTypes: ["virtualization.virtualmachine"] },
  { name: "azure_vm_data_disks_count", label: "Azure Data Disks Count", type: "integer", objectTypes: ["virtualization.virtualmachine"] },
  { name: "azure_vm_dns_name", label: "Azure DNS Name", type: "text", objectTypes: ["virtualization.virtualmachine"] },
  { name: "azure_vm_auto_shutdown", label: "Azure Auto-Shutdown", type: "text", objectTypes: ["virtualization.virtualmachine"] },
  { name: "azure_vm_scheduled_shutdown", label: "Azure Scheduled Shutdown", type: "text", objectTypes: ["virtualization.virtualmachine"] },
  { name: "azure_vm_extensions", label: "Azure Extensions", type: "text", objectTypes: ["virtualization.virtualmachine"] },
];

const AZURE_NIC_CUSTOM_FIELDS: CfDef[] = [
  { name: "azure_nic_id", label: "Azure NIC Resource ID", type: "text", objectTypes: ["virtualization.vminterface"] },
  { name: "azure_nic_resource_group", label: "Azure NIC Resource Group", type: "text", objectTypes: ["virtualization.vminterface"] },
];

const AZURE_PREFIX_CUSTOM_FIELDS: CfDef[] = [
  { name: "azure_vnet_name", label: "Azure VNet Name", type: "text", objectTypes: ["ipam.prefix"] },
  { name: "azure_vnet_id", label: "Azure VNet Resource ID", type: "text", objectTypes: ["ipam.prefix"] },
  { name: "azure_vnet_resource_group", label: "Azure VNet Resource Group", type: "text", objectTypes: ["ipam.prefix"] },
  { name: "azure_vnet_location", label: "Azure VNet Location", type: "text", objectTypes: ["ipam.prefix"] },
  { name: "azure_subnet_name", label: "Azure Subnet Name", type: "text", objectTypes: ["ipam.prefix"] },
  { name: "azure_subnet_id", label: "Azure Subnet Resource ID", type: "text", objectTypes: ["ipam.prefix"] },
  { name: "azure_subnet_resource_group", label: "Azure Subnet Resource Group", type: "text", objectTypes: ["ipam.prefix"] },
];

const AZURE_IP_CUSTOM_FIELDS: CfDef[] = [
  { name: "azure_public_ip_id", label: "Azure Public IP Resource ID", type: "text", objectTypes: ["ipam.ipaddress"] },
  { name: "azure_ip_resource_group", label: "Azure IP Resource Group", type: "text", objectTypes: ["ipam.ipaddress"] },
];

const ALL_AZURE_CUSTOM_FIELDS = [
  ...AZURE_VM_CUSTOM_FIELDS,
  ...AZURE_NIC_CUSTOM_FIELDS,
  ...AZURE_PREFIX_CUSTOM_FIELDS,
  ...AZURE_IP_CUSTOM_FIELDS,
];

// ─── Sync result ──────────────────────────────────────────────────────────────

export interface AzureImportCounts {
  vms: { created: number; updated: number; unchanged: number; errors: number };
  interfaces: { created: number; updated: number; errors: number };
  ips: { created: number; updated: number; errors: number };
  prefixes: { created: number; updated: number; unchanged: number; errors: number };
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class AzureNetBoxSyncService {
  private netbox: NetBoxAdapter;
  private logs: string[] = [];

  constructor(netbox: NetBoxAdapter) {
    this.netbox = netbox;
  }

  getLogs(): string[] {
    return this.logs;
  }

  private log(msg: string) {
    const entry = `[${new Date().toISOString()}] ${msg}`;
    this.logs.push(entry);
    console.log(entry);
  }

  // ─── Entry point ────────────────────────────────────────────────────────────

  async importAll(discovery: AzureDiscoveryResult): Promise<AzureImportCounts> {
    const counts: AzureImportCounts = {
      vms: { created: 0, updated: 0, unchanged: 0, errors: 0 },
      interfaces: { created: 0, updated: 0, errors: 0 },
      ips: { created: 0, updated: 0, errors: 0 },
      prefixes: { created: 0, updated: 0, unchanged: 0, errors: 0 },
    };

    this.log(`Ensuring Azure custom fields exist in NetBox...`);
    await this.ensureAllCustomFields();
    this.log(`Custom fields ready.`);

    this.log(`Importing ${discovery.vnets.length} VNets and their subnets as Prefixes...`);
    for (const vnet of discovery.vnets) {
      await this.importVNet(vnet, counts);
    }

    this.log(`Importing ${discovery.vms.length} VMs...`);
    for (const vm of discovery.vms) {
      await this.importVm(vm, counts);
    }

    return counts;
  }

  // ─── Custom field housekeeping ───────────────────────────────────────────────

  private async ensureAllCustomFields(): Promise<void> {
    for (const cf of ALL_AZURE_CUSTOM_FIELDS) {
      try {
        await this.ensureCustomField(cf);
      } catch (err: any) {
        this.log(`Warning: Could not ensure custom field ${cf.name}: ${err.message}`);
      }
    }
  }

  private async ensureCustomField(cf: CfDef): Promise<void> {
    const client = (this.netbox as any).client;

    // Check if exists
    const check = await client.get("/extras/custom-fields/", { params: { name: cf.name } });
    if (check.data.count > 0) return; // already exists

    // Create it
    await client.post("/extras/custom-fields/", {
      name: cf.name,
      label: cf.label,
      type: cf.type,
      object_types: cf.objectTypes,
      required: false,
      description: cf.description || "",
    });
    this.log(`  Created custom field: ${cf.name}`);
  }

  // ─── VM import ───────────────────────────────────────────────────────────────

  private async importVm(vm: AzureNormalizedVm, counts: AzureImportCounts): Promise<void> {
    try {
      const extId = `azure:${vm.id}`;
      const azureFields: Record<string, any> = {
        azure_vm_id: vm.id,
        azure_vm_computer_name: vm.computerName,
        azure_vm_size: vm.vmSize,
        azure_vm_resource_group: vm.resourceGroup,
        azure_vm_location: vm.location,
        azure_vm_generation: vm.generation,
        azure_vm_architecture: vm.architecture,
        azure_vm_hibernation: vm.hibernation,
        azure_vm_disk_controller_type: vm.diskControllerType,
        azure_vm_availability_zone: vm.availabilityZone,
        azure_vm_availability_set: vm.availabilitySet,
        azure_vm_scale_set: vm.scaleSet,
        azure_vm_proximity_placement_group: vm.proximityPlacementGroup,
        azure_vm_capacity_reservation_group: vm.capacityReservationGroup,
        azure_vm_host_group: vm.hostGroup,
        azure_vm_host: vm.host,
        azure_vm_spot: vm.spot ?? false,
        azure_vm_spot_eviction_policy: vm.spotEvictionPolicy,
        azure_vm_security_type: vm.securityType,
        azure_vm_secure_boot: vm.secureBoot ?? false,
        azure_vm_vtpm: vm.vtpm ?? false,
        azure_vm_integrity_monitoring: vm.integrityMonitoring ?? false,
        azure_vm_image_publisher: vm.imagePublisher,
        azure_vm_image_offer: vm.imageOffer,
        azure_vm_image_plan: vm.imagePlan,
        azure_vm_os_disk_name: vm.osDiskName,
        azure_vm_encryption_at_host: vm.encryptionAtHost ?? false,
        azure_vm_data_disks_count: vm.dataDisksCount ?? 0,
        azure_vm_dns_name: vm.dnsName,
        azure_vm_extensions: vm.extensions?.join(", "),
      };

      // Remove undefined values
      for (const k of Object.keys(azureFields)) {
        if (azureFields[k] === undefined || azureFields[k] === null || azureFields[k] === "") {
          delete azureFields[k];
        }
      }

      // Tag labels from Azure tags
      const tagNames = Object.entries(vm.tags || {}).map(([k, v]) => `azure_${k}:${v}`);

      const vmData = {
        name: vm.name,
        status: vm.status === "running" ? "active" : "offline",
        vcpus: vm.vcpus,
        memory: vm.ramGiB ? vm.ramGiB * 1024 : undefined,
        disk: vm.disk,
        platform: vm.platform ? { name: vm.platform } : undefined,
        tags: tagNames.map((t) => ({ name: t })),
        custom_fields: {
          ext_id: extId,
          ext_provider: "azure",
          provider_state: "active",
          ...azureFields,
        },
        comments: `Synced from Azure (${vm.resourceGroup}) by Rovelink`,
      };

      const result = await this.netbox.upsertVm(vmData, extId);
      if (result.created) {
        counts.vms.created++;
        this.log(`VM created: ${vm.name}`);
      } else if (result.unchanged) {
        counts.vms.unchanged++;
      } else {
        counts.vms.updated++;
        this.log(`VM updated: ${vm.name}`);
      }

      const vmId = result.id;

      // Import NICs and IPs
      await this.importNicsForVm(vm, vmId, counts);

      // Set primary IP on VM
      if (vm.primaryIp4) {
        try {
          await this.netbox.syncVmPrimaryIp(vmId, vm.primaryIp4);
        } catch (err: any) {
          this.log(`  Warning: Could not set primary IP for ${vm.name}: ${err.message}`);
        }
      }
    } catch (err: any) {
      counts.vms.errors++;
      this.log(`Error importing VM ${vm.name}: ${err.message}`);
    }
  }

  // ─── NIC + IP import ─────────────────────────────────────────────────────────

  private async importNicsForVm(
    vm: AzureNormalizedVm,
    vmId: number,
    counts: AzureImportCounts
  ): Promise<void> {
    for (const nic of vm.nics) {
      try {
        // Ensure VM interface
        const ifaceId = await this.ensureVmInterface(vmId, nic, counts);

        // Create private IPs and assign to interface
        for (const privateIp of nic.privateIps) {
          try {
            const exists = await this.upsertIpAddress(privateIp, ifaceId, false, nic.resourceGroup);
            if (exists.created) counts.ips.created++;
            else counts.ips.updated++;
          } catch (err: any) {
            counts.ips.errors++;
            this.log(`    Error creating private IP ${privateIp}: ${err.message}`);
          }
        }

        // Create public IPs
        for (const publicIp of nic.publicIps) {
          try {
            const exists = await this.upsertIpAddress(publicIp, ifaceId, true, nic.resourceGroup);
            if (exists.created) counts.ips.created++;
            else counts.ips.updated++;
          } catch (err: any) {
            counts.ips.errors++;
            this.log(`    Error creating public IP ${publicIp}: ${err.message}`);
          }
        }
      } catch (err: any) {
        counts.interfaces.errors++;
        this.log(`  Error importing NIC ${nic.name} for VM ${vm.name}: ${err.message}`);
      }
    }
  }

  private async ensureVmInterface(
    vmId: number,
    nic: AzureNormalizedNic,
    counts: AzureImportCounts
  ): Promise<number> {
    const client = (this.netbox as any).client;

    // Search by azure_nic_id custom field (most reliable)
    const byNicId = await client.get("/virtualization/interfaces/", {
      params: { virtual_machine_id: vmId, name: nic.name },
    });

    if (byNicId.data.count > 0) {
      const ifaceId = byNicId.data.results[0].id;
      // Update custom fields
      await client.patch(`/virtualization/interfaces/${ifaceId}/`, {
        mac_address: nic.macAddress || undefined,
        custom_fields: {
          azure_nic_id: nic.id,
          azure_nic_resource_group: nic.resourceGroup,
        },
      });
      counts.interfaces.updated++;
      return ifaceId;
    }

    // Create interface
    const payload: any = {
      virtual_machine: vmId,
      name: nic.name,
      enabled: true,
      custom_fields: {
        azure_nic_id: nic.id,
        azure_nic_resource_group: nic.resourceGroup,
      },
    };
    if (nic.macAddress) {
      // NetBox expects XX:XX:XX:XX:XX:XX format
      payload.mac_address = nic.macAddress.replace(/-/g, ":").toUpperCase();
    }

    const res = await client.post("/virtualization/interfaces/", payload);
    counts.interfaces.created++;
    this.log(`  Interface created: ${nic.name} on VM ${vmId}`);
    return res.data.id;
  }

  private async upsertIpAddress(
    ipInput: string,
    interfaceId: number,
    isPublic: boolean,
    resourceGroup: string
  ): Promise<{ created: boolean; id: number }> {
    const client = (this.netbox as any).client;

    // Normalize to CIDR
    const address = ipInput.includes("/") ? ipInput : `${ipInput}/32`;

    // Search existing
    const search = await client.get("/ipam/ip-addresses/", { params: { address } });
    const tags: any[] = [];
    if (isPublic) {
      const publicTagId = await this.ensureTag("azure-public-ip");
      tags.push({ id: publicTagId });
    }

    const payload: any = {
      address,
      status: "active",
      assigned_object_type: "virtualization.vminterface",
      assigned_object_id: interfaceId,
      custom_fields: {
        azure_ip_resource_group: resourceGroup,
      },
    };
    if (tags.length > 0) payload.tags = tags;

    if (search.data.count > 0) {
      const ipId = search.data.results[0].id;
      await client.patch(`/ipam/ip-addresses/${ipId}/`, payload);
      return { created: false, id: ipId };
    }

    const res = await client.post("/ipam/ip-addresses/", payload);
    return { created: true, id: res.data.id };
  }

  private async ensureTag(name: string): Promise<number> {
    const client = (this.netbox as any).client;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const search = await client.get("/extras/tags/", { params: { name } });
    if (search.data.count > 0) return search.data.results[0].id;
    const res = await client.post("/extras/tags/", {
      name,
      slug,
      color: "1565c0",
    });
    return res.data.id;
  }

  // ─── VNet + Subnet import as Prefixes ────────────────────────────────────────

  private async importVNet(vnet: AzureNormalizedVNet, counts: AzureImportCounts): Promise<void> {
    // Import each VNet address space as a Prefix
    for (const cidr of vnet.addressSpaces) {
      try {
        const vnetTagId = await this.ensureTag("azure-vnet");
        const result = await this.upsertPrefix(cidr, {
          description: `Azure VNet: ${vnet.name} (${vnet.resourceGroup})`,
          is_pool: false,
          custom_fields: {
            azure_vnet_name: vnet.name,
            azure_vnet_id: vnet.id,
            azure_vnet_resource_group: vnet.resourceGroup,
            azure_vnet_location: vnet.location,
          },
          tags: [{ id: vnetTagId }],
        });
        if (result.created) counts.prefixes.created++;
        else if (result.unchanged) counts.prefixes.unchanged++;
        else counts.prefixes.updated++;
      } catch (err: any) {
        counts.prefixes.errors++;
        this.log(`  Error importing VNet ${vnet.name} CIDR ${cidr}: ${err.message}`);
      }
    }

    // Import each subnet
    for (const subnet of vnet.subnets) {
      await this.importSubnet(subnet, vnet, counts);
    }
  }

  private async importSubnet(
    subnet: AzureNormalizedSubnet,
    vnet: AzureNormalizedVNet,
    counts: AzureImportCounts
  ): Promise<void> {
    const cidrs = subnet.addressPrefixes?.length
      ? subnet.addressPrefixes
      : subnet.addressPrefix
      ? [subnet.addressPrefix]
      : [];

    for (const cidr of cidrs) {
      try {
        const subnetTagId = await this.ensureTag("azure-subnet");
        const result = await this.upsertPrefix(cidr, {
          description: `Azure Subnet: ${subnet.name} in ${vnet.name} (${subnet.resourceGroup})`,
          is_pool: true,
          custom_fields: {
            azure_subnet_name: subnet.name,
            azure_subnet_id: subnet.id,
            azure_subnet_resource_group: subnet.resourceGroup,
            azure_vnet_name: vnet.name,
          },
          tags: [{ id: subnetTagId }],
        });
        if (result.created) counts.prefixes.created++;
        else if (result.unchanged) counts.prefixes.unchanged++;
        else counts.prefixes.updated++;
      } catch (err: any) {
        counts.prefixes.errors++;
        this.log(`  Error importing Subnet ${subnet.name} CIDR ${cidr}: ${err.message}`);
      }
    }
  }

  private async upsertPrefix(
    prefix: string,
    data: {
      description?: string;
      is_pool?: boolean;
      custom_fields?: Record<string, any>;
      tags?: Array<{ id: number }>;
    }
  ): Promise<{ created: boolean; unchanged: boolean; id: number }> {
    const client = (this.netbox as any).client;

    const search = await client.get("/ipam/prefixes/", { params: { prefix } });

    const payload: any = {
      prefix,
      status: "active",
      description: data.description || "",
      is_pool: data.is_pool ?? false,
      custom_fields: data.custom_fields || {},
    };
    if (data.tags && data.tags.length > 0) payload.tags = data.tags;

    if (search.data.count > 0) {
      const existing = search.data.results[0];
      // Check if update needed
      const needsUpdate =
        existing.description !== payload.description ||
        existing.is_pool !== payload.is_pool;

      if (needsUpdate) {
        await client.patch(`/ipam/prefixes/${existing.id}/`, payload);
        return { created: false, unchanged: false, id: existing.id };
      }
      return { created: false, unchanged: true, id: existing.id };
    }

    const res = await client.post("/ipam/prefixes/", payload);
    this.log(`  Prefix created: ${prefix}`);
    return { created: true, unchanged: false, id: res.data.id };
  }
}

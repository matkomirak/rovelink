/**
 * Preset RTC (Rules, Transforms, Conflicts) for BDP mappings
 * These are pre-configured transformation rules for common provider → CMDB mappings
 */

import { MappingRules } from './rules-engine';

export interface PresetRule {
  id: string;
  label: string;
  sourceProvider: string;
  sourceType: string;
  targetCmdb: string;
  targetType: string;
  rules: MappingRules;
}

// RTC #1: Proxmox.Vm → NetBox.VirtualMachine
const proxmoxToNetboxVm: PresetRule = {
  id: "proxmox→netbox.vm",
  label: "Proxmox.Vm → NetBox.VirtualMachine",
  sourceProvider: "proxmox",
  sourceType: "Vm",
  targetCmdb: "netbox",
  targetType: "VirtualMachine",
  rules: {
    target: "NetBox.VirtualMachine",
    matchBy: ["custom_fields.ext_id"],
    fields: [
      {
        source: "externalId",
        target: "custom_fields.ext_id",
        required: true,
        conflictPolicy: "provider-wins"
      },
      {
        source: "provider",
        target: "custom_fields.ext_provider",
        transforms: [{ type: "lower" }],
        defaultValue: "proxmox",
        conflictPolicy: "provider-wins"
      },
      {
        source: "name",
        target: "name",
        required: true,
        transforms: [{ type: "strip" }],
        conflictPolicy: "provider-wins"
      },
      {
        source: "status",
        target: "status",
        transforms: [{
          type: "map",
          params: {
            mapping: {
              "running": "active",
              "stopped": "offline",
              "paused": "suspended"
            },
            default: "offline"
          }
        }],
        conflictPolicy: "provider-wins"
      },
      {
        source: "cores",
        target: "vcpus",
        conflictPolicy: "provider-wins"
      },
      {
        source: "memory",
        target: "memory",
        transforms: [{
          type: "map",
          params: {
            // Convert MB to GB if needed - Proxmox returns MB
            default: null
          }
        }],
        conflictPolicy: "provider-wins"
      },
      {
        source: "guest.os",
        target: "platform",
        transforms: [
          { type: "lower" },
          {
            type: "regex_extract",
            params: {
              pattern: "(ubuntu|debian|centos|rhel|windows|linux)",
              group: 1,
              default: "linux"
            }
          }
        ],
        conflictPolicy: "provider-wins"
      },
      {
        source: "primaryIp4",
        target: "primary_ip4",
        conflictPolicy: "cmdb-wins" // Respect manual IP assignments
      },
      {
        source: "tags",
        target: "tags",
        conflictPolicy: "merge"
      },
      {
        source: "customFields.patch_wave",
        target: "custom_fields.patch_wave",
        conflictPolicy: "provider-wins"
      },
      {
        source: "customFields.customer",
        target: "tenant",
        conflictPolicy: "cmdb-wins" // Tenant assignment may be manual
      },
      {
        source: "customFields.role",
        target: "role",
        conflictPolicy: "provider-wins"
      }
    ],
    children: [
      {
        sourceType: "Interface",
        targetType: "VMInterface",
        sourcePath: "interfaces",
        targetPath: "interfaces",
        rules: {
          target: "NetBox.VMInterface",
          matchBy: ["mac_address"],
          fields: [
            {
              source: "name",
              target: "name",
              required: true
            },
            {
              source: "mac",
              target: "mac_address",
              transforms: [{ type: "upper" }],
              conflictPolicy: "provider-wins"
            },
            {
              source: "ips",
              target: "ip_addresses",
              transforms: [{ type: "pick_primary_ipv4" }],
              conflictPolicy: "merge"
            }
          ]
        }
      }
    ],
    conflicts: {
      defaultPolicy: "provider-wins",
      fieldPolicies: {
        "primary_ip4": "cmdb-wins",
        "tenant": "cmdb-wins",
        "tags": "merge"
      }
    }
  }
};

// RTC #2: vCenter.VM → NetBox.VirtualMachine
const vcenterToNetboxVm: PresetRule = {
  id: "vc→netbox.vm",
  label: "vCenter.VM → NetBox.VirtualMachine",
  sourceProvider: "vmware",
  sourceType: "VM",
  targetCmdb: "netbox",
  targetType: "VirtualMachine",
  rules: {
    target: "NetBox.VirtualMachine",
    matchBy: ["custom_fields.ext_id"],
    fields: [
      {
        source: "externalId",
        target: "custom_fields.ext_id",
        required: true,
        conflictPolicy: "provider-wins"
      },
      {
        source: "provider",
        target: "custom_fields.ext_provider",
        defaultValue: "vmware",
        conflictPolicy: "provider-wins"
      },
      {
        source: "name",
        target: "name",
        required: true,
        transforms: [{ type: "strip" }],
        conflictPolicy: "provider-wins"
      },
      {
        source: "status",
        target: "status",
        transforms: [{
          type: "map",
          params: {
            mapping: {
              "poweredOn": "active",
              "poweredOff": "offline",
              "suspended": "suspended"
            },
            default: "offline"
          }
        }],
        conflictPolicy: "provider-wins"
      },
      {
        source: "cores",
        target: "vcpus",
        conflictPolicy: "provider-wins"
      },
      {
        source: "memory",
        target: "memory",
        conflictPolicy: "provider-wins"
      },
      {
        source: "guestFamily",
        target: "platform",
        transforms: [{
          type: "map",
          params: {
            mapping: {
              "linuxGuest": "linux",
              "windowsGuest": "windows",
              "otherGuest": "other"
            },
            default: "linux"
          }
        }],
        conflictPolicy: "provider-wins"
      },
      {
        source: "primaryIp4",
        target: "primary_ip4",
        conflictPolicy: "cmdb-wins"
      },
      {
        source: "tags",
        target: "tags",
        conflictPolicy: "merge"
      },
      {
        source: "customAttributes.Patch Wave",
        target: "custom_fields.patch_wave",
        conflictPolicy: "provider-wins"
      },
      {
        source: "customAttributes.Customer",
        target: "tenant",
        conflictPolicy: "cmdb-wins"
      },
      {
        source: "cluster",
        target: "cluster",
        conflictPolicy: "provider-wins"
      }
    ],
    conflicts: {
      defaultPolicy: "provider-wins",
      fieldPolicies: {
        "primary_ip4": "cmdb-wins",
        "tenant": "cmdb-wins",
        "tags": "merge"
      }
    }
  }
};

// RTC #3: Azure.Compute.VirtualMachine → NetBox.VirtualMachine
const azureToNetboxVm: PresetRule = {
  id: "azure→netbox.vm",
  label: "Azure.VM → NetBox.VirtualMachine",
  sourceProvider: "azure",
  sourceType: "Compute.VirtualMachine",
  targetCmdb: "netbox",
  targetType: "VirtualMachine",
  rules: {
    target: "NetBox.VirtualMachine",
    matchBy: ["custom_fields.ext_id"],
    fields: [
      {
        source: "externalId",
        target: "custom_fields.ext_id",
        required: true,
        conflictPolicy: "provider-wins"
      },
      {
        source: "provider",
        target: "custom_fields.ext_provider",
        defaultValue: "azure",
        conflictPolicy: "provider-wins"
      },
      {
        source: "name",
        target: "name",
        required: true,
        transforms: [{ type: "strip" }],
        conflictPolicy: "provider-wins"
      },
      {
        source: "status",
        target: "status",
        transforms: [{
          type: "map",
          params: {
            mapping: {
              "running": "active",
              "stopped": "offline",
              "deallocated": "offline"
            },
            default: "offline"
          }
        }],
        conflictPolicy: "provider-wins"
      },
      {
        source: "cores",
        target: "vcpus",
        conflictPolicy: "provider-wins"
      },
      {
        source: "memory",
        target: "memory",
        conflictPolicy: "provider-wins"
      },
      {
        source: "osProfile.osType",
        target: "platform",
        transforms: [{ type: "lower" }],
        conflictPolicy: "provider-wins"
      },
      {
        source: "primaryIp4",
        target: "primary_ip4",
        conflictPolicy: "cmdb-wins"
      },
      {
        source: "tags",
        target: "tags",
        conflictPolicy: "merge"
      },
      {
        source: "tags.patch-wave",
        target: "custom_fields.patch_wave",
        conflictPolicy: "provider-wins"
      },
      {
        source: "tags.customer",
        target: "tenant",
        conflictPolicy: "cmdb-wins"
      },
      {
        source: "location",
        target: "site",
        conflictPolicy: "provider-wins"
      },
      {
        source: "resourceGroup",
        target: "custom_fields.resource_group",
        conflictPolicy: "provider-wins"
      }
    ],
    conflicts: {
      defaultPolicy: "provider-wins",
      fieldPolicies: {
        "primary_ip4": "cmdb-wins",
        "tenant": "cmdb-wins",
        "tags": "merge"
      }
    }
  }
};

// RTC #4: Proxmox.Vm → i-doit.Virtual Server
const proxmoxToIdoitVserver: PresetRule = {
  id: "proxmox→idoit.vserver",
  label: "Proxmox.Vm → i-doit.Virtual Server",
  sourceProvider: "proxmox",
  sourceType: "Vm",
  targetCmdb: "idoit",
  targetType: "VirtualServer",
  rules: {
    target: "i-doit.VirtualServer",
    matchBy: ["ext_id"],
    fields: [
      {
        source: "externalId",
        target: "ext_id",
        required: true,
        conflictPolicy: "provider-wins"
      },
      {
        source: "name",
        target: "name",
        required: true,
        transforms: [{ type: "strip" }],
        conflictPolicy: "provider-wins"
      },
      {
        source: "cores",
        target: "cpu_cores",
        conflictPolicy: "provider-wins"
      },
      {
        source: "memory",
        target: "memory",
        conflictPolicy: "provider-wins"
      },
      {
        source: "guest.os",
        target: "operating_system",
        transforms: [{ type: "title" }],
        conflictPolicy: "provider-wins"
      },
      {
        source: "status",
        target: "status",
        transforms: [{
          type: "map",
          params: {
            mapping: {
              "running": "In operation",
              "stopped": "Shutdown",
              "paused": "Paused"
            },
            default: "Shutdown"
          }
        }],
        conflictPolicy: "provider-wins"
      },
      {
        source: "primaryIp4",
        target: "primary_ip",
        conflictPolicy: "cmdb-wins"
      },
      {
        source: "customFields.customer",
        target: "organization",
        conflictPolicy: "cmdb-wins"
      }
    ],
    conflicts: {
      defaultPolicy: "provider-wins",
      fieldPolicies: {
        "primary_ip": "cmdb-wins",
        "organization": "cmdb-wins"
      }
    }
  }
};

// RTC #5: vCenter.VM → i-doit.Virtual Server
const vcenterToIdoitVserver: PresetRule = {
  id: "vc→idoit.vserver",
  label: "vCenter.VM → i-doit.Virtual Server",
  sourceProvider: "vmware",
  sourceType: "VM",
  targetCmdb: "idoit",
  targetType: "VirtualServer",
  rules: {
    target: "i-doit.VirtualServer",
    matchBy: ["ext_id"],
    fields: [
      {
        source: "externalId",
        target: "ext_id",
        required: true,
        conflictPolicy: "provider-wins"
      },
      {
        source: "name",
        target: "name",
        required: true,
        transforms: [{ type: "strip" }],
        conflictPolicy: "provider-wins"
      },
      {
        source: "cores",
        target: "cpu_cores",
        conflictPolicy: "provider-wins"
      },
      {
        source: "memory",
        target: "memory",
        conflictPolicy: "provider-wins"
      },
      {
        source: "guestOs",
        target: "operating_system",
        transforms: [
          {
            type: "map",
            params: {
              mapping: {
                "ubuntu64Guest": "Ubuntu Linux",
                "rhel8_64Guest": "Red Hat Enterprise Linux 8",
                "windows9Server64Guest": "Windows Server 2019"
              },
              default: "Other"
            }
          }
        ],
        conflictPolicy: "provider-wins"
      },
      {
        source: "status",
        target: "status",
        transforms: [{
          type: "map",
          params: {
            mapping: {
              "poweredOn": "In operation",
              "poweredOff": "Shutdown",
              "suspended": "Paused"
            },
            default: "Shutdown"
          }
        }],
        conflictPolicy: "provider-wins"
      },
      {
        source: "primaryIp4",
        target: "primary_ip",
        conflictPolicy: "cmdb-wins"
      },
      {
        source: "cluster",
        target: "cluster",
        conflictPolicy: "provider-wins"
      }
    ],
    conflicts: {
      defaultPolicy: "provider-wins",
      fieldPolicies: {
        "primary_ip": "cmdb-wins"
      }
    }
  }
};

// RTC #6: Azure.Compute.VirtualMachine → i-doit.Virtual Server
const azureToIdoitVserver: PresetRule = {
  id: "azure→idoit.vserver",
  label: "Azure.VM → i-doit.Virtual Server",
  sourceProvider: "azure",
  sourceType: "Compute.VirtualMachine",
  targetCmdb: "idoit",
  targetType: "VirtualServer",
  rules: {
    target: "i-doit.VirtualServer",
    matchBy: ["ext_id"],
    fields: [
      {
        source: "externalId",
        target: "ext_id",
        required: true,
        conflictPolicy: "provider-wins"
      },
      {
        source: "name",
        target: "name",
        required: true,
        transforms: [{ type: "strip" }],
        conflictPolicy: "provider-wins"
      },
      {
        source: "cores",
        target: "cpu_cores",
        conflictPolicy: "provider-wins"
      },
      {
        source: "memory",
        target: "memory",
        conflictPolicy: "provider-wins"
      },
      {
        source: "osProfile.osType",
        target: "operating_system",
        transforms: [{ type: "title" }],
        conflictPolicy: "provider-wins"
      },
      {
        source: "status",
        target: "status",
        transforms: [{
          type: "map",
          params: {
            mapping: {
              "running": "In operation",
              "stopped": "Shutdown",
              "deallocated": "Shutdown"
            },
            default: "Shutdown"
          }
        }],
        conflictPolicy: "provider-wins"
      },
      {
        source: "primaryIp4",
        target: "primary_ip",
        conflictPolicy: "cmdb-wins"
      },
      {
        source: "location",
        target: "location",
        conflictPolicy: "provider-wins"
      },
      {
        source: "resourceGroup",
        target: "resource_group",
        conflictPolicy: "provider-wins"
      }
    ],
    conflicts: {
      defaultPolicy: "provider-wins",
      fieldPolicies: {
        "primary_ip": "cmdb-wins"
      }
    }
  }
};

// Azure.NetworkInterface → NetBox.VMInterface
const azureNicToNetboxInterface: PresetRule = {
  id: "azure→netbox.nic",
  label: "Azure.NetworkInterface → NetBox.VMInterface",
  sourceProvider: "azure",
  sourceType: "NetworkInterface",
  targetCmdb: "netbox",
  targetType: "VMInterface",
  rules: {
    target: "NetBox.VMInterface",
    matchBy: ["custom_fields.azure_nic_id"],
    fields: [
      {
        source: "id",
        target: "custom_fields.azure_nic_id",
        required: true,
        conflictPolicy: "provider-wins"
      },
      {
        source: "name",
        target: "name",
        required: true,
        conflictPolicy: "provider-wins"
      },
      {
        source: "macAddress",
        target: "mac_address",
        conflictPolicy: "provider-wins"
      },
      {
        source: "resourceGroup",
        target: "custom_fields.azure_nic_resource_group",
        conflictPolicy: "provider-wins"
      }
    ],
    conflicts: {
      defaultPolicy: "provider-wins",
      fieldPolicies: {}
    }
  }
};

// Azure.PrivateIp → NetBox.IPAddress
const azurePrivateIpToNetboxIp: PresetRule = {
  id: "azure→netbox.private-ip",
  label: "Azure.PrivateIp → NetBox.IPAddress",
  sourceProvider: "azure",
  sourceType: "NetworkInterface",
  targetCmdb: "netbox",
  targetType: "IPAddress",
  rules: {
    target: "NetBox.IPAddress",
    matchBy: ["address"],
    fields: [
      {
        source: "privateIps[0]",
        target: "address",
        required: true,
        conflictPolicy: "provider-wins"
      },
      {
        source: "resourceGroup",
        target: "custom_fields.azure_ip_resource_group",
        conflictPolicy: "provider-wins"
      }
    ],
    conflicts: {
      defaultPolicy: "provider-wins",
      fieldPolicies: {}
    }
  }
};

// Azure.PublicIp → NetBox.IPAddress
const azurePublicIpToNetboxIp: PresetRule = {
  id: "azure→netbox.public-ip",
  label: "Azure.PublicIp → NetBox.IPAddress",
  sourceProvider: "azure",
  sourceType: "PublicIp",
  targetCmdb: "netbox",
  targetType: "IPAddress",
  rules: {
    target: "NetBox.IPAddress",
    matchBy: ["custom_fields.azure_public_ip_id"],
    fields: [
      {
        source: "id",
        target: "custom_fields.azure_public_ip_id",
        required: true,
        conflictPolicy: "provider-wins"
      },
      {
        source: "ipAddress",
        target: "address",
        required: true,
        conflictPolicy: "provider-wins"
      },
      {
        source: "resourceGroup",
        target: "custom_fields.azure_ip_resource_group",
        conflictPolicy: "provider-wins"
      }
    ],
    conflicts: {
      defaultPolicy: "provider-wins",
      fieldPolicies: {}
    }
  }
};

// Azure.VirtualNetwork → NetBox.Prefix
const azureVNetToNetboxPrefix: PresetRule = {
  id: "azure→netbox.vnet",
  label: "Azure.VirtualNetwork → NetBox.Prefix",
  sourceProvider: "azure",
  sourceType: "VirtualNetwork",
  targetCmdb: "netbox",
  targetType: "Prefix",
  rules: {
    target: "NetBox.Prefix",
    matchBy: ["custom_fields.azure_vnet_id"],
    fields: [
      {
        source: "id",
        target: "custom_fields.azure_vnet_id",
        required: true,
        conflictPolicy: "provider-wins"
      },
      {
        source: "name",
        target: "custom_fields.azure_vnet_name",
        conflictPolicy: "provider-wins"
      },
      {
        source: "addressSpaces[0]",
        target: "prefix",
        required: true,
        conflictPolicy: "provider-wins"
      },
      {
        source: "resourceGroup",
        target: "custom_fields.azure_vnet_resource_group",
        conflictPolicy: "provider-wins"
      },
      {
        source: "location",
        target: "custom_fields.azure_vnet_location",
        conflictPolicy: "provider-wins"
      }
    ],
    conflicts: {
      defaultPolicy: "provider-wins",
      fieldPolicies: {}
    }
  }
};

// Azure.Subnet → NetBox.Prefix
const azureSubnetToNetboxPrefix: PresetRule = {
  id: "azure→netbox.subnet",
  label: "Azure.Subnet → NetBox.Prefix",
  sourceProvider: "azure",
  sourceType: "Subnet",
  targetCmdb: "netbox",
  targetType: "Prefix",
  rules: {
    target: "NetBox.Prefix",
    matchBy: ["custom_fields.azure_subnet_id"],
    fields: [
      {
        source: "id",
        target: "custom_fields.azure_subnet_id",
        required: true,
        conflictPolicy: "provider-wins"
      },
      {
        source: "name",
        target: "custom_fields.azure_subnet_name",
        conflictPolicy: "provider-wins"
      },
      {
        source: "addressPrefix",
        target: "prefix",
        required: true,
        conflictPolicy: "provider-wins"
      },
      {
        source: "resourceGroup",
        target: "custom_fields.azure_subnet_resource_group",
        conflictPolicy: "provider-wins"
      },
      {
        source: "virtualNetworkName",
        target: "custom_fields.azure_vnet_name",
        conflictPolicy: "provider-wins"
      }
    ],
    conflicts: {
      defaultPolicy: "provider-wins",
      fieldPolicies: {}
    }
  }
};

// Registry of all presets
export const presetRegistry: PresetRule[] = [
  proxmoxToNetboxVm,
  vcenterToNetboxVm,
  azureToNetboxVm,
  azureNicToNetboxInterface,
  azurePrivateIpToNetboxIp,
  azurePublicIpToNetboxIp,
  azureVNetToNetboxPrefix,
  azureSubnetToNetboxPrefix,
  proxmoxToIdoitVserver,
  vcenterToIdoitVserver,
  azureToIdoitVserver,
];

/**
 * Get all available presets
 */
export function getPresets(): Array<{id: string; label: string}> {
  return presetRegistry.map(p => ({
    id: p.id,
    label: p.label
  }));
}

/**
 * Get a specific preset by ID
 */
export function getPreset(id: string): PresetRule | undefined {
  return presetRegistry.find(p => p.id === id);
}

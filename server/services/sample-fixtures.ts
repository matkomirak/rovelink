/**
 * Sample normalized objects for testing RDP transformations
 * These represent the output from provider collectors (Proxmox, vCenter, Azure)
 */

export interface NormalizedSample {
  sampleId: string;
  providerKind: string;
  objectType: string;
  normalized: any;
}

// Proxmox VM samples
export const proxmoxVmSamples: NormalizedSample[] = [
  {
    sampleId: "proxmox-sample:Vm:100",
    providerKind: "proxmox",
    objectType: "Vm",
    normalized: {
      externalId: "pve-node1-100",
      name: "web-server-01",
      provider: "proxmox",
      node: "pve-node1",
      vmid: 100,
      status: "running",
      cores: 4,
      memory: 8192,
      primaryIp4: "10.0.1.100",
      tags: ["production", "web", "wave_Wave1"],
      guest: {
        os: "ubuntu-20.04"
      },
      interfaces: [
        {
          name: "net0",
          mac: "BC:24:11:2E:55:01",
          ips: ["10.0.1.100"]
        }
      ],
      customFields: {
        patch_wave: "Wave1",
        customer: "Alpha Corp",
        role: "webserver"
      }
    }
  },
  {
    sampleId: "proxmox-sample:Vm:101",
    providerKind: "proxmox",
    objectType: "Vm",
    normalized: {
      externalId: "pve-node1-101",
      name: "db-server-01",
      provider: "proxmox",
      node: "pve-node1",
      vmid: 101,
      status: "running",
      cores: 8,
      memory: 16384,
      primaryIp4: "10.0.1.101",
      tags: ["production", "database", "wave_Wave2"],
      guest: {
        os: "ubuntu-22.04"
      },
      interfaces: [
        {
          name: "net0",
          mac: "BC:24:11:2E:55:02",
          ips: ["10.0.1.101"]
        }
      ],
      customFields: {
        patch_wave: "Wave2",
        customer: "Alpha Corp",
        role: "database"
      }
    }
  },
  {
    sampleId: "proxmox-sample:Vm:200",
    providerKind: "proxmox",
    objectType: "Vm",
    normalized: {
      externalId: "pve-node2-200",
      name: "app-server-01",
      provider: "proxmox",
      node: "pve-node2",
      vmid: 200,
      status: "running",
      cores: 4,
      memory: 8192,
      primaryIp4: "10.0.2.100",
      tags: ["staging", "application"],
      guest: {
        os: "windows-server-2019"
      },
      interfaces: [
        {
          name: "net0",
          mac: "BC:24:11:2E:55:03",
          ips: ["10.0.2.100"]
        }
      ],
      customFields: {
        patch_wave: "Wave3",
        customer: "Beta Inc",
        role: "application"
      }
    }
  }
];

// vCenter VM samples
export const vcenterVmSamples: NormalizedSample[] = [
  {
    sampleId: "vcenter-sample:VM:vm-100",
    providerKind: "vmware",
    objectType: "VM",
    normalized: {
      externalId: "vcenter-dc1-vm-100",
      name: "prod-web-01",
      provider: "vmware",
      moref: "vm-100",
      datacenter: "DC1",
      cluster: "Production",
      host: "esxi-01.example.com",
      status: "poweredOn",
      cores: 4,
      memory: 8192,
      primaryIp4: "192.168.1.100",
      tags: ["production", "web"],
      guestOs: "ubuntu64Guest",
      guestFamily: "linuxGuest",
      interfaces: [
        {
          name: "Network adapter 1",
          mac: "00:50:56:9A:00:01",
          network: "VLAN-100-Prod",
          ips: ["192.168.1.100"]
        }
      ],
      customAttributes: {
        "Patch Wave": "Wave1",
        "Customer": "Gamma LLC",
        "Role": "web"
      }
    }
  },
  {
    sampleId: "vcenter-sample:VM:vm-101",
    providerKind: "vmware",
    objectType: "VM",
    normalized: {
      externalId: "vcenter-dc1-vm-101",
      name: "prod-db-01",
      provider: "vmware",
      moref: "vm-101",
      datacenter: "DC1",
      cluster: "Production",
      host: "esxi-02.example.com",
      status: "poweredOn",
      cores: 8,
      memory: 32768,
      primaryIp4: "192.168.1.101",
      tags: ["production", "database"],
      guestOs: "rhel8_64Guest",
      guestFamily: "linuxGuest",
      interfaces: [
        {
          name: "Network adapter 1",
          mac: "00:50:56:9A:00:02",
          network: "VLAN-100-Prod",
          ips: ["192.168.1.101"]
        }
      ],
      customAttributes: {
        "Patch Wave": "Wave2",
        "Customer": "Gamma LLC",
        "Role": "database"
      }
    }
  }
];

// Azure VM samples
export const azureVmSamples: NormalizedSample[] = [
  {
    sampleId: "azure-sample:Compute.VirtualMachine:vm-001",
    providerKind: "azure",
    objectType: "Compute.VirtualMachine",
    normalized: {
      externalId: "azure-rg-prod-vm-001",
      name: "prod-webapp-001",
      provider: "azure",
      resourceId: "/subscriptions/sub-123/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/prod-webapp-001",
      location: "eastus",
      resourceGroup: "rg-prod",
      status: "running",
      vmSize: "Standard_D4s_v3",
      cores: 4,
      memory: 16384,
      primaryIp4: "10.1.0.100",
      tags: {
        environment: "production",
        application: "webapp",
        "patch-wave": "Wave1",
        customer: "Delta Co"
      },
      osProfile: {
        computerName: "prod-webapp-001",
        osType: "Linux",
        publisher: "Canonical",
        offer: "UbuntuServer",
        sku: "18.04-LTS"
      },
      networkInterfaces: [
        {
          name: "prod-webapp-001-nic",
          macAddress: "00-0D-3A-12-34-56",
          privateIp: "10.1.0.100",
          publicIp: "20.50.100.1"
        }
      ]
    }
  },
  {
    sampleId: "azure-sample:Compute.VirtualMachine:vm-002",
    providerKind: "azure",
    objectType: "Compute.VirtualMachine",
    normalized: {
      externalId: "azure-rg-prod-vm-002",
      name: "prod-sql-001",
      provider: "azure",
      resourceId: "/subscriptions/sub-123/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/prod-sql-001",
      location: "eastus",
      resourceGroup: "rg-prod",
      status: "running",
      vmSize: "Standard_E8s_v3",
      cores: 8,
      memory: 65536,
      primaryIp4: "10.1.0.101",
      tags: {
        environment: "production",
        application: "database",
        "patch-wave": "Wave2",
        customer: "Delta Co"
      },
      osProfile: {
        computerName: "prod-sql-001",
        osType: "Windows",
        publisher: "MicrosoftSQLServer",
        offer: "SQL2019-WS2019",
        sku: "Standard"
      },
      networkInterfaces: [
        {
          name: "prod-sql-001-nic",
          macAddress: "00-0D-3A-12-34-57",
          privateIp: "10.1.0.101"
        }
      ]
    }
  }
];

// Fake provider samples (small deterministic set for preview)
export const fakeVmSamples: NormalizedSample[] = [
  {
    sampleId: "fake-sample:Vm:001",
    providerKind: "fake",
    objectType: "Vm",
    normalized: {
      externalId: "pve1-100",
      name: "alpha-web-001",
      provider: "fake-proxmox",
      node: "pve1",
      vmid: 100,
      status: "running",
      primaryIp4: "10.50.12.10",
      tags: ["provider/proxmox", "node/pve1", "customer/Alpha", "wave/Wave1", "role/web"],
      guest: { os: "linux" },
      interfaces: [
        { name: "net0", mac: "52:54:00:12:34:56", ips: ["10.50.12.10/24"] }
      ]
    }
  },
  {
    sampleId: "fake-sample:Vm:002",
    providerKind: "fake",
    objectType: "Vm",
    normalized: {
      externalId: "pve1-101",
      name: "beta-db-002",
      provider: "fake-proxmox",
      node: "pve1",
      vmid: 101,
      status: "running",
      primaryIp4: "10.50.24.11",
      tags: ["provider/proxmox", "node/pve1", "customer/Beta", "wave/Wave2", "role/db"],
      guest: { os: "linux" },
      interfaces: [
        { name: "net0", mac: "52:54:00:ab:cd:ef", ips: ["10.50.24.11/24"] }
      ]
    }
  }
];

// Azure VirtualNetwork samples
export const azureVNetSamples: NormalizedSample[] = [
  {
    sampleId: "azure-sample:VirtualNetwork:vnet-001",
    providerKind: "azure",
    objectType: "VirtualNetwork",
    normalized: {
      id: "/subscriptions/sub-123/resourceGroups/rg-prod/providers/Microsoft.Network/virtualNetworks/prod-vnet",
      name: "prod-vnet",
      location: "westeurope",
      resourceGroup: "rg-prod",
      addressSpaces: ["10.0.0.0/16"],
      subnets: [
        { id: "/subscriptions/sub-123/resourceGroups/rg-prod/providers/Microsoft.Network/virtualNetworks/prod-vnet/subnets/default", name: "default", resourceGroup: "rg-prod", virtualNetworkName: "prod-vnet", addressPrefix: "10.0.0.0/24" },
        { id: "/subscriptions/sub-123/resourceGroups/rg-prod/providers/Microsoft.Network/virtualNetworks/prod-vnet/subnets/aks-subnet", name: "aks-subnet", resourceGroup: "rg-prod", virtualNetworkName: "prod-vnet", addressPrefix: "10.0.1.0/24" },
      ],
      tags: { environment: "production", team: "platform" }
    }
  },
  {
    sampleId: "azure-sample:VirtualNetwork:vnet-002",
    providerKind: "azure",
    objectType: "VirtualNetwork",
    normalized: {
      id: "/subscriptions/sub-123/resourceGroups/rg-staging/providers/Microsoft.Network/virtualNetworks/staging-vnet",
      name: "staging-vnet",
      location: "eastus",
      resourceGroup: "rg-staging",
      addressSpaces: ["172.16.0.0/20"],
      subnets: [
        { id: "/subscriptions/sub-123/resourceGroups/rg-staging/providers/Microsoft.Network/virtualNetworks/staging-vnet/subnets/default", name: "default", resourceGroup: "rg-staging", virtualNetworkName: "staging-vnet", addressPrefix: "172.16.0.0/24" },
      ],
      tags: { environment: "staging" }
    }
  }
];

// Azure Subnet samples
export const azureSubnetSamples: NormalizedSample[] = [
  {
    sampleId: "azure-sample:Subnet:subnet-001",
    providerKind: "azure",
    objectType: "Subnet",
    normalized: {
      id: "/subscriptions/sub-123/resourceGroups/rg-prod/providers/Microsoft.Network/virtualNetworks/prod-vnet/subnets/default",
      name: "default",
      resourceGroup: "rg-prod",
      virtualNetworkName: "prod-vnet",
      addressPrefix: "10.0.0.0/24"
    }
  },
  {
    sampleId: "azure-sample:Subnet:subnet-002",
    providerKind: "azure",
    objectType: "Subnet",
    normalized: {
      id: "/subscriptions/sub-123/resourceGroups/rg-prod/providers/Microsoft.Network/virtualNetworks/prod-vnet/subnets/aks-subnet",
      name: "aks-subnet",
      resourceGroup: "rg-prod",
      virtualNetworkName: "prod-vnet",
      addressPrefix: "10.0.1.0/24"
    }
  }
];

// Azure NetworkInterface samples
export const azureNicSamples: NormalizedSample[] = [
  {
    sampleId: "azure-sample:NetworkInterface:nic-001",
    providerKind: "azure",
    objectType: "NetworkInterface",
    normalized: {
      id: "/subscriptions/sub-123/resourceGroups/rg-prod/providers/Microsoft.Network/networkInterfaces/prod-webapp-001-nic",
      name: "prod-webapp-001-nic",
      resourceGroup: "rg-prod",
      macAddress: "00:0D:3A:12:34:56",
      vmId: "/subscriptions/sub-123/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/prod-webapp-001",
      vmName: "prod-webapp-001",
      privateIps: ["10.0.0.100"],
      publicIps: ["20.50.100.1"],
      subnetName: "default",
      virtualNetworkName: "prod-vnet"
    }
  },
  {
    sampleId: "azure-sample:NetworkInterface:nic-002",
    providerKind: "azure",
    objectType: "NetworkInterface",
    normalized: {
      id: "/subscriptions/sub-123/resourceGroups/rg-prod/providers/Microsoft.Network/networkInterfaces/prod-sql-001-nic",
      name: "prod-sql-001-nic",
      resourceGroup: "rg-prod",
      macAddress: "00:0D:3A:12:34:57",
      vmId: "/subscriptions/sub-123/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/prod-sql-001",
      vmName: "prod-sql-001",
      privateIps: ["10.0.0.101"],
      publicIps: [],
      subnetName: "default",
      virtualNetworkName: "prod-vnet"
    }
  }
];

// Azure PublicIp samples
export const azurePublicIpSamples: NormalizedSample[] = [
  {
    sampleId: "azure-sample:PublicIp:pip-001",
    providerKind: "azure",
    objectType: "PublicIp",
    normalized: {
      id: "/subscriptions/sub-123/resourceGroups/rg-prod/providers/Microsoft.Network/publicIPAddresses/prod-webapp-pip",
      name: "prod-webapp-pip",
      resourceGroup: "rg-prod",
      location: "westeurope",
      ipAddress: "20.50.100.1",
      ipVersion: "IPv4",
      fqdn: "prod-webapp-001.westeurope.cloudapp.azure.com",
      associatedNicId: "/subscriptions/sub-123/resourceGroups/rg-prod/providers/Microsoft.Network/networkInterfaces/prod-webapp-001-nic",
      tags: { environment: "production" }
    }
  },
  {
    sampleId: "azure-sample:PublicIp:pip-002",
    providerKind: "azure",
    objectType: "PublicIp",
    normalized: {
      id: "/subscriptions/sub-123/resourceGroups/rg-staging/providers/Microsoft.Network/publicIPAddresses/staging-lb-pip",
      name: "staging-lb-pip",
      resourceGroup: "rg-staging",
      location: "eastus",
      ipAddress: "40.121.50.33",
      ipVersion: "IPv4",
      fqdn: "",
      associatedNicId: undefined,
      tags: { environment: "staging" }
    }
  }
];

// Azure Vm samples (new format matching AzureNormalizedVm)
export const azureVmNormalizedSamples: NormalizedSample[] = [
  {
    sampleId: "azure-sample:Vm:vm-001",
    providerKind: "azure",
    objectType: "Vm",
    normalized: {
      id: "/subscriptions/sub-123/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/somemachine1",
      name: "somemachine1",
      location: "westeurope",
      resourceGroup: "rg-prod",
      subscriptionId: "sub-123",
      status: "running",
      platform: "linux",
      computerName: "somemachine1",
      vmSize: "Standard_D2s_v3",
      vcpus: 2,
      ramGiB: 8,
      disk: 30,
      osDiskName: "somemachine1_OsDisk_1_xxx",
      imagePublisher: "canonical",
      imageOffer: "ubuntu-24_04-lts",
      imagePlan: "ubuntu-pro",
      diskControllerType: "SCSI",
      dataDisksCount: 0,
      primaryIp4: "10.0.0.4",
      nics: [
        { id: "/subscriptions/sub-123/resourceGroups/rg-prod/providers/Microsoft.Network/networkInterfaces/somemachine1737_z1", name: "somemachine1737_z1", resourceGroup: "rg-prod", macAddress: "00:0D:3A:AB:CD:EF", privateIps: ["10.0.0.4"], publicIps: ["20.11.32.123"], subnetName: "default", virtualNetworkName: "somemachine1-vnet" }
      ],
      securityType: "Trusted launch",
      secureBoot: true,
      vtpm: true,
      integrityMonitoring: false,
      availabilityZone: "1",
      spot: false,
      generation: "V2",
      architecture: "x64",
      hibernation: "Disabled",
      extensions: [],
      encryptionAtHost: false,
      dataDisksCount2: 0,
      tags: { customer: "Alpha" }
    }
  }
];

// Combined registry for easy lookup
export const sampleRegistry: Record<string, NormalizedSample[]> = {
  "proxmox:Vm": proxmoxVmSamples,
  "vmware:VM": vcenterVmSamples,
  "azure:Compute.VirtualMachine": azureVmSamples,
  "azure:Vm": azureVmNormalizedSamples,
  "azure:VirtualNetwork": azureVNetSamples,
  "azure:Subnet": azureSubnetSamples,
  "azure:NetworkInterface": azureNicSamples,
  "azure:PublicIp": azurePublicIpSamples,
  "fake:Vm": fakeVmSamples,
};

/**
 * Get samples for a specific provider and type
 */
export function getSamples(providerKind: string, objectType: string, limit: number = 20): NormalizedSample[] {
  const key = `${providerKind}:${objectType}`;
  const samples = sampleRegistry[key] || [];
  return samples.slice(0, limit);
}

/**
 * Get a specific sample by ID
 */
export function getSample(sampleId: string): NormalizedSample | undefined {
  for (const samples of Object.values(sampleRegistry)) {
    const sample = samples.find(s => s.sampleId === sampleId);
    if (sample) return sample;
  }
  return undefined;
}

/**
 * Get available object types for a provider
 */
export function getObjectTypes(providerKind: string): string[] {
  const types = new Set<string>();
  for (const key of Object.keys(sampleRegistry)) {
    const [kind, type] = key.split(':');
    if (kind === providerKind) {
      types.add(type);
    }
  }
  return Array.from(types);
}

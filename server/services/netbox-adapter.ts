/**
 * NetBox CMDB Adapter
 * Handles idempotent upserts to NetBox based on ext_id
 */

import axios, { type AxiosInstance } from 'axios';

export interface NetBoxConfig {
  url: string; // Base URL without /api
  token: string;
}

export interface NetBoxVmData {
  name: string;
  status?: string;
  site?: number | { name: string };
  cluster?: number | { name: string };
  tenant?: number | { name: string };
  platform?: number | { name: string };
  vcpus?: number;
  memory?: number;
  disk?: number;
  tags?: Array<{ name: string } | number>;
  custom_fields?: Record<string, any>;
  primary_ip4?: number | { address: string };
  comments?: string;
}

export interface NetBoxIpData {
  address: string; // CIDR notation: 192.168.1.10/24
  status?: string;
  assigned_object_type?: string;
  assigned_object_id?: number;
  tags?: Array<{ name: string } | number>;
}

export class NetBoxAdapter {
  private client: AxiosInstance;
  private config: NetBoxConfig;

  constructor(config: NetBoxConfig) {
    this.config = config;

    // Strip trailing slash from URL
    const baseURL = config.url.replace(/\/$/, '');

    this.client = axios.create({
      baseURL: `${baseURL}/api`,
      headers: {
        'Authorization': `Token ${config.token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      timeout: 30000,
    });
  }

  /**
   * Test connection to NetBox
   */
  async test(): Promise<{ ok: boolean; version?: string; error?: string }> {
    try {
      const response = await this.client.get('/status/');
      const versionStr = response.data?.['netbox-version'] || response.data?.version;
      
      return {
        ok: true,
        version: versionStr,
      };
    } catch (error: any) {
      return {
        ok: false,
        error: error.message || 'Connection failed',
      };
    }
  }

  /**
   * Get supported object types for NetBox
   */
  objectTypes(): string[] {
    return [
      "VirtualMachine",
      "IPAddress",
      "Interface",
      "VMInterface",
      "Tenant",
      "Site",
      "Cluster",
      "Platform",
      "Tag"
    ];
  }

  /**
   * Validate an object against NetBox schema
   */
  validate(targetType: string, obj: any): { errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    switch (targetType) {
      case "VirtualMachine":
        if (!obj.name || typeof obj.name !== 'string') {
          errors.push("VirtualMachine requires a valid 'name' field");
        }
        if (obj.vcpus && typeof obj.vcpus !== 'number') {
          errors.push("VirtualMachine 'vcpus' must be a number");
        }
        if (obj.memory && typeof obj.memory !== 'number') {
          errors.push("VirtualMachine 'memory' must be a number");
        }
        if (!obj.status) {
          warnings.push("VirtualMachine should have 'status' specified (active, offline, staged)");
        }
        if (!obj.custom_fields?.ext_id) {
          warnings.push("VirtualMachine should have 'custom_fields.ext_id' for idempotent sync");
        }
        break;

      case "IPAddress":
        if (!obj.address) {
          errors.push("IPAddress requires an 'address' field (CIDR notation)");
        } else if (!/^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/.test(obj.address)) {
          errors.push("IPAddress 'address' must be in CIDR notation (e.g., 192.168.1.10/24)");
        }
        break;

      case "VMInterface":
      case "Interface":
        if (!obj.name) {
          errors.push("Interface requires a 'name' field");
        }
        if (!obj.mac_address) {
          warnings.push("Interface should have 'mac_address' for proper identification");
        }
        break;

      case "Tenant":
      case "Site":
      case "Cluster":
      case "Platform":
        if (!obj.name) {
          errors.push(`${targetType} requires a 'name' field`);
        }
        break;

      case "Tag":
        if (!obj.name) {
          errors.push("Tag requires a 'name' field");
        }
        if (!obj.slug) {
          warnings.push("Tag should have 'slug' for proper identification");
        }
        break;

      default:
        warnings.push(`Unknown target type: ${targetType}`);
    }

    return { errors, warnings };
  }

  /**
   * Check if ext_id custom field exists in NetBox
   */
  async checkExtIdFieldExists(): Promise<boolean> {
    try {
      const response = await this.client.get('/extras/custom-fields/?name=ext_id');
      return response.data.count > 0;
    } catch (error: any) {
      console.error('Failed to check custom fields:', error.message);
      return false;
    }
  }

  /**
   * Ensure NetBox custom fields exist
   * Note: This requires admin permissions in NetBox. If it fails, the user needs to create
   * the ext_id custom field manually in NetBox (Customization > Custom Fields).
   */
  async ensureCustomFields(): Promise<{ success: boolean; message: string }> {
    const requiredFields = [
      {
        name: 'ext_id',
        label: 'External ID',
        type: 'text',
        description: 'External provider unique identifier for Bridge sync',
        object_types: ['virtualization.virtualmachine'],
        filter_logic: 'loose',
      },
    ];

    const results: string[] = [];

    for (const field of requiredFields) {
      try {
        // Check if field exists
        const existing = await this.client.get(`/extras/custom-fields/?name=${field.name}`);
        
        if (existing.data.count > 0) {
          results.push(`Custom field '${field.name}' already exists`);
          continue;
        }

        // Create the field
        await this.client.post('/extras/custom-fields/', field);
        console.log(`Created custom field: ${field.name}`);
        results.push(`Created custom field '${field.name}'`);
      } catch (error: any) {
        const errorDetail = error.response?.data || error.message;
        console.error(`Failed to create custom field ${field.name}:`, JSON.stringify(errorDetail));
        
        // Check if it's a permission error
        if (error.response?.status === 403) {
          return {
            success: false,
            message: `Permission denied: Your NetBox API token does not have permission to create custom fields. Please create the 'ext_id' custom field manually in NetBox: Customization > Custom Fields > Add (Type: Text, Object Types: Virtual Machine, Name: ext_id)`
          };
        }
        
        return {
          success: false,
          message: `Failed to create custom field '${field.name}': ${JSON.stringify(errorDetail)}. Please create it manually in NetBox: Customization > Custom Fields`
        };
      }
    }

    return { success: true, message: results.join('; ') };
  }

  /**
   * Ensure a platform exists or create it
   */
  private async ensurePlatform(platformName: string): Promise<number> {
    try {
      const slug = platformName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      
      // Search for existing platform
      const response = await this.client.get(`/dcim/platforms/?name=${encodeURIComponent(platformName)}`);
      
      if (response.data.count > 0) {
        return response.data.results[0].id;
      }
      
      // Create new platform
      const createResponse = await this.client.post('/dcim/platforms/', {
        name: platformName,
        slug: slug,
      });
      
      console.log(`Created platform: ${platformName}`);
      return createResponse.data.id;
    } catch (error: any) {
      console.error(`Failed to ensure platform ${platformName}:`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Find or create tag
   */
  private async ensureTag(tagName: string): Promise<number> {
    try {
      // Search for existing tag
      const response = await this.client.get(`/extras/tags/?name=${encodeURIComponent(tagName)}`);
      
      if (response.data.count > 0) {
        return response.data.results[0].id;
      }

      // Create new tag
      const createResponse = await this.client.post('/extras/tags/', {
        name: tagName,
        slug: tagName.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-'),
      });

      return createResponse.data.id;
    } catch (error: any) {
      console.error(`Failed to ensure tag ${tagName}:`, error.message);
      throw error;
    }
  }

  /**
   * Cached cluster ID to avoid repeated API calls
   */
  private defaultClusterId: number | null = null;

  /**
   * Ensure a default cluster exists for VMs
   * NetBox requires VMs to be assigned to a cluster or site
   */
  async ensureDefaultCluster(): Promise<number> {
    // Return cached ID if available
    if (this.defaultClusterId !== null) {
      return this.defaultClusterId;
    }

    const clusterName = 'Bridge-Default';
    const clusterSlug = 'bridge-default';

    try {
      // Search for existing cluster
      const response = await this.client.get(`/virtualization/clusters/?name=${encodeURIComponent(clusterName)}`);
      
      if (response.data.count > 0) {
        const clusterId: number = response.data.results[0].id;
        this.defaultClusterId = clusterId;
        return clusterId;
      }

      // Need to create a cluster type first
      const clusterTypeId = await this.ensureClusterType();

      // Create new cluster
      const createResponse = await this.client.post('/virtualization/clusters/', {
        name: clusterName,
        slug: clusterSlug,
        type: clusterTypeId,
      });

      const newClusterId: number = createResponse.data.id;
      this.defaultClusterId = newClusterId;
      console.log(`Created default cluster: ${clusterName} (ID: ${newClusterId})`);
      return newClusterId;
    } catch (error: any) {
      console.error(`Failed to ensure default cluster:`, error.response?.data || error.message);
      throw new Error(`Failed to create default cluster: ${error.message}`);
    }
  }

  /**
   * Ensure a default cluster type exists
   */
  private async ensureClusterType(): Promise<number> {
    const typeName = 'Bridge';
    const typeSlug = 'bridge';

    try {
      // Search for existing type
      const response = await this.client.get(`/virtualization/cluster-types/?name=${encodeURIComponent(typeName)}`);
      
      if (response.data.count > 0) {
        return response.data.results[0].id;
      }

      // Create new cluster type
      const createResponse = await this.client.post('/virtualization/cluster-types/', {
        name: typeName,
        slug: typeSlug,
      });

      console.log(`Created cluster type: ${typeName}`);
      return createResponse.data.id;
    } catch (error: any) {
      console.error(`Failed to ensure cluster type:`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Upsert a VM to NetBox based on ext_id
   * NetBox 4.x requires specific field formats
   * Implements delta updates - only updates fields that have changed
   */
  async upsertVm(vmData: NetBoxVmData, extId: string): Promise<{ id: number; created: boolean; unchanged?: boolean }> {
    try {
      // First, find existing VM by ext_id
      const searchResponse = await this.client.get(
        `/virtualization/virtual-machines/?cf_ext_id=${encodeURIComponent(extId)}`
      );

      let vmId: number;
      let created = false;
      let unchanged = false;

      // Ensure tags exist and get their IDs
      const tagIds: number[] = [];
      if (vmData.tags) {
        for (const tag of vmData.tags) {
          if (typeof tag === 'object' && 'name' in tag) {
            const tagId = await this.ensureTag(tag.name);
            tagIds.push(tagId);
          } else if (typeof tag === 'string') {
            const tagId = await this.ensureTag(tag);
            tagIds.push(tagId);
          }
        }
      }

      // Ensure platform exists if specified
      let platformId: number | undefined;
      if (vmData.platform) {
        const platformName = typeof vmData.platform === 'object' ? vmData.platform.name : String(vmData.platform);
        if (platformName) {
          platformId = await this.ensurePlatform(platformName);
        }
      }

      // Map status to NetBox-valid values
      const statusMap: Record<string, string> = {
        'running': 'active',
        'stopped': 'offline',
        'paused': 'offline',
        'suspended': 'offline',
      };
      const rawStatus = String(vmData.status || 'active').toLowerCase();
      const status = statusMap[rawStatus] || rawStatus;

      // Build full payload for new VMs or comparison
      const buildFullPayload = async (forCreate: boolean = false) => {
        const payload: any = {
          name: vmData.name,
          status: status,
          custom_fields: {
            ext_id: extId,
          },
        };

        // For new VMs, ensure a cluster is assigned (required by NetBox)
        if (forCreate) {
          const clusterId = await this.ensureDefaultCluster();
          payload.cluster = clusterId;
        }

        // Add optional fields if they have valid values
        if (vmData.vcpus && Number(vmData.vcpus) > 0) {
          payload.vcpus = Number(vmData.vcpus);
        }
        if (vmData.memory && Number(vmData.memory) > 0) {
          payload.memory = Number(vmData.memory);
        }
        if (vmData.disk && Number(vmData.disk) > 0) {
          payload.disk = Number(vmData.disk);
        }
        if (tagIds.length > 0) {
          payload.tags = tagIds;
        }
        if (vmData.comments) {
          payload.comments = vmData.comments;
        }
        if (platformId) {
          payload.platform = platformId;
        }

        return payload;
      };

      if (searchResponse.data.count > 0) {
        // Existing VM - perform delta update
        const existingVm = searchResponse.data.results[0];
        vmId = existingVm.id;
        
        // Build delta payload - only include changed fields
        const deltaPayload: any = {};
        let hasChanges = false;
        
        // Compare and add only changed fields
        if (existingVm.name !== vmData.name) {
          deltaPayload.name = vmData.name;
          hasChanges = true;
        }
        if (existingVm.status?.value !== status) {
          deltaPayload.status = status;
          hasChanges = true;
        }
        if (vmData.vcpus && Number(vmData.vcpus) > 0 && existingVm.vcpus !== Number(vmData.vcpus)) {
          deltaPayload.vcpus = Number(vmData.vcpus);
          hasChanges = true;
        }
        if (vmData.memory && Number(vmData.memory) > 0 && existingVm.memory !== Number(vmData.memory)) {
          deltaPayload.memory = Number(vmData.memory);
          hasChanges = true;
        }
        if (vmData.disk && Number(vmData.disk) > 0 && existingVm.disk !== Number(vmData.disk)) {
          deltaPayload.disk = Number(vmData.disk);
          hasChanges = true;
        }
        if (vmData.comments && existingVm.comments !== vmData.comments) {
          deltaPayload.comments = vmData.comments;
          hasChanges = true;
        }
        if (platformId && existingVm.platform?.id !== platformId) {
          deltaPayload.platform = platformId;
          hasChanges = true;
        }
        
        // Compare tags (by ID)
        const existingTagIds = (existingVm.tags || []).map((t: any) => t.id).sort();
        const newTagIds = tagIds.sort();
        if (JSON.stringify(existingTagIds) !== JSON.stringify(newTagIds) && tagIds.length > 0) {
          deltaPayload.tags = tagIds;
          hasChanges = true;
        }

        if (hasChanges) {
          await this.client.patch(`/virtualization/virtual-machines/${vmId}/`, deltaPayload);
        } else {
          unchanged = true;
        }
      } else {
        // Create new VM (include cluster assignment)
        const createPayload = await buildFullPayload(true);
        const createResponse = await this.client.post('/virtualization/virtual-machines/', createPayload);
        vmId = createResponse.data.id;
        created = true;
      }

      return { id: vmId, created, unchanged };
    } catch (error: any) {
      // Log detailed error info for debugging
      const errorDetails = error.response?.data;
      console.error('NetBox upsert failed:', {
        vmName: vmData.name,
        extId,
        status: error.response?.status,
        error: errorDetails
      });
      
      // Create a more helpful error message
      let errorMsg = error.message;
      if (errorDetails) {
        if (typeof errorDetails === 'object') {
          const fieldErrors = Object.entries(errorDetails)
            .map(([field, msgs]) => `${field}: ${Array.isArray(msgs) ? msgs.join(', ') : msgs}`)
            .join('; ');
          errorMsg = fieldErrors || JSON.stringify(errorDetails);
        } else {
          errorMsg = String(errorDetails);
        }
      }
      
      throw new Error(`Failed to upsert VM: ${errorMsg}`);
    }
  }

  /**
   * Get object types available in NetBox
   */
  async getObjectTypes(): Promise<string[]> {
    return [
      'virtualization.virtual_machines',
      'dcim.devices',
      'ipam.ip_addresses',
      'ipam.prefixes',
    ];
  }

  /**
   * List all virtual machines from NetBox
   */
  async listAllVms(): Promise<any[]> {
    try {
      const vms: any[] = [];
      let offset = 0;
      const limit = 100;
      
      while (true) {
        const response = await this.client.get('/virtualization/virtual-machines/', {
          params: { offset, limit }
        });
        
        if (!response.data.results || response.data.results.length === 0) {
          break;
        }
        
        vms.push(...response.data.results);
        
        if (!response.data.next) {
          break;
        }
        
        offset += limit;
      }
      
      return vms;
    } catch (error: any) {
      console.error('Failed to list VMs from NetBox:', error.message);
      console.error('NetBox URL:', this.config.url);
      console.error('Error details:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data
      });
      
      if (error.response?.status === 403) {
        throw new Error(`NetBox API returned 403 Forbidden. The API token may not have permission to access virtualization resources. Please verify the token has the required permissions in NetBox.`);
      }
      
      throw new Error(`Failed to list VMs: ${error.message}`);
    }
  }
}

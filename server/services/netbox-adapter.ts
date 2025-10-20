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
   * Ensure NetBox custom fields exist
   */
  async ensureCustomFields(): Promise<void> {
    const requiredFields = [
      {
        name: 'ext_id',
        label: 'External ID',
        type: 'text',
        description: 'External provider unique identifier',
        content_types: ['virtualization.virtualmachine'],
      },
      {
        name: 'ext_provider',
        label: 'External Provider',
        type: 'text',
        description: 'Source provider (proxmox, vmware, azure)',
        content_types: ['virtualization.virtualmachine'],
      },
      {
        name: 'patch_wave',
        label: 'Patch Wave',
        type: 'text',
        description: 'Patching wave assignment',
        content_types: ['virtualization.virtualmachine'],
      },
      {
        name: 'patch_subwave',
        label: 'Patch Subwave',
        type: 'text',
        description: 'Patching subwave assignment',
        content_types: ['virtualization.virtualmachine'],
      },
      {
        name: 'ansible_user',
        label: 'Ansible User',
        type: 'text',
        description: 'Default Ansible user for automation',
        content_types: ['virtualization.virtualmachine'],
      },
    ];

    for (const field of requiredFields) {
      try {
        // Check if field exists
        const existing = await this.client.get(`/extras/custom-fields/?name=${field.name}`);
        
        if (existing.data.count === 0) {
          // Create the field
          await this.client.post('/extras/custom-fields/', field);
          console.log(`Created custom field: ${field.name}`);
        }
      } catch (error: any) {
        console.error(`Failed to ensure custom field ${field.name}:`, error.message);
      }
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
   * Upsert a VM to NetBox based on ext_id
   */
  async upsertVm(vmData: NetBoxVmData, extId: string): Promise<{ id: number; created: boolean }> {
    try {
      // First, find existing VM by ext_id
      const searchResponse = await this.client.get(
        `/virtualization/virtual-machines/?cf_ext_id=${encodeURIComponent(extId)}`
      );

      let vmId: number;
      let created = false;

      if (searchResponse.data.count > 0) {
        // Update existing VM
        vmId = searchResponse.data.results[0].id;
        
        // Ensure tags exist and get their IDs
        const tagIds: number[] = [];
        if (vmData.tags) {
          for (const tag of vmData.tags) {
            if (typeof tag === 'object' && 'name' in tag) {
              const tagId = await this.ensureTag(tag.name);
              tagIds.push(tagId);
            }
          }
        }

        const updatePayload: any = {
          ...vmData,
          tags: tagIds,
          custom_fields: {
            ...vmData.custom_fields,
            ext_id: extId,
          },
        };

        await this.client.patch(`/virtualization/virtual-machines/${vmId}/`, updatePayload);
      } else {
        // Create new VM
        // Ensure tags exist
        const tagIds: number[] = [];
        if (vmData.tags) {
          for (const tag of vmData.tags) {
            if (typeof tag === 'object' && 'name' in tag) {
              const tagId = await this.ensureTag(tag.name);
              tagIds.push(tagId);
            }
          }
        }

        const createPayload: any = {
          ...vmData,
          tags: tagIds,
          custom_fields: {
            ...vmData.custom_fields,
            ext_id: extId,
          },
        };

        const createResponse = await this.client.post('/virtualization/virtual-machines/', createPayload);
        vmId = createResponse.data.id;
        created = true;
      }

      return { id: vmId, created };
    } catch (error: any) {
      console.error('NetBox upsert failed:', error.response?.data || error.message);
      throw new Error(`Failed to upsert VM: ${error.message}`);
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
}

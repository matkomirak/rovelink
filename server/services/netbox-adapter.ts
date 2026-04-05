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
      {
        name: 'automatable',
        label: 'Automatable',
        type: 'boolean',
        description: 'Explicit permission for automation to act on this asset. Must be set to true by a human operator.',
        object_types: ['virtualization.virtualmachine'],
        filter_logic: 'loose',
        default: false,
      },
      {
        name: 'provider_state',
        label: 'Provider State',
        type: 'text',
        description: 'Last known provider presence state (active or missing). Managed automatically by Bridge sync.',
        object_types: ['virtualization.virtualmachine'],
        filter_logic: 'loose',
        default: 'active',
      },
      {
        name: 'gate_provider_id',
        label: 'Gate Provider ID',
        type: 'text',
        description: 'Unique identifier of the provider instance that owns this CI. This field is authoritative for provider ownership.',
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
   * 
   * OWNERSHIP RULES (from specification):
   * - gate_provider_id is set on creation ONLY
   * - If a CI already has a different gate_provider_id, skip it and log warning
   * - Never overwrite gate_provider_id if it already exists
   * - Never change ownership automatically
   * 
   * @param vmData - VM data to upsert
   * @param extId - External ID for idempotent sync
   * @param providerId - Optional provider ID for ownership tracking
   * @param clusterName - Optional cluster name for scope validation
   */
  async upsertVm(
    vmData: NetBoxVmData, 
    extId: string,
    providerId?: string,
    clusterName?: string
  ): Promise<{ id: number; created: boolean; unchanged?: boolean; skipped?: boolean; skipReason?: string }> {
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
      // NetBox accepts: active, offline, staged, failed, decommissioning, planned
      const statusMap: Record<string, string> = {
        'running': 'active',
        'stopped': 'offline',
        'paused': 'offline',
        'suspended': 'offline',
        'unknown': 'offline', // Safety net: Azure listVms may return "unknown" power state
      };
      const rawStatus = String(vmData.status || 'active').toLowerCase();
      const status = statusMap[rawStatus] || rawStatus;

      // Build full payload for new VMs or comparison
      const buildFullPayload = async (forCreate: boolean = false) => {
        const payload: any = {
          name: vmData.name,
          status: status,
          custom_fields: (() => {
            // Merge extra custom fields (e.g. azure_vm_* fields), stripping any keys
            // that are managed separately or not registered in NetBox
            const { ext_id: _a, ext_provider: _b, provider_state: _c, gate_provider_id: _d, ...extra } = vmData.custom_fields || {};
            return {
              ext_id: extId,
              provider_state: 'active',
              ...extra,
            };
          })(),
        };

        // For new VMs, set gate_provider_id for ownership tracking
        if (forCreate && providerId) {
          payload.custom_fields.gate_provider_id = providerId;
        }

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
        // Existing VM - perform ownership checks first
        const existingVm = searchResponse.data.results[0];
        vmId = existingVm.id;
        
        // OWNERSHIP CHECK: If providerId is specified, verify ownership
        if (providerId) {
          const existingOwnerId = existingVm.custom_fields?.gate_provider_id;
          
          // If CI already has a different gate_provider_id, skip it
          if (existingOwnerId && existingOwnerId !== providerId) {
            console.warn(`[OWNERSHIP] Skipping VM '${vmData.name}' (ext_id: ${extId}): ` +
              `Owned by provider '${existingOwnerId}', current provider is '${providerId}'`);
            return { 
              id: vmId, 
              created: false, 
              unchanged: true, 
              skipped: true, 
              skipReason: `Owned by different provider: ${existingOwnerId}` 
            };
          }
          
          // CLUSTER CHECK: If clusterName is specified, verify cluster matches
          const existingClusterName = existingVm.cluster?.name;
          if (clusterName && existingClusterName && existingClusterName !== clusterName) {
            console.warn(`[OWNERSHIP] Skipping VM '${vmData.name}' (ext_id: ${extId}): ` +
              `Cluster mismatch - expected '${clusterName}', found '${existingClusterName}'`);
            return { 
              id: vmId, 
              created: false, 
              unchanged: true, 
              skipped: true, 
              skipReason: `Cluster mismatch: ${existingClusterName} vs ${clusterName}` 
            };
          }
        }
        
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

        // Always update provider_state to active when syncing from provider
        const existingProviderState = existingVm.custom_fields?.provider_state;
        if (existingProviderState !== 'active') {
          deltaPayload.custom_fields = {
            ...deltaPayload.custom_fields,
            provider_state: 'active',
          };
          hasChanges = true;
        }
        
        // BACKFILL: Set gate_provider_id if it's currently empty (for legacy VMs synced before ownership tracking)
        // This only happens if the VM has no existing owner - we never overwrite existing ownership
        const existingGateProviderId = existingVm.custom_fields?.gate_provider_id;
        if (providerId && (!existingGateProviderId || existingGateProviderId === '')) {
          console.log(`[OWNERSHIP] Backfilling gate_provider_id for VM '${vmData.name}' (ext_id: ${extId}): Setting to '${providerId}'`);
          deltaPayload.custom_fields = {
            ...deltaPayload.custom_fields,
            gate_provider_id: providerId,
          };
          hasChanges = true;
        }

        // Always write extra custom fields (e.g. azure_vm_* fields) — these are provider-specific
        // and cannot be diffed cheaply, so we always patch them to keep NetBox current
        const extraCf = { ...(vmData.custom_fields || {}) };
        // Remove fields already managed above or not registered as NetBox custom fields
        delete extraCf.ext_id;
        delete extraCf.ext_provider;
        delete extraCf.provider_state;
        delete extraCf.gate_provider_id;
        if (Object.keys(extraCf).length > 0) {
          deltaPayload.custom_fields = {
            ...deltaPayload.custom_fields,
            ...extraCf,
          };
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
   * Ensure a VM interface exists for a given VM
   * Returns the interface ID
   */
  async ensureVmInterface(vmId: number, interfaceName: string = 'eth0'): Promise<number> {
    try {
      // Check if interface already exists
      const searchResponse = await this.client.get('/virtualization/interfaces/', {
        params: {
          virtual_machine_id: vmId,
          name: interfaceName,
        }
      });

      if (searchResponse.data.count > 0) {
        return searchResponse.data.results[0].id;
      }

      // Create the interface
      const createResponse = await this.client.post('/virtualization/interfaces/', {
        virtual_machine: vmId,
        name: interfaceName,
        enabled: true,
      });

      console.log(`Created VM interface: ${interfaceName} for VM ${vmId}`);
      return createResponse.data.id;
    } catch (error: any) {
      console.error('Failed to ensure VM interface:', error.response?.data || error.message);
      throw new Error(`Failed to ensure VM interface: ${error.message}`);
    }
  }

  /**
   * Ensure an IP address exists in NetBox IPAM and optionally assign to a VM interface
   * Returns the IP address ID
   */
  async ensureIpAddress(address: string, vmId?: number, interfaceId?: number): Promise<number> {
    try {
      // Normalize address - add /32 if no prefix length
      let normalizedAddress = address;
      if (!address.includes('/')) {
        normalizedAddress = `${address}/32`;
      }

      // Check if IP already exists
      const searchResponse = await this.client.get('/ipam/ip-addresses/', {
        params: { address: normalizedAddress }
      });

      let ipId: number;

      if (searchResponse.data.count > 0) {
        ipId = searchResponse.data.results[0].id;
        
        // Update assignment if interface is provided and not already assigned
        if (interfaceId) {
          const existingIp = searchResponse.data.results[0];
          const currentAssignment = existingIp.assigned_object_id;
          
          if (currentAssignment !== interfaceId) {
            await this.client.patch(`/ipam/ip-addresses/${ipId}/`, {
              assigned_object_type: 'virtualization.vminterface',
              assigned_object_id: interfaceId,
            });
            console.log(`Assigned IP ${normalizedAddress} to interface ${interfaceId}`);
          }
        }
      } else {
        // Create the IP address
        const createPayload: any = {
          address: normalizedAddress,
          status: 'active',
        };

        // Assign to interface if provided
        if (interfaceId) {
          createPayload.assigned_object_type = 'virtualization.vminterface';
          createPayload.assigned_object_id = interfaceId;
        }

        const createResponse = await this.client.post('/ipam/ip-addresses/', createPayload);
        ipId = createResponse.data.id;
        console.log(`Created IP address: ${normalizedAddress}` + (interfaceId ? ` assigned to interface ${interfaceId}` : ''));
      }

      return ipId;
    } catch (error: any) {
      console.error('Failed to ensure IP address:', error.response?.data || error.message);
      throw new Error(`Failed to ensure IP address ${address}: ${error.message}`);
    }
  }

  /**
   * Sync primary IP address for a VM
   * Creates the IP in IPAM, creates a VM interface, assigns IP to interface, and sets as primary
   */
  async syncVmPrimaryIp(vmId: number, ipAddress: string): Promise<{ ipId: number; interfaceId: number }> {
    try {
      // Step 1: Ensure VM interface exists
      const interfaceId = await this.ensureVmInterface(vmId, 'eth0');

      // Step 2: Ensure IP address exists and is assigned to interface
      const ipId = await this.ensureIpAddress(ipAddress, vmId, interfaceId);

      // Step 3: Set as primary IP on the VM
      await this.client.patch(`/virtualization/virtual-machines/${vmId}/`, {
        primary_ip4: ipId,
      });

      console.log(`Set primary_ip4 for VM ${vmId} to ${ipAddress} (IP ID: ${ipId})`);
      return { ipId, interfaceId };
    } catch (error: any) {
      console.error('Failed to sync VM primary IP:', error.response?.data || error.message);
      throw new Error(`Failed to sync primary IP ${ipAddress}: ${error.message}`);
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

  /**
   * Check if adapter has write access to NetBox.
   * Used to determine if block reasons can be written.
   */
  hasWriteAccess(): boolean {
    // For now, assume we don't have write access unless explicitly configured
    // In production, this would check token permissions
    return false;
  }

  /**
   * Update VM block status in NetBox (informational only).
   * 
   * This data is INFORMATIONAL ONLY.
   * Gate logic must NEVER read these fields.
   * Overwrites on every gate evaluation.
   * 
   * @param vmName - The VM name to update
   * @param blockStatus - Block status information
   */
  async updateVmBlockStatus(
    vmName: string,
    blockStatus: { tag: string; reason: string; missingFields: string[] }
  ): Promise<void> {
    try {
      // Find VM by name
      const response = await this.client.get('/virtualization/virtual-machines/', {
        params: { name: vmName }
      });

      if (!response.data.results || response.data.results.length === 0) {
        console.warn(`VM not found in NetBox for block status update: ${vmName}`);
        return;
      }

      const vm = response.data.results[0];
      const vmId = vm.id;

      // Get or create the automation-blocked tag
      const tagId = await this.getOrCreateTag(blockStatus.tag);

      // Update VM with tag and custom field
      const existingTags = vm.tags?.map((t: any) => t.id || t) || [];
      const tagSet = new Set([...existingTags, tagId]);
      const newTags = Array.from(tagSet);

      await this.client.patch(`/virtualization/virtual-machines/${vmId}/`, {
        tags: newTags,
        custom_fields: {
          ...vm.custom_fields,
          automation_block_reason: blockStatus.reason,
        },
      });

      console.log(`Updated block status in NetBox for VM: ${vmName}`);
    } catch (error: any) {
      console.warn(`Failed to update block status for ${vmName}: ${error.message}`);
      // Non-fatal - just log and continue
    }
  }

  /**
   * Get or create a tag by name
   */
  private async getOrCreateTag(tagName: string): Promise<number> {
    try {
      // Check if tag exists
      const response = await this.client.get('/extras/tags/', {
        params: { name: tagName }
      });

      if (response.data.results && response.data.results.length > 0) {
        return response.data.results[0].id;
      }

      // Create tag
      const createResponse = await this.client.post('/extras/tags/', {
        name: tagName,
        slug: tagName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        color: 'f44336', // Red color for blocked
      });

      return createResponse.data.id;
    } catch (error: any) {
      console.warn(`Failed to get/create tag ${tagName}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get all VMs that have been synced by Bridge (have ext_id custom field)
   * Returns VMs with their ext_id, cluster info, and ownership for missing CI detection
   */
  async getSyncedVms(): Promise<Array<{
    id: number;
    name: string;
    extId: string;
    clusterId: number | null;
    clusterName: string | null;
    providerState: string | null;
    gateProviderId: string | null;
    status: string;
  }>> {
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

        // Only include VMs that have ext_id set (synced by Bridge)
        const syncedVms = response.data.results.filter(
          (vm: any) => vm.custom_fields?.ext_id
        );
        vms.push(...syncedVms);

        if (!response.data.next) {
          break;
        }

        offset += limit;
      }

      return vms.map((vm: any) => ({
        id: vm.id,
        name: vm.name,
        extId: vm.custom_fields?.ext_id || '',
        clusterId: vm.cluster?.id || null,
        clusterName: vm.cluster?.name || null,
        providerState: vm.custom_fields?.provider_state || null,
        gateProviderId: vm.custom_fields?.gate_provider_id || null,
        status: vm.status?.value || 'unknown',
      }));
    } catch (error: any) {
      console.error('Failed to get synced VMs:', error.message);
      throw new Error(`Failed to get synced VMs: ${error.message}`);
    }
  }

  /**
   * Mark a VM as missing (not present in provider inventory).
   * 
   * IMPORTANT: This does NOT delete the VM. It only:
   * - Sets status = offline
   * - Sets provider_state = missing
   * - Preserves all governance fields (tenant, role, automatable)
   * - Preserves all tags
   * 
   * @param vmId - NetBox VM ID
   * @param vmName - VM name for logging
   */
  async markVmAsMissing(vmId: number, vmName: string): Promise<void> {
    try {
      await this.client.patch(`/virtualization/virtual-machines/${vmId}/`, {
        status: 'offline',
        custom_fields: {
          provider_state: 'missing',
        },
      });
      console.log(`Marked VM as missing: ${vmName} (ID: ${vmId})`);
    } catch (error: any) {
      console.error(`Failed to mark VM as missing: ${vmName}`, error.message);
      throw error;
    }
  }

  /**
   * Get the default cluster ID used by Bridge sync.
   * Used for cluster safety check when marking VMs as missing.
   */
  async getDefaultClusterId(): Promise<number | null> {
    try {
      const response = await this.client.get('/virtualization/clusters/', {
        params: { name: 'Bridge-Default' }
      });

      if (response.data.count > 0) {
        return response.data.results[0].id;
      }
      return null;
    } catch (error: any) {
      console.error('Failed to get default cluster ID:', error.message);
      return null;
    }
  }
}

// NetBox API integration service
import axios from "axios";

interface NetBoxConfig {
  url: string;
  token: string;
}

export interface NetBoxGroup {
  name: string;
  count: number;
}

export interface NetBoxHost {
  name: string;
  primary_ip4?: string;
  tags?: string[];
  patch_wave?: string;
  patch_subwave?: string;
  ansible_user?: string;
}

export interface PreflightResult {
  matched: number;
  warnings: string[];
}

export class NetBoxService {
  private config: NetBoxConfig;

  constructor(config?: NetBoxConfig) {
    this.config = config ?? {
      url: process.env.NETBOX_URL || "",
      token: process.env.NETBOX_TOKEN || "",
    };
  }

  private getHeaders() {
    return {
      Authorization: `Token ${this.config.token}`,
      "Content-Type": "application/json",
    };
  }

  async testConnection(url?: string, token?: string): Promise<boolean> {
    try {
      // Remove trailing slash from URL to avoid double slashes
      const testUrl = (url || this.config.url)?.replace(/\/+$/, '');
      const testToken = token || this.config.token;
      
      console.log("Testing NetBox connection with URL:", testUrl);
      
      if (!testUrl) {
        throw new Error("NetBox URL is not configured");
      }
      
      const response = await axios.get(`${testUrl}/api/status/`, {
        headers: {
          Authorization: `Token ${testToken}`,
          "Content-Type": "application/json",
        },
        timeout: 5000,
      });
      return response.status === 200;
    } catch (error) {
      console.error("NetBox connection test failed:", error);
      return false;
    }
  }

  async getGroups(): Promise<NetBoxGroup[]> {
    try {
      // In a real implementation, this would fetch device groups/clusters from NetBox
      // For MVP, returning mock data structure
      return [
        { name: "web-servers", count: 12 },
        { name: "db-servers", count: 5 },
        { name: "app-servers", count: 8 },
        { name: "monitoring", count: 3 },
      ];
    } catch (error) {
      console.error("Failed to fetch NetBox groups:", error);
      throw new Error("Failed to fetch inventory groups");
    }
  }

  async getHosts(group?: string): Promise<NetBoxHost[]> {
    try {
      // In a real implementation, this would fetch devices from NetBox API
      // For MVP, returning mock data
      const mockHosts: NetBoxHost[] = [
        {
          name: "web-01.example.com",
          primary_ip4: "10.0.1.10",
          tags: ["production", "nginx", "customer_x"],
          patch_wave: "wave1",
          patch_subwave: "A",
          ansible_user: "ansible",
        },
        {
          name: "web-02.example.com",
          primary_ip4: "10.0.1.11",
          tags: ["production", "nginx", "customer_x"],
          patch_wave: "wave1",
          patch_subwave: "B",
          ansible_user: "ansible",
        },
        {
          name: "db-01.example.com",
          primary_ip4: "10.0.2.10",
          tags: ["production", "postgresql", "customer_y"],
          patch_wave: "wave2",
          ansible_user: "ansible",
        },
      ];

      return group ? mockHosts.filter(h => h.name.includes(group)) : mockHosts;
    } catch (error) {
      console.error("Failed to fetch NetBox hosts:", error);
      throw new Error("Failed to fetch inventory hosts");
    }
  }

  async preflightCheck(limitExpr: string): Promise<PreflightResult> {
    try {
      // Mock preflight implementation
      // In real app, this would parse the limit expression and query NetBox
      const warnings: string[] = [];
      let matched = 3;

      // Recognize keyed group patterns
      const keyedGroupPatterns = [
        /wave_\w+/i,
        /customer_\w+/i,
        /os_\w+/i,
        /role_\w+/i
      ];
      
      const hasKeyedGroups = keyedGroupPatterns.some(pattern => pattern.test(limitExpr));
      if (hasKeyedGroups) {
        // Valid keyed group usage
        matched = Math.floor(Math.random() * 5) + 1; // Simulate 1-5 matches
      }

      if (limitExpr.includes("missing")) {
        warnings.push("Some hosts are missing primary IP addresses");
        matched = 1;
      }

      if (limitExpr.includes("!") || limitExpr.includes("-")) {
        warnings.push("Negation patterns may exclude unexpected hosts");
      }

      if (limitExpr.length > 50) {
        warnings.push("Complex limit expressions may be slow to evaluate");
      }

      return { matched, warnings };
    } catch (error) {
      console.error("Preflight check failed:", error);
      throw new Error("Preflight validation failed");
    }
  }

  async getSuggestions(query: string, storage?: any, orgId?: string): Promise<string[]> {
    try {
      let allSuggestions: string[] = [
        // Traditional groups
        "tag_production",
        "tag_staging",
        "tag_development",
        "web-servers",
        "db-servers",
        "app-servers",
        "monitoring",
      ];
      
      // Add keyed groups from imported VMs if storage is provided.
      // Always use the org-scoped method when an orgId is supplied so that
      // one org's VM metadata never leaks into another org's suggestions.
      if (storage) {
        try {
          const vms = orgId
            ? await storage.getNetboxVms(orgId)
            : await storage.getNetboxVmsUnsafe();
          const keyedGroups = new Set<string>();
          
          vms.forEach((vm: any) => {
            const cf = vm.customFields || {};
            
            // Extract and add keyed groups
            const patchWave = cf.patch_wave || cf.Patching?.Wave;
            if (patchWave) keyedGroups.add(`wave_${patchWave}`);
            
            if (vm.tags && Array.isArray(vm.tags)) {
              vm.tags.forEach((tag: string) => {
                if (tag) keyedGroups.add(`customer_${tag}`);
              });
            }
            
            if (vm.operatingSystem && vm.operatingSystem !== 'Unknown') {
              keyedGroups.add(`os_${vm.operatingSystem.toLowerCase().replace(/\s+/g, '_')}`);
            }
            
            const role = cf.role || cf.device_role;
            if (role) keyedGroups.add(`role_${role.toLowerCase().replace(/\s+/g, '_')}`);
          });
          
          allSuggestions = [...allSuggestions, ...Array.from(keyedGroups)];
        } catch (error) {
          console.error("Failed to generate keyed groups for suggestions:", error);
        }
      } else {
        // Fallback keyed group examples when no storage
        allSuggestions = [
          ...allSuggestions,
          "wave_Wave1",
          "wave_Wave2",
          "wave_Wave3",
          "customer_Alpha",
          "customer_Beta",
          "os_linux",
          "os_windows",
          "role_web",
          "role_db",
          "role_app",
        ];
      }

      if (!query || query.length < 2) {
        return allSuggestions.slice(0, 10);
      }

      return allSuggestions
        .filter(s => s.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 15);
    } catch (error) {
      console.error("Failed to get suggestions:", error);
      return [];
    }
  }

  // Write operations for provider sync (mocked for MVP)
  async upsertVm(data: {
    externalId: string;
    name: string;
    provider: string;
    primaryIp4?: string;
    tags?: string[];
    customFields?: Record<string, any>;
  }): Promise<{ id: number; created: boolean }> {
    try {
      // Mock upsert - in real implementation, this would:
      // 1. Search for VM by custom_fields.ext_id
      // 2. Create or update the VM
      // 3. Ensure IP address exists and set primary_ip4
      // 4. Apply tags
      console.log(`[NetBox Mock] Upsert VM: ${data.name} (${data.externalId})`);
      
      // Simulate random ID
      const id = Math.floor(Math.random() * 10000);
      const created = Math.random() > 0.5; // Random create vs update
      
      return { id, created };
    } catch (error) {
      console.error("Failed to upsert VM:", error);
      throw error;
    }
  }

  async ensureCustomFields(fields: string[]): Promise<{ created: string[]; existing: string[] }> {
    try {
      // Mock custom field creation
      console.log(`[NetBox Mock] Ensure custom fields: ${fields.join(", ")}`);
      
      // Simulate some fields already exist
      const created: string[] = [];
      const existing: string[] = [];
      
      fields.forEach(field => {
        if (Math.random() > 0.5) {
          created.push(field);
        } else {
          existing.push(field);
        }
      });
      
      return { created, existing };
    } catch (error) {
      console.error("Failed to ensure custom fields:", error);
      throw error;
    }
  }

  async listAllGroups(storage?: any): Promise<Array<{ kind: string; name: string }>> {
    try {
      const groups: Array<{ kind: string; name: string }> = [];
      
      // If storage is provided, generate keyed groups from imported VMs
      if (storage) {
        const vms = await storage.getNetboxVmsUnsafe();
        const waveSet = new Set<string>();
        const customerSet = new Set<string>();
        const osSet = new Set<string>();
        const roleSet = new Set<string>();
        
        // Extract unique values from VMs
        vms.forEach((vm: any) => {
          const customFields = vm.customFields || {};
          
          // Extract patch_wave (supports both flat and nested)
          const patchWave = customFields.patch_wave || customFields.Patching?.Wave;
          if (patchWave && typeof patchWave === 'string' && patchWave.trim() !== '') {
            waveSet.add(patchWave);
          }
          
          // Extract customer from tags (looking for customer_* pattern)
          if (vm.tags && Array.isArray(vm.tags)) {
            vm.tags.forEach((tag: string) => {
              if (tag && typeof tag === 'string' && tag.trim() !== '') {
                customerSet.add(tag);
              }
            });
          }
          
          // Extract OS
          if (vm.operatingSystem && vm.operatingSystem.trim() !== '' && vm.operatingSystem !== 'Unknown') {
            osSet.add(vm.operatingSystem.toLowerCase().replace(/\s+/g, '_'));
          }
          
          // Extract role from custom fields
          const role = customFields.role || customFields.device_role;
          if (role && typeof role === 'string' && role.trim() !== '') {
            roleSet.add(role.toLowerCase().replace(/\s+/g, '_'));
          }
        });
        
        // Convert sets to groups with prefixes
        waveSet.forEach(wave => {
          groups.push({ kind: 'keyed_group', name: `wave_${wave}` });
        });
        customerSet.forEach(customer => {
          groups.push({ kind: 'keyed_group', name: `customer_${customer}` });
        });
        osSet.forEach(os => {
          groups.push({ kind: 'keyed_group', name: `os_${os}` });
        });
        roleSet.forEach(role => {
          groups.push({ kind: 'keyed_group', name: `role_${role}` });
        });
      }
      
      // Also include traditional groups (sites, tags, device roles, tenants)
      groups.push(
        { kind: "site", name: "DC1" },
        { kind: "site", name: "DC2" },
        { kind: "tag", name: "production" },
        { kind: "tag", name: "staging" },
        { kind: "device_role", name: "web-server" },
        { kind: "device_role", name: "db-server" },
        { kind: "tenant", name: "Customer A" },
        { kind: "tenant", name: "Customer B" }
      );
      
      return groups;
    } catch (error) {
      console.error("Failed to list all groups:", error);
      throw error;
    }
  }

  async getVirtualMachines(url?: string, token?: string): Promise<Array<{
    id: number;
    name: string;
    ip?: string;
    operatingSystem?: string;
    customFields: Record<string, any>;
    tags: string[];
  }>> {
    try {
      // Remove trailing slash from URL to avoid double slashes
      const apiUrl = (url || this.config.url)?.replace(/\/+$/, '');
      const apiToken = token || this.config.token;

      if (!apiUrl) {
        throw new Error("NetBox URL is not configured");
      }

      console.log(`Fetching VMs from NetBox: ${apiUrl}/api/virtualization/virtual-machines/`);

      const response = await axios.get(`${apiUrl}/api/virtualization/virtual-machines/`, {
        headers: {
          Authorization: `Token ${apiToken}`,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      });

      const vms = response.data.results || [];
      console.log(`Fetched ${vms.length} VMs from NetBox`);

      return vms.map((vm: any) => {
        // Extract primary IP
        const primaryIp = vm.primary_ip4?.address?.split('/')[0] || vm.primary_ip?.address?.split('/')[0] || undefined;

        // Determine operating system from platform or custom fields
        let os = vm.custom_fields?.operating_system || vm.platform?.name || "Unknown";
        
        // Normalize OS to Linux/Windows/Other
        if (os.toLowerCase().includes('linux') || os.toLowerCase().includes('ubuntu') || 
            os.toLowerCase().includes('debian') || os.toLowerCase().includes('centos') || 
            os.toLowerCase().includes('rhel') || os.toLowerCase().includes('fedora')) {
          os = "Linux";
        } else if (os.toLowerCase().includes('windows')) {
          os = "Windows";
        } else if (os !== "Unknown") {
          os = "Other";
        }

        // Extract tags
        const tags = vm.tags?.map((tag: any) => tag.name || tag.slug || tag) || [];

        // Extract all custom fields
        const customFields = vm.custom_fields || {};

        return {
          id: vm.id,
          name: vm.name,
          ip: primaryIp,
          operatingSystem: os,
          customFields,
          tags,
        };
      });
    } catch (error: any) {
      console.error("Failed to fetch VMs from NetBox:", error.message);
      throw new Error(`Failed to fetch VMs: ${error.message}`);
    }
  }
}

export const netboxService = new NetBoxService();

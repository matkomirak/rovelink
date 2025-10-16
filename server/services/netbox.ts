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

  constructor() {
    this.config = {
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
      const testUrl = url || this.config.url;
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

      if (limitExpr.includes("missing")) {
        warnings.push("Some hosts are missing primary IP addresses");
        matched = 1;
      }

      if (limitExpr.includes("!")) {
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

  async getSuggestions(query: string): Promise<string[]> {
    try {
      // Mock suggestions based on common NetBox tags and groups
      const allSuggestions = [
        "tag_production",
        "tag_staging",
        "tag_development",
        "tag_customer_x",
        "tag_customer_y",
        "tag_nginx",
        "tag_postgresql",
        "tag_redis",
        "tag_os_linux",
        "tag_os_windows",
        "web-servers",
        "db-servers",
        "app-servers",
        "monitoring",
        "wave1",
        "wave2",
        "wave3",
        "subwave_A",
        "subwave_B",
      ];

      if (!query || query.length < 2) {
        return [];
      }

      return allSuggestions
        .filter(s => s.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 10);
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

  async listAllGroups(): Promise<Array<{ kind: string; name: string }>> {
    try {
      // Mock fetching all group types for cache
      return [
        { kind: "site", name: "DC1" },
        { kind: "site", name: "DC2" },
        { kind: "tag", name: "production" },
        { kind: "tag", name: "staging" },
        { kind: "device_role", name: "web-server" },
        { kind: "device_role", name: "db-server" },
        { kind: "tenant", name: "Customer A" },
        { kind: "tenant", name: "Customer B" },
      ];
    } catch (error) {
      console.error("Failed to list all groups:", error);
      throw error;
    }
  }
}

export const netboxService = new NetBoxService();

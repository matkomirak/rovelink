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

  async testConnection(): Promise<boolean> {
    try {
      const response = await axios.get(`${this.config.url}/api/status/`, {
        headers: this.getHeaders(),
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
}

export const netboxService = new NetBoxService();

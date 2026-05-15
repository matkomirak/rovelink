/**
 * ServiceNow CMDB Adapter
 * Uses the ServiceNow Table API:
 * https://docs.servicenow.com/bundle/washingtondc-api-reference/page/integrate/inbound-rest/concept/c_TableAPI.html
 *
 * Authentication: Basic auth (username + password).
 */

import axios, { AxiosInstance } from "axios";

export interface ServiceNowConfig {
  url: string;
  username: string;
  password: string;
}

export class ServiceNowAdapter {
  private config: ServiceNowConfig;
  private client: AxiosInstance;

  constructor(config: ServiceNowConfig) {
    this.config = config;
    this.client = axios.create({
      baseURL: config.url.replace(/\/$/, ""),
      auth: { username: config.username, password: config.password },
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      timeout: 30000,
    });
  }

  objectTypes(): string[] {
    return [
      "cmdb_ci_vm_instance",
      "cmdb_ci_server",
      "cmdb_ci_network_adapter",
      "cmdb_ci_ip_address",
    ];
  }

  async test(): Promise<{ ok: boolean; version?: string; error?: string }> {
    try {
      await this.client.get("/api/now/table/sys_properties", {
        params: { sysparm_limit: 1, sysparm_fields: "name" },
      });
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  async upsert(targetType: string, obj: any, matchBy: string[] = ["name"]): Promise<any> {
    const table = this.resolveTable(targetType);

    const query = matchBy
      .map((f) => `${f}=${encodeURIComponent(obj[f] ?? "")}`)
      .join("^");
    const searchRes = await this.client.get(`/api/now/table/${table}`, {
      params: { sysparm_query: query, sysparm_limit: 1 },
    });
    const results = searchRes.data?.result ?? [];

    const payload = this.mapToServiceNow(targetType, obj);

    if (results.length > 0) {
      const sysId: string = results[0].sys_id;
      await this.client.patch(`/api/now/table/${table}/${sysId}`, payload);
      return { action: "updated", sys_id: sysId };
    } else {
      const createRes = await this.client.post(`/api/now/table/${table}`, payload);
      return { action: "created", sys_id: createRes.data?.result?.sys_id };
    }
  }

  validate(targetType: string, obj: any): { errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!obj.name) errors.push("name is required");
    return { errors, warnings };
  }

  private resolveTable(targetType: string): string {
    const map: Record<string, string> = {
      cmdb_ci_vm_instance: "cmdb_ci_vm_instance",
      cmdb_ci_server: "cmdb_ci_server",
      cmdb_ci_network_adapter: "cmdb_ci_network_adapter",
      cmdb_ci_ip_address: "cmdb_ci_ip_address",
      VirtualMachine: "cmdb_ci_vm_instance",
      Server: "cmdb_ci_server",
    };
    return map[targetType] ?? targetType;
  }

  private mapToServiceNow(targetType: string, obj: any): Record<string, any> {
    const payload: Record<string, any> = { name: obj.name };
    if (obj.vcpus !== undefined) payload.cpu_core_count = obj.vcpus;
    if (obj.memory !== undefined) payload.ram = obj.memory;
    if (obj.platform) payload.os = obj.platform;
    if (obj.primaryIp4) payload.ip_address = obj.primaryIp4;
    if (obj.status)
      payload.operational_status = obj.status === "running" ? "1" : "6";
    return payload;
  }
}

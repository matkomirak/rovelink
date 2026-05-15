/**
 * i-doit CMDB Adapter
 * Uses the i-doit JSON-RPC 2.0 API at /src/jsonrpc.php
 */

import axios, { AxiosInstance } from "axios";

export interface IdoitConfig {
  url: string;
  apiKey: string;
  username?: string;
  password?: string;
}

export interface ValidationResult {
  errors: string[];
  warnings: string[];
}

export class IdoitAdapter {
  private config: IdoitConfig;
  private client: AxiosInstance;
  private sessionId?: string;
  private requestId = 1;

  constructor(config: IdoitConfig) {
    this.config = config;
    this.client = axios.create({
      baseURL: config.url.replace(/\/$/, ""),
      headers: { "Content-Type": "application/json" },
      timeout: 30000,
    });
  }

  private async rpc(method: string, params: Record<string, any>): Promise<any> {
    const body = {
      version: "2.0",
      method,
      params: { apikey: this.config.apiKey, ...params },
      id: this.requestId++,
    };
    const res = await this.client.post("/src/jsonrpc.php", body);
    if (res.data.error) {
      throw new Error(`iDoIT RPC error [${res.data.error.code}]: ${res.data.error.message}`);
    }
    return res.data.result;
  }

  objectTypes(): string[] {
    return [
      "VirtualServer",
      "Interface",
      "IPv4Address",
      "Tenant",
      "Site",
      "PhysicalServer",
      "Application",
    ];
  }

  async test(): Promise<{ ok: boolean; version?: string; error?: string }> {
    try {
      const result = await this.rpc("idoit.version", {});
      return { ok: true, version: result?.version };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  async upsert(targetType: string, obj: any, matchBy: string[] = ["name"]): Promise<any> {
    const typeId = this.resolveTypeId(targetType);

    const searchResult = await this.rpc("cmdb.objects.read", {
      filter: { type: typeId, title: obj.name },
    });

    const existing = Array.isArray(searchResult) ? searchResult[0] : null;

    if (existing) {
      await this.writeCategoryData(existing.id, obj);
      return { action: "updated", id: existing.id };
    } else {
      const created = await this.rpc("cmdb.object.create", {
        type: typeId,
        title: obj.name,
      });
      await this.writeCategoryData(created.id, obj);
      return { action: "created", id: created.id };
    }
  }

  private async writeCategoryData(objectId: number, obj: any): Promise<void> {
    const catData: Record<string, any> = {};
    if (obj.vcpus !== undefined) catData.cpu_cores = obj.vcpus;
    if (obj.memory !== undefined) catData.memory_mb = obj.memory;
    if (obj.platform !== undefined) catData.operating_system = obj.platform;
    if (obj.primaryIp4) catData.primary_ip = obj.primaryIp4;

    if (Object.keys(catData).length > 0) {
      await this.rpc("cmdb.category.save", {
        object: objectId,
        catconst: "C__CATG__VIRTUAL_MACHINE",
        data: catData,
      });
    }
  }

  validate(targetType: string, obj: any): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    switch (targetType) {
      case "VirtualServer":
        if (!obj.name || typeof obj.name !== "string") {
          errors.push("VirtualServer requires a valid 'name' field");
        }
        if (obj.memory && typeof obj.memory !== "number") {
          errors.push("VirtualServer 'memory' must be a number");
        }
        if (obj.cpu_cores && typeof obj.cpu_cores !== "number") {
          errors.push("VirtualServer 'cpu_cores' must be a number");
        }
        if (!obj.operating_system) {
          warnings.push("VirtualServer should have 'operating_system' specified");
        }
        break;
      case "Interface":
        if (!obj.name) errors.push("Interface requires a 'name' field");
        if (!obj.mac_address)
          warnings.push("Interface should have 'mac_address' for proper identification");
        break;
      case "IPv4Address":
        if (!obj.address) {
          errors.push("IPv4Address requires an 'address' field");
        } else if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(obj.address)) {
          errors.push("IPv4Address 'address' must be a valid IPv4 address");
        }
        break;
      case "Tenant":
        if (!obj.name) errors.push("Tenant requires a 'name' field");
        break;
      case "Site":
        if (!obj.name) errors.push("Site requires a 'name' field");
        break;
      default:
        warnings.push(`Unknown target type: ${targetType}`);
    }

    return { errors, warnings };
  }

  private resolveTypeId(targetType: string): number {
    const typeMap: Record<string, number> = {
      VirtualServer: 1011,
      PhysicalServer: 5,
      Application: 58,
      Interface: 76,
      Site: 6,
      Tenant: 1,
    };
    const id = typeMap[targetType];
    if (!id) throw new Error(`Unknown iDoIT object type: ${targetType}`);
    return id;
  }
}

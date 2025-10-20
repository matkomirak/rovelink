/**
 * i-doit CMDB Adapter (Stub for Phase 3)
 * Provides object types and validation for i-doit targets
 */

export interface IdoitConfig {
  url: string;
  apiKey: string;
}

export interface ValidationResult {
  errors: string[];
  warnings: string[];
}

export class IdoitAdapter {
  private config: IdoitConfig;

  constructor(config: IdoitConfig) {
    this.config = config;
  }

  /**
   * Get supported object types for i-doit
   */
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

  /**
   * Validate an object against i-doit schema
   * Basic validation for Phase 3 - full implementation later
   */
  validate(targetType: string, obj: any): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Basic validation based on target type
    switch (targetType) {
      case "VirtualServer":
        if (!obj.name || typeof obj.name !== 'string') {
          errors.push("VirtualServer requires a valid 'name' field");
        }
        if (obj.memory && typeof obj.memory !== 'number') {
          errors.push("VirtualServer 'memory' must be a number");
        }
        if (obj.cpu_cores && typeof obj.cpu_cores !== 'number') {
          errors.push("VirtualServer 'cpu_cores' must be a number");
        }
        if (!obj.operating_system) {
          warnings.push("VirtualServer should have 'operating_system' specified");
        }
        break;

      case "Interface":
        if (!obj.name) {
          errors.push("Interface requires a 'name' field");
        }
        if (!obj.mac_address) {
          warnings.push("Interface should have 'mac_address' for proper identification");
        }
        break;

      case "IPv4Address":
        if (!obj.address) {
          errors.push("IPv4Address requires an 'address' field");
        } else if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(obj.address)) {
          errors.push("IPv4Address 'address' must be a valid IPv4 address");
        }
        break;

      case "Tenant":
        if (!obj.name) {
          errors.push("Tenant requires a 'name' field");
        }
        break;

      case "Site":
        if (!obj.name) {
          errors.push("Site requires a 'name' field");
        }
        break;

      default:
        warnings.push(`Unknown target type: ${targetType}`);
    }

    return { errors, warnings };
  }

  /**
   * Test connection to i-doit (stub for Phase 3)
   */
  async test(): Promise<{ ok: boolean; version?: string; error?: string }> {
    try {
      // Stub implementation - would make actual API call in full implementation
      // For now, just validate config
      if (!this.config.url || !this.config.apiKey) {
        return {
          ok: false,
          error: "i-doit URL and API key are required"
        };
      }

      // Simulate successful connection test
      return {
        ok: true,
        version: "1.18.2", // Stub version
      };
    } catch (error: any) {
      return {
        ok: false,
        error: error.message || "Connection test failed"
      };
    }
  }

  /**
   * Upsert object to i-doit (not implemented for Phase 3)
   * Will be implemented in later phase
   */
  async upsert(targetType: string, obj: any, matchBy?: string[]): Promise<any> {
    throw new Error("i-doit upsert not implemented in Phase 3 - use validate() for dry-run only");
  }
}

// Normalized VM type that all providers must return
export interface NormalizedVm {
  externalId: string; // Stable unique ID from provider
  name: string;
  provider: string; // Provider kind (proxmox, azure, vmware)
  primaryIp4?: string;
  primaryIp6?: string;
  vcpus?: number;
  memory?: number; // Memory in MB
  disk?: number; // Disk in GB
  platform?: string; // OS platform: linux, windows
  description?: string;
  status?: string; // running, stopped, etc.
  tags: string[];
  tenant?: string;
  site?: string;
  role?: string;
  raw?: any; // Raw provider data for debugging
}

// Test connection result
export interface TestConnectionResult {
  ok: boolean;
  details?: string;
  error?: string;
  version?: string;
}

// Provider interface that all collectors must implement
export interface IProviderCollector {
  testConnection(): Promise<TestConnectionResult>;
  listVms(): Promise<NormalizedVm[]>;
}

// Provider factory function type
export type ProviderFactory = (config: any) => IProviderCollector;

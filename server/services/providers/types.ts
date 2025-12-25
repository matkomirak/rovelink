// Observed asset - mandatory data describing VM existence and state
// This is factual data that providers MUST return
export interface ObservedAsset {
  provider_id: string; // Stable unique ID from provider
  name: string;
  provider: string; // Provider kind (proxmox, azure, vmware, fake)
  status: string; // running, stopped, etc.
  last_seen_at: Date;
  primaryIp4?: string;
  primaryIp6?: string;
  vcpus?: number;
  memory?: number; // Memory in MB
  disk?: number; // Disk in GB
  platform?: string; // OS platform: linux, windows
  description?: string;
  cluster?: string; // Infrastructure cluster
  site?: string; // Physical location (non-governance)
}

// Provider hints - optional metadata that MAY help humans later
// These are NON-AUTHORITATIVE and MUST NOT be used for gate decisions
// These MUST NOT populate NetBox governance fields
export interface ProviderHints {
  provider_tags?: string[]; // Tags from provider (e.g. customer:Alpha)
  provider_project?: string; // Project/folder in provider
  provider_folder?: string; // Folder path in provider
  provider_tenant?: string; // Tenant suggestion from provider (NOT authoritative)
  provider_role?: string; // Role suggestion from provider (NOT authoritative)
  raw?: any; // Raw provider data for debugging
}

// Provider output - separates observed facts from non-authoritative hints
export interface ProviderOutput {
  observed: ObservedAsset;
  hints?: ProviderHints;
}

// Legacy NormalizedVm type for backward compatibility during transition
// TODO: Remove after full migration to ProviderOutput
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
  // New method that returns separated observed/hints data
  // Providers should implement this going forward
  listVmsWithHints?(): Promise<ProviderOutput[]>;
}

// Provider factory function type
export type ProviderFactory = (config: any) => IProviderCollector;

export interface NormalizedVM {
  externalId: string;
  name: string;
  status?: string;
  platform?: string;
  description?: string;
  vcpus?: number;
  memory?: number;
  disk?: number;
  ipv4?: string[];
  ipv6?: string[];
  tags?: string[];
  tenant?: string;
  site?: string;
  cluster?: string;
  node?: string;
  raw?: Record<string, unknown>;
}

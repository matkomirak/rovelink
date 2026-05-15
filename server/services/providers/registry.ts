import { ProviderFactory } from "./types";
import { createProxmoxCollector } from "./proxmox";
import { createFakeCollector } from "./fake";
import { createAzureCollector } from "./azure";
import { createVCenterCollector } from "./vcenter";

// Provider registry mapping kind to factory function
const providerRegistry: Record<string, ProviderFactory> = {
  proxmox: createProxmoxCollector,
  fake: createFakeCollector,
  azure: createAzureCollector,
  vcenter: createVCenterCollector,
};

export function getProviderCollector(kind: string, config: any) {
  const factory = providerRegistry[kind];
  if (!factory) {
    throw new Error(`Unknown provider kind: ${kind}`);
  }
  return factory(config);
}

export function getSupportedProviderKinds(): string[] {
  return Object.keys(providerRegistry);
}

import type { IStorage } from "../storage";
import { storage as defaultStorage } from "../storage";
import type { ProviderAccount } from "@shared/schema";
import {
  type ProviderInfrastructureSyncResult,
  syncProviderInfrastructureInventory,
} from "./provider-infrastructure-sync";

export type FakeInfrastructureSyncResult = ProviderInfrastructureSyncResult;

export async function syncFakeProviderInfrastructure(
  provider: ProviderAccount,
  orgId: string,
  config: Record<string, unknown>,
  store: IStorage = defaultStorage as IStorage,
): Promise<FakeInfrastructureSyncResult> {
  if (provider.kind !== "fake") {
    throw new Error("Normalized infrastructure inventory sync is currently implemented only for fake providers");
  }

  return syncProviderInfrastructureInventory(provider, orgId, config, store);
}

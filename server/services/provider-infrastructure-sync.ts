import type { IStorage } from "../storage";
import { storage as defaultStorage } from "../storage";
import type {
  InfrastructureObject,
  InfrastructureProviderType,
  InfrastructureRelationship,
  InsertInfrastructureObject,
  InsertInfrastructureRelationship,
  InsertProviderCustomerScopeCandidate,
  ProviderAccount,
  ProviderCustomerScopeCandidate,
} from "@shared/schema";
import { getProviderCollector } from "./providers/registry";
import type { AzureConfig } from "./providers/azure";
import { fakeInfrastructureNormalizer } from "./infrastructure-normalizers/fake";
import { azureInfrastructureNormalizer } from "./infrastructure-normalizers/azure";
import type {
  InfrastructureNormalizationResult,
  InfrastructureProviderNormalizer,
  NormalizedInfrastructureRelationshipInput,
} from "./infrastructure-normalizers/types";
import type { IProviderCollector } from "./providers/types";

export interface ProviderInfrastructureSyncResult {
  sourceId: string;
  providerType: string;
  objectsUpserted: number;
  relationshipsUpserted: number;
  customerScopeCandidatesUpserted: number;
  skipped: Array<{ externalId?: string; name?: string; reason: string; item?: unknown }>;
  errors: Array<{ externalId?: string; name?: string; message: string; item?: unknown }>;
}

export class ProviderInfrastructureSyncNotSupportedError extends Error {
  result: ProviderInfrastructureSyncResult;

  constructor(provider: ProviderAccount) {
    super("Normalized infrastructure inventory sync is currently implemented only for fake and Azure providers");
    this.name = "ProviderInfrastructureSyncNotSupportedError";
    this.result = {
      sourceId: provider.id,
      providerType: provider.kind,
      objectsUpserted: 0,
      relationshipsUpserted: 0,
      customerScopeCandidatesUpserted: 0,
      skipped: [{ reason: `Provider kind '${provider.kind}' is not implemented for normalized infrastructure sync yet` }],
      errors: [],
    };
  }
}

export class ProviderInfrastructureSyncConfigError extends Error {
  result: ProviderInfrastructureSyncResult;

  constructor(provider: ProviderAccount, message: string) {
    super(message);
    this.name = "ProviderInfrastructureSyncConfigError";
    this.result = emptyResult(provider, [{ message }]);
  }
}

export class ProviderInfrastructureSyncDiscoveryError extends Error {
  result: ProviderInfrastructureSyncResult;

  constructor(provider: ProviderAccount, message = "Provider infrastructure discovery failed") {
    super(message);
    this.name = "ProviderInfrastructureSyncDiscoveryError";
    this.result = emptyResult(provider, [{ message }]);
  }
}

interface InfrastructureStorage {
  upsertInfrastructureObject(input: InsertInfrastructureObject): Promise<InfrastructureObject>;
  upsertInfrastructureRelationship?(input: InsertInfrastructureRelationship): Promise<InfrastructureRelationship>;
  upsertProviderCustomerScopeCandidate(input: InsertProviderCustomerScopeCandidate): Promise<ProviderCustomerScopeCandidate>;
}

interface InfrastructureCollector extends IProviderCollector {
  discoverAll?: () => Promise<unknown>;
}

interface SyncOptions {
  collectorFactory?: (kind: string, config: Record<string, unknown>) => InfrastructureCollector;
}

const normalizers: Partial<Record<InfrastructureProviderType, InfrastructureProviderNormalizer<any>>> = {
  fake: fakeInfrastructureNormalizer,
  azure: azureInfrastructureNormalizer,
};

export async function syncProviderInfrastructureInventory(
  provider: ProviderAccount,
  orgId: string,
  config: Record<string, unknown>,
  store: InfrastructureStorage = defaultStorage as IStorage,
  options: SyncOptions = {},
): Promise<ProviderInfrastructureSyncResult> {
  const normalizer = normalizers[provider.kind as InfrastructureProviderType];
  if (!normalizer) {
    throw new ProviderInfrastructureSyncNotSupportedError(provider);
  }

  const now = new Date();
  const result: ProviderInfrastructureSyncResult = {
    sourceId: provider.id,
    providerType: provider.kind,
    objectsUpserted: 0,
    relationshipsUpserted: 0,
    customerScopeCandidatesUpserted: 0,
    skipped: [],
    errors: [],
  };

  const items = await collectProviderItems(provider, config, options.collectorFactory ?? getProviderCollector);
  const normalized = await normalizer.normalize({ provider, orgId, items, config, now });
  result.skipped.push(...toSkipped(normalized));
  result.errors.push(...toErrors(normalized));

  const objectIdByRef = new Map<string, string>();

  for (const objectInput of normalized.objects) {
    try {
      const object = await store.upsertInfrastructureObject({
        ...objectInput,
        orgId,
        sourceId: provider.id,
      });
      objectIdByRef.set(objectRefKey(object.objectType, object.externalId), object.id);
      result.objectsUpserted++;
    } catch (error: any) {
      result.errors.push({
        externalId: objectInput.externalId,
        name: objectInput.name ?? undefined,
        message: error?.message || "Failed to upsert infrastructure object",
      });
    }
  }

  for (const candidate of normalized.customerScopeCandidates) {
    const objectId = objectIdByRef.get(objectRefKey(candidate.object.objectType, candidate.object.externalId));
    if (!objectId) {
      result.skipped.push({
        reason: "CustomerScope candidate references an object that was not upserted",
        item: candidate.object,
      });
      continue;
    }

    try {
      await store.upsertProviderCustomerScopeCandidate({
        ...candidate,
        orgId,
        sourceId: provider.id,
        objectId,
      });
      result.customerScopeCandidatesUpserted++;
    } catch (error: any) {
      result.errors.push({
        externalId: candidate.object.externalId,
        message: error?.message || "Failed to upsert provider customer scope candidate",
      });
    }
  }

  if (store.upsertInfrastructureRelationship) {
    for (const relationship of normalized.relationships) {
      const input = buildRelationshipInput(relationship, objectIdByRef, orgId, provider.id);
      if (!input) {
        result.skipped.push({
          reason: "Infrastructure relationship references objects that were not upserted",
          item: {
            fromObject: relationship.fromObject,
            toObject: relationship.toObject,
            relationshipType: relationship.relationshipType,
          },
        });
        continue;
      }

      try {
        await store.upsertInfrastructureRelationship(input);
        result.relationshipsUpserted++;
      } catch (error: any) {
        result.errors.push({
          message: error?.message || "Failed to upsert infrastructure relationship",
          item: {
            fromObject: relationship.fromObject,
            toObject: relationship.toObject,
            relationshipType: relationship.relationshipType,
          },
        });
      }
    }
  } else if (normalized.relationships.length > 0) {
    result.skipped.push({
      reason: "Infrastructure relationship storage is not available",
      item: { count: normalized.relationships.length },
    });
  }

  return result;
}

async function collectProviderItems(
  provider: ProviderAccount,
  config: Record<string, unknown>,
  collectorFactory: (kind: string, config: Record<string, unknown>) => InfrastructureCollector,
): Promise<unknown[]> {
  if (provider.kind === "azure") {
    validateAzureConfig(provider, config);
  }

  const collector = collectorFactory(provider.kind, config);

  if (provider.kind === "azure") {
    if (typeof collector.discoverAll !== "function") {
      throw new ProviderInfrastructureSyncConfigError(provider, "Azure collector does not support normalized infrastructure discovery");
    }

    try {
      return [await collector.discoverAll()];
    } catch {
      throw new ProviderInfrastructureSyncDiscoveryError(provider, "Azure infrastructure discovery failed");
    }
  }

  try {
    return await collector.listVms();
  } catch {
    throw new ProviderInfrastructureSyncDiscoveryError(provider, "Provider infrastructure discovery failed");
  }
}

function validateAzureConfig(
  provider: ProviderAccount,
  config: Record<string, unknown>,
): asserts config is Record<string, unknown> & AzureConfig {
  const requiredFields = ["subscription_id", "tenant_id", "client_id", "client_secret"] as const;
  const missing = requiredFields.filter((field) => typeof config[field] !== "string" || String(config[field]).trim().length === 0);
  if (missing.length > 0) {
    throw new ProviderInfrastructureSyncConfigError(
      provider,
      `Azure provider config is missing required fields: ${missing.join(", ")}`,
    );
  }
}

function buildRelationshipInput(
  relationship: NormalizedInfrastructureRelationshipInput,
  objectIdByRef: Map<string, string>,
  orgId: string,
  sourceId: string,
): InsertInfrastructureRelationship | null {
  const fromObjectId = objectIdByRef.get(objectRefKey(relationship.fromObject.objectType, relationship.fromObject.externalId));
  const toObjectId = objectIdByRef.get(objectRefKey(relationship.toObject.objectType, relationship.toObject.externalId));
  if (!fromObjectId || !toObjectId) return null;

  const { fromObject: _fromObject, toObject: _toObject, ...rest } = relationship;
  return {
    ...rest,
    orgId,
    sourceId,
    fromObjectId,
    toObjectId,
  };
}

function objectRefKey(objectType: string, externalId: string) {
  return `${objectType}:${externalId}`;
}

function emptyResult(
  provider: ProviderAccount,
  errors: ProviderInfrastructureSyncResult["errors"] = [],
): ProviderInfrastructureSyncResult {
  return {
    sourceId: provider.id,
    providerType: provider.kind,
    objectsUpserted: 0,
    relationshipsUpserted: 0,
    customerScopeCandidatesUpserted: 0,
    skipped: [],
    errors,
  };
}

function toSkipped(normalized: InfrastructureNormalizationResult): ProviderInfrastructureSyncResult["skipped"] {
  return normalized.skipped.map((item) => ({ reason: item.reason, item: item.item }));
}

function toErrors(normalized: InfrastructureNormalizationResult): ProviderInfrastructureSyncResult["errors"] {
  return normalized.errors.map((item) => ({ message: item.message, item: item.item }));
}

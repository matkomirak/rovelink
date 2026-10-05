import type {
  InfrastructureProviderType,
  InsertInfrastructureObject,
  InsertInfrastructureRelationship,
  InsertProviderCustomerScopeCandidate,
  ProviderAccount,
} from "@shared/schema";

export type NormalizedInfrastructureObjectInput = Omit<InsertInfrastructureObject, "orgId" | "sourceId">;

export interface InfrastructureObjectRef {
  objectType: string;
  externalId: string;
}

export interface NormalizedInfrastructureRelationshipInput
  extends Omit<InsertInfrastructureRelationship, "orgId" | "sourceId" | "fromObjectId" | "toObjectId"> {
  fromObject: InfrastructureObjectRef;
  toObject: InfrastructureObjectRef;
}

export interface NormalizedProviderCustomerScopeCandidateInput
  extends Omit<InsertProviderCustomerScopeCandidate, "orgId" | "sourceId" | "objectId"> {
  object: InfrastructureObjectRef;
}

export interface InfrastructureNormalizationResult {
  objects: NormalizedInfrastructureObjectInput[];
  relationships: NormalizedInfrastructureRelationshipInput[];
  customerScopeCandidates: NormalizedProviderCustomerScopeCandidateInput[];
  skipped: Array<{ reason: string; item?: unknown }>;
  errors: Array<{ message: string; item?: unknown }>;
}

export interface InfrastructureProviderNormalizer<TInput = unknown> {
  providerType: InfrastructureProviderType;
  normalize(input: {
    provider: ProviderAccount;
    orgId: string;
    items: TInput[];
    config: Record<string, unknown>;
    now: Date;
  }): Promise<InfrastructureNormalizationResult> | InfrastructureNormalizationResult;
}

// WARNING:
// This store contains DERIVED STATE ONLY.
// Data here is non-authoritative and may be dropped at any time.
// Do NOT build business logic that depends on persistence here.
//
// Provider hints are NON-AUTHORITATIVE suggestions.
// They MUST NEVER be used to satisfy gate requirements.
// They exist only for human reference and transparency.

import type { ProviderHints } from "./providers/types";

export interface StoredProviderHint {
  orgId: string;
  providerAccountId: string;
  vmName: string;
  providerId: string;
  hints: ProviderHints;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Ephemeral in-memory provider hints store.
 *
 * Provider hints are NON-AUTHORITATIVE and MUST NOT affect gate decisions.
 * This store exists only for transparency - it has NO authority.
 *
 * All methods are org-scoped: hints from org A are never visible to org B.
 */
export class ProviderHintsStore {
  // Ephemeral in-memory storage - can be cleared at any time
  private hints: Map<string, StoredProviderHint> = new Map();

  private compositeKey(orgId: string, providerAccountId: string, providerId: string): string {
    return `${orgId}:${providerAccountId}:${providerId}`;
  }

  async upsertHint(
    orgId: string,
    providerAccountId: string,
    vmName: string,
    providerId: string,
    hints: ProviderHints
  ): Promise<StoredProviderHint> {
    const key = this.compositeKey(orgId, providerAccountId, providerId);
    const now = new Date();
    const existing = this.hints.get(key);

    const stored: StoredProviderHint = {
      orgId,
      providerAccountId,
      vmName,
      providerId,
      hints,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    this.hints.set(key, stored);
    return stored;
  }

  async getHintsByVmName(orgId: string, vmName: string): Promise<StoredProviderHint | null> {
    for (const hint of Array.from(this.hints.values())) {
      if (hint.orgId === orgId && hint.vmName === vmName) {
        return hint;
      }
    }
    return null;
  }

  async getHintsByProviderId(orgId: string, providerId: string): Promise<StoredProviderHint | null> {
    for (const hint of Array.from(this.hints.values())) {
      if (hint.orgId === orgId && hint.providerId === providerId) {
        return hint;
      }
    }
    return null;
  }

  async getAllHintsForProvider(orgId: string, providerAccountId: string): Promise<StoredProviderHint[]> {
    return Array.from(this.hints.values()).filter(
      (h) => h.orgId === orgId && h.providerAccountId === providerAccountId
    );
  }

  async deleteHintsForProvider(orgId: string, providerAccountId: string): Promise<void> {
    for (const [key, hint] of Array.from(this.hints.entries())) {
      if (hint.orgId === orgId && hint.providerAccountId === providerAccountId) {
        this.hints.delete(key);
      }
    }
  }

  async clear(): Promise<void> {
    this.hints.clear();
  }
}

export const providerHintsStore = new ProviderHintsStore();

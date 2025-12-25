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
 */
export class ProviderHintsStore {
  // Ephemeral in-memory storage - can be cleared at any time
  private hints: Map<string, StoredProviderHint> = new Map();

  async upsertHint(
    providerAccountId: string,
    vmName: string,
    providerId: string,
    hints: ProviderHints
  ): Promise<StoredProviderHint> {
    const key = `${providerAccountId}:${providerId}`;
    const now = new Date();
    const existing = this.hints.get(key);

    const stored: StoredProviderHint = {
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

  async getHintsByVmName(vmName: string): Promise<StoredProviderHint | null> {
    const allHints = Array.from(this.hints.values());
    for (const hint of allHints) {
      if (hint.vmName === vmName) {
        return hint;
      }
    }
    return null;
  }

  async getHintsByProviderId(providerId: string): Promise<StoredProviderHint | null> {
    const allHints = Array.from(this.hints.values());
    for (const hint of allHints) {
      if (hint.providerId === providerId) {
        return hint;
      }
    }
    return null;
  }

  async getAllHintsForProvider(providerAccountId: string): Promise<StoredProviderHint[]> {
    return Array.from(this.hints.values()).filter(
      (h) => h.providerAccountId === providerAccountId
    );
  }

  async deleteHintsForProvider(providerAccountId: string): Promise<void> {
    const entries = Array.from(this.hints.entries());
    for (const [key, hint] of entries) {
      if (hint.providerAccountId === providerAccountId) {
        this.hints.delete(key);
      }
    }
  }

  async clear(): Promise<void> {
    this.hints.clear();
  }
}

export const providerHintsStore = new ProviderHintsStore();

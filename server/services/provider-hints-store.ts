import { db } from "../db";
import { providerHints } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import type { ProviderHints } from "./providers/types";

export interface StoredProviderHint {
  id: string;
  providerAccountId: string;
  vmName: string;
  providerId: string;
  hints: ProviderHints;
  createdAt: Date;
  updatedAt: Date;
}

export class ProviderHintsStore {
  async upsertHint(
    providerAccountId: string,
    vmName: string,
    providerId: string,
    hints: ProviderHints
  ): Promise<StoredProviderHint> {
    const existing = await db
      .select()
      .from(providerHints)
      .where(
        and(
          eq(providerHints.providerAccountId, providerAccountId),
          eq(providerHints.providerId, providerId)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      const [updated] = await db
        .update(providerHints)
        .set({
          vmName,
          hints,
          updatedAt: new Date(),
        })
        .where(eq(providerHints.id, existing[0].id))
        .returning();
      return updated as StoredProviderHint;
    }

    const [created] = await db
      .insert(providerHints)
      .values({
        providerAccountId,
        vmName,
        providerId,
        hints,
      })
      .returning();
    return created as StoredProviderHint;
  }

  async getHintsByVmName(vmName: string): Promise<StoredProviderHint | null> {
    const [hint] = await db
      .select()
      .from(providerHints)
      .where(eq(providerHints.vmName, vmName))
      .limit(1);
    return hint ? (hint as StoredProviderHint) : null;
  }

  async getHintsByProviderId(providerId: string): Promise<StoredProviderHint | null> {
    const [hint] = await db
      .select()
      .from(providerHints)
      .where(eq(providerHints.providerId, providerId))
      .limit(1);
    return hint ? (hint as StoredProviderHint) : null;
  }

  async getAllHintsForProvider(providerAccountId: string): Promise<StoredProviderHint[]> {
    const hints = await db
      .select()
      .from(providerHints)
      .where(eq(providerHints.providerAccountId, providerAccountId));
    return hints as StoredProviderHint[];
  }

  async deleteHintsForProvider(providerAccountId: string): Promise<void> {
    await db
      .delete(providerHints)
      .where(eq(providerHints.providerAccountId, providerAccountId));
  }
}

export const providerHintsStore = new ProviderHintsStore();

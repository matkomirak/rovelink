import { db } from "../db";
import { gateDecisions } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";

export interface GateDecision {
  id: string;
  vmName: string;
  netboxVmId?: number;
  allowed: boolean;
  missing: string[];
  evaluatedAt: Date;
  cmdbAccountId?: string;
  reason?: string;
}

export interface GateEvaluationInput {
  vmName: string;
  netboxVmId?: number;
  tenant?: string | null;
  role?: string | null;
  tags?: string[];
  cmdbAccountId?: string;
}

export class GateStore {
  async storeDecision(decision: Omit<GateDecision, "id">): Promise<GateDecision> {
    const existing = await db
      .select()
      .from(gateDecisions)
      .where(eq(gateDecisions.vmName, decision.vmName))
      .limit(1);

    if (existing.length > 0) {
      const [updated] = await db
        .update(gateDecisions)
        .set({
          allowed: decision.allowed,
          missing: decision.missing,
          evaluatedAt: decision.evaluatedAt,
          netboxVmId: decision.netboxVmId,
          cmdbAccountId: decision.cmdbAccountId,
          reason: decision.reason,
        })
        .where(eq(gateDecisions.id, existing[0].id))
        .returning();
      return updated as GateDecision;
    }

    const [created] = await db
      .insert(gateDecisions)
      .values({
        vmName: decision.vmName,
        netboxVmId: decision.netboxVmId,
        allowed: decision.allowed,
        missing: decision.missing,
        evaluatedAt: decision.evaluatedAt,
        cmdbAccountId: decision.cmdbAccountId,
        reason: decision.reason,
      })
      .returning();
    return created as GateDecision;
  }

  async getDecision(vmName: string): Promise<GateDecision | null> {
    const [decision] = await db
      .select()
      .from(gateDecisions)
      .where(eq(gateDecisions.vmName, vmName))
      .limit(1);
    return decision ? (decision as GateDecision) : null;
  }

  async getAllowedVms(): Promise<GateDecision[]> {
    const decisions = await db
      .select()
      .from(gateDecisions)
      .where(eq(gateDecisions.allowed, true))
      .orderBy(desc(gateDecisions.evaluatedAt));
    return decisions as GateDecision[];
  }

  async getBlockedVms(): Promise<GateDecision[]> {
    const decisions = await db
      .select()
      .from(gateDecisions)
      .where(eq(gateDecisions.allowed, false))
      .orderBy(desc(gateDecisions.evaluatedAt));
    return decisions as GateDecision[];
  }

  async getAllDecisions(): Promise<GateDecision[]> {
    const decisions = await db
      .select()
      .from(gateDecisions)
      .orderBy(desc(gateDecisions.evaluatedAt));
    return decisions as GateDecision[];
  }

  async deleteDecision(vmName: string): Promise<void> {
    await db
      .delete(gateDecisions)
      .where(eq(gateDecisions.vmName, vmName));
  }

  async deleteAllDecisions(): Promise<void> {
    await db.delete(gateDecisions);
  }
}

export const gateStore = new GateStore();

// WARNING:
// This store contains DERIVED STATE ONLY.
// Data here is non-authoritative and may be dropped at any time.
// Do NOT build business logic that depends on persistence here.
//
// Gate decisions are RECOMPUTABLE from CMDB state at any time.
// Stored decisions are for TRANSPARENCY and EXPLAINABILITY only.

export interface GateDecision {
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

/**
 * Ephemeral in-memory gate decision store.
 * 
 * Gate decisions are DERIVED from CMDB state and must be recomputable.
 * This store exists only for transparency - it has NO authority.
 */
export class GateStore {
  // Ephemeral in-memory storage - can be cleared at any time
  private decisions: Map<string, GateDecision> = new Map();

  async storeDecision(decision: Omit<GateDecision, "id">): Promise<GateDecision> {
    const stored: GateDecision = {
      vmName: decision.vmName,
      netboxVmId: decision.netboxVmId,
      allowed: decision.allowed,
      missing: decision.missing,
      evaluatedAt: decision.evaluatedAt,
      cmdbAccountId: decision.cmdbAccountId,
      reason: decision.reason,
    };
    this.decisions.set(decision.vmName, stored);
    return stored;
  }

  async getDecision(vmName: string): Promise<GateDecision | null> {
    return this.decisions.get(vmName) || null;
  }

  async getAllowedVms(): Promise<GateDecision[]> {
    return Array.from(this.decisions.values())
      .filter((d) => d.allowed)
      .sort((a, b) => b.evaluatedAt.getTime() - a.evaluatedAt.getTime());
  }

  async getBlockedVms(): Promise<GateDecision[]> {
    return Array.from(this.decisions.values())
      .filter((d) => !d.allowed)
      .sort((a, b) => b.evaluatedAt.getTime() - a.evaluatedAt.getTime());
  }

  async getAllDecisions(): Promise<GateDecision[]> {
    return Array.from(this.decisions.values())
      .sort((a, b) => b.evaluatedAt.getTime() - a.evaluatedAt.getTime());
  }

  async deleteDecision(vmName: string): Promise<void> {
    this.decisions.delete(vmName);
  }

  async deleteAllDecisions(): Promise<void> {
    this.decisions.clear();
  }

  // Get summary statistics - minimal, no preview optimization
  async getSummary(): Promise<{ allowed: number; blocked: number }> {
    let allowed = 0;
    let blocked = 0;
    const decisions = Array.from(this.decisions.values());
    for (const decision of decisions) {
      if (decision.allowed) {
        allowed++;
      } else {
        blocked++;
      }
    }
    return { allowed, blocked };
  }
}

export const gateStore = new GateStore();

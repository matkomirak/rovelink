// WARNING:
// This store contains DERIVED STATE ONLY.
// Data here is non-authoritative and may be dropped at any time.
// Do NOT build business logic that depends on persistence here.
//
// Gate decisions are RECOMPUTABLE from CMDB state at any time.
// Stored decisions are for TRANSPARENCY and EXPLAINABILITY only.
//
// Gate evaluation is a FIRST-CLASS PHASE.
// Inventory generation must never implicitly re-evaluate gates.

import { GATE_DESIGN_PRINCIPLE } from "./gate-design-principle";

export interface GateDecision {
  assetId: string;           // Stable internal identity - NOT vm name
  vmName: string;            // Display only - NOT authoritative
  netboxVmId?: number;
  allowed: boolean;
  missing: string[];
  evaluatedAt: Date;
  cmdbAccountId?: string;
  reason?: string;
  failureType?: "governance" | "invariant"; // Classification of failure
}

export interface GateEvaluationInput {
  assetId: string;
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
 * 
 * KEY: Uses asset_id (stable identity), not vm name.
 */
export class GateStore {
  // Ephemeral in-memory storage - can be cleared at any time
  // Keyed by asset_id for stable identity
  private decisions: Map<string, GateDecision> = new Map();
  
  // Track when gates were last evaluated (for first-class phase tracking)
  private lastEvaluationTime: Date | null = null;
  private evaluationComplete: boolean = false;

  async storeDecision(decision: Omit<GateDecision, "id">): Promise<GateDecision> {
    const stored: GateDecision = {
      assetId: decision.assetId,
      vmName: decision.vmName,
      netboxVmId: decision.netboxVmId,
      allowed: decision.allowed,
      missing: decision.missing,
      evaluatedAt: decision.evaluatedAt,
      cmdbAccountId: decision.cmdbAccountId,
      reason: decision.reason,
      failureType: decision.failureType,
    };
    // Key by asset_id for stable identity
    this.decisions.set(decision.assetId, stored);
    return stored;
  }

  async getDecision(assetId: string): Promise<GateDecision | null> {
    return this.decisions.get(assetId) || null;
  }

  async getDecisionByVmName(vmName: string): Promise<GateDecision | null> {
    // Fallback lookup by VM name (less reliable but useful for API)
    const allDecisions = Array.from(this.decisions.values());
    for (const decision of allDecisions) {
      if (decision.vmName === vmName) {
        return decision;
      }
    }
    return null;
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

  async deleteDecision(assetId: string): Promise<void> {
    this.decisions.delete(assetId);
  }

  async deleteAllDecisions(): Promise<void> {
    this.decisions.clear();
    this.evaluationComplete = false;
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

  // Mark gate evaluation as complete (first-class phase tracking)
  markEvaluationComplete(): void {
    this.lastEvaluationTime = new Date();
    this.evaluationComplete = true;
  }

  // Check if gate evaluation has been completed
  isEvaluationComplete(): boolean {
    return this.evaluationComplete;
  }

  // Get last evaluation time
  getLastEvaluationTime(): Date | null {
    return this.lastEvaluationTime;
  }
}

export const gateStore = new GateStore();

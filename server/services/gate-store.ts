// WARNING:
// This store contains DERIVED STATE ONLY.
// Data here is non-authoritative and may be dropped at any time.
//
// Gate decisions are RECOMPUTABLE from CMDB state at any time.
// Stored decisions are for TRANSPARENCY and EXPLAINABILITY only.
//
// Gate evaluation is a FIRST-CLASS PHASE.
// Inventory generation must never implicitly re-evaluate gates.
//
// The store is ORG-SCOPED: all methods require an orgId.
// Decisions from one org NEVER appear in another org's results.

import { GATE_DESIGN_PRINCIPLE } from "./gate-design-principle";

export interface GateDecision {
  orgId: string;             // Organization that owns this decision
  assetId: string;           // Stable internal identity - NOT vm name
  vmName: string;            // Display only - NOT authoritative
  netboxVmId?: number;       // Legacy/source NetBox numeric VM ID
  governanceObjectType?: "netbox_vm";
  governanceObjectId?: string; // Local netbox_vms.id; future enforcement must require this
  sourceNetboxId?: number;
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

// Lightweight snapshot stored on a run — no orgId needed (it's implicit from the run)
export interface GateDecisionSnapshot {
  assetId: string;
  vmName: string;
  netboxVmId?: number;       // Legacy/source NetBox numeric VM ID
  governanceObjectType?: "netbox_vm";
  governanceObjectId?: string; // Local netbox_vms.id; future enforcement must require this
  sourceNetboxId?: number;
  allowed: boolean;
  missing: string[];
  reason?: string;
  failureType?: "governance" | "invariant";
  evaluatedAt: string; // ISO string for JSON serialization
}

/**
 * Ephemeral in-memory gate decision store — ORG-SCOPED.
 *
 * Gate decisions are DERIVED from CMDB state and must be recomputable.
 * This store exists only for transparency - it has NO authority.
 *
 * KEY: Uses `${orgId}:${assetId}` for strict org isolation.
 */
export class GateStore {
  // Ephemeral in-memory storage - can be cleared at any time
  // Keyed by `${orgId}:${assetId}` for stable, org-isolated identity
  private decisions: Map<string, GateDecision> = new Map();

  // Track when gates were last evaluated per org
  private lastEvaluationTime: Map<string, Date> = new Map();
  private evaluationComplete: Map<string, boolean> = new Map();

  private compositeKey(orgId: string, assetId: string): string {
    return `${orgId}:${assetId}`;
  }

  async storeDecision(decision: GateDecision): Promise<GateDecision> {
    const key = this.compositeKey(decision.orgId, decision.assetId);
    this.decisions.set(key, decision);
    return decision;
  }

  async getDecision(orgId: string, assetId: string): Promise<GateDecision | null> {
    return this.decisions.get(this.compositeKey(orgId, assetId)) || null;
  }

  async getDecisionByVmName(orgId: string, vmName: string): Promise<GateDecision | null> {
    for (const decision of Array.from(this.decisions.values())) {
      if (decision.orgId === orgId && decision.vmName === vmName) {
        return decision;
      }
    }
    return null;
  }

  async getAllowedVms(orgId: string): Promise<GateDecision[]> {
    return Array.from(this.decisions.values())
      .filter((d) => d.orgId === orgId && d.allowed)
      .sort((a, b) => b.evaluatedAt.getTime() - a.evaluatedAt.getTime());
  }

  async getBlockedVms(orgId: string): Promise<GateDecision[]> {
    return Array.from(this.decisions.values())
      .filter((d) => d.orgId === orgId && !d.allowed)
      .sort((a, b) => b.evaluatedAt.getTime() - a.evaluatedAt.getTime());
  }

  async getAllDecisions(orgId: string): Promise<GateDecision[]> {
    return Array.from(this.decisions.values())
      .filter((d) => d.orgId === orgId)
      .sort((a, b) => b.evaluatedAt.getTime() - a.evaluatedAt.getTime());
  }

  async deleteDecision(orgId: string, assetId: string): Promise<void> {
    this.decisions.delete(this.compositeKey(orgId, assetId));
  }

  async deleteAllDecisions(orgId?: string): Promise<void> {
    if (orgId) {
      // Delete only decisions for this org
      for (const [key, decision] of Array.from(this.decisions.entries())) {
        if (decision.orgId === orgId) {
          this.decisions.delete(key);
        }
      }
      this.evaluationComplete.delete(orgId);
    } else {
      // Global clear (used by tests only)
      this.decisions.clear();
      this.evaluationComplete.clear();
    }
  }

  async getSummary(orgId: string): Promise<{ allowed: number; blocked: number }> {
    let allowed = 0;
    let blocked = 0;
    for (const d of Array.from(this.decisions.values())) {
      if (d.orgId !== orgId) continue;
      if (d.allowed) allowed++; else blocked++;
    }
    return { allowed, blocked };
  }

  markEvaluationComplete(orgId: string): void {
    this.lastEvaluationTime.set(orgId, new Date());
    this.evaluationComplete.set(orgId, true);
  }

  isEvaluationComplete(orgId: string): boolean {
    return this.evaluationComplete.get(orgId) === true;
  }

  getLastEvaluationTime(orgId: string): Date | null {
    return this.lastEvaluationTime.get(orgId) || null;
  }
}

export const gateStore = new GateStore();

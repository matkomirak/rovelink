// Gate evaluation is AUTOMATIC and NON-OPTIONAL.
// There must be no execution path that bypasses this check.
//
// Gate evaluation is a FIRST-CLASS PHASE.
// Inventory generation must never implicitly re-evaluate gates.
//
// Governance authority resides EXCLUSIVELY in the CMDB.
// Provider metadata may only suggest, never confirm intent.
//
// Gate decisions must always be reproducible from CMDB state.
// Stored decisions are for transparency only.
//
// asset_id is the stable internal identity.
// VM names are NOT trusted identifiers.
//
// ================================================================
// FUTURE PROVIDER-TO-CMDB MAPPING (NOT YET IMPLEMENTED):
// ================================================================
// When implemented, provider-to-CMDB mapping:
// - May pre-fill governance fields (tenant, role, tags)
// - Must require explicit human confirmation
// - Must never automatically grant automation access
// - Should be clearly labeled as "suggestions" in the UI
// ================================================================

import { gateStore, GateDecision } from "./gate-store";
import { deriveAssetId } from "./asset-identity";
import { GATE_DESIGN_PRINCIPLE, GATE_INVARIANTS } from "./gate-design-principle";

// Re-export GATE_DESIGN_PRINCIPLE for consumers
export { GATE_DESIGN_PRINCIPLE, GATE_INVARIANTS };

export type GateFailureType = "governance" | "invariant";

export interface GateEvaluationResult {
  assetId: string;
  allowed: boolean;
  missing: string[];
  reason: string;
  failureType?: GateFailureType;
}

export interface NetBoxVmForGate {
  id?: number;
  name: string;
  tenant?: { name: string; id?: number } | string | null;
  role?: { name: string; id?: number } | string | null;
  tags?: Array<{ name: string } | string>;
}

/**
 * Gate Evaluator - determines if VMs are allowed for automation.
 * 
 * INVARIANTS:
 * 1. Gate evaluation CANNOT be skipped
 * 2. Provider hints CANNOT grant automation access
 * 3. Removing CMDB governance immediately removes automation access
 * 4. Gate decisions are DERIVED from CMDB state, not stored state
 * 5. Gate evaluation is a FIRST-CLASS PHASE - runs BEFORE inventory generation
 * 
 * FAILURE CLASSIFICATION:
 * - INVARIANT violations (crash): blocked VM in inventory, provider hints used
 * - GOVERNANCE failures (block): missing tenant/role/tag - visible, non-fatal
 */
export class GateEvaluator {
  /**
   * Evaluate gate requirements for a single VM.
   * 
   * SECURITY: This method ONLY accepts CMDB data (NetBox VM).
   * Provider hints are EXPLICITLY FORBIDDEN as input.
   * 
   * @param netboxVm - VM data from CMDB (NetBox) ONLY
   * @param providerHintsUsed - MUST be false, throws if true (INVARIANT VIOLATION)
   */
  evaluateGate(netboxVm: NetBoxVmForGate, providerHintsUsed: boolean = false): GateEvaluationResult {
    // SECURITY GUARDRAIL: Explicitly reject provider hints - INVARIANT VIOLATION
    if (providerHintsUsed) {
      throw new Error("INVARIANT VIOLATION: Provider hints must not affect gate decisions");
    }

    // Generate stable asset_id using VM name (ID may not always be available)
    // Note: Callers should use deriveAssetId directly when cmdbAccountId is known
    const assetId = deriveAssetId("netbox", netboxVm.name);
    
    const missing: string[] = [];

    // Check tenant - MUST come from CMDB only
    const tenantName = this.extractName(netboxVm.tenant);
    if (!tenantName) {
      missing.push("tenant");
    }

    // Check role - MUST come from CMDB only
    const roleName = this.extractName(netboxVm.role);
    if (!roleName) {
      missing.push("role");
    }

    // Check automatable tag - MUST come from CMDB only
    const hasAutomatableTag = this.hasTag(netboxVm.tags, "automatable");
    if (!hasAutomatableTag) {
      missing.push("tag:automatable");
    }

    const allowed = missing.length === 0;

    let reason: string;
    let failureType: GateFailureType | undefined;
    
    if (allowed) {
      reason = `VM has all required governance: tenant=${tenantName}, role=${roleName}, tag=automatable`;
    } else {
      // This is a GOVERNANCE failure - normal, visible, non-fatal
      failureType = "governance";
      reason = `VM missing required governance fields: ${missing.join(", ")}`;
    }

    return { assetId, allowed, missing, reason, failureType };
  }

  /**
   * Evaluate and store decision for transparency.
   * Storage is ephemeral and for explainability only.
   */
  async evaluateAndStore(
    netboxVm: NetBoxVmForGate,
    cmdbAccountId?: string
  ): Promise<GateEvaluationResult> {
    // Evaluate gate - never pass provider hints
    const result = this.evaluateGate(netboxVm, false);

    // Store for transparency only - this is derived state
    await gateStore.storeDecision({
      assetId: result.assetId,
      vmName: netboxVm.name,
      netboxVmId: netboxVm.id,
      allowed: result.allowed,
      missing: result.missing,
      evaluatedAt: new Date(),
      cmdbAccountId,
      reason: result.reason,
      failureType: result.failureType,
    });

    return result;
  }

  /**
   * FIRST-CLASS GATE EVALUATION PHASE.
   * 
   * This function evaluates ALL gates for a CMDB.
   * It must be called BEFORE inventory generation.
   * Inventory generation must ONLY read from gate store, never trigger evaluation.
   * 
   * @param vms - All VMs from CMDB
   * @param cmdbAccountId - CMDB account identifier
   * @returns Map of assetId to evaluation result
   */
  async evaluateAllGates(
    vms: NetBoxVmForGate[],
    cmdbAccountId?: string
  ): Promise<Map<string, GateEvaluationResult>> {
    // Clear previous decisions for this evaluation phase
    await gateStore.deleteAllDecisions();
    
    const results = new Map<string, GateEvaluationResult>();

    for (const vm of vms) {
      const result = await this.evaluateAndStore(vm, cmdbAccountId);
      results.set(result.assetId, result);
    }

    // Mark gate evaluation as complete - this is a FIRST-CLASS PHASE
    gateStore.markEvaluationComplete();
    
    console.log(`Gate evaluation complete: ${results.size} VMs evaluated`);

    return results;
  }

  /**
   * Read gate decisions from store.
   * Inventory generation should use this - never trigger evaluation.
   * 
   * Throws INVARIANT VIOLATION if gate evaluation hasn't been completed.
   */
  async readGateDecisions(): Promise<GateDecision[]> {
    if (!gateStore.isEvaluationComplete()) {
      throw new Error("INVARIANT VIOLATION: Attempted to read gate decisions before evaluation phase completed");
    }
    return gateStore.getAllDecisions();
  }

  /**
   * Check if a specific asset is allowed.
   * Uses asset_id for stable lookup.
   */
  async isAssetAllowed(assetId: string): Promise<boolean> {
    const decision = await gateStore.getDecision(assetId);
    return decision?.allowed === true;
  }

  /**
   * LEGACY: Evaluate a batch of VMs from CMDB.
   * @deprecated Use evaluateAllGates() for first-class phase evaluation.
   */
  async evaluateBatch(
    vms: NetBoxVmForGate[],
    cmdbAccountId?: string
  ): Promise<Map<string, GateEvaluationResult>> {
    // Delegate to evaluateAllGates for proper phase tracking
    return this.evaluateAllGates(vms, cmdbAccountId);
  }

  private extractName(value: { name: string; id?: number } | string | null | undefined): string | null {
    if (!value) return null;
    if (typeof value === "string") return value || null;
    if (typeof value === "object" && "name" in value) return value.name || null;
    return null;
  }

  private hasTag(tags: Array<{ name: string } | string> | undefined, targetTag: string): boolean {
    if (!tags || !Array.isArray(tags)) return false;
    
    return tags.some((tag) => {
      const tagName = typeof tag === "string" ? tag : tag.name;
      return tagName?.toLowerCase() === targetTag.toLowerCase();
    });
  }
}

export const gateEvaluator = new GateEvaluator();

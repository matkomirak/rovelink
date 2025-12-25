// Gate evaluation is AUTOMATIC and NON-OPTIONAL.
// There must be no execution path that bypasses this check.
//
// Governance authority resides EXCLUSIVELY in the CMDB.
// Provider metadata may only suggest, never confirm intent.
//
// Gate decisions must always be reproducible from CMDB state.
// Stored decisions are for transparency only.
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

import { gateStore, GateEvaluationInput } from "./gate-store";

export interface GateEvaluationResult {
  allowed: boolean;
  missing: string[];
  reason: string;
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
 */
export class GateEvaluator {
  /**
   * Evaluate gate requirements for a single VM.
   * 
   * SECURITY: This method ONLY accepts CMDB data (NetBox VM).
   * Provider hints are EXPLICITLY FORBIDDEN as input.
   * 
   * @param netboxVm - VM data from CMDB (NetBox) ONLY
   * @param providerHintsUsed - MUST be false, throws if true
   */
  evaluateGate(netboxVm: NetBoxVmForGate, providerHintsUsed: boolean = false): GateEvaluationResult {
    // SECURITY GUARDRAIL: Explicitly reject provider hints
    if (providerHintsUsed) {
      throw new Error("SECURITY VIOLATION: Provider hints must not affect gate decisions");
    }

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
    if (allowed) {
      reason = `VM has all required governance: tenant=${tenantName}, role=${roleName}, tag=automatable`;
    } else {
      reason = `VM missing required governance fields: ${missing.join(", ")}`;
    }

    return { allowed, missing, reason };
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
      vmName: netboxVm.name,
      netboxVmId: netboxVm.id,
      allowed: result.allowed,
      missing: result.missing,
      evaluatedAt: new Date(),
      cmdbAccountId,
      reason: result.reason,
    });

    return result;
  }

  /**
   * Evaluate a batch of VMs from CMDB.
   * Gate evaluation is AUTOMATIC during inventory generation.
   */
  async evaluateBatch(
    vms: NetBoxVmForGate[],
    cmdbAccountId?: string
  ): Promise<Map<string, GateEvaluationResult>> {
    const results = new Map<string, GateEvaluationResult>();

    for (const vm of vms) {
      const result = await this.evaluateAndStore(vm, cmdbAccountId);
      results.set(vm.name, result);
    }

    return results;
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

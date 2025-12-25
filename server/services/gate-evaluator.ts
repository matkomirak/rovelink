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

export class GateEvaluator {
  evaluateGate(netboxVm: NetBoxVmForGate): GateEvaluationResult {
    const missing: string[] = [];

    const tenantName = this.extractName(netboxVm.tenant);
    if (!tenantName) {
      missing.push("tenant");
    }

    const roleName = this.extractName(netboxVm.role);
    if (!roleName) {
      missing.push("role");
    }

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

  async evaluateAndStore(
    netboxVm: NetBoxVmForGate,
    cmdbAccountId?: string
  ): Promise<GateEvaluationResult> {
    const result = this.evaluateGate(netboxVm);

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

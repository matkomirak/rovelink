// ================================================================
// GATE PHASE - First-Class Explicit Phase
// ================================================================
// 
// Gate evaluation is a FIRST-CLASS PHASE.
// It must be called EXPLICITLY before inventory generation.
// Inventory generation must ONLY read gate results, never evaluate.
//
// This phase:
// 1. Fetches NetBox VMs from CMDB
// 2. Evaluates gate rules
// 3. Populates the ephemeral gate store
// 4. Writes block reasons to NetBox (informational only)
//
// ================================================================

import { db } from "../db";
import { cmdbAccounts } from "../../shared/schema";
import { eq } from "drizzle-orm";
import { NetBoxAdapter } from "./netbox-adapter";
import { gateStore, GateDecision } from "./gate-store";
import { deriveAssetId } from "./asset-identity";

export interface GatePhaseResult {
  cmdbId: string;
  cmdbName: string;
  totalVms: number;
  allowed: number;
  blocked: number;
  evaluatedAt: Date;
  blockedVms: Array<{
    assetId: string;
    vmName: string;
    missing: string[];
    reason: string;
  }>;
}

/**
 * Run the gate phase for a specific CMDB.
 * 
 * This is the EXPLICIT gate evaluation phase.
 * It must be called before inventory generation.
 * 
 * @param cmdbId - The CMDB account ID to evaluate
 * @returns Gate phase result with statistics
 */
export async function runGatePhase(cmdbId: string): Promise<GatePhaseResult> {
  // Fetch CMDB account
  const [cmdb] = await db
    .select()
    .from(cmdbAccounts)
    .where(eq(cmdbAccounts.id, cmdbId));

  if (!cmdb) {
    throw new Error(`CMDB account not found: ${cmdbId}`);
  }

  // Fetch VMs from NetBox
  const adapter = new NetBoxAdapter(cmdb.config as any);
  const vms = await adapter.listAllVms();

  // Clear previous decisions
  await gateStore.deleteAllDecisions();

  const blockedVms: GatePhaseResult["blockedVms"] = [];
  let allowedCount = 0;

  // Evaluate gate rules for each VM
  for (const vm of vms) {
    const assetId = deriveAssetId(cmdbId, vm.name);
    const missing: string[] = [];

    // Check VM status - MUST be active to be automatable
    const vmStatus = vm.status?.value || vm.status;
    if (vmStatus !== 'active') {
      missing.push("status:active");
    }

    // Check provider_state - MUST NOT be missing
    const providerState = vm.custom_fields?.provider_state;
    if (providerState === 'missing') {
      missing.push("provider_state:missing");
    }

    // Check tenant - MUST come from CMDB only
    const tenantName = extractName(vm.tenant);
    if (!tenantName) {
      missing.push("tenant");
    }

    // Check role - MUST come from CMDB only
    const roleName = extractName(vm.role);
    if (!roleName) {
      missing.push("role");
    }

    // Check automatable custom field (boolean) - MUST come from CMDB only
    // MANDATORY: This is the ONLY way to grant automation permission
    // Provider data cannot influence this field
    const isAutomatable = vm.custom_fields?.automatable === true;
    if (!isAutomatable) {
      missing.push("automatable");
    }

    // Log warning if legacy automatable tag exists (deprecated)
    if (hasTag(vm.tags, "automatable")) {
      console.warn(`[DEPRECATED] VM ${vm.name} has legacy 'automatable' tag. This tag is no longer used. Set custom_fields.automatable = true in NetBox instead.`);
    }

    const allowed = missing.length === 0;
    let reason: string;
    let failureType: "governance" | undefined;

    if (allowed) {
      reason = `VM has all required governance: tenant=${tenantName}, role=${roleName}, automatable=true`;
      allowedCount++;
    } else {
      // GOVERNANCE FAILURE - normal, visible, non-fatal
      failureType = "governance";
      reason = `VM missing required governance fields: ${missing.join(", ")}`;
      blockedVms.push({ assetId, vmName: vm.name, missing, reason });
    }

    // Store decision (keyed by asset_id, not VM name)
    await gateStore.storeDecision({
      assetId,
      vmName: vm.name,
      netboxVmId: vm.id,
      allowed,
      missing,
      evaluatedAt: new Date(),
      cmdbAccountId: cmdbId,
      reason,
      failureType,
    });
  }

  // Mark evaluation complete
  gateStore.markEvaluationComplete();

  // Write block reasons to NetBox (informational only)
  // Gate logic NEVER reads these fields
  await writeBlockReasonsToNetBox(adapter, blockedVms);

  const result: GatePhaseResult = {
    cmdbId,
    cmdbName: cmdb.name,
    totalVms: vms.length,
    allowed: allowedCount,
    blocked: blockedVms.length,
    evaluatedAt: new Date(),
    blockedVms,
  };

  console.log(`Gate phase complete for ${cmdb.name}: ${allowedCount} allowed, ${blockedVms.length} blocked of ${vms.length} total`);

  return result;
}

/**
 * Write block reasons to NetBox for human visibility.
 * 
 * This data is INFORMATIONAL ONLY.
 * Gate logic must NEVER read these fields.
 * Overwrites on every gate evaluation.
 */
async function writeBlockReasonsToNetBox(
  adapter: NetBoxAdapter,
  blockedVms: GatePhaseResult["blockedVms"]
): Promise<void> {
  // Only attempt if adapter has write capability
  if (!adapter.hasWriteAccess()) {
    console.log("NetBox adapter does not have write access, skipping block reason sync");
    return;
  }

  for (const vm of blockedVms) {
    try {
      // Add tag: automation-blocked
      // Add/update custom field: automation_block_reason
      await adapter.updateVmBlockStatus(vm.vmName, {
        tag: "automation-blocked",
        reason: vm.reason,
        missingFields: vm.missing,
      });
    } catch (error: any) {
      // Non-fatal - just log and continue
      console.warn(`Failed to write block status to NetBox for ${vm.vmName}: ${error.message}`);
    }
  }
}

/**
 * Read allowed VMs from gate store.
 * 
 * Inventory generation must use this.
 * Inventory generation must NEVER call runGatePhase().
 * 
 * Throws INVARIANT VIOLATION if gate phase hasn't run.
 */
export async function readAllowedAssets(): Promise<GateDecision[]> {
  if (!gateStore.isEvaluationComplete()) {
    throw new Error("INVARIANT VIOLATION: Attempted to read gate results before gate phase completed");
  }
  return gateStore.getAllowedVms();
}

/**
 * Check if a specific asset is allowed by asset_id.
 * 
 * Throws INVARIANT VIOLATION if gate phase hasn't run.
 */
export async function isAssetAllowed(assetId: string): Promise<boolean> {
  if (!gateStore.isEvaluationComplete()) {
    throw new Error("INVARIANT VIOLATION: Attempted to read gate results before gate phase completed");
  }
  const decision = await gateStore.getDecision(assetId);
  return decision?.allowed === true;
}

/**
 * Read blocked VMs from gate store.
 * 
 * Used for the blocked assets output.
 * These assets MUST NOT appear in any automation inventory.
 * 
 * Throws INVARIANT VIOLATION if gate phase hasn't run.
 */
export async function readBlockedAssets(): Promise<GateDecision[]> {
  if (!gateStore.isEvaluationComplete()) {
    throw new Error("INVARIANT VIOLATION: Attempted to read gate results before gate phase completed");
  }
  return gateStore.getBlockedVms();
}

/**
 * Get gate phase summary statistics.
 * 
 * Throws INVARIANT VIOLATION if gate phase hasn't run.
 */
export async function getGateSummary(): Promise<{ allowed: number; blocked: number; evaluatedAt: Date | null }> {
  if (!gateStore.isEvaluationComplete()) {
    throw new Error("INVARIANT VIOLATION: Attempted to read gate results before gate phase completed");
  }
  const summary = await gateStore.getSummary();
  return {
    ...summary,
    evaluatedAt: gateStore.getLastEvaluationTime(),
  };
}

// Helper functions
function extractName(value: { name: string; id?: number } | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") return value || null;
  if (typeof value === "object" && "name" in value) return value.name || null;
  return null;
}

function hasTag(tags: Array<{ name: string } | string> | undefined, targetTag: string): boolean {
  if (!tags || !Array.isArray(tags)) return false;
  return tags.some((tag) => {
    const tagName = typeof tag === "string" ? tag : tag.name;
    return tagName?.toLowerCase() === targetTag.toLowerCase();
  });
}

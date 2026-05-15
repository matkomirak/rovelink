// Gate API routes - READ-ONLY endpoints for transparency.
// Gate evaluation is AUTOMATIC and NON-OPTIONAL.
// These endpoints exist for observability only, not for triggering evaluation.
//
// Gate evaluation is a FIRST-CLASS PHASE.
// Inventory generation must never implicitly re-evaluate gates.

import { Router, Request, Response, NextFunction } from "express";
import { gateStore } from "../services/gate-store";
import { providerHintsStore } from "../services/provider-hints-store";
import { GATE_DESIGN_PRINCIPLE } from "../services/gate-design-principle";
import { requireRole } from "../auth/roles";

interface AuthRequest extends Request {
  userId?: string;
  orgId?: string;
  user?: { id: string; role: string; orgId: string };
}

const router = Router();

// All gate routes require authentication (enforced at mount in routes.ts).
// Read routes require minimum viewer role; sync-blocks requires admin.

// GET /api/gate/allowed - List all allowed VMs (transparency only)
router.get("/allowed", async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user?.orgId || req.orgId || "";
    const allowed = await gateStore.getAllowedVms(orgId);
    res.json({
      count: allowed.length,
      vms: allowed.map((d) => ({
        asset_id: d.assetId,
        vm_name: d.vmName,
        netbox_vm_id: d.netboxVmId,
        allowed: d.allowed,
        evaluated_at: d.evaluatedAt,
        reason: d.reason,
      })),
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// GET /api/gate/blocked - List all blocked VMs with missing fields (transparency only)
router.get("/blocked", async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user?.orgId || req.orgId || "";
    const blocked = await gateStore.getBlockedVms(orgId);
    res.json({
      count: blocked.length,
      vms: blocked.map((d) => ({
        asset_id: d.assetId,
        vm_name: d.vmName,
        netbox_vm_id: d.netboxVmId,
        allowed: d.allowed,
        missing: d.missing,
        evaluated_at: d.evaluatedAt,
        reason: d.reason,
        failure_type: d.failureType,
      })),
      // Block reason sync-back is informational only.
      // NetBox remains the source of governance, not of gate decisions.
      _note: "Use /api/gate/sync-blocks to write block reasons to NetBox for visibility",
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// GET /api/gate/status/:vmName - Get gate status for specific VM (transparency only)
// NOTE: Uses VM name for API convenience, but asset_id is the true identity
router.get("/status/:vmName", async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user?.orgId || req.orgId || "";
    const { vmName } = req.params;
    // Use fallback lookup by VM name scoped to this org
    const decision = await gateStore.getDecisionByVmName(orgId, vmName);

    if (!decision) {
      return res.status(404).json({
        message: "No gate decision found for this VM",
        _note: "asset_id is the stable internal identity. VM names are NOT trusted identifiers.",
      });
    }

    const hints = await providerHintsStore.getHintsByVmName(vmName);

    res.json({
      asset_id: decision.assetId,
      vm_name: decision.vmName,
      netbox_vm_id: decision.netboxVmId,
      allowed: decision.allowed,
      missing: decision.missing,
      evaluated_at: decision.evaluatedAt,
      reason: decision.reason,
      failure_type: decision.failureType,
      provider_hints: hints?.hints || null,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// GET /api/gate/hints/:vmName - Get provider hints for specific VM (transparency only)
// NOTE: Provider hints are NON-AUTHORITATIVE and never affect gate decisions
router.get("/hints/:vmName", async (req: AuthRequest, res: Response) => {
  try {
    const { vmName } = req.params;
    const hints = await providerHintsStore.getHintsByVmName(vmName);

    if (!hints) {
      return res.status(404).json({ message: "No provider hints found for this VM" });
    }

    res.json({
      vm_name: hints.vmName,
      provider_id: hints.providerId,
      hints: hints.hints,
      created_at: hints.createdAt,
      updated_at: hints.updatedAt,
      _warning: "Provider hints are NON-AUTHORITATIVE and do not affect gate decisions",
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// POST /api/gate/evaluate - REMOVED
// Gate evaluation is AUTOMATIC and NON-OPTIONAL.
// Gate evaluation is a FIRST-CLASS PHASE that runs BEFORE inventory generation.
// Manual triggering is forbidden to prevent the illusion that gating is optional.

// GET /api/gate/summary - Minimal summary stats (transparency only)
router.get("/summary", async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user?.orgId || req.orgId || "";
    const summary = await gateStore.getSummary(orgId);
    const lastEval = gateStore.getLastEvaluationTime(orgId);
    res.json({
      allowed: summary.allowed,
      blocked: summary.blocked,
      last_evaluation: lastEval?.toISOString() || null,
      evaluation_complete: gateStore.isEvaluationComplete(orgId),
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// POST /api/gate/sync-blocks - Sync block reasons to NetBox for human visibility
// Block reason sync-back is informational only.
// NetBox remains the source of governance, not of gate decisions.
router.post("/sync-blocks", requireRole("admin"), async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user?.orgId || req.orgId || "";
    const blocked = await gateStore.getBlockedVms(orgId);
    
    // TODO: Implement actual NetBox sync when NETBOX_TOKEN is configured
    // This would update custom fields or add tags like "automation-blocked"
    // For now, just return what would be synced
    
    const syncPreview = blocked.map((d) => ({
      vm_name: d.vmName,
      netbox_vm_id: d.netboxVmId,
      tag_to_add: "automation-blocked",
      block_reason: d.reason,
      missing_fields: d.missing,
    }));

    res.json({
      message: "Block reason sync preview (actual sync requires NetBox write access)",
      preview: syncPreview,
      count: syncPreview.length,
      _note: "Block reason sync-back is informational only. NetBox remains the source of governance.",
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

export default router;

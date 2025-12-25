// Gate API routes - READ-ONLY endpoints for transparency.
// Gate evaluation is AUTOMATIC and NON-OPTIONAL.
// These endpoints exist for observability only, not for triggering evaluation.

import { Router, Request, Response } from "express";
import { gateStore } from "../services/gate-store";
import { providerHintsStore } from "../services/provider-hints-store";

interface AuthRequest extends Request {
  userId?: string;
  user?: { id: string; role: string };
}

const router = Router();

// GET /api/gate/allowed - List all allowed VMs (transparency only)
router.get("/allowed", async (req: AuthRequest, res: Response) => {
  try {
    const allowed = await gateStore.getAllowedVms();
    res.json({
      count: allowed.length,
      vms: allowed.map((d) => ({
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
    const blocked = await gateStore.getBlockedVms();
    res.json({
      count: blocked.length,
      vms: blocked.map((d) => ({
        vm_name: d.vmName,
        netbox_vm_id: d.netboxVmId,
        allowed: d.allowed,
        missing: d.missing,
        evaluated_at: d.evaluatedAt,
        reason: d.reason,
      })),
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// GET /api/gate/status/:vmName - Get gate status for specific VM (transparency only)
router.get("/status/:vmName", async (req: AuthRequest, res: Response) => {
  try {
    const { vmName } = req.params;
    const decision = await gateStore.getDecision(vmName);

    if (!decision) {
      return res.status(404).json({ message: "No gate decision found for this VM" });
    }

    const hints = await providerHintsStore.getHintsByVmName(vmName);

    res.json({
      vm_name: decision.vmName,
      netbox_vm_id: decision.netboxVmId,
      allowed: decision.allowed,
      missing: decision.missing,
      evaluated_at: decision.evaluatedAt,
      reason: decision.reason,
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
// It occurs during inventory generation and NetBox data refresh.
// Manual triggering is forbidden to prevent the illusion that gating is optional.

// GET /api/gate/summary - Minimal summary stats (transparency only)
router.get("/summary", async (req: AuthRequest, res: Response) => {
  try {
    const summary = await gateStore.getSummary();
    res.json({
      allowed: summary.allowed,
      blocked: summary.blocked,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

export default router;

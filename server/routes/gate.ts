import { Router, Request, Response } from "express";
import { gateStore } from "../services/gate-store";
import { gateEvaluator } from "../services/gate-evaluator";
import { providerHintsStore } from "../services/provider-hints-store";
import { db } from "../db";
import { cmdbAccounts } from "@shared/schema";
import { eq } from "drizzle-orm";
import { NetBoxAdapter } from "../services/netbox-adapter";

interface AuthRequest extends Request {
  userId?: string;
  user?: { id: string; role: string };
}

const router = Router();

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
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

router.post("/evaluate", async (req: AuthRequest, res: Response) => {
  try {
    const userRole = req.user?.role;
    if (userRole !== "admin" && userRole !== "operator") {
      return res.status(403).json({ message: "Admin or operator role required" });
    }

    const { cmdb_account_id } = req.body;

    if (!cmdb_account_id) {
      return res.status(400).json({ message: "cmdb_account_id is required" });
    }

    const [cmdb] = await db
      .select()
      .from(cmdbAccounts)
      .where(eq(cmdbAccounts.id, cmdb_account_id));

    if (!cmdb) {
      return res.status(404).json({ message: "CMDB account not found" });
    }

    if (cmdb.kind !== "netbox") {
      return res.status(400).json({ message: "Only NetBox CMDBs are supported for gate evaluation" });
    }

    const adapter = new NetBoxAdapter(cmdb.config as any);
    const vms = await adapter.listAllVms();

    const results = await gateEvaluator.evaluateBatch(vms, cmdb_account_id);

    let allowedCount = 0;
    let blockedCount = 0;
    const blockedVms: Array<{ name: string; missing: string[] }> = [];

    results.forEach((result, vmName) => {
      if (result.allowed) {
        allowedCount++;
      } else {
        blockedCount++;
        blockedVms.push({ name: vmName, missing: result.missing });
      }
    });

    res.json({
      total: vms.length,
      allowed: allowedCount,
      blocked: blockedCount,
      blocked_vms: blockedVms.slice(0, 20),
      message: `Evaluated ${vms.length} VMs. ${allowedCount} allowed, ${blockedCount} blocked.`,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

router.get("/summary", async (req: AuthRequest, res: Response) => {
  try {
    const allowed = await gateStore.getAllowedVms();
    const blocked = await gateStore.getBlockedVms();

    const missingCounts: Record<string, number> = {};
    for (const decision of blocked) {
      const missing = decision.missing as string[];
      for (const field of missing) {
        missingCounts[field] = (missingCounts[field] || 0) + 1;
      }
    }

    res.json({
      total: allowed.length + blocked.length,
      allowed: allowed.length,
      blocked: blocked.length,
      missing_field_counts: missingCounts,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

export default router;

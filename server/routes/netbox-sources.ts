import { Router } from "express";
import type { Request } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { netboxVms, insertNetboxInventorySourceSchema } from "@shared/schema";
import { eq } from "drizzle-orm";
import {
  sanitizeNetboxSourceForResponse,
  encryptNetboxToken,
  decryptNetboxToken,
} from "../services/secrets";
import { netboxService } from "../services/netbox";
import { requireRole } from "../auth/roles";

interface AuthRequest extends Request {
  userId?: string;
  orgId?: string;
  user?: any;
}

const router = Router();

// ── VM list ──────────────────────────────────────────────────────────────────

router.get("/vms", async (req: AuthRequest, res) => {
  try {
    const orgId = req.user?.orgId || req.orgId! || "";
    const vms = await storage.getNetboxVms(orgId);
    res.json(vms);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post("/import", requireRole("admin"), async (req, res) => {
  try {
    const { vms } = req.body;
    if (!Array.isArray(vms)) {
      return res.status(400).json({ message: "vms must be an array" });
    }
    let imported = 0;
    for (const vm of vms) {
      await storage.upsertNetboxVm({
        netboxId: vm.id,
        name: vm.name,
        ip: vm.primary_ip?.address || null,
        operatingSystem: vm.platform?.name || null,
        customFields: vm.custom_fields || {},
        tags: (vm.tags || []).map((t: { name: string }) => t.name),
      });
      imported++;
    }
    res.json({ imported, message: `Imported ${imported} VMs` });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ── Inventory sources ────────────────────────────────────────────────────────

router.get("/sources", async (req: AuthRequest, res) => {
  try {
    const sources = await storage.getNetboxInventorySources(req.orgId!);
    res.json(sources.map(sanitizeNetboxSourceForResponse));
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.get("/sources/:id", async (req: AuthRequest, res) => {
  try {
    const source = await storage.getNetboxInventorySource(req.params.id, req.orgId!);
    if (!source) return res.status(404).json({ message: "Source not found" });
    res.json(sanitizeNetboxSourceForResponse(source));
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post("/sources", requireRole("admin"), async (req: AuthRequest, res) => {
  try {
    const data = insertNetboxInventorySourceSchema.parse({
      ...req.body,
      orgId: req.orgId!,
    });
    if (data.token) {
      data.token = await encryptNetboxToken(data.token);
    }
    const source = await storage.createNetboxInventorySource(data);
    res.json(sanitizeNetboxSourceForResponse(source));
  } catch (err: any) {
    res.status(400).json({ message: err.message });
  }
});

router.patch("/sources/:id", requireRole("admin"), async (req: AuthRequest, res) => {
  try {
    const update = { ...req.body };
    if (update.token && update.token !== "********") {
      update.token = await encryptNetboxToken(update.token);
    } else {
      delete update.token;
    }
    const source = await storage.updateNetboxInventorySource(
      req.params.id,
      update,
      req.orgId!
    );
    if (!source) return res.status(404).json({ message: "Source not found" });
    res.json(sanitizeNetboxSourceForResponse(source));
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.delete("/sources/:id", requireRole("admin"), async (req: AuthRequest, res) => {
  try {
    await storage.deleteNetboxInventorySource(req.params.id, req.orgId!);
    res.status(204).end();
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post("/sources/:id/test", requireRole("operator"), async (req: AuthRequest, res) => {
  try {
    const source = await storage.getNetboxInventorySource(req.params.id, req.orgId!);
    if (!source) return res.status(404).json({ message: "Source not found" });

    const token = await decryptNetboxToken(source.token || "");
    const result = await netboxService.testConnection(source.url, token);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ── Source-specific VMs (for browsing / group drill-down) ────────────────────

router.get("/sources/:id/vms", async (req: AuthRequest, res) => {
  try {
    const source = await storage.getNetboxInventorySource(req.params.id, req.orgId!);
    if (!source) return res.status(404).json({ message: "Source not found" });

    const vms = await db.select().from(netboxVms).where(eq(netboxVms.sourceId, req.params.id));
    res.json(vms);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

export default router;

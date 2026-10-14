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
import { sendInternalError } from "../services/api-errors";
import { normalizedNetboxVmSchema, sanitizeIngestionMetadata } from "../services/ingestion-validation";

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
    sendInternalError(res, err, "netbox.vms", "Failed to fetch NetBox VMs");
  }
});

router.post("/import", requireRole("admin"), async (req: AuthRequest, res) => {
  try {
    const { vms, sourceId } = req.body;
    if (!Array.isArray(vms)) {
      return res.status(400).json({ message: "vms must be an array" });
    }
    if (typeof sourceId !== "string" || !sourceId || !req.orgId) return res.status(400).json({ message: "Organization-owned sourceId required" });
    if (!await storage.getNetboxInventorySource(sourceId, req.orgId)) return res.status(404).json({ message: "Source not found" });
    let imported = 0;
    let skipped = 0;
    for (const vm of vms) {
      const input = {
        sourceId, netboxId: vm?.id, name: vm?.name,
        ip: vm?.primary_ip?.address || null,
        operatingSystem: vm?.platform?.name || null,
        customFields: sanitizeIngestionMetadata(vm?.custom_fields || {}),
        tags: Array.isArray(vm?.tags) ? vm.tags.map((t: { name?: string } | null) => t?.name).filter((name: unknown) => typeof name === "string") : [],
      };
      const parsed = normalizedNetboxVmSchema.safeParse(input);
      if (!parsed.success) { skipped++; continue; }
      await storage.upsertNetboxVm(parsed.data);
      imported++;
    }
    res.json({ imported, validation: { recordsFetched: vms.length, recordsAccepted: imported, recordsSkipped: skipped, validationErrors: skipped }, message: `Imported ${imported} VMs` });
  } catch (err: any) {
    sendInternalError(res, err, "netbox.import", "Failed to import NetBox VMs");
  }
});

// ── Inventory sources ────────────────────────────────────────────────────────

router.get("/sources", async (req: AuthRequest, res) => {
  try {
    const sources = await storage.getNetboxInventorySources(req.orgId!);
    res.json(sources.map(sanitizeNetboxSourceForResponse));
  } catch (err: any) {
    sendInternalError(res, err, "netbox.sources.list", "Failed to fetch NetBox sources");
  }
});

router.get("/sources/:id", async (req: AuthRequest, res) => {
  try {
    const source = await storage.getNetboxInventorySource(req.params.id, req.orgId!);
    if (!source) return res.status(404).json({ message: "Source not found" });
    res.json(sanitizeNetboxSourceForResponse(source));
  } catch (err: any) {
    sendInternalError(res, err, "netbox.sources.get", "Failed to fetch NetBox source");
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
    sendInternalError(res, err, "netbox.sources.update", "Failed to update NetBox source");
  }
});

router.delete("/sources/:id", requireRole("admin"), async (req: AuthRequest, res) => {
  try {
    await storage.deleteNetboxInventorySource(req.params.id, req.orgId!);
    res.status(204).end();
  } catch (err: any) {
    sendInternalError(res, err, "netbox.sources.delete", "Failed to delete NetBox source");
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
    sendInternalError(res, err, "netbox.sources.test", "Failed to test NetBox source");
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
    sendInternalError(res, err, "netbox.sources.vms", "Failed to fetch source VMs");
  }
});

export default router;

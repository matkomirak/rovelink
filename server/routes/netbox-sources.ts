import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
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

interface AuthRequest extends Request {
  userId?: string;
  orgId?: string;
  user?: any;
}

function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    next();
  };
}

const router = Router();

// ─── NetBox VM import ─────────────────────────────────────────────────────────

router.post("/import", requireRole("admin"), async (req: AuthRequest, res) => {
  try {
    const { sourceId } = req.body;
    if (!sourceId) return res.status(400).json({ message: "Source ID is required" });

    const source = await storage.getNetboxInventorySource(sourceId, req.orgId);
    if (!source) return res.status(404).json({ message: "NetBox source not found" });
    if (!source.enabled) return res.status(400).json({ message: "NetBox source is disabled" });

    const decryptedToken = decryptNetboxToken(source.token);
    const vms = await netboxService.getVirtualMachines(source.url, decryptedToken);

    await db.delete(netboxVms).where(eq(netboxVms.sourceId, sourceId));

    let imported = 0;
    for (const vm of vms) {
      await storage.upsertNetboxVm({
        sourceId,
        netboxId: vm.id,
        name: vm.name,
        ip: vm.ip || null,
        operatingSystem: vm.operatingSystem || null,
        customFields: vm.customFields,
        tags: vm.tags,
      });
      imported++;
    }

    await storage.updateNetboxInventorySource(sourceId, { lastImportAt: new Date() }, req.orgId);
    res.json({ message: `Successfully imported ${imported} VMs from ${source.name}`, count: imported });
  } catch (error: any) {
    console.error("NetBox import failed:", error);
    res.status(500).json({ message: error.message || "Failed to import VMs from NetBox" });
  }
});

router.get("/vms", async (_req, res) => {
  try {
    const vms = await storage.getNetboxVms();
    res.json(vms);
  } catch (error: any) {
    res.status(500).json({ message: error.message || "Failed to get NetBox VMs" });
  }
});

router.patch("/vms/:id", async (req, res) => {
  try {
    const updatedVm = await storage.updateNetboxVm(req.params.id, req.body);
    if (!updatedVm) return res.status(404).json({ message: "VM not found" });
    res.json(updatedVm);
  } catch (error: any) {
    res.status(500).json({ message: error.message || "Failed to update VM" });
  }
});

// ─── NetBox inventory sources ─────────────────────────────────────────────────

router.get("/sources", async (req: AuthRequest, res) => {
  try {
    const sources = await storage.getNetboxInventorySources(req.orgId);
    res.json(sources.map(sanitizeNetboxSourceForResponse));
  } catch (error: any) {
    res.status(500).json({ message: error.message || "Failed to get NetBox inventory sources" });
  }
});

router.get("/sources/:id", async (req: AuthRequest, res) => {
  try {
    const source = await storage.getNetboxInventorySource(req.params.id, req.orgId);
    if (!source) return res.status(404).json({ message: "NetBox inventory source not found" });
    res.json(sanitizeNetboxSourceForResponse(source));
  } catch (error: any) {
    res.status(500).json({ message: error.message || "Failed to get NetBox inventory source" });
  }
});

router.post("/sources", requireRole("admin"), async (req: AuthRequest, res) => {
  try {
    const { orgId: _o, id: _i, ...safeBody } = req.body;
    const insertSource = insertNetboxInventorySourceSchema.parse({ ...safeBody, orgId: req.orgId });
    if (insertSource.token) {
      insertSource.token = encryptNetboxToken(insertSource.token);
    }
    const source = await storage.createNetboxInventorySource(insertSource);
    res.status(201).json(sanitizeNetboxSourceForResponse(source));
  } catch (error: any) {
    res.status(400).json({ message: error.message || "Failed to create NetBox inventory source" });
  }
});

router.patch("/sources/:id", requireRole("admin"), async (req: AuthRequest, res) => {
  try {
    const body = { ...req.body };
    if (body.token === "" || body.token === null || body.token === undefined) {
      delete body.token;
    } else if (body.token) {
      body.token = encryptNetboxToken(body.token);
    }
    const source = await storage.updateNetboxInventorySource(req.params.id, body, req.orgId);
    if (!source) return res.status(404).json({ message: "NetBox inventory source not found" });
    res.json(sanitizeNetboxSourceForResponse(source));
  } catch (error: any) {
    res.status(400).json({ message: error.message || "Failed to update NetBox inventory source" });
  }
});

router.delete("/sources/:id", requireRole("admin"), async (req: AuthRequest, res) => {
  try {
    await storage.deleteNetboxInventorySource(req.params.id, req.orgId);
    res.status(204).send();
  } catch (error: any) {
    res.status(500).json({ message: error.message || "Failed to delete NetBox inventory source" });
  }
});

router.post("/sources/:id/test", requireRole("admin", "operator"), async (req: AuthRequest, res) => {
  try {
    const source = await storage.getNetboxInventorySource(req.params.id, req.orgId);
    if (!source) return res.status(404).json({ message: "NetBox inventory source not found" });
    const token = decryptNetboxToken(source.token);
    const connected = await netboxService.testConnection(source.url, token);
    if (connected) {
      res.json({ ok: true, message: "Connection successful" });
    } else {
      res.status(502).json({ ok: false, message: "Connection failed — NetBox did not respond correctly" });
    }
  } catch (error: any) {
    res.status(500).json({ ok: false, message: error.message || "Connection test failed" });
  }
});

export default router;

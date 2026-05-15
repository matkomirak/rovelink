/**
 * Provider Discovery routes - Object types and samples
 */

import { Router, type Request, type Response } from "express";
import { storage } from "../storage";
import { getObjectTypes, getSamples } from "../services/sample-fixtures";

const router = Router();

interface AuthRequest extends Request {
  userId?: string;
  orgId?: string;
  user?: any;
}

// GET /api/providers/:id/object-types - Get available object types
router.get("/:id/object-types", async (req: AuthRequest, res: Response) => {
  try {
    const provider = await storage.getProvider(req.params.id, req.orgId!);
    if (!provider) {
      return res.status(404).json({ error: "not_found" });
    }

    const types = getObjectTypes(provider.kind);
    
    res.json({
      providerId: provider.id,
      types,
    });
  } catch (error: any) {
    res.status(500).json({ error: "internal", message: error.message });
  }
});

// GET /api/providers/:id/samples - Get sample objects
router.get("/:id/samples", async (req: AuthRequest, res: Response) => {
  try {
    const provider = await storage.getProvider(req.params.id, req.orgId!);
    if (!provider) {
      return res.status(404).json({ error: "not_found" });
    }

    const type = req.query.type as string;
    const limit = parseInt(req.query.limit as string) || 20;

    if (!type) {
      return res.status(400).json({ 
        error: "validation_error", 
        message: "Query parameter 'type' is required" 
      });
    }

    const samples = getSamples(provider.kind, type, limit);
    
    const items = samples.map(s => ({
      sampleId: s.sampleId,
      normalized: s.normalized,
    }));

    res.json({
      providerId: provider.id,
      type,
      items,
    });
  } catch (error: any) {
    res.status(500).json({ error: "internal", message: error.message });
  }
});

export default router;

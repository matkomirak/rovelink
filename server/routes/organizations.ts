import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { db } from "../db";
import { organizations, insertOrganizationSchema } from "@shared/schema";
import { eq } from "drizzle-orm";

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

router.get("/", async (_req, res) => {
  try {
    const orgs = await db.select().from(organizations);
    res.json(orgs);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post("/", requireRole("admin"), async (req, res) => {
  try {
    const data = insertOrganizationSchema.parse(req.body);
    const [org] = await db.insert(organizations).values(data).returning();
    res.status(201).json(org);
  } catch (err: any) {
    res.status(400).json({ message: err.message });
  }
});

router.patch("/:id", requireRole("admin"), async (req, res) => {
  try {
    const [org] = await db
      .update(organizations)
      .set(req.body)
      .where(eq(organizations.id, req.params.id))
      .returning();
    if (!org) return res.status(404).json({ message: "Organization not found" });
    res.json(org);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.delete("/:id", requireRole("admin"), async (req, res) => {
  try {
    await db.delete(organizations).where(eq(organizations.id, req.params.id));
    res.status(204).end();
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// /api/org/current — caller's own org
router.get("/current", async (req: AuthRequest, res) => {
  try {
    if (!req.orgId) return res.status(404).json({ message: "No organisation assigned" });
    const [org] = await db.select().from(organizations).where(eq(organizations.id, req.orgId));
    if (!org) return res.status(404).json({ message: "Organisation not found" });
    res.json(org);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.put("/current", requireRole("admin"), async (req: AuthRequest, res) => {
  try {
    if (!req.orgId) return res.status(404).json({ message: "No organisation assigned" });
    const { name, slug } = req.body;
    const [org] = await db
      .update(organizations)
      .set({ ...(name && { name }), ...(slug && { slug }) })
      .where(eq(organizations.id, req.orgId))
      .returning();
    res.json(org);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

export default router;

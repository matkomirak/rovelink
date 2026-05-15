import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { storage } from "../storage";

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

router.get("/", async (req: AuthRequest, res) => {
  try {
    const notifications = await storage.getNotifications(req.orgId);
    res.json(notifications);
  } catch (error: any) {
    res.status(500).json({ message: error.message || "Failed to fetch notifications" });
  }
});

router.post("/", requireRole("admin"), async (req: AuthRequest, res) => {
  try {
    const { orgId: _o, id: _i, ...safeBody } = req.body;
    const notification = await storage.createNotification({ ...safeBody, orgId: req.orgId });
    res.json(notification);
  } catch (error: any) {
    res.status(500).json({ message: error.message || "Failed to create notification" });
  }
});

router.get("/:id", async (req: AuthRequest, res) => {
  try {
    const notification = await storage.getNotification(req.params.id, req.orgId);
    if (!notification) return res.status(404).json({ message: "Notification not found" });
    res.json(notification);
  } catch (error: any) {
    res.status(500).json({ message: error.message || "Failed to fetch notification" });
  }
});

router.patch("/:id", requireRole("admin"), async (req: AuthRequest, res) => {
  try {
    const notification = await storage.updateNotification(req.params.id, req.body, req.orgId);
    if (!notification) return res.status(404).json({ message: "Notification not found" });
    res.json(notification);
  } catch (error: any) {
    res.status(500).json({ message: error.message || "Failed to update notification" });
  }
});

router.delete("/:id", requireRole("admin"), async (req: AuthRequest, res) => {
  try {
    const existing = await storage.getNotification(req.params.id, req.orgId);
    if (!existing) return res.status(404).json({ message: "Notification not found" });
    await storage.deleteNotification(req.params.id, req.orgId);
    res.json({ message: "Notification deleted" });
  } catch (error: any) {
    res.status(500).json({ message: error.message || "Failed to delete notification" });
  }
});

export default router;

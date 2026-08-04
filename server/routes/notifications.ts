import { Router } from "express";
import type { Request } from "express";
import { storage } from "../storage";
import { requireRole } from "../auth/roles";
import { sendInternalError } from "../services/api-errors";

interface AuthRequest extends Request {
  userId?: string;
  orgId?: string;
  user?: any;
}

const router = Router();

router.get("/", async (req: AuthRequest, res) => {
  try {
    const notifications = await storage.getNotifications(req.orgId!);
    res.json(notifications);
  } catch (error: any) {
    sendInternalError(res, error, "notifications.list", "Failed to fetch notifications");
  }
});

router.get("/:id", async (req: AuthRequest, res) => {
  try {
    const notification = await storage.getNotification(req.params.id, req.orgId!);
    if (!notification) return res.status(404).json({ message: "Notification not found" });
    res.json(notification);
  } catch (error: any) {
    sendInternalError(res, error, "notifications.get", "Failed to fetch notification");
  }
});

router.post("/", requireRole("admin"), async (req: AuthRequest, res) => {
  try {
    const notification = await storage.createNotification({ ...req.body, orgId: req.orgId! });
    res.json(notification);
  } catch (error: any) {
    res.status(400).json({ message: error.message || "Failed to create notification" });
  }
});

router.patch("/:id", requireRole("admin"), async (req: AuthRequest, res) => {
  try {
    const notification = await storage.updateNotification(req.params.id, req.body, req.orgId!);
    if (!notification) return res.status(404).json({ message: "Notification not found" });
    res.json(notification);
  } catch (error: any) {
    sendInternalError(res, error, "notifications.update", "Failed to update notification");
  }
});

router.delete("/:id", requireRole("admin"), async (req: AuthRequest, res) => {
  try {
    const existing = await storage.getNotification(req.params.id, req.orgId!);
    if (!existing) return res.status(404).json({ message: "Notification not found" });
    await storage.deleteNotification(req.params.id, req.orgId!);
    res.status(204).end();
  } catch (error: any) {
    sendInternalError(res, error, "notifications.delete", "Failed to delete notification");
  }
});

export default router;

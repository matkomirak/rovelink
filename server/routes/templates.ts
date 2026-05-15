import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { WebSocket } from "ws";
import { storage } from "../storage";
import { dispatchRun } from "../services/runner-dispatcher";
import { notificationService } from "../services/notificationService";
import { insertJobTemplateSchema } from "@shared/schema";

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
    const templates = await storage.getJobTemplates(req.orgId);
    res.json(templates);
  } catch (error: any) {
    res.status(500).json({ message: error.message || "Failed to fetch templates" });
  }
});

router.post("/", requireRole("admin"), async (req: AuthRequest, res) => {
  try {
    const { orgId: _o, id: _i, ...safeBody } = req.body;
    const data = insertJobTemplateSchema.parse({ ...safeBody, orgId: req.orgId });
    const template = await storage.createJobTemplate(data);
    res.json(template);
  } catch (error: any) {
    res.status(400).json({ message: error.message || "Failed to create template" });
  }
});

router.patch("/:id", requireRole("admin"), async (req: AuthRequest, res) => {
  try {
    const template = await storage.updateJobTemplate(req.params.id, req.body, req.orgId);
    res.json(template);
  } catch (error: any) {
    res.status(400).json({ message: error.message || "Failed to update template" });
  }
});

router.delete("/:id", requireRole("admin"), async (req: AuthRequest, res) => {
  try {
    await storage.deleteJobTemplate(req.params.id, req.orgId);
    res.json({ message: "Template deleted successfully" });
  } catch (error: any) {
    res.status(500).json({ message: error.message || "Failed to delete template" });
  }
});

router.post("/:id/launch", requireRole("operator", "admin"), async (req: AuthRequest, res) => {
  try {
    const template = await storage.getJobTemplate(req.params.id, req.orgId);
    if (!template) {
      return res.status(404).json({ message: "Template not found" });
    }

    const run = await storage.createJobRun({
      templateId: template.id,
      userId: req.userId!,
      orgId: req.orgId || null,
      status: "queued",
      limitExpr: template.limitExpr || null,
    });

    setImmediate(async () => {
      try {
        await storage.updateJobRun(run.id, { status: "running", startedAt: new Date() });

        let logs = "";
        const result = await dispatchRun(run, (log) => {
          logs += log;
          const wsClients = (global as any).wsClients?.get(run.id);
          if (wsClients) {
            wsClients.forEach((client: WebSocket) => {
              if (client.readyState === WebSocket.OPEN) {
                client.send(log);
              }
            });
          }
        });

        const updatedRun = await storage.updateJobRun(run.id, {
          status: result.status,
          completedAt: new Date(),
          logs: result.logs,
          resultSummary: result.summary,
        });

        if (updatedRun) {
          await notificationService.triggerNotifications(updatedRun);
        }
      } catch {
        const failedRun = await storage.updateJobRun(run.id, {
          status: "failed",
          completedAt: new Date(),
        });
        if (failedRun) {
          await notificationService.triggerNotifications(failedRun);
        }
      }
    });

    res.json(run);
  } catch (error: any) {
    res.status(500).json({ message: error.message || "Failed to launch job" });
  }
});

router.post("/:id/schedule", requireRole("operator", "admin"), async (req: AuthRequest, res) => {
  try {
    const template = await storage.getJobTemplate(req.params.id, req.orgId);
    if (!template) {
      return res.status(404).json({ message: "Template not found" });
    }

    const { scheduledAt } = req.body;
    const run = await storage.createJobRun({
      templateId: template.id,
      userId: req.userId!,
      orgId: req.orgId || null,
      status: "queued",
      scheduledAt: new Date(scheduledAt),
      limitExpr: template.limitExpr || null,
    });

    const delay = new Date(scheduledAt).getTime() - Date.now();
    setTimeout(async () => {
      await storage.updateJobRun(run.id, { status: "running" });
    }, delay);

    res.json(run);
  } catch (error: any) {
    res.status(500).json({ message: error.message || "Failed to schedule job" });
  }
});

export default router;

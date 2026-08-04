import { Router } from "express";
import type { Request } from "express";
import { WebSocket } from "ws";
import { storage } from "../storage";
import { dispatchRun } from "../services/runner-dispatcher";
import { notificationService } from "../services/notificationService";
import { insertJobTemplateSchema } from "@shared/schema";
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
    const templates = await storage.getJobTemplates(req.orgId!);
    res.json(templates);
  } catch (error: any) {
    sendInternalError(res, error, "templates.list", "Failed to fetch templates");
  }
});

router.get("/:id", async (req: AuthRequest, res) => {
  try {
    const template = await storage.getJobTemplate(req.params.id, req.orgId!);
    if (!template) return res.status(404).json({ message: "Template not found" });
    res.json(template);
  } catch (error: any) {
    sendInternalError(res, error, "templates.get", "Failed to fetch template");
  }
});

router.post("/", requireRole("admin"), async (req: AuthRequest, res) => {
  try {
    const data = insertJobTemplateSchema.parse({ ...req.body, orgId: req.orgId! });
    const template = await storage.createJobTemplate(data);
    res.json(template);
  } catch (error: any) {
    res.status(400).json({ message: error.message || "Failed to create template" });
  }
});

router.patch("/:id", requireRole("admin"), async (req: AuthRequest, res) => {
  try {
    const template = await storage.updateJobTemplate(req.params.id, req.body, req.orgId!);
    if (!template) return res.status(404).json({ message: "Template not found" });
    res.json(template);
  } catch (error: any) {
    sendInternalError(res, error, "templates.update", "Failed to update template");
  }
});

router.delete("/:id", requireRole("admin"), async (req: AuthRequest, res) => {
  try {
    await storage.deleteJobTemplate(req.params.id, req.orgId!);
    res.status(204).end();
  } catch (error: any) {
    sendInternalError(res, error, "templates.delete", "Failed to delete template");
  }
});

router.post("/:id/launch", requireRole("operator"), async (req: AuthRequest, res) => {
  try {
    const template = await storage.getJobTemplate(req.params.id, req.orgId!);
    if (!template) {
      return res.status(404).json({ message: "Template not found" });
    }

    const run = await storage.createJobRun({
      templateId: template.id,
      userId: req.userId!,
      orgId: req.orgId! || null,
      status: "queued",
      limitExpr: template.limitExpr || null,
    });

    setImmediate(async () => {
      try {
        await storage.updateJobRun(run.id, { status: "running", startedAt: new Date() }, run.orgId!);

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
        }, run.orgId!);

        if (updatedRun) {
          await notificationService.triggerNotifications(updatedRun);
        }
      } catch {
        const failedRun = await storage.updateJobRun(run.id, {
          status: "failed",
          completedAt: new Date(),
        }, run.orgId!);
        if (failedRun) {
          await notificationService.triggerNotifications(failedRun);
        }
      }
    });

    res.json(run);
  } catch (error: any) {
    sendInternalError(res, error, "templates.launch", "Failed to launch job");
  }
});

router.post("/:id/schedule", requireRole("operator"), async (req: AuthRequest, res) => {
  try {
    const template = await storage.getJobTemplate(req.params.id, req.orgId!);
    if (!template) return res.status(404).json({ message: "Template not found" });

    const { scheduledAt } = req.body;
    if (!scheduledAt) return res.status(400).json({ message: "scheduledAt required" });

    const run = await storage.createJobRun({
      templateId: template.id,
      userId: req.userId!,
      orgId: req.orgId! || null,
      status: "queued",
      scheduledAt: new Date(scheduledAt),
      limitExpr: template.limitExpr || null,
    });

    res.json(run);
  } catch (error: any) {
    res.status(400).json({ message: error.message || "Failed to schedule job" });
  }
});

export default router;

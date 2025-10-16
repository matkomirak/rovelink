import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { storage } from "./storage";
import { netboxService } from "./services/netbox";
import { fakeRunner } from "./services/fake-runner";
import { notificationService } from "./services/notificationService";
import { insertUserSchema, insertProjectSchema, insertCredentialSchema, insertJobTemplateSchema, insertJobRunSchema } from "@shared/schema";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";

// Auth middleware
interface AuthRequest extends Request {
  userId?: string;
  user?: any;
}

async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    req.userId = decoded.userId;
    req.user = await storage.getUser(decoded.userId);
    next();
  } catch (error) {
    res.status(401).json({ message: "Invalid token" });
  }
}

// Role middleware
function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    next();
  };
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Auth routes
  app.post("/api/auth/signup", async (req, res) => {
    try {
      const { username, password } = insertUserSchema.parse(req.body);
      
      const existing = await storage.getUserByUsername(username);
      if (existing) {
        return res.status(400).json({ message: "Username already exists" });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      const user = await storage.createUser({
        username,
        password: hashedPassword,
        role: "viewer", // Default role
      });

      const token = jwt.sign({ userId: user.id }, JWT_SECRET);
      res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
    } catch (error: any) {
      res.status(400).json({ message: error.message || "Signup failed" });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const { username, password } = insertUserSchema.parse(req.body);
      
      const user = await storage.getUserByUsername(username);
      if (!user) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      const validPassword = await bcrypt.compare(password, user.password);
      if (!validPassword) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      const token = jwt.sign({ userId: user.id }, JWT_SECRET);
      res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
    } catch (error: any) {
      res.status(400).json({ message: error.message || "Login failed" });
    }
  });

  app.get("/api/auth/me", authMiddleware, async (req: AuthRequest, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    res.json({ id: req.user.id, username: req.user.username, role: req.user.role });
  });

  // Inventory routes (NetBox integration)
  app.get("/api/inventory/groups", authMiddleware, async (req, res) => {
    try {
      const groups = await netboxService.getGroups();
      res.json(groups);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to fetch groups" });
    }
  });

  app.get("/api/inventory/hosts", authMiddleware, async (req, res) => {
    try {
      const group = req.query.group as string | undefined;
      const hosts = await netboxService.getHosts(group);
      res.json(hosts);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to fetch hosts" });
    }
  });

  app.post("/api/inventory/preflight", authMiddleware, async (req, res) => {
    try {
      const { limitExpr } = req.body;
      const result = await netboxService.preflightCheck(limitExpr);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Preflight check failed" });
    }
  });

  app.get("/api/inventory/suggest", authMiddleware, async (req, res) => {
    try {
      const query = req.query.q as string || "";
      const suggestions = await netboxService.getSuggestions(query);
      res.json(suggestions);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get suggestions" });
    }
  });

  // Projects routes
  app.get("/api/projects", authMiddleware, async (req, res) => {
    try {
      const projects = await storage.getProjects();
      res.json(projects);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to fetch projects" });
    }
  });

  app.post("/api/projects", authMiddleware, async (req, res) => {
    try {
      const data = insertProjectSchema.parse(req.body);
      const project = await storage.createProject(data);
      res.json(project);
    } catch (error: any) {
      res.status(400).json({ message: error.message || "Failed to create project" });
    }
  });

  app.post("/api/projects/:id/sync", authMiddleware, async (req, res) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      // Simulate Git sync (in real app, would use simple-git or similar)
      await storage.updateProject(req.params.id, {
        syncStatus: "syncing",
      });

      // Simulate async operation
      setTimeout(async () => {
        const mockPlaybooks = ["site.yml", "deploy.yml", "rollback.yml"];
        await storage.updateProject(req.params.id, {
          syncStatus: "success",
          lastSyncAt: new Date(),
          playbooks: mockPlaybooks,
        });
      }, 2000);

      res.json({ message: "Sync started" });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Sync failed" });
    }
  });

  // Credentials routes
  app.get("/api/credentials", authMiddleware, async (req, res) => {
    try {
      const credentials = await storage.getCredentials();
      res.json(credentials);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to fetch credentials" });
    }
  });

  app.post("/api/credentials", authMiddleware, async (req, res) => {
    try {
      const data = insertCredentialSchema.parse(req.body);
      const credential = await storage.createCredential(data);
      res.json(credential);
    } catch (error: any) {
      res.status(400).json({ message: error.message || "Failed to create credential" });
    }
  });

  // Templates routes
  app.get("/api/templates", authMiddleware, async (req, res) => {
    try {
      const templates = await storage.getJobTemplates();
      res.json(templates);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to fetch templates" });
    }
  });

  app.post("/api/templates", authMiddleware, async (req, res) => {
    try {
      const data = insertJobTemplateSchema.parse(req.body);
      const template = await storage.createJobTemplate(data);
      res.json(template);
    } catch (error: any) {
      res.status(400).json({ message: error.message || "Failed to create template" });
    }
  });

  app.post("/api/templates/:id/launch", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const template = await storage.getJobTemplate(req.params.id);
      if (!template) {
        return res.status(404).json({ message: "Template not found" });
      }

      const run = await storage.createJobRun({
        templateId: template.id,
        userId: req.userId!,
        status: "queued",
      });

      // Start execution asynchronously
      setImmediate(async () => {
        try {
          await storage.updateJobRun(run.id, {
            status: "running",
            startedAt: new Date(),
          });

          let logs = "";
          const result = await fakeRunner.executeRun(run, (log) => {
            logs += log;
            // Broadcast to WebSocket clients
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

          // Trigger notifications
          if (updatedRun) {
            await notificationService.triggerNotifications(updatedRun);
          }
        } catch (error) {
          const failedRun = await storage.updateJobRun(run.id, {
            status: "failed",
            completedAt: new Date(),
          });

          // Trigger notifications for failure
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

  app.post("/api/templates/:id/schedule", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const template = await storage.getJobTemplate(req.params.id);
      if (!template) {
        return res.status(404).json({ message: "Template not found" });
      }

      const { scheduledAt } = req.body;
      const run = await storage.createJobRun({
        templateId: template.id,
        userId: req.userId!,
        status: "queued",
        scheduledAt: new Date(scheduledAt),
      });

      // In real app, would use a job queue like GoodJob
      const delay = new Date(scheduledAt).getTime() - Date.now();
      setTimeout(async () => {
        // Trigger execution at scheduled time (simplified)
        await storage.updateJobRun(run.id, { status: "running" });
        // Execute run...
      }, delay);

      res.json(run);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to schedule job" });
    }
  });

  // Runs routes
  app.get("/api/runs", authMiddleware, async (req, res) => {
    try {
      const { status, archived, startDate, endDate, page = "1", pageSize = "50" } = req.query;
      const filters: any = {};
      
      if (status) filters.status = status;
      if (archived) filters.archived = archived === "true";
      if (startDate) filters.startDate = new Date(startDate as string);
      if (endDate) filters.endDate = new Date(endDate as string);
      
      const pageNum = parseInt(page as string);
      const pageSizeNum = parseInt(pageSize as string);
      
      const runs = await storage.getJobRuns(filters, pageNum, pageSizeNum);
      res.json(runs);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to fetch runs" });
    }
  });

  app.get("/api/runs/:id", authMiddleware, async (req, res) => {
    try {
      const run = await storage.getJobRun(req.params.id);
      if (!run) {
        return res.status(404).json({ message: "Run not found" });
      }
      res.json(run);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to fetch run" });
    }
  });

  app.post("/api/runs/:id/archive", authMiddleware, async (req, res) => {
    try {
      const run = await storage.getJobRun(req.params.id);
      if (!run) {
        return res.status(404).json({ message: "Run not found" });
      }

      await storage.updateJobRun(req.params.id, { archived: true });
      res.json({ message: "Run archived successfully" });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to archive run" });
    }
  });

  app.post("/api/runs/:id/unarchive", authMiddleware, async (req, res) => {
    try {
      const run = await storage.getJobRun(req.params.id);
      if (!run) {
        return res.status(404).json({ message: "Run not found" });
      }

      await storage.updateJobRun(req.params.id, { archived: false });
      res.json({ message: "Run unarchived successfully" });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to unarchive run" });
    }
  });

  app.get("/api/runs/:id/csv", authMiddleware, async (req, res) => {
    try {
      const run = await storage.getJobRun(req.params.id);
      if (!run) {
        return res.status(404).json({ message: "Run not found" });
      }

      const csv = `Run ID,Status,Started,Completed,Hosts,OK,Changed,Failed\n${run.id},${run.status},${run.startedAt || ""},${run.completedAt || ""},${(run.resultSummary as any)?.hosts || 0},${(run.resultSummary as any)?.ok || 0},${(run.resultSummary as any)?.changed || 0},${(run.resultSummary as any)?.failed || 0}`;
      
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="run-${run.id}.csv"`);
      res.send(csv);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to generate CSV" });
    }
  });

  // Reports routes
  app.get("/api/reports/inventory-health", authMiddleware, async (req, res) => {
    try {
      const hosts = await netboxService.getHosts();
      const total = hosts.length;
      const withIP = hosts.filter(h => h.primary_ip4).length;
      const withUser = hosts.filter(h => h.ansible_user).length;
      const coverage = total > 0 ? Math.round((Math.min(withIP, withUser) / total) * 100) : 0;

      res.json({ total, withIP, withUser, coverage });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to fetch inventory health" });
    }
  });

  // Settings routes
  app.get("/api/settings", authMiddleware, async (req, res) => {
    try {
      const netboxUrl = await storage.getSetting("netbox_url");
      const netboxToken = await storage.getSetting("netbox_token");

      res.json({
        netboxUrl: netboxUrl?.value || process.env.NETBOX_URL || "",
        netboxToken: netboxToken?.value ? "********" : "",
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to fetch settings" });
    }
  });

  app.post("/api/settings", authMiddleware, async (req, res) => {
    try {
      const { netboxUrl, netboxToken } = req.body;
      
      if (netboxUrl) {
        await storage.setSetting("netbox_url", netboxUrl);
      }
      if (netboxToken && netboxToken !== "********") {
        await storage.setSetting("netbox_token", netboxToken);
      }

      res.json({ message: "Settings saved" });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to save settings" });
    }
  });

  app.post("/api/settings/test-connection", authMiddleware, async (req, res) => {
    try {
      const netboxUrl = await storage.getSetting("netbox_url");
      const netboxToken = await storage.getSetting("netbox_token");
      
      const url = netboxUrl?.value || process.env.NETBOX_URL || "";
      const token = netboxToken?.value || process.env.NETBOX_TOKEN || "";
      
      if (!url) {
        return res.status(400).json({ message: "NetBox URL is not configured" });
      }
      
      const connected = await netboxService.testConnection(url, token);
      if (connected) {
        res.json({ message: "Connection successful" });
      } else {
        res.status(500).json({ message: "Connection failed" });
      }
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Connection test failed" });
    }
  });

  // Notification routes
  app.get("/api/notifications", authMiddleware, async (req, res) => {
    try {
      const notifications = await storage.getNotifications();
      res.json(notifications);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to fetch notifications" });
    }
  });

  app.post("/api/notifications", authMiddleware, async (req, res) => {
    try {
      const notification = await storage.createNotification(req.body);
      res.json(notification);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to create notification" });
    }
  });

  app.patch("/api/notifications/:id", authMiddleware, async (req, res) => {
    try {
      const notification = await storage.updateNotification(req.params.id, req.body);
      if (!notification) {
        return res.status(404).json({ message: "Notification not found" });
      }
      res.json(notification);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to update notification" });
    }
  });

  app.delete("/api/notifications/:id", authMiddleware, async (req, res) => {
    try {
      await storage.deleteNotification(req.params.id);
      res.json({ message: "Notification deleted" });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to delete notification" });
    }
  });

  // Provider routes
  app.get("/api/providers", authMiddleware, async (req, res) => {
    try {
      const providers = await storage.getProviders();
      res.json(providers);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get providers" });
    }
  });

  app.post("/api/providers", authMiddleware, requireRole("admin"), async (req, res) => {
    try {
      const provider = await storage.createProvider(req.body);
      res.json(provider);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to create provider" });
    }
  });

  app.patch("/api/providers/:id", authMiddleware, requireRole("admin"), async (req, res) => {
    try {
      const provider = await storage.updateProvider(req.params.id, req.body);
      if (!provider) {
        return res.status(404).json({ message: "Provider not found" });
      }
      res.json(provider);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to update provider" });
    }
  });

  app.post("/api/providers/:id/test", authMiddleware, requireRole("admin", "operator"), async (req, res) => {
    try {
      const provider = await storage.getProvider(req.params.id);
      if (!provider) {
        return res.status(404).json({ message: "Provider not found" });
      }

      const { getProviderCollector } = await import("./services/providers/registry");
      const collector = getProviderCollector(provider.kind, provider.config);
      const result = await collector.testConnection();
      
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to test connection" });
    }
  });

  app.post("/api/providers/:id/sync", authMiddleware, requireRole("admin", "operator"), async (req, res) => {
    try {
      const provider = await storage.getProvider(req.params.id);
      if (!provider) {
        return res.status(404).json({ message: "Provider not found" });
      }

      // Create sync run
      const syncRun = await storage.createSyncRun({
        providerAccountId: provider.id,
        type: "provider-sync",
        status: "queued",
      });

      // Execute sync in background
      const { SyncWorker } = await import("./services/syncWorker");
      const worker = new SyncWorker();
      worker.executeSyncRun(syncRun.id).catch(console.error);

      res.json({ runId: syncRun.id });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to start sync" });
    }
  });

  app.get("/api/providers/:id/runs", authMiddleware, async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const runs = await storage.getProviderRuns(req.params.id, limit);
      res.json(runs);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get provider runs" });
    }
  });

  // Housekeeping routes
  app.post("/api/housekeeping/rebuild-groups-cache", authMiddleware, requireRole("admin"), async (req, res) => {
    try {
      const { netboxService } = await import("./services/netbox");
      const groups = await netboxService.listAllGroups();
      
      await storage.clearGroupCache();
      for (const group of groups) {
        await storage.addGroupCache(group);
      }
      
      res.json({ message: `Rebuilt cache with ${groups.length} groups` });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to rebuild cache" });
    }
  });

  app.post("/api/housekeeping/ensure-netbox-schema", authMiddleware, requireRole("admin"), async (req, res) => {
    try {
      const { netboxService } = await import("./services/netbox");
      const fields = ["ext_id", "ext_provider", "patch_wave", "patch_subwave", "ansible_user"];
      const result = await netboxService.ensureCustomFields(fields);
      
      res.json({
        message: `Ensured ${fields.length} custom fields`,
        created: result.created,
        existing: result.existing,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to ensure schema" });
    }
  });

  app.post("/api/housekeeping/prune-stale", authMiddleware, requireRole("admin"), async (req, res) => {
    try {
      const days = parseInt(req.body.days as string) || 30;
      const count = await storage.pruneStaleObjects(days);
      
      res.json({ message: `Pruned ${count} stale objects (not seen in ${days} days)` });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to prune stale objects" });
    }
  });

  app.post("/api/housekeeping/retry-last-failed", authMiddleware, requireRole("admin"), async (req, res) => {
    try {
      const failedRuns = await storage.getLastFailedSyncRuns();
      const retried: string[] = [];
      
      const { SyncWorker } = await import("./services/syncWorker");
      
      for (const run of failedRuns) {
        const newRun = await storage.createSyncRun({
          providerAccountId: run.providerAccountId,
          type: "provider-sync",
          status: "queued",
        });
        
        const worker = new SyncWorker();
        worker.executeSyncRun(newRun.id).catch(console.error);
        retried.push(newRun.id);
      }
      
      res.json({ message: `Retried ${retried.length} failed syncs`, runs: retried });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to retry syncs" });
    }
  });

  app.post("/api/housekeeping/rotate-tokens", authMiddleware, requireRole("admin"), async (req, res) => {
    try {
      // Stub implementation
      res.json({ message: "Token rotation checked (stub)", checkedAt: new Date().toISOString() });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to rotate tokens" });
    }
  });

  // Stats routes
  app.get("/api/stats/providers", authMiddleware, async (req, res) => {
    try {
      const stats = await storage.getProviderStats();
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get provider stats" });
    }
  });

  // Create HTTP server
  const httpServer = createServer(app);

  // WebSocket server for live logs (from javascript_websocket blueprint)
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  // Store WebSocket clients per run ID
  (global as any).wsClients = new Map();

  wss.on('connection', (ws, req) => {
    const url = req.url || "";
    const match = url.match(/\/ws\/runs\/([^/]+)/);
    
    if (match) {
      const runId = match[1];
      
      if (!(global as any).wsClients.has(runId)) {
        (global as any).wsClients.set(runId, new Set());
      }
      (global as any).wsClients.get(runId).add(ws);

      ws.on('close', () => {
        const clients = (global as any).wsClients.get(runId);
        if (clients) {
          clients.delete(ws);
          if (clients.size === 0) {
            (global as any).wsClients.delete(runId);
          }
        }
      });

      // Send initial connection message
      if (ws.readyState === WebSocket.OPEN) {
        ws.send("Connected to run stream\n");
      }
    }
  });

  return httpServer;
}

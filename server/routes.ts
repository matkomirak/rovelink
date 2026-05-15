import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import { storage } from "./storage";
import { netboxService } from "./services/netbox";
import { fakeRunner } from "./services/fake-runner";
import { notificationService } from "./services/notificationService";
import { ProxmoxCollector } from "./services/proxmox-collector";
import { NetBoxAdapter } from "./services/netbox-adapter";
import { runProviderSyncWithWorker } from "./services/syncWorker";
import { insertUserSchema, insertProjectSchema, insertCredentialSchema, insertJobTemplateSchema, insertJobRunSchema, insertNetboxInventorySourceSchema, insertProviderAccountSchema, insertCmdbAccountSchema, netboxVms } from "@shared/schema";
import { db } from "./db";
import { eq } from "drizzle-orm";
import {
  sanitizeProviderForResponse,
  sanitizeCmdbForResponse,
  sanitizeNetboxSourceForResponse,
  encryptProviderConfig,
  decryptProviderConfig,
  encryptCmdbConfig,
  decryptCmdbConfig,
  encryptNetboxToken,
  decryptNetboxToken,
} from "./services/secrets";

// Import modular RDP routes
import pipelineRoutes from "./routes/pipelines";
import pipelineMappingRoutes from "./routes/pipeline-mappings";
import providerDiscoveryRoutes from "./routes/provider-discovery";
import automationInventoryRoutes from "./routes/automation-inventories";
import gateRoutes from "./routes/gate";

// ─── JWT setup ────────────────────────────────────────────────────────────────
const isProduction = process.env.NODE_ENV === "production";

if (isProduction && !process.env.JWT_SECRET) {
  console.error("FATAL: JWT_SECRET environment variable is required in production. Refusing to start.");
  process.exit(1);
}

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";
const JWT_EXPIRES_IN = "24h";

// ─── Rate limiter for login ───────────────────────────────────────────────────
const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many login attempts, please try again later" },
});

// Auth middleware
interface AuthRequest extends Request {
  userId?: string;
  user?: any;
}

async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  // Extract token from Authorization header or HttpOnly cookie
  let token: string | undefined;
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    token = authHeader.substring(7);
  } else if (req.cookies?.auth_token) {
    token = req.cookies.auth_token;
  }

  if (!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }

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
  // Mount RDP modular routes with auth middleware
  app.use("/api/pipelines", authMiddleware, pipelineRoutes);
  app.use("/api/pipelines", authMiddleware, pipelineMappingRoutes);
  app.use("/api/providers", authMiddleware, providerDiscoveryRoutes);
  app.use("/api/inventories", authMiddleware, automationInventoryRoutes);
  app.use("/api/gate", gateRoutes);

  // ─── Auth routes ────────────────────────────────────────────────────────────

  function setAuthCookie(res: Response, token: string) {
    res.cookie("auth_token", token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: "strict",
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    });
  }

  app.post("/api/auth/signup", loginRateLimiter, async (req, res) => {
    try {
      const { username, password } = insertUserSchema.parse(req.body);
      
      const existing = await storage.getUserByUsername(username);
      if (existing) {
        return res.status(400).json({ message: "Username already exists" });
      }

      const hashedPassword = await bcrypt.hash(password, 12);
      const user = await storage.createUser({
        username,
        password: hashedPassword,
        role: "viewer",
      });

      const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
      setAuthCookie(res, token);
      res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
    } catch (error: any) {
      res.status(400).json({ message: error.message || "Signup failed" });
    }
  });

  app.post("/api/auth/login", loginRateLimiter, async (req, res) => {
    try {
      // AUTH_DISABLE: dev-only bypass. Hard-fails in production.
      if (process.env.AUTH_DISABLE === "true") {
        if (isProduction) {
          console.error("SECURITY ALERT: AUTH_DISABLE=true detected in production — request rejected.");
          return res.status(403).json({ message: "AUTH_DISABLE is not permitted in production." });
        }
        // Development-only stub login
        const stubUser = { id: "stub-admin-id", username: "admin", role: "admin" };
        const token = jwt.sign({ userId: stubUser.id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
        setAuthCookie(res, token);
        return res.json({ token, user: stubUser });
      }

      const { username, password } = insertUserSchema.parse(req.body);
      
      const user = await storage.getUserByUsername(username);
      if (!user) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      const validPassword = await bcrypt.compare(password, user.password);
      if (!validPassword) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
      setAuthCookie(res, token);
      res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
    } catch (error: any) {
      res.status(400).json({ message: error.message || "Login failed" });
    }
  });

  app.post("/api/auth/logout", (_req, res) => {
    res.clearCookie("auth_token", { httpOnly: true, sameSite: "strict" });
    res.json({ message: "Logged out" });
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
      const suggestions = await netboxService.getSuggestions(query, storage);
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

  app.patch("/api/projects/:id", authMiddleware, async (req, res) => {
    try {
      const data = insertProjectSchema.partial().parse(req.body);
      const project = await storage.updateProject(req.params.id, data);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      res.json(project);
    } catch (error: any) {
      res.status(400).json({ message: error.message || "Failed to update project" });
    }
  });

  app.delete("/api/projects/:id", authMiddleware, async (req, res) => {
    try {
      await storage.deleteProject(req.params.id);
      res.json({ message: "Project deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to delete project" });
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

  app.patch("/api/credentials/:id", authMiddleware, async (req, res) => {
    try {
      const data = insertCredentialSchema.partial().parse(req.body);
      const credential = await storage.updateCredential(req.params.id, data);
      if (!credential) {
        return res.status(404).json({ message: "Credential not found" });
      }
      res.json(credential);
    } catch (error: any) {
      res.status(400).json({ message: error.message || "Failed to update credential" });
    }
  });

  app.delete("/api/credentials/:id", authMiddleware, async (req, res) => {
    try {
      await storage.deleteCredential(req.params.id);
      res.json({ message: "Credential deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to delete credential" });
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

  app.patch("/api/templates/:id", authMiddleware, async (req, res) => {
    try {
      const template = await storage.updateJobTemplate(req.params.id, req.body);
      res.json(template);
    } catch (error: any) {
      res.status(400).json({ message: error.message || "Failed to update template" });
    }
  });

  app.delete("/api/templates/:id", authMiddleware, async (req, res) => {
    try {
      await storage.deleteJobTemplate(req.params.id);
      res.json({ message: "Template deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to delete template" });
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
        limitExpr: template.limitExpr || null,
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
        limitExpr: template.limitExpr || null,
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

  // Unified Runs routes - combines job_runs, pipeline_runs, and sync_runs
  app.get("/api/runs", authMiddleware, async (req, res) => {
    try {
      const { status, archived, startDate, endDate, type, page = "1", pageSize = "100" } = req.query;
      const typeFilter = type && type !== "_all" ? type as string : null;
      const statusFilter = status && status !== "_all" ? status as string : null;
      
      // Fetch all run types in parallel
      const [jobRunsData, pipelineRunsData, syncRunsData, pipelinesData, providersData] = await Promise.all([
        storage.getJobRuns({}, 1, 100),
        storage.getAllPipelineRuns(100),
        storage.getAllSyncRuns(100),
        storage.getPipelines(),
        storage.getProviders(),
      ]);

      // Create lookup maps for names
      const pipelineNameMap = new Map(pipelinesData.map((p: { id: string; name: string }) => [p.id, p.name]));
      const providerNameMap = new Map(providersData.map((p: { id: string; name: string }) => [p.id, p.name]));

      // Normalize all runs to a common format
      interface UnifiedRun {
        id: string;
        runType: 'playbook-run' | 'bdp-sync' | 'provider-sync';
        status: string;
        startedAt: Date | null;
        finishedAt: Date | null;
        createdAt: Date;
        logs: string | null;
        summary: any;
        archived: boolean;
        sourceId: string | null;
        sourceName: string | null;
        sourceType: string | null;
      }

      const unifiedRuns: UnifiedRun[] = [];

      // Add job runs (playbook runs)
      for (const run of jobRunsData) {
        unifiedRuns.push({
          id: run.id,
          runType: 'playbook-run',
          status: run.status,
          startedAt: run.startedAt,
          finishedAt: run.completedAt,
          createdAt: run.createdAt,
          logs: run.logs,
          summary: run.resultSummary,
          archived: run.archived || false,
          sourceId: run.templateId,
          sourceName: null, // Would need to fetch template name
          sourceType: 'template',
        });
      }

      // Add pipeline runs
      for (const run of pipelineRunsData) {
        unifiedRuns.push({
          id: run.id,
          runType: 'bdp-sync',
          status: run.status,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
          createdAt: run.createdAt,
          logs: run.logs,
          summary: run.summary,
          archived: false, // Pipeline runs don't have archive
          sourceId: run.pipelineId,
          sourceName: pipelineNameMap.get(run.pipelineId) || 'Unknown Pipeline',
          sourceType: 'pipeline',
        });
      }

      // Add sync runs (provider syncs)
      for (const run of syncRunsData) {
        unifiedRuns.push({
          id: run.id,
          runType: 'provider-sync',
          status: run.status,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
          createdAt: run.createdAt,
          logs: run.logs,
          summary: run.counts,
          archived: false, // Sync runs don't have archive
          sourceId: run.providerAccountId,
          sourceName: providerNameMap.get(run.providerAccountId) || 'Unknown Provider',
          sourceType: 'provider',
        });
      }

      // Sort by createdAt descending
      unifiedRuns.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      // Apply filters
      let filteredRuns = unifiedRuns;
      
      if (typeFilter) {
        filteredRuns = filteredRuns.filter(r => r.runType === typeFilter);
      }
      if (statusFilter) {
        filteredRuns = filteredRuns.filter(r => r.status === statusFilter);
      }
      if (archived) {
        const showArchived = archived === "true";
        filteredRuns = filteredRuns.filter(r => r.archived === showArchived);
      }
      if (startDate) {
        const start = new Date(startDate as string);
        filteredRuns = filteredRuns.filter(r => new Date(r.createdAt) >= start);
      }
      if (endDate) {
        const end = new Date(endDate as string);
        filteredRuns = filteredRuns.filter(r => new Date(r.createdAt) <= end);
      }

      res.json(filteredRuns);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to fetch runs" });
    }
  });

  app.get("/api/runs/:id", authMiddleware, async (req, res) => {
    try {
      const id = req.params.id;
      
      // Try to find the run in all three tables
      const jobRun = await storage.getJobRun(id);
      if (jobRun) {
        return res.json({
          ...jobRun,
          runType: 'playbook-run',
          sourceType: 'template',
          finishedAt: jobRun.completedAt,
        });
      }

      const pipelineRun = await storage.getPipelineRun(id);
      if (pipelineRun) {
        const pipeline = await storage.getPipeline(pipelineRun.pipelineId);
        return res.json({
          ...pipelineRun,
          runType: 'bdp-sync',
          sourceType: 'pipeline',
          sourceName: pipeline?.name || 'Unknown Pipeline',
        });
      }

      const syncRun = await storage.getSyncRun(id);
      if (syncRun) {
        const provider = await storage.getProvider(syncRun.providerAccountId);
        return res.json({
          ...syncRun,
          runType: 'provider-sync',
          sourceType: 'provider',
          sourceName: provider?.name || 'Unknown Provider',
        });
      }

      return res.status(404).json({ message: "Run not found" });
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
        // Encrypt before persisting to DB
        const encryptedToken = encryptNetboxToken(netboxToken);
        await storage.setSetting("netbox_token", encryptedToken);
      }

      res.json({ message: "Settings saved" });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to save settings" });
    }
  });

  app.post("/api/settings/test-connection", authMiddleware, async (req, res) => {
    try {
      const netboxUrl = await storage.getSetting("netbox_url");
      const netboxTokenSetting = await storage.getSetting("netbox_token");
      
      const url = netboxUrl?.value || process.env.NETBOX_URL || "";
      // Decrypt token from DB before use; fall back to env var (assumed plaintext)
      const rawStoredToken = netboxTokenSetting?.value || "";
      const token = rawStoredToken ? decryptNetboxToken(rawStoredToken) : (process.env.NETBOX_TOKEN || "");
      
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

  // ─── Provider routes ─────────────────────────────────────────────────────────
  app.get("/api/providers", authMiddleware, async (req, res) => {
    try {
      const providers = await storage.getProviders();
      res.json(providers.map(sanitizeProviderForResponse));
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get providers" });
    }
  });

  app.get("/api/providers/:id", authMiddleware, async (req, res) => {
    try {
      const provider = await storage.getProvider(req.params.id);
      if (!provider) {
        return res.status(404).json({ message: "Provider not found" });
      }
      res.json(sanitizeProviderForResponse(provider));
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get provider" });
    }
  });

  // Get VMs discovered by a provider
  app.get("/api/providers/:id/vms", authMiddleware, async (req, res) => {
    try {
      const provider = await storage.getProvider(req.params.id);
      if (!provider) {
        return res.status(404).json({ message: "Provider not found" });
      }

      const { getProviderCollector } = await import("./services/providers/registry");
      const decryptedConfig = decryptProviderConfig(provider.config as Record<string, any>);
      const collector = getProviderCollector(provider.kind, decryptedConfig);
      const vms = await collector.listVms();
      
      res.json({ 
        provider: { id: provider.id, name: provider.name, kind: provider.kind },
        vms 
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get provider VMs" });
    }
  });

  app.post("/api/providers", authMiddleware, requireRole("admin"), async (req, res) => {
    try {
      const body = { ...req.body };
      if (body.config && typeof body.config === "object") {
        body.config = encryptProviderConfig(body.config);
      }
      const provider = await storage.createProvider(body);
      res.json(sanitizeProviderForResponse(provider));
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to create provider" });
    }
  });

  app.patch("/api/providers/:id", authMiddleware, requireRole("admin"), async (req, res) => {
    try {
      const body = { ...req.body };
      if (body.config && typeof body.config === "object") {
        // Merge with existing encrypted config so blank secret fields don't wipe stored secrets
        const existing = await storage.getProvider(req.params.id);
        if (existing) {
          const existingConfig = existing.config as Record<string, any>;
          const incoming = body.config as Record<string, any>;
          const merged: Record<string, any> = { ...existingConfig };
          for (const [k, v] of Object.entries(incoming)) {
            if (v !== "" && v !== null && v !== undefined) {
              merged[k] = v;
            }
          }
          body.config = encryptProviderConfig(merged);
        } else {
          body.config = encryptProviderConfig(body.config);
        }
      }
      const provider = await storage.updateProvider(req.params.id, body);
      if (!provider) {
        return res.status(404).json({ message: "Provider not found" });
      }
      res.json(sanitizeProviderForResponse(provider));
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
      const decryptedConfig = decryptProviderConfig(provider.config as Record<string, any>);
      const collector = getProviderCollector(provider.kind, decryptedConfig);
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

      // Start provider sync
      const runId = await runProviderSyncWithWorker(provider.id);

      res.json({ runId });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to start sync" });
    }
  });

  app.delete("/api/providers/:id", authMiddleware, requireRole("admin"), async (req, res) => {
    try {
      const existing = await storage.getProvider(req.params.id);
      if (!existing) {
        return res.status(404).json({ message: "Provider not found" });
      }
      await storage.deleteProvider(req.params.id);
      res.json({ message: "Provider deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to delete provider" });
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

  // ─── CMDB routes ─────────────────────────────────────────────────────────────
  app.get("/api/cmdbs", authMiddleware, async (req, res) => {
    try {
      const cmdbs = await storage.getCmdbAccounts();
      res.json(cmdbs.map(sanitizeCmdbForResponse));
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get CMDBs" });
    }
  });

  app.post("/api/cmdbs", authMiddleware, requireRole("admin"), async (req, res) => {
    try {
      const data = insertCmdbAccountSchema.parse(req.body);
      const body = { ...data };
      if (body.config && typeof body.config === "object") {
        body.config = encryptCmdbConfig(body.config as Record<string, any>);
      }
      const cmdb = await storage.createCmdbAccount(body);
      res.json(sanitizeCmdbForResponse(cmdb));
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to create CMDB account" });
    }
  });

  app.patch("/api/cmdbs/:id", authMiddleware, requireRole("admin"), async (req, res) => {
    try {
      const body = { ...req.body };
      if (body.config && typeof body.config === "object") {
        // Preserve existing encrypted secrets when blank fields submitted
        const existing = await storage.getCmdbAccount(req.params.id);
        if (existing) {
          const existingConfig = (existing.config as Record<string, any>) || {};
          const incoming = body.config as Record<string, any>;
          const merged: Record<string, any> = { ...existingConfig };
          for (const [k, v] of Object.entries(incoming)) {
            if (v !== "" && v !== null && v !== undefined) {
              merged[k] = v;
            }
          }
          body.config = encryptCmdbConfig(merged);
        } else {
          body.config = encryptCmdbConfig(body.config);
        }
      }
      const cmdb = await storage.updateCmdbAccount(req.params.id, body);
      if (!cmdb) {
        return res.status(404).json({ message: "CMDB account not found" });
      }
      res.json(sanitizeCmdbForResponse(cmdb));
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to update CMDB account" });
    }
  });

  app.delete("/api/cmdbs/:id", authMiddleware, requireRole("admin"), async (req, res) => {
    try {
      await storage.deleteCmdbAccount(req.params.id);
      res.json({ message: "CMDB account deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to delete CMDB account" });
    }
  });

  app.post("/api/cmdbs/:id/test", authMiddleware, requireRole("admin", "operator"), async (req, res) => {
    try {
      const cmdb = await storage.getCmdbAccount(req.params.id);
      if (!cmdb) {
        return res.status(404).json({ message: "CMDB account not found" });
      }

      if (cmdb.kind === "netbox") {
        const decryptedConfig = decryptCmdbConfig(cmdb.config as Record<string, any>);
        const adapter = new NetBoxAdapter(decryptedConfig as any);
        const result = await adapter.test();
        
        if (result.ok) {
          await storage.updateCmdbAccount(req.params.id, {
            lastValidatedAt: new Date(),
          });
        }
        
        res.json(result);
      } else {
        res.status(400).json({ error: "Unsupported CMDB kind" });
      }
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to test connection" });
    }
  });

  app.get("/api/cmdbs/:id/vms", authMiddleware, async (req, res) => {
    try {
      const cmdb = await storage.getCmdbAccount(req.params.id);
      if (!cmdb) {
        return res.status(404).json({ message: "CMDB account not found" });
      }
      if (cmdb.kind !== "netbox") {
        return res.status(400).json({ message: "VM listing is only supported for NetBox CMDBs" });
      }
      const decryptedConfig = decryptCmdbConfig(cmdb.config as Record<string, any>);
      const adapter = new NetBoxAdapter(decryptedConfig as any);
      const vms = await adapter.listAllVms();
      res.json({ vms, total: vms.length });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to fetch VMs" });
    }
  });

  // Housekeeping routes
  app.post("/api/housekeeping/rebuild-groups-cache", authMiddleware, requireRole("admin"), async (req, res) => {
    try {
      const { netboxService } = await import("./services/netbox");
      const groups = await netboxService.listAllGroups(storage);
      
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
      const netboxUrl = process.env.NETBOX_URL || '';
      const netboxToken = process.env.NETBOX_TOKEN || '';

      if (!netboxUrl || !netboxToken) {
        return res.status(400).json({ message: "NetBox URL or Token not configured" });
      }

      const adapter = new NetBoxAdapter({ url: netboxUrl, token: netboxToken });
      await adapter.ensureCustomFields();
      
      res.json({
        message: "Ensured NetBox custom fields (ext_id, ext_provider, patch_wave, patch_subwave, ansible_user)",
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

  // NetBox VM import routes
  app.post("/api/netbox/import", authMiddleware, requireRole("admin"), async (req, res) => {
    try {
      const { sourceId } = req.body;
      
      if (!sourceId) {
        return res.status(400).json({ message: "Source ID is required" });
      }

      const { netboxService } = await import("./services/netbox");
      
      // Get NetBox source
      const source = await storage.getNetboxInventorySource(sourceId);
      
      if (!source) {
        return res.status(404).json({ message: "NetBox source not found" });
      }

      if (!source.enabled) {
        return res.status(400).json({ message: "NetBox source is disabled" });
      }

      // Fetch VMs from NetBox (decrypt token before use)
      const decryptedToken = decryptNetboxToken(source.token);
      const vms = await netboxService.getVirtualMachines(source.url, decryptedToken);
      
      // Clear existing VMs from this source
      await db.delete(netboxVms).where(eq(netboxVms.sourceId, sourceId));
      
      // Import all VMs with sourceId
      let imported = 0;
      for (const vm of vms) {
        await storage.upsertNetboxVm({
          sourceId: sourceId,
          netboxId: vm.id,
          name: vm.name,
          ip: vm.ip || null,
          operatingSystem: vm.operatingSystem || null,
          customFields: vm.customFields,
          tags: vm.tags,
        });
        imported++;
      }

      // Update last import timestamp
      await storage.updateNetboxInventorySource(sourceId, { lastImportAt: new Date() });

      res.json({ 
        message: `Successfully imported ${imported} VMs from ${source.name}`, 
        count: imported 
      });
    } catch (error: any) {
      console.error("NetBox import failed:", error);
      res.status(500).json({ message: error.message || "Failed to import VMs from NetBox" });
    }
  });

  app.get("/api/netbox/vms", authMiddleware, async (req, res) => {
    try {
      const vms = await storage.getNetboxVms();
      res.json(vms);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get NetBox VMs" });
    }
  });

  app.patch("/api/netbox/vms/:id", authMiddleware, async (req, res) => {
    try {
      const { id } = req.params;
      const updates = req.body;
      const updatedVm = await storage.updateNetboxVm(id, updates);
      if (!updatedVm) {
        return res.status(404).json({ message: "VM not found" });
      }
      res.json(updatedVm);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to update VM" });
    }
  });

  // ─── NetBox Inventory Source routes ─────────────────────────────────────────
  app.get("/api/netbox-sources", authMiddleware, async (req, res) => {
    try {
      const sources = await storage.getNetboxInventorySources();
      res.json(sources.map(sanitizeNetboxSourceForResponse));
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get NetBox inventory sources" });
    }
  });

  app.get("/api/netbox-sources/:id", authMiddleware, async (req, res) => {
    try {
      const source = await storage.getNetboxInventorySource(req.params.id);
      if (!source) {
        return res.status(404).json({ message: "NetBox inventory source not found" });
      }
      res.json(sanitizeNetboxSourceForResponse(source));
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get NetBox inventory source" });
    }
  });

  app.post("/api/netbox-sources", authMiddleware, requireRole("admin"), async (req, res) => {
    try {
      const insertSource = insertNetboxInventorySourceSchema.parse(req.body);
      if (insertSource.token) {
        insertSource.token = encryptNetboxToken(insertSource.token);
      }
      const source = await storage.createNetboxInventorySource(insertSource);
      res.status(201).json(sanitizeNetboxSourceForResponse(source));
    } catch (error: any) {
      res.status(400).json({ message: error.message || "Failed to create NetBox inventory source" });
    }
  });

  app.patch("/api/netbox-sources/:id", authMiddleware, requireRole("admin"), async (req, res) => {
    try {
      const body = { ...req.body };
      // If token is blank, keep the existing one; if provided, encrypt it
      if (body.token === "" || body.token === null || body.token === undefined) {
        delete body.token;
      } else if (body.token) {
        body.token = encryptNetboxToken(body.token);
      }
      const source = await storage.updateNetboxInventorySource(req.params.id, body);
      if (!source) {
        return res.status(404).json({ message: "NetBox inventory source not found" });
      }
      res.json(sanitizeNetboxSourceForResponse(source));
    } catch (error: any) {
      res.status(400).json({ message: error.message || "Failed to update NetBox inventory source" });
    }
  });

  app.delete("/api/netbox-sources/:id", authMiddleware, requireRole("admin"), async (req, res) => {
    try {
      await storage.deleteNetboxInventorySource(req.params.id);
      res.status(204).send();
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to delete NetBox inventory source" });
    }
  });

  // Backend-only NetBox source connection test (replaces browser-side direct call)
  app.post("/api/netbox-sources/:id/test", authMiddleware, requireRole("admin", "operator"), async (req, res) => {
    try {
      const source = await storage.getNetboxInventorySource(req.params.id);
      if (!source) {
        return res.status(404).json({ message: "NetBox inventory source not found" });
      }
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

import type { Express, Request, Response, NextFunction } from "express";
import { requireRole } from "./auth/roles";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import { storage } from "./storage";
import { netboxService } from "./services/netbox";
import { dispatchRun } from "./services/runner-dispatcher";
import { notificationService } from "./services/notificationService";
import { ProxmoxCollector } from "./services/proxmox-collector";
import { NetBoxAdapter } from "./services/netbox-adapter";
import { runProviderSyncWithWorker } from "./services/syncWorker";
import { insertUserSchema, insertProjectSchema, insertCredentialSchema, insertJobTemplateSchema, insertJobRunSchema, insertNetboxInventorySourceSchema, insertProviderAccountSchema, insertCmdbAccountSchema, netboxVms, organizations, insertOrganizationSchema } from "@shared/schema";
import { db } from "./db";
import { eq, sql } from "drizzle-orm";
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
import templateRoutes from "./routes/templates";
import runsRoutes from "./routes/runs";
import notificationRoutes from "./routes/notifications";
import settingsRoutes from "./routes/settings";
import netboxRoutes from "./routes/netbox-sources";
import orgRoutes from "./routes/organizations";

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
  orgId?: string;
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

  // Step 1: Verify the token — this is the only hard failure path.
  let decoded: { userId: string; role?: string; username?: string; orgId?: string };
  try {
    decoded = jwt.verify(token, JWT_SECRET) as any;
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }

  // Step 2: Set fallback identity from JWT claims immediately so that tests
  // using synthetic tokens work even if no DB is reachable.
  req.userId = decoded.userId;
  req.orgId = decoded.orgId ?? undefined;
  req.user = decoded.role
    ? ({
        id: decoded.userId,
        username: decoded.username ?? "",
        role: decoded.role,
        orgId: decoded.orgId ?? null,
      } as any)
    : undefined;

  // Step 3: Attempt to hydrate from DB — DB errors must NOT invalidate a valid token.
  try {
    const dbUser = await storage.getUser(decoded.userId);
    if (dbUser) {
      req.user = dbUser;
      req.orgId = dbUser.orgId ?? undefined;
    }
  } catch (error) {
    // Log in non-test environments but do not reject the request.
    if (process.env.NODE_ENV !== "test") {
      console.error("[auth] DB user lookup failed, continuing with JWT claims:", (error as any)?.message);
    }
  }

  if (!req.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  next();
}

// Role middleware — see server/auth/roles.ts for the full hierarchy.

export async function registerRoutes(app: Express): Promise<Server> {
  // ─── Health endpoints (no auth required) ───────────────────────────────────
  app.get("/api/health", (_req, res) => {
    res.status(200).json({ ok: true, service: "rovelink", timestamp: new Date().toISOString() });
  });

  app.get("/api/health/db", async (_req, res) => {
    try {
      await db.execute(sql`select 1`);
      res.status(200).json({ ok: true, database: "ok", timestamp: new Date().toISOString() });
    } catch {
      res.status(503).json({ ok: false, database: "error", timestamp: new Date().toISOString() });
    }
  });

  // Mount RDP modular routes with auth middleware
  app.use("/api/pipelines", authMiddleware, pipelineRoutes);
  app.use("/api/pipelines", authMiddleware, pipelineMappingRoutes);
  app.use("/api/providers", authMiddleware, providerDiscoveryRoutes);
  app.use("/api/inventories", authMiddleware, automationInventoryRoutes);
  app.use("/api/gate", authMiddleware, gateRoutes);
  app.use("/api/templates", authMiddleware, templateRoutes);
  app.use("/api/runs", authMiddleware, runsRoutes);
  app.use("/api/notifications", authMiddleware, notificationRoutes);
  app.use("/api/settings", authMiddleware, settingsRoutes);
  app.use("/api/netbox", authMiddleware, netboxRoutes);
  app.use("/api/netbox-sources", authMiddleware, netboxRoutes);
  app.use("/api/organizations", authMiddleware, orgRoutes);
  app.use("/api/admin/organizations", authMiddleware, orgRoutes);
  app.use("/api/org", authMiddleware, orgRoutes);

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

      const token = jwt.sign({ userId: user.id, username: user.username, role: user.role, orgId: user.orgId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
      setAuthCookie(res, token);
      res.json({ token, user: { id: user.id, username: user.username, role: user.role, orgId: user.orgId } });
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
        const stubUser = { id: "stub-admin-id", username: "admin", role: "admin", orgId: null as null };
        const token = jwt.sign({ userId: stubUser.id, username: stubUser.username, role: stubUser.role, orgId: stubUser.orgId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
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

      const token = jwt.sign({ userId: user.id, username: user.username, role: user.role, orgId: user.orgId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
      setAuthCookie(res, token);
      res.json({ token, user: { id: user.id, username: user.username, role: user.role, orgId: user.orgId } });
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

  // DEMO-ONLY: returns hardcoded mock hosts — not org-scoped.
  // Production use: replace with automation inventory or org-scoped NetBox VM data.
  app.get("/api/inventory/hosts", authMiddleware, async (req, res) => {
    try {
      const group = req.query.group as string | undefined;
      const hosts = await netboxService.getHosts(group);
      res.json({
        _demo: true,
        _note: "Demo data only — not org-scoped. Use automation inventory endpoints in production.",
        hosts,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to fetch hosts" });
    }
  });

  // DEMO-ONLY: preflight evaluated against mock hosts — not org-scoped.
  app.post("/api/inventory/preflight", authMiddleware, async (req, res) => {
    try {
      const { limitExpr } = req.body;
      const result = await netboxService.preflightCheck(limitExpr);
      res.json({
        ...result,
        _demo: true,
        _note: "Demo data only — limit expression evaluated against mock hosts, not real org inventory.",
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Preflight check failed" });
    }
  });

  app.get("/api/inventory/suggest", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const query = req.query.q as string || "";
      const suggestions = await netboxService.getSuggestions(query, storage, req.orgId!);
      res.json(suggestions);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get suggestions" });
    }
  });

  // Projects routes
  app.get("/api/projects", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const projects = await storage.getProjects(req.orgId!);
      res.json(projects);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to fetch projects" });
    }
  });

  app.post("/api/projects", authMiddleware, requireRole("admin"), async (req: AuthRequest, res) => {
    try {
      const { orgId: _o, id: _i, ...safeBody } = req.body;
      const data = insertProjectSchema.parse({ ...safeBody, orgId: req.orgId! });
      const project = await storage.createProject(data);
      res.json(project);
    } catch (error: any) {
      res.status(400).json({ message: error.message || "Failed to create project" });
    }
  });

  app.post("/api/projects/:id/sync", authMiddleware, requireRole("operator", "admin"), async (req: AuthRequest, res) => {
    try {
      const project = await storage.getProject(req.params.id, req.orgId!);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      // Demo sync — simulates Git sync (no real checkout in this environment)
      await storage.updateProject(req.params.id, { syncStatus: "syncing" }, req.orgId!);

      // Simulate async sync with demo playbook discovery
      setTimeout(async () => {
        const demoPlaybooks = ["site.yml", "deploy.yml", "rollback.yml"];
        await storage.updateProject(req.params.id, {
          syncStatus: "success",
          lastSyncAt: new Date(),
          playbooks: demoPlaybooks,
        }, req.orgId!);
      }, 2000);

      res.json({ message: "Demo sync started — playbooks discovered from simulated repository" });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Sync failed" });
    }
  });

  app.patch("/api/projects/:id", authMiddleware, requireRole("admin"), async (req: AuthRequest, res) => {
    try {
      const data = insertProjectSchema.partial().parse(req.body);
      const project = await storage.updateProject(req.params.id, data, req.orgId!);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      res.json(project);
    } catch (error: any) {
      res.status(400).json({ message: error.message || "Failed to update project" });
    }
  });

  app.delete("/api/projects/:id", authMiddleware, requireRole("admin"), async (req: AuthRequest, res) => {
    try {
      await storage.deleteProject(req.params.id, req.orgId!);
      res.json({ message: "Project deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to delete project" });
    }
  });

  // Credentials routes
  app.get("/api/credentials", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const credentials = await storage.getCredentials(req.orgId!);
      res.json(credentials);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to fetch credentials" });
    }
  });

  app.post("/api/credentials", authMiddleware, requireRole("admin"), async (req: AuthRequest, res) => {
    try {
      const { orgId: _o, id: _i, ...safeBody } = req.body;
      const data = insertCredentialSchema.parse({ ...safeBody, orgId: req.orgId! });
      const credential = await storage.createCredential(data);
      res.json(credential);
    } catch (error: any) {
      res.status(400).json({ message: error.message || "Failed to create credential" });
    }
  });

  app.patch("/api/credentials/:id", authMiddleware, requireRole("admin"), async (req: AuthRequest, res) => {
    try {
      const data = insertCredentialSchema.partial().parse(req.body);
      const credential = await storage.updateCredential(req.params.id, data, req.orgId!);
      if (!credential) {
        return res.status(404).json({ message: "Credential not found" });
      }
      res.json(credential);
    } catch (error: any) {
      res.status(400).json({ message: error.message || "Failed to update credential" });
    }
  });

  app.delete("/api/credentials/:id", authMiddleware, requireRole("admin"), async (req: AuthRequest, res) => {
    try {
      await storage.deleteCredential(req.params.id, req.orgId!);
      res.json({ message: "Credential deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to delete credential" });
    }
  });

  // Reports routes
  // Org-scoped inventory health — computed from real NetBox VMs imported for this org.
  app.get("/api/reports/inventory-health", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const vms = await storage.getNetboxVms(req.orgId!);
      const total = vms.length;
      const withIP = vms.filter(v => !!v.ip).length;
      const withUser = vms.filter(v => !!(v.customFields as Record<string, any>)?.ansible_user).length;
      const coverage = total > 0 ? Math.round((Math.min(withIP, withUser) / total) * 100) : 0;

      res.json({ total, withIP, withUser, coverage });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to fetch inventory health" });
    }
  });

  app.get("/api/providers", authMiddleware, async (req, res) => {
    try {
      const providers = await storage.getProviders((req as AuthRequest).orgId!);
      res.json(providers.map(sanitizeProviderForResponse));
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get providers" });
    }
  });

  app.get("/api/providers/:id", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const provider = await storage.getProvider(req.params.id, req.orgId!);
      if (!provider) {
        return res.status(404).json({ message: "Provider not found" });
      }
      res.json(sanitizeProviderForResponse(provider));
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get provider" });
    }
  });

  // Get VMs discovered by a provider
  app.get("/api/providers/:id/vms", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const provider = await storage.getProvider(req.params.id, req.orgId!);
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

  app.post("/api/providers", authMiddleware, requireRole("admin"), async (req: AuthRequest, res) => {
    try {
      const { orgId: _o, id: _i, ...safeBody } = req.body;
      const body = { ...safeBody, orgId: req.orgId! };
      if (body.config && typeof body.config === "object") {
        body.config = encryptProviderConfig(body.config);
      }
      const provider = await storage.createProvider(body);
      res.json(sanitizeProviderForResponse(provider));
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to create provider" });
    }
  });

  app.patch("/api/providers/:id", authMiddleware, requireRole("admin"), async (req: AuthRequest, res) => {
    try {
      const body = { ...req.body };
      if (body.config && typeof body.config === "object") {
        // Merge with existing encrypted config so blank secret fields don't wipe stored secrets
        const existing = await storage.getProvider(req.params.id, req.orgId!);
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
      const provider = await storage.updateProvider(req.params.id, body, req.orgId!);
      if (!provider) {
        return res.status(404).json({ message: "Provider not found" });
      }
      res.json(sanitizeProviderForResponse(provider));
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to update provider" });
    }
  });

  app.post("/api/providers/:id/test", authMiddleware, requireRole("admin", "operator"), async (req: AuthRequest, res) => {
    try {
      const provider = await storage.getProvider(req.params.id, req.orgId!);
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

  app.post("/api/providers/:id/sync", authMiddleware, requireRole("admin", "operator"), async (req: AuthRequest, res) => {
    try {
      const provider = await storage.getProvider(req.params.id, req.orgId!);
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

  app.delete("/api/providers/:id", authMiddleware, requireRole("admin"), async (req: AuthRequest, res) => {
    try {
      const existing = await storage.getProvider(req.params.id, req.orgId!);
      if (!existing) {
        return res.status(404).json({ message: "Provider not found" });
      }
      await storage.deleteProvider(req.params.id, req.orgId!);
      res.json({ message: "Provider deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to delete provider" });
    }
  });

  app.get("/api/providers/:id/runs", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      // Verify the provider belongs to the requesting org before returning runs
      const provider = await storage.getProvider(req.params.id, req.orgId!);
      if (!provider) {
        return res.status(404).json({ message: "Provider not found" });
      }
      const runs = await storage.getProviderRuns(req.params.id, limit, req.orgId!);
      res.json(runs);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get provider runs" });
    }
  });

  // ─── CMDB routes ─────────────────────────────────────────────────────────────
  app.get("/api/cmdbs", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const cmdbs = await storage.getCmdbAccounts(req.orgId!);
      res.json(cmdbs.map(sanitizeCmdbForResponse));
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get CMDBs" });
    }
  });

  app.post("/api/cmdbs", authMiddleware, requireRole("admin"), async (req: AuthRequest, res) => {
    try {
      const { orgId: _o, id: _i, ...safeReqBody } = req.body;
      const data = insertCmdbAccountSchema.parse({ ...safeReqBody, orgId: req.orgId! });
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

  app.get("/api/cmdbs/:id", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const cmdb = await storage.getCmdbAccount(req.params.id, req.orgId!);
      if (!cmdb) {
        return res.status(404).json({ message: "CMDB account not found" });
      }
      res.json(sanitizeCmdbForResponse(cmdb));
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to fetch CMDB account" });
    }
  });

  app.patch("/api/cmdbs/:id", authMiddleware, requireRole("admin"), async (req: AuthRequest, res) => {
    try {
      const body = { ...req.body };
      if (body.config && typeof body.config === "object") {
        // Preserve existing encrypted secrets when blank fields submitted
        const existing = await storage.getCmdbAccount(req.params.id, req.orgId!);
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
      const cmdb = await storage.updateCmdbAccount(req.params.id, body, req.orgId!);
      if (!cmdb) {
        return res.status(404).json({ message: "CMDB account not found" });
      }
      res.json(sanitizeCmdbForResponse(cmdb));
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to update CMDB account" });
    }
  });

  app.delete("/api/cmdbs/:id", authMiddleware, requireRole("admin"), async (req: AuthRequest, res) => {
    try {
      const existing = await storage.getCmdbAccount(req.params.id, req.orgId!);
      if (!existing) {
        return res.status(404).json({ message: "CMDB account not found" });
      }
      await storage.deleteCmdbAccount(req.params.id, req.orgId!);
      res.json({ message: "CMDB account deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to delete CMDB account" });
    }
  });

  app.post("/api/cmdbs/:id/test", authMiddleware, requireRole("admin", "operator"), async (req: AuthRequest, res) => {
    try {
      const cmdb = await storage.getCmdbAccount(req.params.id, req.orgId!);
      if (!cmdb) {
        return res.status(404).json({ message: "CMDB account not found" });
      }

      if (cmdb.kind === "netbox") {
        const decryptedConfig = decryptCmdbConfig(cmdb.config as Record<string, any>);
        const adapter = new NetBoxAdapter(decryptedConfig as any);
        const result = await adapter.test();
        
        if (result.ok) {
          await storage.updateCmdbAccount(req.params.id, { lastValidatedAt: new Date() }, req.orgId!);
        }
        
        res.json(result);
      } else {
        res.status(400).json({ error: "Unsupported CMDB kind" });
      }
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to test connection" });
    }
  });

  app.get("/api/cmdbs/:id/vms", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const cmdb = await storage.getCmdbAccount(req.params.id, req.orgId!);
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
  // platform_admin only — this rebuilds the GLOBAL group cache from ALL orgs' VMs.
  // A normal org admin must not trigger a global cache rebuild that affects other tenants.
  app.post("/api/housekeeping/rebuild-groups-cache", authMiddleware, requireRole("platform_admin"), async (req, res) => {
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

  // platform_admin only — writes custom fields to the shared NetBox instance
  // configured via the global NETBOX_URL / NETBOX_TOKEN env vars. This is a
  // platform-wide schema change that affects all tenants sharing the NetBox.
  app.post("/api/housekeeping/ensure-netbox-schema", authMiddleware, requireRole("platform_admin"), async (req, res) => {
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

  // platform_admin only — deletes externalObjects rows globally across all orgs.
  app.post("/api/housekeeping/prune-stale", authMiddleware, requireRole("platform_admin"), async (req, res) => {
    try {
      const days = parseInt(req.body.days as string) || 30;
      const count = await storage.pruneStaleObjects(days);
      
      res.json({ message: `Pruned ${count} stale objects (not seen in ${days} days)` });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to prune stale objects" });
    }
  });

  // admin — org-scoped: only retries failed syncs for providers belonging to req.orgId.
  app.post("/api/housekeeping/retry-last-failed", authMiddleware, requireRole("admin"), async (req: AuthRequest, res) => {
    try {
      const failedRuns = await storage.getLastFailedSyncRuns(req.orgId!);
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

  // Token rotation — not yet implemented.
  app.post("/api/housekeeping/rotate-tokens", authMiddleware, requireRole("admin"), async (req, res) => {
    res.status(501).json({
      message: "Token rotation is not yet implemented.",
      planned: "Per-org credential rotation for admin; platform-token rotation for platform_admin.",
    });
  });

  // Stats routes
  app.get("/api/stats/providers", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const stats = await storage.getProviderStats(req.orgId!);
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

import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import {
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

// ─── NetBox settings ──────────────────────────────────────────────────────────

router.get("/", async (_req, res) => {
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

router.post("/", requireRole("platform_admin"), async (req, res) => {
  try {
    const { netboxUrl, netboxToken } = req.body;
    if (netboxUrl) await storage.setSetting("netbox_url", netboxUrl);
    if (netboxToken && netboxToken !== "********") {
      await storage.setSetting("netbox_token", encryptNetboxToken(netboxToken));
    }
    res.json({ message: "Settings saved" });
  } catch (error: any) {
    res.status(500).json({ message: error.message || "Failed to save settings" });
  }
});

router.post("/test-connection", async (_req, res) => {
  try {
    const netboxUrl = await storage.getSetting("netbox_url");
    const netboxTokenSetting = await storage.getSetting("netbox_token");
    const url = netboxUrl?.value || process.env.NETBOX_URL || "";
    const rawStoredToken = netboxTokenSetting?.value || "";
    const token = rawStoredToken
      ? decryptNetboxToken(rawStoredToken)
      : (process.env.NETBOX_TOKEN || "");
    if (!url) return res.status(400).json({ message: "NetBox URL is not configured" });
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

// ─── AWX settings ─────────────────────────────────────────────────────────────

router.get("/awx", async (_req, res) => {
  try {
    const url = await storage.getSetting("awx_url");
    const verifySsl = await storage.getSetting("awx_verify_ssl");
    res.json({
      url: url?.value ?? "",
      verify_ssl: verifySsl?.value !== "false",
      token_set: !!(await storage.getSetting("awx_token")),
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post("/awx/test", requireRole("platform_admin"), async (req, res) => {
  try {
    const { encryptSecret: enc } = await import("../services/secrets");
    const { AwxRunner } = await import("../services/awx-runner");
    const { url, token, verify_ssl } = req.body as {
      url: string;
      token: string;
      verify_ssl?: boolean;
    };
    if (!url || !token) {
      return res.status(400).json({ message: "url and token are required" });
    }
    const runner = new AwxRunner({ url, token, verifySsl: verify_ssl !== false });
    const result = await runner.testConnection();
    if (result.ok) {
      await storage.setSetting("awx_url", url);
      await storage.setSetting("awx_token", enc(token));
      await storage.setSetting("awx_verify_ssl", String(verify_ssl !== false));
    }
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

export default router;

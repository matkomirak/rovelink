import { Router } from "express";
import type { Request } from "express";
import { storage } from "../storage";
import {
  encryptNetboxToken,
  decryptNetboxToken,
} from "../services/secrets";
import { netboxService } from "../services/netbox";
import { requireRole } from "../auth/roles";

interface AuthRequest extends Request {
  userId?: string;
  orgId?: string;
  user?: any;
}

const router = Router();

router.get("/", async (_req, res) => {
  try {
    const [netboxUrlSetting, netboxTokenSetting] = await Promise.all([
      storage.getSetting("netbox_url"),
      storage.getSetting("netbox_token"),
    ]);

    res.json({
      netboxUrl: netboxUrlSetting?.value || "",
      netboxToken: netboxTokenSetting?.value ? "********" : "",
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message || "Failed to fetch settings" });
  }
});

// Writing platform settings requires platform_admin — admins manage their own org,
// not the global platform configuration (NetBox URL/token, AWX URL/token).
router.post("/", requireRole("platform_admin"), async (req, res) => {
  try {
    const { netboxUrl, netboxToken } = req.body;
    if (netboxUrl) await storage.setSetting("netbox_url", netboxUrl);
    if (netboxToken && netboxToken !== "********") {
      const encrypted = await encryptNetboxToken(netboxToken);
      await storage.setSetting("netbox_token", encrypted);
    }
    res.json({ message: "Settings updated" });
  } catch (error: any) {
    res.status(500).json({ message: error.message || "Failed to update settings" });
  }
});

router.get("/awx", async (_req, res) => {
  try {
    const [urlSetting, tokenSetting, verifySslSetting] = await Promise.all([
      storage.getSetting("awx_url"),
      storage.getSetting("awx_token"),
      storage.getSetting("awx_verify_ssl"),
    ]);

    res.json({
      url: urlSetting?.value || "",
      token: tokenSetting?.value ? "********" : "",
      verify_ssl: verifySslSetting?.value === "false" ? false : true,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post("/awx", requireRole("platform_admin"), async (req, res) => {
  try {
    const { encryptSecret } = await import("../services/secrets");
    const { url, token, verify_ssl } = req.body as {
      url?: string; token?: string; verify_ssl?: boolean;
    };
    if (url) await storage.setSetting("awx_url", url);
    if (token && token !== "********") {
      const encrypted = await encryptSecret(token);
      await storage.setSetting("awx_token", encrypted);
    }
    if (verify_ssl !== undefined) {
      await storage.setSetting("awx_verify_ssl", String(verify_ssl));
    }
    res.json({ message: "AWX settings updated" });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post("/awx/test", requireRole("platform_admin"), async (req, res) => {
  try {
    const { AwxRunner } = await import("../services/awx-runner");
    const { url, token, verify_ssl } = req.body as {
      url: string; token: string; verify_ssl?: boolean;
    };
    if (!url || !token) {
      return res.status(400).json({ message: "url and token are required" });
    }
    const runner = new AwxRunner({ url, token, verifySsl: verify_ssl ?? true });
    const result = await runner.testConnection();
    res.json({ ok: result.ok, message: result.ok ? "Connection successful" : result.error });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post("/netbox/test", async (req, res) => {
  try {
    const { url, token } = req.body;
    if (!url || !token) {
      return res.status(400).json({ ok: false, message: "url and token are required" });
    }
    const result = await netboxService.testConnection(url, token);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

export default router;

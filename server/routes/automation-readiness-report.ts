import { Router } from "express";
import { summarizeAutomationReadiness, type ReadinessInventoryInput } from "../services/automation-readiness-report";
import { sendInternalError } from "../services/api-errors";

interface ReportDependencies {
  listInventories(orgId: string): Promise<Array<Omit<ReadinessInventoryInput, "hosts"> & { cachedData: unknown }>>;
  getGovernanceReady(orgId: string, objectId: string): Promise<boolean | null>;
}

export function createAutomationReadinessRouter(deps: ReportDependencies) {
  const router = Router();
  router.get("/readiness-report", async (req, res) => {
    try {
      const authenticated = req as typeof req & { orgId?: string; user?: { orgId?: string } };
      const orgId = authenticated.user?.orgId || authenticated.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });
      const inventories = await deps.listInventories(orgId);
      const governance = new Map<string, boolean | null>();
      const inputs: ReadinessInventoryInput[] = [];
      for (const inventory of inventories.filter(row => row.orgId === orgId)) {
        const cached = inventory.cachedData as { hosts?: unknown } | null;
        const hosts: ReadinessInventoryInput["hosts"] = [];
        if (inventory.type === "linked" && Array.isArray(cached?.hosts)) {
          for (const host of cached.hosts) {
            if (!host || typeof host !== "object") continue;
            let governanceReady: boolean | null = null;
            // Explicit local identity only; no names or cached provider hints.
            if (host.governanceObjectType === "netbox_vm" && typeof host.governanceObjectId === "string" && host.governanceObjectId.trim()) {
              const id = host.governanceObjectId;
              if (!governance.has(id)) governance.set(id, await deps.getGovernanceReady(orgId, id));
              governanceReady = governance.get(id) ?? null;
            }
            hosts.push({ address: host.ansible_host, governanceReady });
          }
        }
        inputs.push({ ...inventory, hosts });
      }
      res.json(summarizeAutomationReadiness(orgId, inputs));
    } catch (error) {
      sendInternalError(res, error, "automation-readiness-report", "Failed to load automation readiness report");
    }
  });
  return router;
}

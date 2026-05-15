import express, { Request, Response } from "express";
import { db } from "../db";
import { automationInventories, cmdbAccounts, type AutomationInventory, type InsertAutomationInventory, type EligibilityPolicy } from "../../shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { insertAutomationInventorySchema } from "../../shared/schema";
import { NetBoxAdapter } from "../services/netbox-adapter";
import { decryptCmdbConfig } from "../services/secrets";
import { runGatePhase, readAllowedAssets, readBlockedAssets, getGateSummary } from "../services/gate-phase";
import { deriveAssetId } from "../services/asset-identity";
import { gateStore } from "../services/gate-store";
import { hasRoleAtLeast } from "../auth/roles";

// Auth request type — orgId is stamped by auth middleware
interface AuthRequest extends Request {
  user?: any;
  orgId?: string;
}

// Helper: resolve orgId from request (supports both middleware patterns)
function resolveOrgId(req: AuthRequest): string {
  return req.user?.orgId || req.orgId || "";
}

// Default policy for gate evaluation - all optional rules disabled
const DEFAULT_POLICY: EligibilityPolicy = {
  requireRole: false,
  requireContacts: false,
};

/**
 * Extract eligibility policy from inventory, with defaults if not set.
 */
function extractPolicy(inventory: any): EligibilityPolicy {
  if (!inventory.eligibilityPolicy) {
    return DEFAULT_POLICY;
  }
  return {
    requireRole: inventory.eligibilityPolicy.requireRole === true,
    requireContacts: inventory.eligibilityPolicy.requireContacts === true,
  };
}

const router = express.Router();

// List all automation inventories — org-scoped
router.get("/", async (req: AuthRequest, res: Response) => {
  try {
    const orgId = resolveOrgId(req);
    const inventories = await db
      .select()
      .from(automationInventories)
      .where(eq(automationInventories.orgId, orgId))
      .orderBy(desc(automationInventories.createdAt));
    res.json(inventories);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// Get single inventory — org-scoped
router.get("/:id", async (req: AuthRequest, res: Response) => {
  try {
    const orgId = resolveOrgId(req);
    const [inventory] = await db
      .select()
      .from(automationInventories)
      .where(
        and(
          eq(automationInventories.id, req.params.id),
          eq(automationInventories.orgId, orgId)
        )
      );

    if (!inventory) {
      return res.status(404).json({ message: "Inventory not found" });
    }

    res.json(inventory);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// Create new automation inventory
router.post("/", async (req: AuthRequest, res: Response) => {
  try {
    if (!hasRoleAtLeast(req.user?.role, "admin")) {
      return res.status(403).json({ message: "Admin role required" });
    }

    const orgId = resolveOrgId(req);
    const validated = insertAutomationInventorySchema.parse(req.body);
    const userId = req.user?.id;

    // Validate type-specific requirements
    if (validated.type === "linked") {
      if (!validated.sourceRef || !validated.sourceType) {
        return res.status(400).json({ 
          message: "Linked inventories require sourceRef and sourceType" 
        });
      }
    } else if (validated.type === "file") {
      if (!validated.fileContent || !validated.fileFormat) {
        return res.status(400).json({ 
          message: "File inventories require fileContent and fileFormat" 
        });
      }
    }

    // For linked type: validate CMDB ownership BEFORE inserting.
    // This prevents dangling inventory rows when the sourceRef belongs to another org
    // or does not exist at all. No INSERT is performed if this check fails.
    let linkedCmdb: any = null;
    if (validated.type === "linked" && validated.sourceRef) {
      const [preCmdb] = await db
        .select()
        .from(cmdbAccounts)
        .where(
          and(
            eq(cmdbAccounts.id, validated.sourceRef),
            eq(cmdbAccounts.orgId, orgId)
          )
        );
      if (!preCmdb) {
        return res.status(404).json({ message: "Linked CMDB not found" });
      }
      linkedCmdb = preCmdb;
    }

    // If this is marked as default, unset other defaults within this org only
    if (validated.isDefault) {
      await db
        .update(automationInventories)
        .set({ isDefault: false })
        .where(
          and(
            eq(automationInventories.isDefault, true),
            eq(automationInventories.orgId, orgId)
          )
        );
    }

    // Strip client-supplied orgId and id — always stamp from authenticated request
    const { orgId: _ignoredOrgId, id: _ignoredId, ...safeBody } = validated as any;

    const [newInventory] = await db
      .insert(automationInventories)
      .values({
        ...safeBody,
        orgId,
        createdBy: userId,
        updatedAt: new Date(),
      })
      .returning();

    // For linked inventories, fetch real data from CMDB
    if (newInventory.type === "linked" && newInventory.sourceRef) {
      try {
        // CMDB was already validated and fetched before insert — use cached reference
        const cmdb = linkedCmdb!;

        // Decrypt secrets before passing to adapter
        const decryptedCmdbCfg = decryptCmdbConfig(cmdb.config as Record<string, any>);
        // Test connection and fetch VMs from NetBox
        const adapter = new NetBoxAdapter(decryptedCmdbCfg as any);
        
        // First test the connection.
        // Throw on failure so the outer catch keeps the inventory row and returns 201 — API
        // response and database state stay consistent regardless of external network outcome.
        const testResult = await adapter.test();
        if (!testResult.ok) {
          throw new Error(`Failed to connect to NetBox: ${testResult.error}`);
        }

        // Fetch VMs from NetBox — throw on failure for the same reason
        let vms;
        try {
          vms = await adapter.listAllVms();
        } catch (error: any) {
          const fetchMsg = error.message.includes("403")
            ? `NetBox API access denied (token needs 'virtualization.view_virtualmachine' permission)`
            : `Failed to fetch VMs from NetBox: ${error.message}`;
          throw new Error(fetchMsg);
        }

        // ================================================================
        // FIRST-CLASS GATE EVALUATION PHASE
        // Gate evaluation runs BEFORE inventory generation.
        // Inventory generation must ONLY read from gate store.
        // ================================================================
        const policy = extractPolicy(newInventory);
        await runGatePhase(cmdb.id, policy, orgId);
        
        // Read gate decisions from store - NEVER trigger evaluation here
        // This is the decoupled read phase
        const allowedDecisions = await readAllowedAssets(orgId);
        const allowedAssetIds = new Set(allowedDecisions.map(d => d.assetId));
        
        // Filter VMs through gate - only include allowed VMs
        const allowedVms = vms.filter((vm: any) => {
          const assetId = deriveAssetId(cmdb.id, vm.name);
          return allowedAssetIds.has(assetId);
        });
        
        const blockedCount = vms.length - allowedVms.length;
        console.log(`Gate filtering: ${allowedVms.length} allowed, ${blockedCount} blocked of ${vms.length} total VMs`);
        
        // INVARIANT CHECK: Verify no blocked VMs made it through
        // This is our tripwire - if this fires, something is seriously wrong
        for (const vm of allowedVms) {
          const assetId = deriveAssetId(cmdb.id, vm.name);
          if (!allowedAssetIds.has(assetId)) {
            const errorMsg = `INVARIANT VIOLATION: Blocked VM "${vm.name}" (asset_id: ${assetId}) in automation inventory`;
            console.error(errorMsg);
            throw new Error(errorMsg);
          }
        }

        // Build full groups and hosts structure for caching
        const groupsMap = new Map<string, Set<string>>();
        const hostsMap = new Map<string, any>();
        
        for (const vm of allowedVms) {
          const hostName = vm.name;
          const ip = vm.primary_ip4?.address?.split('/')[0] || '';
          const hostGroups: string[] = [];
          
          // Create groups from tags
          if (vm.tags && Array.isArray(vm.tags)) {
            for (const tag of vm.tags) {
              const tagName = typeof tag === 'string' ? tag : tag.name;
              if (tagName) {
                hostGroups.push(tagName);
                if (!groupsMap.has(tagName)) {
                  groupsMap.set(tagName, new Set());
                }
                groupsMap.get(tagName)!.add(hostName);
              }
            }
          }

          // Create groups from metadata
          if (vm.tenant?.name) {
            const groupName = `tenant_${vm.tenant.name}`;
            hostGroups.push(groupName);
            if (!groupsMap.has(groupName)) {
              groupsMap.set(groupName, new Set());
            }
            groupsMap.get(groupName)!.add(hostName);
          }

          if (vm.site?.name) {
            const groupName = `site_${vm.site.name}`;
            hostGroups.push(groupName);
            if (!groupsMap.has(groupName)) {
              groupsMap.set(groupName, new Set());
            }
            groupsMap.get(groupName)!.add(hostName);
          }

          if (vm.cluster?.name) {
            const groupName = `cluster_${vm.cluster.name}`;
            hostGroups.push(groupName);
            if (!groupsMap.has(groupName)) {
              groupsMap.set(groupName, new Set());
            }
            groupsMap.get(groupName)!.add(hostName);
          }

          if (vm.platform?.name) {
            const groupName = `platform_${vm.platform.name}`;
            hostGroups.push(groupName);
            if (!groupsMap.has(groupName)) {
              groupsMap.set(groupName, new Set());
            }
            groupsMap.get(groupName)!.add(hostName);
          }

          // Store full host data
          hostsMap.set(hostName, {
            name: hostName,
            ansible_host: ip,
            groups: hostGroups,
            vars: {
              status: vm.status?.value || vm.status || '',
              vcpus: vm.vcpus || 0,
              memory: vm.memory || 0,
              tenant: vm.tenant?.name || '',
              site: vm.site?.name || '',
              cluster: vm.cluster?.name || '',
            }
          });
        }

        // Convert maps to arrays for storage
        const fullGroups = Array.from(groupsMap.entries()).map(([name, hosts]) => ({
          name,
          hostsCount: hosts.size,
          hosts: Array.from(hosts),
        }));
        const fullHosts = Array.from(hostsMap.values());

        // Update inventory with both preview and full cached data
        await db
          .update(automationInventories)
          .set({
            groupsCount: groupsMap.size,
            hostsCount: allowedVms.length,
            lastRefreshedAt: new Date(),
            previewData: {
              groups: Array.from(groupsMap.keys()).slice(0, 10),
              sampleHosts: allowedVms.slice(0, 5).map((vm: any) => ({
                name: vm.name,
                ip: vm.primary_ip4?.address?.split('/')[0] || '',
                status: vm.status?.value || vm.status || '',
              })),
              // Minimal gate stats - no preview optimization bias
              gateStats: {
                allowed: allowedVms.length,
                blocked: blockedCount,
              },
            },
            cachedData: {
              groups: fullGroups,
              hosts: fullHosts,
            },
          })
          .where(
            and(
              eq(automationInventories.id, newInventory.id),
              eq(automationInventories.orgId, orgId)
            )
          );

        // Re-fetch to get updated data
        const [updated] = await db
          .select()
          .from(automationInventories)
          .where(
            and(
              eq(automationInventories.id, newInventory.id),
              eq(automationInventories.orgId, orgId)
            )
          );
        return res.status(201).json({
          inventory: updated,
          sync: { status: "ok" },
        });
      } catch (error: any) {
        console.error("Error during initial NetBox sync for linked inventory:", error.message);
        
        // Still create the inventory but with error state
        await db
          .update(automationInventories)
          .set({
            groupsCount: 0,
            hostsCount: 0,
            previewData: {
              groups: [],
              sampleHosts: [],
              error: error.message
            },
          })
          .where(
            and(
              eq(automationInventories.id, newInventory.id),
              eq(automationInventories.orgId, orgId)
            )
          );

        const [updated] = await db
          .select()
          .from(automationInventories)
          .where(
            and(
              eq(automationInventories.id, newInventory.id),
              eq(automationInventories.orgId, orgId)
            )
          );
        
        return res.status(201).json({
          inventory: updated,
          sync: {
            status: "failed",
            message: error.message,
            retryable: true,
          },
        });
      }
    }

    // For file inventories, parse and count groups/hosts
    if (newInventory.type === "file" && newInventory.fileContent) {
      try {
        const parsed = parseInventoryFile(newInventory.fileContent, newInventory.fileFormat || "yaml");
        await db
          .update(automationInventories)
          .set({
            groupsCount: parsed.groupsCount,
            hostsCount: parsed.hostsCount,
            previewData: parsed.preview,
          })
          .where(
            and(
              eq(automationInventories.id, newInventory.id),
              eq(automationInventories.orgId, orgId)
            )
          );

        const [updated] = await db
          .select()
          .from(automationInventories)
          .where(
            and(
              eq(automationInventories.id, newInventory.id),
              eq(automationInventories.orgId, orgId)
            )
          );
        return res.status(201).json(updated);
      } catch (parseError: any) {
        console.error("File parse error:", parseError);
      }
    }

    res.status(201).json(newInventory);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// Get inventory preview — org-scoped
router.get("/:id/preview", async (req: AuthRequest, res: Response) => {
  try {
    const orgId = resolveOrgId(req);
    const [inventory] = await db
      .select()
      .from(automationInventories)
      .where(
        and(
          eq(automationInventories.id, req.params.id),
          eq(automationInventories.orgId, orgId)
        )
      );

    if (!inventory) {
      return res.status(404).json({ message: "Inventory not found" });
    }

    res.json({
      id: inventory.id,
      name: inventory.name,
      type: inventory.type,
      groupsCount: inventory.groupsCount,
      hostsCount: inventory.hostsCount,
      lastRefreshedAt: inventory.lastRefreshedAt,
      preview: inventory.previewData,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// Get full inventory structure - uses cached data, not live fetch — org-scoped
router.get("/:id/structure", async (req: AuthRequest, res: Response) => {
  try {
    const orgId = resolveOrgId(req);
    const [inventory] = await db
      .select()
      .from(automationInventories)
      .where(
        and(
          eq(automationInventories.id, req.params.id),
          eq(automationInventories.orgId, orgId)
        )
      );

    if (!inventory) {
      return res.status(404).json({ message: "Inventory not found" });
    }

    // For file-based inventories, re-parse to get full structure
    if (inventory.type === "file" && inventory.fileContent) {
      const parsed = parseInventoryFile(inventory.fileContent, inventory.fileFormat || "yaml");
      return res.json({
        groups: parsed.fullData.groups,
        hosts: parsed.fullData.hosts,
      });
    }

    // For linked inventories, use cached data from last successful refresh
    if (inventory.type === "linked") {
      const cachedData = inventory.cachedData as { groups?: any[]; hosts?: any[] } | null;
      
      if (cachedData && cachedData.groups && cachedData.hosts) {
        // Return cached data
        return res.json({
          groups: cachedData.groups,
          hosts: cachedData.hosts,
          cachedAt: inventory.lastRefreshedAt,
        });
      }
      
      // No cached data available - return empty with message
      return res.json({
        groups: [],
        hosts: [],
        message: "No cached data available. Please refresh the inventory to fetch data from the CMDB.",
        lastRefreshedAt: inventory.lastRefreshedAt,
      });
    }

    res.json({ groups: [], hosts: [] });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// Refresh linked inventory — org-scoped
router.post("/:id/refresh", async (req: AuthRequest, res: Response) => {
  try {
    if (!hasRoleAtLeast(req.user?.role, "operator")) {
      return res.status(403).json({ message: "Viewers cannot refresh inventories" });
    }

    const orgId = resolveOrgId(req);
    const [inventory] = await db
      .select()
      .from(automationInventories)
      .where(
        and(
          eq(automationInventories.id, req.params.id),
          eq(automationInventories.orgId, orgId)
        )
      );

    if (!inventory) {
      return res.status(404).json({ message: "Inventory not found" });
    }

    if (inventory.type !== "linked") {
      return res.status(400).json({ message: "Only linked inventories can be refreshed" });
    }

    if (!inventory.sourceRef) {
      return res.status(400).json({ message: "Inventory has no linked CMDB source" });
    }

    // Fetch real data from CMDB — org-scoped to prevent cross-tenant CMDB access
    const [cmdb] = await db
      .select()
      .from(cmdbAccounts)
      .where(
        and(
          eq(cmdbAccounts.id, inventory.sourceRef),
          eq(cmdbAccounts.orgId, orgId)
        )
      );

    if (!cmdb) {
      return res.status(404).json({ message: "Linked CMDB not found" });
    }

    // Decrypt secrets before passing to adapter
    const decryptedRefreshCfg = decryptCmdbConfig(cmdb.config as Record<string, any>);
    // Fetch VMs from NetBox (ensure automatable custom field exists — idempotent)
    const adapter = new NetBoxAdapter(decryptedRefreshCfg as any);
    await adapter.ensureAutomatableCustomField().catch(() => {}); // non-fatal
    const vms = await adapter.listAllVms();

    // ================================================================
    // FIRST-CLASS GATE EVALUATION PHASE (REFRESH)
    // Gate evaluation runs BEFORE inventory generation.
    // Inventory generation must ONLY read from gate store.
    // ================================================================
    const policy = extractPolicy(inventory);
    await runGatePhase(cmdb.id, policy, orgId);
    
    // Read gate decisions from store - NEVER trigger evaluation here
    const allowedDecisions = await readAllowedAssets(orgId);
    const allowedAssetIds = new Set(allowedDecisions.map(d => d.assetId));
    
    // Filter VMs through gate - only include allowed VMs
    const allowedVms = vms.filter((vm: any) => {
      const assetId = deriveAssetId(cmdb.id, vm.name);
      return allowedAssetIds.has(assetId);
    });
    
    const blockedCount = vms.length - allowedVms.length;
    console.log(`Gate filtering (refresh): ${allowedVms.length} allowed, ${blockedCount} blocked of ${vms.length} total VMs`);
    
    // INVARIANT CHECK: Verify no blocked VMs made it through
    // This is our tripwire - if this fires, something is seriously wrong
    for (const vm of allowedVms) {
      const assetId = deriveAssetId(cmdb.id, vm.name);
      if (!allowedAssetIds.has(assetId)) {
        const errorMsg = `INVARIANT VIOLATION: Blocked VM "${vm.name}" (asset_id: ${assetId}) in automation inventory`;
        console.error(errorMsg);
        throw new Error(errorMsg);
      }
    }

    // Build full groups and hosts structure for caching
    const groupsMap = new Map<string, Set<string>>();
    const hostsMap = new Map<string, any>();
    
    for (const vm of allowedVms) {
      const hostName = vm.name;
      const ip = vm.primary_ip4?.address?.split('/')[0] || '';
      const hostGroups: string[] = [];
      
      // Create groups from tags
      if (vm.tags && Array.isArray(vm.tags)) {
        for (const tag of vm.tags) {
          const tagName = typeof tag === 'string' ? tag : tag.name;
          if (tagName) {
            hostGroups.push(tagName);
            if (!groupsMap.has(tagName)) {
              groupsMap.set(tagName, new Set());
            }
            groupsMap.get(tagName)!.add(hostName);
          }
        }
      }

      // Create groups from metadata
      if (vm.tenant?.name) {
        const groupName = `tenant_${vm.tenant.name}`;
        hostGroups.push(groupName);
        if (!groupsMap.has(groupName)) {
          groupsMap.set(groupName, new Set());
        }
        groupsMap.get(groupName)!.add(hostName);
      }

      if (vm.site?.name) {
        const groupName = `site_${vm.site.name}`;
        hostGroups.push(groupName);
        if (!groupsMap.has(groupName)) {
          groupsMap.set(groupName, new Set());
        }
        groupsMap.get(groupName)!.add(hostName);
      }

      if (vm.cluster?.name) {
        const groupName = `cluster_${vm.cluster.name}`;
        hostGroups.push(groupName);
        if (!groupsMap.has(groupName)) {
          groupsMap.set(groupName, new Set());
        }
        groupsMap.get(groupName)!.add(hostName);
      }

      if (vm.platform?.name) {
        const groupName = `platform_${vm.platform.name}`;
        hostGroups.push(groupName);
        if (!groupsMap.has(groupName)) {
          groupsMap.set(groupName, new Set());
        }
        groupsMap.get(groupName)!.add(hostName);
      }

      // Store full host data
      hostsMap.set(hostName, {
        name: hostName,
        ansible_host: ip,
        groups: hostGroups,
        vars: {
          status: vm.status?.value || vm.status || '',
          vcpus: vm.vcpus || 0,
          memory: vm.memory || 0,
          tenant: vm.tenant?.name || '',
          site: vm.site?.name || '',
          cluster: vm.cluster?.name || '',
        }
      });
    }

    // Convert maps to arrays for storage
    const fullGroups = Array.from(groupsMap.entries()).map(([name, hosts]) => ({
      name,
      hostsCount: hosts.size,
      hosts: Array.from(hosts),
    }));
    const fullHosts = Array.from(hostsMap.values());

    // Update inventory with both preview and full cached data
    await db
      .update(automationInventories)
      .set({
        groupsCount: groupsMap.size,
        hostsCount: allowedVms.length,
        lastRefreshedAt: new Date(),
        previewData: {
          groups: Array.from(groupsMap.keys()).slice(0, 10),
          sampleHosts: allowedVms.slice(0, 5).map((vm: any) => ({
            name: vm.name,
            ip: vm.primary_ip4?.address?.split('/')[0] || '',
            status: vm.status?.value || vm.status || '',
          })),
          // Minimal gate stats - no preview optimization bias
          gateStats: {
            allowed: allowedVms.length,
            blocked: blockedCount,
          },
        },
        cachedData: {
          groups: fullGroups,
          hosts: fullHosts,
        },
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(automationInventories.id, req.params.id),
          eq(automationInventories.orgId, orgId)
        )
      );

    const [updated] = await db
      .select()
      .from(automationInventories)
      .where(
        and(
          eq(automationInventories.id, req.params.id),
          eq(automationInventories.orgId, orgId)
        )
      );

    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// Update inventory — org-scoped
router.patch("/:id", async (req: AuthRequest, res: Response) => {
  try {
    if (!hasRoleAtLeast(req.user?.role, "admin")) {
      return res.status(403).json({ message: "Admin role required" });
    }

    const orgId = resolveOrgId(req);
    const [existing] = await db
      .select()
      .from(automationInventories)
      .where(
        and(
          eq(automationInventories.id, req.params.id),
          eq(automationInventories.orgId, orgId)
        )
      );

    if (!existing) {
      return res.status(404).json({ message: "Inventory not found" });
    }

    // Validate linked source fields — prevent cross-org CMDB references via PATCH.
    // Calculate the effective post-update values so a partial PATCH is handled correctly.
    const effectiveType = (req.body.type ?? existing.type) as string;
    const effectiveSourceRef = req.body.sourceRef ?? existing.sourceRef;
    const effectiveSourceType = req.body.sourceType ?? existing.sourceType;

    if (effectiveType === "linked") {
      if (!effectiveSourceRef || !effectiveSourceType) {
        return res.status(400).json({
          message: "Linked inventories require sourceRef and sourceType",
        });
      }
      const [patchCmdb] = await db
        .select()
        .from(cmdbAccounts)
        .where(
          and(
            eq(cmdbAccounts.id, effectiveSourceRef),
            eq(cmdbAccounts.orgId, orgId)
          )
        );
      if (!patchCmdb) {
        return res.status(404).json({ message: "Linked CMDB not found" });
      }
    }

    // Handle default flag toggle — only within this org
    if (req.body.isDefault === true) {
      await db
        .update(automationInventories)
        .set({ isDefault: false })
        .where(
          and(
            eq(automationInventories.isDefault, true),
            eq(automationInventories.orgId, orgId)
          )
        );
    }

    // Strip orgId and id from update payload — neither can be changed via PATCH
    const { orgId: _ignoredOrgId, id: _ignoredId, ...bodyWithoutOrgId } = req.body;
    const updateData: any = {
      ...bodyWithoutOrgId,
      updatedAt: new Date(),
    };

    // Re-parse file if content changed
    if (existing.type === "file" && req.body.fileContent && req.body.fileContent !== existing.fileContent) {
      try {
        const parsed = parseInventoryFile(req.body.fileContent, req.body.fileFormat || existing.fileFormat || "yaml");
        updateData.groupsCount = parsed.groupsCount;
        updateData.hostsCount = parsed.hostsCount;
        updateData.previewData = parsed.preview;
      } catch (parseError: any) {
        return res.status(400).json({ message: `Invalid inventory file: ${parseError.message}` });
      }
    }

    await db
      .update(automationInventories)
      .set(updateData)
      .where(
        and(
          eq(automationInventories.id, req.params.id),
          eq(automationInventories.orgId, orgId)
        )
      );

    const [updated] = await db
      .select()
      .from(automationInventories)
      .where(
        and(
          eq(automationInventories.id, req.params.id),
          eq(automationInventories.orgId, orgId)
        )
      );

    res.json(updated);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// Update eligibility policy — org-scoped
router.patch("/:id/policy", async (req: AuthRequest, res: Response) => {
  try {
    if (!hasRoleAtLeast(req.user?.role, "admin")) {
      return res.status(403).json({ message: "Admin role required" });
    }

    const orgId = resolveOrgId(req);
    const [existing] = await db
      .select()
      .from(automationInventories)
      .where(
        and(
          eq(automationInventories.id, req.params.id),
          eq(automationInventories.orgId, orgId)
        )
      );

    if (!existing) {
      return res.status(404).json({ message: "Inventory not found" });
    }

    // Validate policy structure
    const { requireRole, requireContacts } = req.body;
    const policy = {
      requireRole: requireRole === true,
      requireContacts: requireContacts === true,
    };

    await db
      .update(automationInventories)
      .set({ 
        eligibilityPolicy: policy,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(automationInventories.id, req.params.id),
          eq(automationInventories.orgId, orgId)
        )
      );

    const [updated] = await db
      .select()
      .from(automationInventories)
      .where(
        and(
          eq(automationInventories.id, req.params.id),
          eq(automationInventories.orgId, orgId)
        )
      );

    res.json({ 
      message: "Policy updated",
      policy: updated.eligibilityPolicy,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// Get eligibility policy — org-scoped
router.get("/:id/policy", async (req: AuthRequest, res: Response) => {
  try {
    const orgId = resolveOrgId(req);
    const [inventory] = await db
      .select()
      .from(automationInventories)
      .where(
        and(
          eq(automationInventories.id, req.params.id),
          eq(automationInventories.orgId, orgId)
        )
      );

    if (!inventory) {
      return res.status(404).json({ message: "Inventory not found" });
    }

    // Default policy if not set
    const defaultPolicy = {
      requireRole: false,
      requireContacts: false,
    };

    const policy = inventory.eligibilityPolicy || defaultPolicy;

    res.json({
      inventoryId: inventory.id,
      inventoryName: inventory.name,
      policy,
      // Core rules that are always enforced (for UI display)
      coreRules: [
        { key: "tenant", label: "Tenant assigned", enforced: true },
        { key: "platform", label: "Platform detected (Windows/Linux)", enforced: true },
        { key: "primary_ip", label: "Primary IP present", enforced: true },
        { key: "automatable", label: "Automatable = true", enforced: true },
        { key: "provider_state", label: "Provider State = active", enforced: true },
      ],
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// Delete inventory — org-scoped
router.delete("/:id", async (req: AuthRequest, res: Response) => {
  try {
    if (!hasRoleAtLeast(req.user?.role, "admin")) {
      return res.status(403).json({ message: "Admin role required" });
    }

    const orgId = resolveOrgId(req);
    const [inventory] = await db
      .select()
      .from(automationInventories)
      .where(
        and(
          eq(automationInventories.id, req.params.id),
          eq(automationInventories.orgId, orgId)
        )
      );

    if (!inventory) {
      return res.status(404).json({ message: "Inventory not found" });
    }

    await db
      .delete(automationInventories)
      .where(
        and(
          eq(automationInventories.id, req.params.id),
          eq(automationInventories.orgId, orgId)
        )
      );

    res.json({ message: "Inventory deleted" });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// Helper function to parse inventory files
function parseInventoryFile(content: string, format: string) {
  const lines = content.split("\n").filter(l => l.trim() && !l.trim().startsWith("#"));
  
  const groupsMap = new Map<string, { hosts: string[] }>();
  const hostsMap = new Map<string, { ansible_host?: string; groups: string[]; vars: Record<string, string> }>();

  if (format === "ini") {
    let currentGroup = "";
    for (const line of lines) {
      if (line.startsWith("[") && line.includes("]")) {
        currentGroup = line.replace(/[\[\]]/g, "").trim();
        if (!groupsMap.has(currentGroup)) {
          groupsMap.set(currentGroup, { hosts: [] });
        }
      } else if (line.trim()) {
        const parts = line.split(/\s+/);
        const hostName = parts[0];
        
        if (!hostsMap.has(hostName)) {
          hostsMap.set(hostName, { groups: [], vars: {} });
        }
        
        const hostData = hostsMap.get(hostName)!;
        if (currentGroup && !hostData.groups.includes(currentGroup)) {
          hostData.groups.push(currentGroup);
          groupsMap.get(currentGroup)!.hosts.push(hostName);
        }
        
        // Parse variables
        for (let i = 1; i < parts.length; i++) {
          const [key, value] = parts[i].split("=");
          if (key && value) {
            if (key === "ansible_host") {
              hostData.ansible_host = value;
            } else {
              hostData.vars[key] = value;
            }
          }
        }
      }
    }
  } else if (format === "json") {
    try {
      const parsed = JSON.parse(content);
      Object.keys(parsed).forEach(key => {
        if (key !== "_meta") {
          groupsMap.set(key, { hosts: parsed[key].hosts || [] });
          (parsed[key].hosts || []).forEach((hostName: string) => {
            if (!hostsMap.has(hostName)) {
              hostsMap.set(hostName, { groups: [], vars: {} });
            }
            hostsMap.get(hostName)!.groups.push(key);
          });
        }
      });
      
      // Parse host vars from _meta
      if (parsed._meta?.hostvars) {
        Object.keys(parsed._meta.hostvars).forEach(hostName => {
          if (!hostsMap.has(hostName)) {
            hostsMap.set(hostName, { groups: [], vars: {} });
          }
          const hostVars = parsed._meta.hostvars[hostName];
          if (hostVars.ansible_host) {
            hostsMap.get(hostName)!.ansible_host = hostVars.ansible_host;
          }
          hostsMap.get(hostName)!.vars = { ...hostsMap.get(hostName)!.vars, ...hostVars };
        });
      }
    } catch (e) {
      throw new Error("Invalid JSON format");
    }
  } else if (format === "yaml") {
    // Basic YAML parsing for simple inventories
    const yamlLines = content.split("\n");
    let currentGroup = "";
    let inHosts = false;
    
    for (const line of yamlLines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      
      if (trimmed.endsWith(":") && !line.startsWith(" ")) {
        currentGroup = trimmed.slice(0, -1);
        if (!groupsMap.has(currentGroup)) {
          groupsMap.set(currentGroup, { hosts: [] });
        }
        inHosts = false;
      } else if (trimmed === "hosts:") {
        inHosts = true;
      } else if (inHosts && line.startsWith("    ") && trimmed.includes(":")) {
        const hostName = trimmed.split(":")[0];
        if (!hostsMap.has(hostName)) {
          hostsMap.set(hostName, { groups: [], vars: {} });
        }
        if (currentGroup && !hostsMap.get(hostName)!.groups.includes(currentGroup)) {
          hostsMap.get(hostName)!.groups.push(currentGroup);
          groupsMap.get(currentGroup)!.hosts.push(hostName);
        }
      }
    }
  }

  const groupsList = Array.from(groupsMap.entries()).map(([name, data]) => ({
    name,
    hostsCount: data.hosts.length,
    hosts: data.hosts,
  }));

  const hostsList = Array.from(hostsMap.entries()).map(([name, data]) => ({
    name,
    ansible_host: data.ansible_host,
    groups: data.groups,
    vars: data.vars,
  }));

  return {
    groupsCount: groupsMap.size,
    hostsCount: hostsMap.size,
    preview: {
      groups: groupsList.slice(0, 10).map(g => g.name),
      sampleHosts: hostsList.slice(0, 5).map(h => ({
        name: h.name,
        ip: h.ansible_host || "N/A",
        groups: h.groups,
      })),
    },
    fullData: {
      groups: groupsList,
      hosts: hostsList,
    },
  };
}

// ================================================================
// AUTOMATION.YML - Download allowed assets as Ansible inventory
// ================================================================
router.get("/:id/automation.yml", async (req: AuthRequest, res: Response) => {
  try {
    const orgId = resolveOrgId(req);
    const [inventory] = await db
      .select()
      .from(automationInventories)
      .where(
        and(
          eq(automationInventories.id, req.params.id),
          eq(automationInventories.orgId, orgId)
        )
      );

    if (!inventory) {
      return res.status(404).json({ message: "Inventory not found" });
    }

    if (inventory.type !== "linked" || !inventory.sourceRef) {
      return res.status(400).json({ 
        message: "automation.yml is only available for linked inventories" 
      });
    }

    // Get CMDB account — org-scoped
    const [cmdb] = await db
      .select()
      .from(cmdbAccounts)
      .where(
        and(
          eq(cmdbAccounts.id, inventory.sourceRef),
          eq(cmdbAccounts.orgId, orgId)
        )
      );

    if (!cmdb) {
      return res.status(404).json({ message: "Linked CMDB not found" });
    }

    // Run gate phase (first-class phase)
    const policy = extractPolicy(inventory);
    await runGatePhase(cmdb.id, policy, orgId);

    // Read ONLY allowed assets from gate store
    const allowedDecisions = await readAllowedAssets(orgId);
    const allowedAssetIds = new Set(allowedDecisions.map(d => d.assetId));

    // Fetch VMs from NetBox — always decrypt config before use
    const decryptedAutomationYmlCfg = decryptCmdbConfig(cmdb.config as Record<string, any>);
    const adapter = new NetBoxAdapter(decryptedAutomationYmlCfg as any);
    const vms = await adapter.listAllVms();

    // Filter to allowed VMs only
    const allowedVms = vms.filter((vm: any) => {
      const assetId = deriveAssetId(cmdb.id, vm.name);
      return allowedAssetIds.has(assetId);
    });

    // INVARIANT CHECK: Verify NO blocked assets in output
    for (const vm of allowedVms) {
      const assetId = deriveAssetId(cmdb.id, vm.name);
      if (!allowedAssetIds.has(assetId)) {
        throw new Error(`INVARIANT VIOLATION: Blocked VM "${vm.name}" in automation inventory`);
      }
    }

    // Build Ansible inventory YAML
    const hostsSection: Record<string, any> = {};
    
    for (const vm of allowedVms) {
      const assetId = deriveAssetId(cmdb.id, vm.name);
      const ip = vm.primary_ip4?.address?.split('/')[0] || '';
      
      hostsSection[vm.name] = {
        asset_id: assetId,
        ansible_host: ip || undefined,
        role: vm.role?.name || vm.role || undefined,
        tenant: vm.tenant?.name || vm.tenant || undefined,
        site: vm.site?.name || undefined,
        cluster: vm.cluster?.name || undefined,
        status: vm.status?.value || vm.status || undefined,
      };
      
      // Remove undefined values
      Object.keys(hostsSection[vm.name]).forEach(key => {
        if (hostsSection[vm.name][key] === undefined) {
          delete hostsSection[vm.name][key];
        }
      });
    }

    const inventoryYaml = generateAnsibleInventoryYaml(hostsSection, allowedVms);

    // Set headers for YAML file download
    res.setHeader('Content-Type', 'text/yaml');
    res.setHeader('Content-Disposition', `attachment; filename="${inventory.name}_automation.yml"`);
    res.send(inventoryYaml);
  } catch (error: any) {
    console.error("Error generating automation.yml:", error);
    res.status(500).json({ message: error.message });
  }
});

// ================================================================
// BLOCKED.JSON - Download blocked assets with reasons
// ================================================================
router.get("/:id/blocked.json", async (req: AuthRequest, res: Response) => {
  try {
    const orgId = resolveOrgId(req);
    const [inventory] = await db
      .select()
      .from(automationInventories)
      .where(
        and(
          eq(automationInventories.id, req.params.id),
          eq(automationInventories.orgId, orgId)
        )
      );

    if (!inventory) {
      return res.status(404).json({ message: "Inventory not found" });
    }

    if (inventory.type !== "linked" || !inventory.sourceRef) {
      return res.status(400).json({ 
        message: "blocked.json is only available for linked inventories" 
      });
    }

    // Get CMDB account — org-scoped
    const [cmdb] = await db
      .select()
      .from(cmdbAccounts)
      .where(
        and(
          eq(cmdbAccounts.id, inventory.sourceRef),
          eq(cmdbAccounts.orgId, orgId)
        )
      );

    if (!cmdb) {
      return res.status(404).json({ message: "Linked CMDB not found" });
    }

    // Run gate phase (first-class phase)
    const policy = extractPolicy(inventory);
    await runGatePhase(cmdb.id, policy, orgId);

    // Read ONLY blocked assets from gate store
    const blockedDecisions = await readBlockedAssets(orgId);

    // Format blocked assets according to spec
    const blockedAssets = blockedDecisions.map(decision => ({
      asset_id: decision.assetId,
      name: decision.vmName,
      source: cmdb.name,
      missing: decision.missing,
      blocked_reason: decision.reason || "Missing governance data",
      last_evaluated: decision.evaluatedAt.toISOString(),
    }));

    // Set headers for JSON file download
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${inventory.name}_blocked.json"`);
    res.json(blockedAssets);
  } catch (error: any) {
    console.error("Error generating blocked.json:", error);
    res.status(500).json({ message: error.message });
  }
});

// ================================================================
// BLOCKED - API endpoint for UI to get blocked assets list
// ================================================================
router.get("/:id/blocked", async (req: AuthRequest, res: Response) => {
  try {
    const orgId = resolveOrgId(req);
    const [inventory] = await db
      .select()
      .from(automationInventories)
      .where(
        and(
          eq(automationInventories.id, req.params.id),
          eq(automationInventories.orgId, orgId)
        )
      );

    if (!inventory) {
      return res.status(404).json({ message: "Inventory not found" });
    }

    if (inventory.type !== "linked" || !inventory.sourceRef) {
      return res.json({ 
        blocked: [],
        count: 0,
        message: "Blocked assets only available for linked inventories" 
      });
    }

    // Get CMDB account — org-scoped
    const [cmdb] = await db
      .select()
      .from(cmdbAccounts)
      .where(
        and(
          eq(cmdbAccounts.id, inventory.sourceRef),
          eq(cmdbAccounts.orgId, orgId)
        )
      );

    if (!cmdb) {
      return res.status(404).json({ message: "Linked CMDB not found" });
    }

    // Check if gate evaluation has been completed
    if (!gateStore.isEvaluationComplete(orgId)) {
      // Run gate phase if not yet evaluated
      const policy = extractPolicy(inventory);
      await runGatePhase(cmdb.id, policy, orgId);
    }

    // Read blocked assets from gate store
    const blockedDecisions = await readBlockedAssets(orgId);

    // Format for UI
    const blocked = blockedDecisions.map(decision => ({
      asset_id: decision.assetId,
      name: decision.vmName,
      source: cmdb.name,
      missing: decision.missing,
      blocked_reason: decision.reason || "Missing governance data",
      last_evaluated: decision.evaluatedAt.toISOString(),
    }));

    res.json({
      blocked,
      count: blocked.length,
      source: cmdb.name,
      lastEvaluated: gateStore.getLastEvaluationTime(orgId)?.toISOString() || null,
    });
  } catch (error: any) {
    console.error("Error fetching blocked assets:", error);
    res.status(500).json({ message: error.message });
  }
});

// ================================================================
// GATE STATS - Get allowed/blocked counts for an inventory
// ================================================================
router.get("/:id/gate-stats", async (req: AuthRequest, res: Response) => {
  try {
    const orgId = resolveOrgId(req);
    const [inventory] = await db
      .select()
      .from(automationInventories)
      .where(
        and(
          eq(automationInventories.id, req.params.id),
          eq(automationInventories.orgId, orgId)
        )
      );

    if (!inventory) {
      return res.status(404).json({ message: "Inventory not found" });
    }

    if (inventory.type !== "linked" || !inventory.sourceRef) {
      return res.json({ 
        allowed: inventory.hostsCount || 0,
        blocked: 0,
        message: "Gate stats only available for linked inventories" 
      });
    }

    // Get CMDB account — org-scoped
    const [cmdb] = await db
      .select()
      .from(cmdbAccounts)
      .where(
        and(
          eq(cmdbAccounts.id, inventory.sourceRef),
          eq(cmdbAccounts.orgId, orgId)
        )
      );

    if (!cmdb) {
      return res.status(404).json({ message: "Linked CMDB not found" });
    }

    // Check if gate evaluation has been completed
    if (!gateStore.isEvaluationComplete(orgId)) {
      // Run gate phase if not yet evaluated
      const policy = extractPolicy(inventory);
      await runGatePhase(cmdb.id, policy, orgId);
    }

    const summary = await getGateSummary(orgId);

    res.json({
      allowed: summary.allowed,
      blocked: summary.blocked,
      total: summary.allowed + summary.blocked,
      lastEvaluated: summary.evaluatedAt?.toISOString() || null,
    });
  } catch (error: any) {
    console.error("Error fetching gate stats:", error);
    res.status(500).json({ message: error.message });
  }
});

// Helper: Generate Ansible inventory YAML
function generateAnsibleInventoryYaml(hostsSection: Record<string, any>, vms: any[]): string {
  // Build groups from VM metadata
  const groups: Record<string, string[]> = {};
  
  for (const vm of vms) {
    const hostName = vm.name;
    
    // Group by tenant
    if (vm.tenant?.name) {
      const groupName = `tenant_${vm.tenant.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
      if (!groups[groupName]) groups[groupName] = [];
      groups[groupName].push(hostName);
    }
    
    // Group by role
    if (vm.role?.name || typeof vm.role === 'string') {
      const roleName = vm.role?.name || vm.role;
      const groupName = `role_${roleName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
      if (!groups[groupName]) groups[groupName] = [];
      groups[groupName].push(hostName);
    }
    
    // Group by site
    if (vm.site?.name) {
      const groupName = `site_${vm.site.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
      if (!groups[groupName]) groups[groupName] = [];
      groups[groupName].push(hostName);
    }
    
    // Group by tags
    if (vm.tags && Array.isArray(vm.tags)) {
      for (const tag of vm.tags) {
        const tagName = typeof tag === 'string' ? tag : tag.name;
        if (tagName && tagName.toLowerCase() !== 'automatable') {
          const groupName = `tag_${tagName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
          if (!groups[groupName]) groups[groupName] = [];
          groups[groupName].push(hostName);
        }
      }
    }
  }

  // Build YAML structure
  let yaml = "# Automation Inventory - ALLOWED ASSETS ONLY\n";
  yaml += "# Generated by Bridge Gate System\n";
  yaml += `# Generated at: ${new Date().toISOString()}\n`;
  yaml += "# \n";
  yaml += "# IMPORTANT: This inventory contains ONLY gate-allowed assets.\n";
  yaml += "# Blocked assets are in the separate blocked.json file.\n";
  yaml += "#\n\n";

  yaml += "all:\n";
  yaml += "  hosts:\n";
  
  for (const [hostname, vars] of Object.entries(hostsSection)) {
    yaml += `    ${hostname}:\n`;
    for (const [key, value] of Object.entries(vars)) {
      if (value !== undefined && value !== null && value !== '') {
        yaml += `      ${key}: ${JSON.stringify(value)}\n`;
      }
    }
  }

  yaml += "  children:\n";
  for (const [groupName, hosts] of Object.entries(groups)) {
    yaml += `    ${groupName}:\n`;
    yaml += "      hosts:\n";
    for (const host of hosts) {
      yaml += `        ${host}: {}\n`;
    }
  }

  return yaml;
}

export default router;

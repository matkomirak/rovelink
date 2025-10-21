import express, { Request, Response } from "express";
import { db } from "../db";
import { automationInventories, cmdbAccounts, type AutomationInventory, type InsertAutomationInventory } from "../../shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { insertAutomationInventorySchema } from "../../shared/schema";

// Auth request type
interface AuthRequest extends Request {
  user?: any;
}

const router = express.Router();

// List all automation inventories
router.get("/", async (req, res) => {
  try {
    const inventories = await db
      .select()
      .from(automationInventories)
      .orderBy(desc(automationInventories.createdAt));
    res.json(inventories);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// Get single inventory
router.get("/:id", async (req, res) => {
  try {
    const [inventory] = await db
      .select()
      .from(automationInventories)
      .where(eq(automationInventories.id, req.params.id));

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
    const userRole = req.user?.role;
    if (userRole !== "admin") {
      return res.status(403).json({ message: "Admin role required" });
    }

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

    // If this is marked as default, unset other defaults
    if (validated.isDefault) {
      await db
        .update(automationInventories)
        .set({ isDefault: false })
        .where(eq(automationInventories.isDefault, true));
    }

    const [newInventory] = await db
      .insert(automationInventories)
      .values({
        ...validated,
        createdBy: userId,
        updatedAt: new Date(),
      })
      .returning();

    // For linked inventories, trigger initial refresh
    if (newInventory.type === "linked") {
      // This would trigger an async refresh - for now just set mock data
      await db
        .update(automationInventories)
        .set({
          groupsCount: 12,
          hostsCount: 145,
          lastRefreshedAt: new Date(),
          previewData: {
            groups: ["customer_acme", "os_ubuntu", "wave_1", "wave_2"],
            sampleHosts: [
              { name: "web-01.acme.com", ip: "10.0.1.10" },
              { name: "web-02.acme.com", ip: "10.0.1.11" },
              { name: "db-01.acme.com", ip: "10.0.2.10" },
            ],
          },
        })
        .where(eq(automationInventories.id, newInventory.id));

      // Re-fetch to get updated data
      const [updated] = await db
        .select()
        .from(automationInventories)
        .where(eq(automationInventories.id, newInventory.id));
      return res.status(201).json(updated);
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
          .where(eq(automationInventories.id, newInventory.id));

        const [updated] = await db
          .select()
          .from(automationInventories)
          .where(eq(automationInventories.id, newInventory.id));
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

// Get inventory preview
router.get("/:id/preview", async (req, res) => {
  try {
    const [inventory] = await db
      .select()
      .from(automationInventories)
      .where(eq(automationInventories.id, req.params.id));

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

// Get full inventory structure
router.get("/:id/structure", async (req, res) => {
  try {
    const [inventory] = await db
      .select()
      .from(automationInventories)
      .where(eq(automationInventories.id, req.params.id));

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

    // For linked inventories, fetch real data from CMDB
    if (inventory.type === "linked" && inventory.sourceType && inventory.sourceRef) {
      const { NetBoxAdapter } = await import("../services/netbox-adapter");
      const cmdbAccounts = (await import("../db/schema")).cmdbAccounts;
      
      // Get the linked CMDB account
      const [cmdb] = await db
        .select()
        .from(cmdbAccounts)
        .where(eq(cmdbAccounts.id, inventory.sourceRef));

      if (!cmdb) {
        return res.status(404).json({ message: "Linked CMDB not found" });
      }

      // Fetch VMs from NetBox
      const adapter = new NetBoxAdapter(cmdb.config as any);
      const vms = await adapter.listAllVms();

      // Build groups and hosts structure
      const groupsMap = new Map<string, Set<string>>();
      const hostsMap = new Map<string, any>();

      for (const vm of vms) {
        const hostName = vm.name;
        const ip = vm.primary_ip4?.address?.split('/')[0] || '';
        const groups: string[] = [];
        
        // Create groups from tags
        if (vm.tags && Array.isArray(vm.tags)) {
          for (const tag of vm.tags) {
            const tagName = typeof tag === 'string' ? tag : tag.name;
            if (tagName) {
              groups.push(tagName);
              if (!groupsMap.has(tagName)) {
                groupsMap.set(tagName, new Set());
              }
              groupsMap.get(tagName)!.add(hostName);
            }
          }
        }

        // Create groups from tenant, site, cluster, platform
        if (vm.tenant?.name) {
          const groupName = `tenant_${vm.tenant.name}`;
          groups.push(groupName);
          if (!groupsMap.has(groupName)) {
            groupsMap.set(groupName, new Set());
          }
          groupsMap.get(groupName)!.add(hostName);
        }

        if (vm.site?.name) {
          const groupName = `site_${vm.site.name}`;
          groups.push(groupName);
          if (!groupsMap.has(groupName)) {
            groupsMap.set(groupName, new Set());
          }
          groupsMap.get(groupName)!.add(hostName);
        }

        if (vm.cluster?.name) {
          const groupName = `cluster_${vm.cluster.name}`;
          groups.push(groupName);
          if (!groupsMap.has(groupName)) {
            groupsMap.set(groupName, new Set());
          }
          groupsMap.get(groupName)!.add(hostName);
        }

        if (vm.platform?.name) {
          const groupName = `platform_${vm.platform.name}`;
          groups.push(groupName);
          if (!groupsMap.has(groupName)) {
            groupsMap.set(groupName, new Set());
          }
          groupsMap.get(groupName)!.add(hostName);
        }

        // Create host entry
        hostsMap.set(hostName, {
          name: hostName,
          ansible_host: ip,
          groups,
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

      // Convert maps to arrays
      const groups = Array.from(groupsMap.entries()).map(([name, hosts]) => ({
        name,
        hostsCount: hosts.size,
        hosts: Array.from(hosts),
      }));

      const hosts = Array.from(hostsMap.values());

      return res.json({ groups, hosts });
    }

    res.json({ groups: [], hosts: [] });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// Refresh linked inventory
router.post("/:id/refresh", async (req: AuthRequest, res: Response) => {
  try {
    const userRole = req.user?.role;
    if (userRole === "viewer") {
      return res.status(403).json({ message: "Viewers cannot refresh inventories" });
    }

    const [inventory] = await db
      .select()
      .from(automationInventories)
      .where(eq(automationInventories.id, req.params.id));

    if (!inventory) {
      return res.status(404).json({ message: "Inventory not found" });
    }

    if (inventory.type !== "linked") {
      return res.status(400).json({ message: "Only linked inventories can be refreshed" });
    }

    if (!inventory.sourceRef) {
      return res.status(400).json({ message: "Inventory has no linked CMDB source" });
    }

    // Fetch real data from CMDB
    const { NetBoxAdapter } = await import("../services/netbox-adapter");
    const cmdbAccounts = (await import("../db/schema")).cmdbAccounts;
    
    const [cmdb] = await db
      .select()
      .from(cmdbAccounts)
      .where(eq(cmdbAccounts.id, inventory.sourceRef));

    if (!cmdb) {
      return res.status(404).json({ message: "Linked CMDB not found" });
    }

    // Fetch VMs from NetBox
    const adapter = new NetBoxAdapter(cmdb.config as any);
    const vms = await adapter.listAllVms();

    // Calculate groups and hosts counts
    const groupsMap = new Map<string, Set<string>>();
    
    for (const vm of vms) {
      const hostName = vm.name;
      
      // Count groups from tags
      if (vm.tags && Array.isArray(vm.tags)) {
        for (const tag of vm.tags) {
          const tagName = typeof tag === 'string' ? tag : tag.name;
          if (tagName) {
            if (!groupsMap.has(tagName)) {
              groupsMap.set(tagName, new Set());
            }
            groupsMap.get(tagName)!.add(hostName);
          }
        }
      }

      // Count groups from metadata
      if (vm.tenant?.name) {
        const groupName = `tenant_${vm.tenant.name}`;
        if (!groupsMap.has(groupName)) {
          groupsMap.set(groupName, new Set());
        }
        groupsMap.get(groupName)!.add(hostName);
      }

      if (vm.site?.name) {
        const groupName = `site_${vm.site.name}`;
        if (!groupsMap.has(groupName)) {
          groupsMap.set(groupName, new Set());
        }
        groupsMap.get(groupName)!.add(hostName);
      }

      if (vm.cluster?.name) {
        const groupName = `cluster_${vm.cluster.name}`;
        if (!groupsMap.has(groupName)) {
          groupsMap.set(groupName, new Set());
        }
        groupsMap.get(groupName)!.add(hostName);
      }

      if (vm.platform?.name) {
        const groupName = `platform_${vm.platform.name}`;
        if (!groupsMap.has(groupName)) {
          groupsMap.set(groupName, new Set());
        }
        groupsMap.get(groupName)!.add(hostName);
      }
    }

    // Update inventory with real counts
    await db
      .update(automationInventories)
      .set({
        groupsCount: groupsMap.size,
        hostsCount: vms.length,
        lastRefreshedAt: new Date(),
        previewData: {
          groups: Array.from(groupsMap.keys()).slice(0, 10),
          sampleHosts: vms.slice(0, 5).map((vm: any) => ({
            name: vm.name,
            ip: vm.primary_ip4?.address?.split('/')[0] || '',
            status: vm.status?.value || vm.status || '',
          })),
        },
        updatedAt: new Date(),
      })
      .where(eq(automationInventories.id, req.params.id));

    const [updated] = await db
      .select()
      .from(automationInventories)
      .where(eq(automationInventories.id, req.params.id));

    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// Update inventory
router.patch("/:id", async (req: AuthRequest, res: Response) => {
  try {
    const userRole = req.user?.role;
    if (userRole !== "admin") {
      return res.status(403).json({ message: "Admin role required" });
    }

    const [existing] = await db
      .select()
      .from(automationInventories)
      .where(eq(automationInventories.id, req.params.id));

    if (!existing) {
      return res.status(404).json({ message: "Inventory not found" });
    }

    // Handle default flag toggle
    if (req.body.isDefault === true) {
      await db
        .update(automationInventories)
        .set({ isDefault: false })
        .where(eq(automationInventories.isDefault, true));
    }

    const updateData: any = {
      ...req.body,
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
      .where(eq(automationInventories.id, req.params.id));

    const [updated] = await db
      .select()
      .from(automationInventories)
      .where(eq(automationInventories.id, req.params.id));

    res.json(updated);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// Delete inventory
router.delete("/:id", async (req: AuthRequest, res: Response) => {
  try {
    const userRole = req.user?.role;
    if (userRole !== "admin") {
      return res.status(403).json({ message: "Admin role required" });
    }

    const [inventory] = await db
      .select()
      .from(automationInventories)
      .where(eq(automationInventories.id, req.params.id));

    if (!inventory) {
      return res.status(404).json({ message: "Inventory not found" });
    }

    await db
      .delete(automationInventories)
      .where(eq(automationInventories.id, req.params.id));

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

export default router;

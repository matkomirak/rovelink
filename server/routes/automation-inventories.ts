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

    // Simulate refresh from CMDB
    // In a real implementation, this would fetch from the actual CMDB
    await db
      .update(automationInventories)
      .set({
        groupsCount: 12 + Math.floor(Math.random() * 5),
        hostsCount: 145 + Math.floor(Math.random() * 20),
        lastRefreshedAt: new Date(),
        previewData: {
          groups: ["customer_acme", "customer_contoso", "os_ubuntu", "os_centos", "wave_1", "wave_2"],
          sampleHosts: [
            { name: "web-01.acme.com", ip: "10.0.1.10", groups: ["customer_acme", "os_ubuntu"] },
            { name: "web-02.acme.com", ip: "10.0.1.11", groups: ["customer_acme", "os_ubuntu"] },
            { name: "db-01.contoso.com", ip: "10.0.2.10", groups: ["customer_contoso", "os_centos"] },
          ],
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
  // Simplified parser - in production, use proper YAML/JSON/INI parsers
  const lines = content.split("\n").filter(l => l.trim() && !l.trim().startsWith("#"));
  
  const groups = new Set<string>();
  const hosts = new Set<string>();
  const sampleHosts: any[] = [];

  if (format === "ini") {
    let currentGroup = "";
    for (const line of lines) {
      if (line.startsWith("[") && line.includes("]")) {
        currentGroup = line.replace(/[\[\]]/g, "").trim();
        groups.add(currentGroup);
      } else if (line.includes("ansible_host=") || /\S+\s+/.test(line)) {
        const hostName = line.split(/\s+/)[0];
        hosts.add(hostName);
        if (sampleHosts.length < 5) {
          const ipMatch = line.match(/ansible_host=([^\s]+)/);
          sampleHosts.push({
            name: hostName,
            ip: ipMatch ? ipMatch[1] : "N/A",
            groups: currentGroup ? [currentGroup] : [],
          });
        }
      }
    }
  } else if (format === "json") {
    try {
      const parsed = JSON.parse(content);
      Object.keys(parsed).forEach(key => {
        if (key !== "_meta") {
          groups.add(key);
          if (parsed[key].hosts) {
            parsed[key].hosts.forEach((h: string) => hosts.add(h));
          }
        }
      });
    } catch (e) {
      throw new Error("Invalid JSON format");
    }
  }

  return {
    groupsCount: groups.size,
    hostsCount: hosts.size,
    preview: {
      groups: Array.from(groups).slice(0, 10),
      sampleHosts: sampleHosts.slice(0, 5),
    },
  };
}

export default router;

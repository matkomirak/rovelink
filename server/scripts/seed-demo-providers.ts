import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { db, pool } from "../db";
import { organizations, providerAccounts, type InsertProviderAccount } from "../../shared/schema";

export function demoProviderDefinitions(orgId: string): InsertProviderAccount[] {
  return [
    { name: "Demo Proxmox", scenario: "proxmox", variant: "proxmox", seed: 43 },
    { name: "Demo Azure", scenario: "azure", variant: "azure", seed: 42 },
    { name: "Demo Generic/Fake", scenario: "generic", variant: "vsphere", seed: 44 },
  ].map(profile => ({
    id: `local-demo-${createHash("sha256").update(`${orgId}:${profile.scenario}`).digest("hex").slice(0, 24)}`,
    orgId, kind: "fake", name: profile.name, enabled: true,
    config: { scenario: profile.scenario, variant: profile.variant, seed: profile.seed, vms: 4, demo: true },
  }));
}

export async function seedDemoProviders() {
  if (process.env.ROVELINK_DEMO_DATA !== "true") throw new Error("ROVELINK_DEMO_DATA=true is required for this local demo seed");
  const slug = process.env.ROVELINK_DEMO_ORG_SLUG || "default";
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, slug) });
  if (!org) throw new Error("Demo organization not found. Start Rovelink first or set ROVELINK_DEMO_ORG_SLUG.");
  // Stable IDs are scoped to the chosen organization. Never overwrite existing configuration.
  for (const provider of demoProviderDefinitions(org.id)) {
    await db.insert(providerAccounts).values(provider).onConflictDoNothing();
  }
  console.log("Three demo provider accounts are available. Use Sync Cached Inventory on each provider. No NetBox data was written.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  seedDemoProviders().catch(() => { console.error("Demo provider seed failed; check demo opt-in and organization configuration."); process.exitCode = 1; })
    .finally(async () => { await pool.end(); });
}

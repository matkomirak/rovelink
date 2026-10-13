import axios from "axios";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { db, pool } from "../db";
import { organizations } from "../../shared/schema";
import { storage } from "../storage";
import { FakeCollector } from "../services/providers/fake";
import { decryptCmdbConfig } from "../services/secrets";

export function selectDemoVms<T extends { name: string }>(vms: T[], names: string[]) {
  if (!names.length) throw new Error("Select at least one demo VM explicitly");
  const unique = Array.from(new Set(names));
  const selected = unique.map(name => vms.find(vm => vm.name === name));
  if (selected.some(vm => !vm)) throw new Error("Only VMs from the seeded Demo Proxmox profile may be imported");
  return selected as T[];
}

export async function importDemoProxmoxNetbox() {
  if (process.env.ROVELINK_DEMO_DATA !== "true") throw new Error("ROVELINK_DEMO_DATA=true is required");
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, process.env.ROVELINK_DEMO_ORG_SLUG || "default") });
  if (!org) throw new Error("Demo organization not found");
  const provider = (await storage.getProviders(org.id)).find(p => p.kind === "fake" && (p.config as any)?.scenario === "proxmox" && (p.config as any)?.demo === true);
  if (!provider) throw new Error("Seed Demo Proxmox first");
  const vms = await new FakeCollector({ ...(provider.config as any), variant: "proxmox", seed: 43, vms: 4 }).listVms();
  const names = (process.env.ROVELINK_DEMO_VM_NAMES || "").split(",").map(v => v.trim()).filter(Boolean);
  if (!names.length) { console.log("Available offline Demo Proxmox VMs:", vms.map(v => v.name).join(", ")); console.log("Set ROVELINK_DEMO_VM_NAMES explicitly to import selected VMs. No writes performed."); return; }
  const selected = selectDemoVms(vms, names);
  const cmdbId = process.env.ROVELINK_DEMO_CMDB_ID;
  if (!cmdbId) throw new Error("ROVELINK_DEMO_CMDB_ID is required");
  const cmdb = await storage.getCmdbAccount(cmdbId, org.id);
  if (!cmdb || cmdb.kind !== "netbox") throw new Error("Selected NetBox CMDB does not belong to this demo organization");
  const config = decryptCmdbConfig(cmdb.config as Record<string, any>);
  if (config.url !== "http://netbox:8080") throw new Error("This demo importer only permits the isolated http://netbox:8080 service");
  const client = axios.create({ baseURL: "http://netbox:8080/api", timeout: 30000, maxRedirects: 0, headers: { Authorization: `${config.token.includes(".") ? "Bearer" : "Token"} ${config.token}` } });
  const ensure = async (path: string, name: string, values: object) => {
    const found = await client.get(path, { params: { name } });
    if (found.data.count > 1) throw new Error("Ambiguous demo resource name");
    return found.data.results[0] ?? (await client.post(path, { name, ...values })).data;
  };
  const tenant = await ensure("/tenancy/tenants/", "ACME GmbH", { slug: "acme-gmbh-demo", description: "Fictional local Rovelink demo customer" });
  const type = await ensure("/virtualization/cluster-types/", "Rovelink Demo", { slug: "rovelink-demo" });
  const cluster = await ensure("/virtualization/clusters/", "Rovelink Demo Proxmox", { type: type.id });
  let created = 0;
  for (const vm of selected) {
    const exists = await client.get("/virtualization/virtual-machines/", { params: { name: vm.name } });
    if (exists.data.count > 0) { console.log("Existing VM preserved:", vm.name); continue; }
    const platform = await ensure("/dcim/platforms/", vm.platform === "windows" ? "Demo Windows" : "Demo Linux", { slug: vm.platform === "windows" ? "rovelink-demo-windows" : "rovelink-demo-linux" });
    const result = await client.post("/virtualization/virtual-machines/", { name: vm.name, cluster: cluster.id, tenant: tenant.id, platform: platform.id, status: vm.status === "running" ? "active" : "offline", vcpus: vm.vcpus, memory: vm.memory, comments: "Explicit offline Rovelink Demo Proxmox reference import; fictional ACME customer." });
    created++;
    if (vm.primaryIp4) {
      const nic = await client.post("/virtualization/interfaces/", { virtual_machine: result.data.id, name: "demo-eth0" });
      const ip = await client.post("/ipam/ip-addresses/", { address: `${vm.primaryIp4}/32`, tenant: tenant.id, status: "active", assigned_object_type: "virtualization.vminterface", assigned_object_id: nic.data.id });
      await client.patch(`/virtualization/virtual-machines/${result.data.id}/`, { primary_ip4: ip.data.id });
    }
  }
  console.log(`Explicit demo import completed: ${created} VMs created. Existing VMs were preserved. Refresh the CMDB cache and evaluate manually.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  importDemoProxmoxNetbox().catch(() => { console.error("Demo import failed. Check selected IDs, local URL, and NetBox write-token permissions. Partial objects may exist; inspect NetBox before retrying. No credentials or upstream bodies are printed."); process.exitCode = 1; }).finally(async () => { await pool.end(); });
}

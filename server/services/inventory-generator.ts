/**
 * Inventory Generator — creates a per-run Ansible inventory file on disk.
 *
 * The generated file lives at:
 *   runtime/inventories/<orgId>/<runId>/inventory.yml
 *
 * Gate policy is ALWAYS recomputed fresh from the org's DB-cached NetBox VMs.
 * There is NO dependency on the ephemeral in-memory gate store for execution.
 * The gate store is updated for transparency (UI), but inventory generation
 * reads from DB → evaluates inline → writes file.
 *
 * After writing, a GateDecisionSnapshot[] is returned for the caller to persist
 * on the job run (gateSnapshot field).
 *
 * Cross-org isolation:
 *   - Only VMs owned by the org (via netbox_inventory_sources.org_id) are loaded.
 *   - Gate evaluation is scoped to the org.
 *   - Inventory never includes hosts from another organization.
 *
 * The file is written with mode 0o600. The returned path is always an
 * absolute path resolved from the project root.
 */

import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { gateEvaluator } from "./gate-evaluator";
import { gateStore, type GateDecisionSnapshot } from "./gate-store";
import { storage } from "../storage";
import { db } from "../db";
import { automationInventories, normalizeEligibilityPolicy, type EligibilityPolicy } from "../../shared/schema";
import { and, eq } from "drizzle-orm";
import { applyGovernanceGateEnforcement } from "./governance-gate-enforcement";

export interface InventoryOptions {
  orgId: string;
  runId: string;
  templateId?: string | null;
  inventoryId?: string | null;
  limitExpr?: string | null;
  ansibleUser?: string | null;
  ansiblePort?: number | null;
}

export interface InventoryResult {
  inventoryPath: string;
  gateSnapshot: GateDecisionSnapshot[];
  allowedCount: number;
  blockedCount: number;
}

export async function createInventoryForRun(
  options: InventoryOptions
): Promise<string> {
  const { inventoryPath } = await createInventoryForRunWithSnapshot(options);
  return inventoryPath;
}

/**
 * Full version — returns both the path and the gate snapshot.
 * Called by runner-dispatcher so the snapshot can be persisted on the run.
 */
export async function createInventoryForRunWithSnapshot(
  options: InventoryOptions
): Promise<InventoryResult> {
  const { orgId, runId } = options;
  const ansibleUser = typeof options.ansibleUser === "string" && options.ansibleUser.trim()
    ? options.ansibleUser.trim()
    : null;
  const ansiblePort = Number.isInteger(options.ansiblePort) && options.ansiblePort! > 0 && options.ansiblePort! <= 65535
    ? options.ansiblePort
    : null;

  // Resolve to an absolute path — no ambiguity about CWD.
  const dir = path.resolve(
    process.cwd(),
    "runtime",
    "inventories",
    orgId,
    runId
  );

  // Create directory tree safely (idempotent).
  await mkdir(dir, { recursive: true });

  const inventoryPath = path.join(dir, "inventory.yml");

  // ── Gate phase: load org's cached VMs from DB, evaluate inline ──────────────
  // This is ALWAYS fresh from DB — no dependency on ephemeral gate store.
  const dbVms = await storage.getNetboxVms(orgId);
  const eligibilityPolicy = await loadInventoryEligibilityPolicy(orgId, options.inventoryId ?? null);

  const gateSnapshot: GateDecisionSnapshot[] = [];
  const allowedHosts: Array<{
    safeName: string;
    ip: string | null;
    governanceObjectType: "netbox_vm";
    governanceObjectId: string;
    sourceNetboxId: number | undefined;
  }> = [];

  for (const vm of dbVms) {
    // Convert DB record to the shape gate-evaluator expects
    const vmForGate = {
      id: vm.netboxId,
      name: vm.name,
      tenant: (vm.customFields as any)?.tenant ?? null,
      role: (vm.customFields as any)?.role ?? null,
      tags: Array.isArray(vm.tags) ? (vm.tags as string[]) : [],
      custom_fields: (vm.customFields as Record<string, any>) ?? {},
    };

    // Evaluate gate (pure function, no side effects on store yet)
    const result = gateEvaluator.evaluateGate(vmForGate, false);

    const baseDecision = {
      assetId: result.assetId,
      vmName: vm.name,
      netboxVmId: vm.netboxId,
      governanceObjectType: "netbox_vm" as const,
      governanceObjectId: vm.id,
      sourceNetboxId: vm.netboxId,
      allowed: result.allowed,
      missing: result.missing,
      reason: result.reason,
      failureType: result.failureType,
    };
    const enforcedDecision = await applyGovernanceGateEnforcement(
      baseDecision,
      { governanceObjectType: "netbox_vm", governanceObjectId: vm.id },
      eligibilityPolicy.governance,
      async (identity) => {
        const latest = await storage.getLatestGovernanceEvaluationForObject(
          orgId,
          identity.governanceObjectType,
          identity.governanceObjectId,
        );
        return latest?.evaluation ?? null;
      },
    );

    const snapshot: GateDecisionSnapshot = {
      ...enforcedDecision,
      evaluatedAt: new Date().toISOString(),
    };
    gateSnapshot.push(snapshot);

    // Also update the org-scoped gate store for UI transparency
    await gateStore.storeDecision({
      orgId,
      assetId: result.assetId,
      vmName: vm.name,
      netboxVmId: vm.netboxId,
      governanceObjectType: "netbox_vm",
      governanceObjectId: vm.id,
      sourceNetboxId: vm.netboxId,
      allowed: enforcedDecision.allowed,
      missing: enforcedDecision.missing,
      evaluatedAt: new Date(),
      reason: enforcedDecision.reason,
      failureType: enforcedDecision.failureType,
      governanceEnforcement: enforcedDecision.governanceEnforcement,
    });

    if (enforcedDecision.allowed) {
      // Strip CIDR notation if present (e.g., "10.0.0.1/24" → "10.0.0.1")
      const ip = vm.ip ? vm.ip.split("/")[0] : null;
      allowedHosts.push({
        safeName: vm.name.replace(/[^A-Za-z0-9_\-.]/g, "_"),
        ip,
        governanceObjectType: "netbox_vm",
        governanceObjectId: vm.id,
        sourceNetboxId: vm.netboxId,
      });
    }
  }

  // Mark as evaluated for this org (enables gate store UI)
  gateStore.markEvaluationComplete(orgId);

  const allowedCount = allowedHosts.length;
  const blockedCount = gateSnapshot.length - allowedCount;

  // ── Write inventory YAML ─────────────────────────────────────────────────────
  const lines: string[] = [
    "---",
    "# Generated by Rovelink",
    `# Run ID: ${runId}`,
    `# Organization ID: ${orgId}`,
    "# Gate policy: enforced (recomputed from DB at run preparation time)",
    `# Allowed: ${allowedCount}  Blocked: ${blockedCount}`,
    "#",
  ];

  if (allowedHosts.length === 0) {
    lines.push(
      "# No hosts passed gate evaluation.",
      "#   Possible reasons:",
      "#   - No NetBox VMs are imported for this organization.",
      "#   - All VMs are missing required governance fields (tenant, role, automatable).",
      "#   Import VMs via a NetBox Inventory Source before executing local Ansible playbooks.",
      "#",
      "all:",
      "  hosts: {}"
    );
  } else {
    lines.push("all:", "  hosts:");

    for (const host of allowedHosts) {
      lines.push(`    ${host.safeName}:`);
      if (host.ip) {
        lines.push(`      ansible_host: "${host.ip}"`);
      }
      if (ansibleUser) {
        lines.push(`      ansible_user: "${ansibleUser}"`);
      }
      if (ansiblePort) {
        lines.push(`      ansible_port: ${ansiblePort}`);
      }
      lines.push(`      rovelink_governance_object_type: "${host.governanceObjectType}"`);
      lines.push(`      rovelink_governance_object_id: "${host.governanceObjectId}"`);
      if (host.sourceNetboxId != null) {
        lines.push(`      rovelink_netbox_id: ${host.sourceNetboxId}`);
        lines.push(`      rovelink_source_netbox_id: ${host.sourceNetboxId}`);
      }
      lines.push(`      rovelink_gate_status: allowed`);
      lines.push(`      rovelink_org_id: "${orgId}"`);
    }
  }

  await writeFile(inventoryPath, lines.join("\n") + "\n", { mode: 0o600 });

  return { inventoryPath, gateSnapshot, allowedCount, blockedCount };
}

async function loadInventoryEligibilityPolicy(orgId: string, inventoryId: string | null): Promise<EligibilityPolicy> {
  if (!inventoryId) {
    return normalizeEligibilityPolicy(null);
  }

  const [inventory] = await db
    .select({ eligibilityPolicy: automationInventories.eligibilityPolicy })
    .from(automationInventories)
    .where(and(
      eq(automationInventories.id, inventoryId),
      eq(automationInventories.orgId, orgId),
    ))
    .limit(1);

  return normalizeEligibilityPolicy(inventory?.eligibilityPolicy ?? null);
}

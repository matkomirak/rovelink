/**
 * Inventory Generator — creates a per-run Ansible inventory file on disk.
 *
 * The generated file lives under runtime/inventories/<orgId>/<runId>/inventory.yml
 * and is owned by the server process (mode 0o600). The returned path is always an
 * absolute path resolved from the project root, safe to pass directly to LocalRunner.
 *
 * This eliminates the inline path string in runner-dispatcher.ts and ensures the
 * directory tree exists before execution begins.
 */

import { mkdir, writeFile } from "fs/promises";
import path from "path";

export async function createInventoryForRun(
  orgId: string | null,
  runId: string
): Promise<string> {
  const orgDir = orgId ?? "default";

  // Resolve to an absolute path so there is no ambiguity about the CWD.
  const dir = path.resolve(
    process.cwd(),
    "runtime",
    "inventories",
    orgDir,
    runId
  );

  // Create the directory tree if it does not exist (safe, idempotent).
  await mkdir(dir, { recursive: true });

  const inventoryPath = path.join(dir, "inventory.yml");

  const content = [
    "---",
    "# Auto-generated inventory for run " + runId,
    "# Do not edit — regenerated on each run.",
    "all:",
    "  hosts:",
    "    localhost:",
    "      ansible_connection: local",
  ].join("\n") + "\n";

  await writeFile(inventoryPath, content, { mode: 0o600 });

  return inventoryPath;
}

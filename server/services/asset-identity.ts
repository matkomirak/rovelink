// asset_id is the stable internal identity.
// VM names are NOT trusted identifiers.
//
// asset_id is a deterministic composite of source and external identity.
// This prepares the system for real providers with mutable VM names.

import { createHash } from "crypto";

/**
 * Generate a stable asset_id from source and external identifier.
 * 
 * The asset_id is a deterministic hash that:
 * - Survives VM name changes
 * - Prevents name collisions across providers
 * - Provides stable internal identity for gate decisions
 * 
 * @param source - The source system (e.g., "netbox", "proxmox", "vsphere")
 * @param externalId - The external identifier (provider VM ID or name if ID unavailable)
 * @returns Stable asset_id hash
 */
export function generateAssetId(source: string, externalId: string | number): string {
  const composite = `${source}:${externalId}`;
  return createHash("sha256").update(composite).digest("hex").substring(0, 16);
}

/**
 * Generate asset_id from CMDB (NetBox) VM data.
 * Prefers NetBox VM ID, falls back to name if ID unavailable.
 */
export function assetIdFromNetBox(vmId?: number, vmName?: string): string {
  if (vmId) {
    return generateAssetId("netbox", vmId);
  }
  if (vmName) {
    return generateAssetId("netbox", vmName);
  }
  throw new Error("Cannot generate asset_id: both vmId and vmName are empty");
}

/**
 * Generate asset_id from provider data.
 * Each provider should have its own ID generation logic.
 */
export function assetIdFromProvider(
  providerId: string,
  providerVmId: string | number
): string {
  return generateAssetId(providerId, providerVmId);
}

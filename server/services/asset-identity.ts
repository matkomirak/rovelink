// ================================================================
// ASSET IDENTITY - Stable Internal Identity
// ================================================================
//
// asset_id is the stable internal identity.
// VM names are display-only, NOT trusted identifiers.
//
// Use asset_id as the key for:
// - gate decisions
// - provider hints
// - inventory inclusion
//
// No map or store may be keyed by VM name.
//
// ================================================================

import { createHash } from "crypto";

/**
 * Derive a stable asset_id from provider and VM name.
 * 
 * This is the ONE helper function for asset identity.
 * All gate, hint, and inventory logic must use this.
 * 
 * @param providerId - The provider/CMDB identifier (e.g., CMDB account ID)
 * @param vmName - The VM name (used only because VM ID may not always be available)
 * @returns Stable asset_id hash (16 hex characters)
 */
export function deriveAssetId(providerId: string, vmName: string): string {
  const composite = `${providerId}:${vmName}`;
  return createHash("sha256").update(composite).digest("hex").substring(0, 16);
}

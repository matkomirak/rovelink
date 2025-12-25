/*
================================================================================
AUTOMATION GATE DESIGN PRINCIPLE
================================================================================

Automation inventory represents PERMISSION, not reality.

If an asset is not explicitly governed and accountable,
it must not be automatable — even if it exists.

Any code change that weakens this principle is incorrect.

================================================================================
CRITICAL INVARIANTS:
================================================================================

1. GOVERNANCE AUTHORITY
   - CMDB (NetBox) is the SOLE source of governance truth
   - Provider metadata may suggest, but NEVER confirm intent
   - No provider data can bypass CMDB governance

2. GATE EVALUATION
   - Gate evaluation is a FIRST-CLASS PHASE
   - Inventory generation must NEVER implicitly re-evaluate gates
   - Gate must run BEFORE inventory generation, never during

3. IDENTITY
   - asset_id is the stable internal identity
   - VM names are NOT trusted identifiers
   - asset_id = deterministic hash of (source + external_id or name)

4. FAILURE CLASSIFICATION
   - INVARIANT VIOLATIONS (crash): blocked VM in inventory, provider hints used
   - GOVERNANCE FAILURES (block): missing tenant/role/tag - visible, non-fatal

5. FEEDBACK LOOP
   - Block reasons sync back to NetBox for human visibility
   - Sync-back is INFORMATIONAL ONLY - not used for gate decisions
   - NetBox remains source of governance, not gate decisions

================================================================================
*/

// This file contains no executable code.
// It exists solely as an architectural anchor for the gate system.
// Import this file in gate-related services to enforce awareness.

export const GATE_DESIGN_PRINCIPLE = `
Automation inventory represents PERMISSION, not reality.
If an asset is not explicitly governed and accountable,
it must not be automatable — even if it exists.
`;

export const GATE_INVARIANTS = {
  CMDB_IS_AUTHORITY: "CMDB (NetBox) is the SOLE source of governance truth",
  GATE_IS_FIRST_CLASS: "Gate evaluation is a FIRST-CLASS PHASE, runs BEFORE inventory",
  ASSET_ID_IS_STABLE: "asset_id is stable internal identity, VM names are not trusted",
  FAILURES_ARE_CLASSIFIED: "Invariant violations crash, governance failures block silently",
  FEEDBACK_IS_INFORMATIONAL: "Block reason sync-back is informational only",
};

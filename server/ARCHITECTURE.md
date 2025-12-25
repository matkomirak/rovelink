# Bridge Automation Architecture

## Core Principle

**Automation inventory = permission, not reality.**

If an asset exists in the infrastructure but is not explicitly governed in the CMDB, it must not be automatable.

## Key Rules

### 1. Provider Data is Suggestive, Never Authoritative

Providers (Proxmox, vSphere, Azure, AWS, Fake) emit observed data only. They have no knowledge of governance concepts like tenants, roles, or automation permissions.

Provider metadata may *suggest* governance intent, but the CMDB is the sole authority.

### 2. Gate Refusal is a Success Condition

When the gate blocks a VM, that is correct behavior. The system is working as designed.

A blocked VM means:
- Missing tenant assignment
- Missing role assignment  
- Missing "automatable" tag

All three must be present in the CMDB for automation to be allowed.

### 3. Gate Runs as Explicit Phase

Gate evaluation is a first-class phase that runs BEFORE inventory generation.

```
1. runGatePhase()     → Fetches VMs, evaluates rules, populates store
2. readAllowedAssets() → Inventory reads from store (never evaluates)
```

Inventory generation must ONLY read gate results. It must NEVER trigger gate evaluation.

### 4. Stable Identity via asset_id

VM names are mutable and can collide. The system uses `asset_id` as the stable internal identity:

```
asset_id = hash(providerId + vmName)
```

All stores are keyed by `asset_id`, not VM name.

### 5. Failure Classification

**Fatal errors (crash):**
- Blocked VM appears in automation inventory
- Provider hints used in gate logic

**Normal blocks (visible, non-fatal):**
- Missing tenant
- Missing role
- Missing automatable tag

## What This System Does NOT Do

- No UI for gate management
- No provider → CMDB auto-mapping
- No approval workflows
- No multi-tenancy
- No RBAC for gate decisions
- No metrics dashboards

## Acceptance Criteria

These must always be true:

1. A VM without CMDB governance never appears in automation inventory
2. Removing governance immediately removes automation access
3. Provider data cannot bypass the gate
4. Block reasons are visible in NetBox
5. Gate logic runs as its own explicit phase

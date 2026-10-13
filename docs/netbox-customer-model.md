# Recommended NetBox modeling for MSPs

**Create one NetBox Tenant per customer. Assign each customer's objects to
that Tenant. Let Rovelink import the Tenant as a CustomerScope and resolve
customer assignments from the CMDB.** For MSP usage, one NetBox Tenant = one
customer is the recommended starting model.

## Terminology

| NetBox term | Rovelink term | Business meaning |
| --- | --- | --- |
| Tenant | CustomerScope | Customer / customer boundary |
| Object's Tenant field | Customer assignment to a CustomerScope | Which customer owns or is assigned this object |

Tenant is the NetBox **source-side object**. CustomerScope is Rovelink's
normalized business/governance concept. A customer assignment links a cached
reference object to that CustomerScope. NetBox Tenant remains visible as the
source of the assignment, not a separate required business field.

A Rovelink **organization** is an application security/account boundary; it is
not a customer. One MSP organization can manage many CustomerScopes. CustomerScopes
remain scoped to their organization and CMDB source; matching names in different
NetBox sources do not automatically merge customer boundaries.

An **Azure tenant** is an identity/directory boundary, not automatically a
business customer. This recommendation uses **NetBox Tenant** as the customer
boundary; the word tenant alone does not imply these concepts are equivalent.

## Model the customer in NetBox

1. Create a Tenant for each customer, with a clear customer name.
2. Assign VMs, devices, IP addresses, prefixes, and other tenant-aware NetBox
   objects to the correct Tenant where the object type supports that field.
3. Set the Tenant on each VM directly. Do not assume a Tenant on its prefix,
   site, cluster, or other related object automatically assigns the VM.
4. Keep these assignments current when customer ownership changes.

Current Rovelink CMDB refresh/governance support imports **NetBox VMs** and
resolves CustomerScopes from each VM's Tenant ID and name. Modeling devices,
IPs, prefixes, and other objects consistently is recommended NetBox practice,
but this does not claim Rovelink currently imports or evaluates all those types.
Empty or incomplete VM Tenant data cannot establish a valid CustomerScope.
Unused NetBox Tenants are not automatically imported by the VM refresh.

## Practical flow in Rovelink

1. Connect the NetBox CMDB using the appropriate base URL and raw API token.
   See [Demo scenarios](demo-scenarios.md) for internal Docker, host, and browser
   addresses. Do not append `/api` or paste `Bearer`/`Token` prefixes.
2. Open the CMDB detail page, click **Refresh**, and confirm **Refresh CMDB**.
   This reads NetBox into Rovelink's cached reference inventory and updates
   customer assignments; it does not write to NetBox or providers.
3. Open an imported VM's **Customer Assignment** section. Verify the expected
   CustomerScope, NetBox Tenant ID, and **Derived from: NetBox Tenant** label.
4. Run a governance evaluation explicitly. Governance evaluates the resolved
   CustomerScope/customer assignment, not provider customer hints. A valid
   assignment satisfies the standard customer-assignment requirement and its
   legacy NetBox `tenant` rule equivalent.
5. After manually adding, removing, or changing a VM's Tenant **in NetBox**,
   refresh the CMDB cache again, then rerun governance to inspect new findings.
   Refresh does not automatically run governance or Automation GATE.

| Manual NetBox change | After CMDB refresh | After explicit governance evaluation |
| --- | --- | --- |
| Assign a valid Tenant | CustomerScope/customer assignment is resolved | No missing-customer-assignment finding for that VM |
| Remove the VM's Tenant | VM becomes unassigned | CustomerScope/customer-assignment finding; effect depends on blueprint rules/policy |
| Change the assigned Tenant | Assignment points to the new customer boundary | Governance evaluates the new resolved assignment |
| Rename the same Tenant | CustomerScope display name updates using stable NetBox Tenant ID | Assignment remains tied to that source-side identity |

Removing a VM's Tenant does not necessarily delete its historical CustomerScope
record. Removing the VM itself upstream also does not purge older cached VMs:
the current refresh upserts records. Inspect the VM's current assignment rather
than treating the mere existence of a CustomerScope record as customer ownership.

Stored evaluation findings are historical until you run a new evaluation. A
customer assignment being present does **not** alone make a VM automation-ready:
other data, ownership, blueprint requirements, and existing GATE checks still apply.
The separate CustomerScope policy defaults to visibility-only; configured policy
modes and explicit required-data rules determine score/readiness effects.

## Example: ACME GmbH

ACME GmbH is a fictional customer in this example.

- Business customer: **ACME GmbH**.
- NetBox Tenant: **ACME GmbH**.
- NetBox VM: `acme-db-01`, with its Tenant field set to **ACME GmbH**.
- After Rovelink CMDB refresh: CustomerScope **ACME GmbH** and a customer
  assignment for `acme-db-01`, derived from **NetBox Tenant**.
- After governance evaluation: customer assignment is present; no
  missing-customer-assignment finding should be emitted for that VM.

For the [empty-NetBox demo](demo-scenarios.md), first observe the intentional
`unmatched_provider` drift. To explore customer modeling afterward, manually
create a reference VM and Tenant in disposable NetBox, assign the VM, refresh
Rovelink, and evaluate governance. This is a separate follow-up to the empty
scenario, not provider writeback or an automatic seed.

## Provider hints are not customer truth

Do not rely on provider tags alone as the source of customer truth. Azure tags,
subscription/resource-group names, Proxmox tags/pools, and other provider customer
candidates are non-authoritative runtime hints. They do not replace NetBox Tenant
assignments, create CustomerScopes or customer_scope_object_assignments, or
authorize automation. Model the customer in the CMDB, then import that reference
assignment into Rovelink.

Do not equate a Rovelink organization, an Azure tenant, and a NetBox Tenant.
Use the full source-qualified term when discussing a tenant, and use
**CustomerScope/customer assignment** when discussing Rovelink governance.

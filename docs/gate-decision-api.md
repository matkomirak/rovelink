# Pre-flight GATE Decision API

Status: action-specific, decision-only public-alpha API. Rovelink is the governance
and pre-flight decision layer; this endpoint never launches automation, creates a
run, persists a snapshot, refreshes a source or writes to infrastructure.

## Request and authentication

POST /api/v1/gate/evaluate uses the existing authenticated HttpOnly cookie session
(or existing server bearer authentication) and server-resolved organization.
Viewers receive HTTP 403 before data reads. Operators/admins/platform admins need
an explicit matching action role grant; there is no admin rank bypass. Platform
admins must select an organization through the existing org-context guard. Identity
and role are hydrated from the database and rechecked before returning allow.
Machine authentication and external execution adapters are not implemented here.

```json
{
  "target": { "sourceType": "cmdb", "sourceId": "local-cmdb-id", "objectType": "netbox_vm", "objectId": "local-vm-id" },
  "automation": { "templateId": "local-template-id", "adapter": "local" },
  "freshness": { "maxGovernanceAgeSeconds": 900 }
}
```

IDs are local Rovelink IDs. Strict validation rejects unsupported target types,
caller org/requester, scores, approval claims, arbitrary context, persist/dryRun
flags and request-side policy. Malformed bodies return HTTP 400 without echoing
values. templateId remains optional for old clients, but its absence can only
return unknown. A caller freshness limit can tighten, never loosen, stored policy.
Foreign and missing source/target/template references have indistinguishable safe
unknown results. Role-grant denials return HTTP 403 without target details.

## Admin-managed action policy

The smallest supporting model change is optional preflightActions in existing
inventory eligibilityPolicy JSON. No database migration or new table is needed.
Configure it through the existing admin-only, org-scoped
PATCH /api/inventories/:id/policy route. Existing PATCH merging preserves normal
governance policy and pre-flight actions. Operators cannot configure grants.
The pre-flight endpoint itself does not write policy or accept overrides.

Example (illustrative explicit values, not defaults):

```json
{
  "preflightActions": [{
    "templateId": "local-template-id",
    "blueprintId": "local-blueprint-id",
    "playbookSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "allowedRoles": ["operator"],
    "allowedCustomerScopeIds": ["local-customer-scope-id"],
    "minimumGovernanceScore": 80,
    "maxGovernanceAgeSeconds": 3600,
    "maxSourceAgeSeconds": 1800,
    "maxInventoryAgeSeconds": 900,
    "maxAssignmentAgeSeconds": 1800,
    "decisionTtlSeconds": 30
  }]
}
```

Replace every illustrative ID and digest. An administrator must review the synced
trusted playbook and record its actual SHA-256 digest (for example sha256sum over
the server-managed checkout file). The endpoint compares file contents with this
pin; the example digest is not a working approval. Pin updates are explicit admin
policy changes. Duplicate template entries, unknown policy keys, empty grants and
missing age/TTL limits are rejected. Removing the matching entry revokes positive
pre-flight authorization. Different templates can grant different roles/scopes
and thresholds for the same target. This policy is not wired into launch routes.

## Exact allow conditions

All must be verified; no score or role alone is sufficient:

1. An authenticated operator-or-higher has an exact role grant for the requested
   template in its organization-owned inventory. Admin/platform-admin must be
   explicitly included to use their roles. The requester still exists with the
   same role and tenant context at the final read.
2. The requested template and all referenced inventory/source/project/credential
   objects belong to the selected org. Adapter and template runner are local.
   Only enabled NetBox sources and linked NetBox inventories are supported.
3. The target has one unambiguous local ID and positive NetBox ID in that source,
   and exactly one inventory host with the same local governance identity. Aliases
   must be safe and unique; its connection address matches the cached reference.
   Limits are absent, all, or that exact host alias. File/script inventories and
   complex limit expressions cannot produce allow.
4. The explicitly selected blueprint is active/applicable to this source and VM
   type; its active version is owned and valid. The latest relevant completed
   successful evaluation belongs to that target/source/blueprint/version. Tied
   latest evidence is ambiguous; inconsistent stored result fields are unknown.
5. Stored and pure current cached blueprint checks are governance-ready, without
   blocking findings/recommendations, and meet the action threshold. Existing
   inventory governance enforcement is also applied. Observe/warn modes do not
   relax the action's mandatory readiness checks.
6. There is exactly one dedicated, authoritative, NetBox/provider-derived
   CustomerScope assignment, referencing an owned scope explicitly granted to
   that action. The current blueprint's CustomerScope policy passes.
7. Evaluation, VM import, inventory refresh and assignment/scope sync satisfy all
   explicitly configured ages. No timestamp is missing/future/invalid. Inventory
   refresh does not predate VM import. Source, customer and blueprint/version
   state was not changed after evaluation. The stored VM snapshot agrees with
   current cached fields. A refresh requires reevaluation even if data looks alike.
8. Technical prerequisites are positively configured: native NetBox status active,
   provider_state active, automatable boolean true, Linux platform and valid IP.
   Optional role requirements pass. requireContacts remains unknown because cached
   contact verification is unavailable. Old caches without native status require
   an explicit source refresh and governance reevaluation.
9. The project is successfully synced; the requested YAML playbook is discovered,
   exists inside the real checkout without path/symlink escape, is bounded and
   matches the admin pin. Extra variables pass existing reserved-key/Jinja guards.
   ROVELINK_LOCAL_RUNNER_ENABLED must be explicitly true on a supported non-Windows host; ansible-playbook
   version inspection succeeds, and ssh-keygen finds a known-host entry for the
   actual IP/port. These are local read-only probes, not remote connection tests.
10. The owned SSH credential has a valid username/port, host-key checking enabled,
    and decryptable unencrypted PEM/PKCS8 private-key material. No key is written.
    OpenSSH containers, protected keys and external secret references remain
    unknown in this initial allow path. Network reachability is not promised.
11. A second local prerequisite/digest inspection and final org-scoped reread agree
    with the original bound evidence. Any detected change fails closed. The minimum
    of TTL and all evidence deadlines remains in the future.

## Results and evidence

- allow: all conditions above verified at evaluation time. Reasons is empty;
  explanation states the bounded result and validUntil is set.
- block: known current governance/action-threshold/enforcement violations,
  missing/disallowed customer assignment, missing/invalid connection data or
  known negative technical eligibility. Fresh historical negative governance is
  also blocking; stale historical evidence alone is unknown.
- unknown: missing action policy or evidence, unsupported capability, stale,
  future, invalidated or inconsistent evidence, ambiguous identity, absent target,
  or unverified project/credential/runtime configuration. validUntil is null.
- pending is reserved in the shared type, but never emitted: no approval workflow
  exists. A request flag cannot fabricate approval or pending state.

HTTP 401/403/400 are authentication/permission/input failures, not allow decisions.
Operational errors return a safe HTTP 500 and must also fail closed.

Stable reason codes and explanations are defined in shared/gate-decision.ts:
unsupported_target, unsupported_automation, invalid_template, action_policy_missing,
invalid_action_policy, governance_not_ready, governance_policy_blocked,
missing_governance_evaluation, stale_governance_evaluation, inconsistent_evidence,
evidence_invalidated, stale_source, stale_inventory, missing_inventory_target,
ambiguous_target, missing_connection_data, eligibility_blocked,
customer_assignment_missing, customer_scope_blocked, missing_credential,
missing_execution_prerequisites, unsupported_inventory, unsupported_template_limit,
unknown_readiness. The first failing condition determines the response; this is
not a complete diagnostics dump and does not reveal denied target details.

Responses preserve correlationId, evaluatedAt, decision, reasons, evidence and
warnings; add explanation, validUntil and authorized target/action references.
Selected evidence includes evaluation/run/blueprint/version IDs, inventory/source
and assignment timestamps, CustomerScope/assignment IDs, readiness, policy/action
fingerprints and pinned playbook digest. No raw findings, credential values,
private keys, custom fields, provider payloads, paths or environment are returned.

## Freshness and TOCTOU

There is no universal age default. Admin action policies specify every age and
TTL. Positive validity ends at the earliest configured evidence deadline or TTL;
client requests can only shorten governance age. Source imports, customer changes,
blueprint activation, target remapping and detected policy/template/project/key
changes invalidate evidence. Run/version IDs, cache timestamps and content hashes
identify what was read; they are not immutable decision snapshots.

The reread is an optimistic consistency check, not a distributed transaction or
infrastructure lock. State can change immediately afterward, and cached evidence
cannot detect unrefreshed upstream changes. The response is not a signed,
single-use or indefinitely reusable execution token. Future adapters must recheck
auth/role/policy, identities, source versions, content and expiry immediately before
launch, then bind actual targets and execution evidence through a separately
reviewed authorization lifecycle. Do not wire allow directly into today's runner.

Drift remains analysis-only and is neither consulted nor used to block by default.
AWX/RHAAP/webhook adapters, approval workflows, snapshot persistence, durable
workers and machine authentication remain future work. See the
[enforcement boundary](enforcement-boundary.md) and
[snapshot architecture](execution-decision-snapshots.md).

The legacy runner's enablement helper has a local-dev fallback, including when
the enable flag is false. Pre-flight does not reuse that fallback: explicit true
is required. Existing launch behavior was not changed or connected to this API.
This mismatch must be resolved before claiming a unified execution lifecycle.
Legacy local and live-NetBox inventory paths also use differing core checks and
legacy tag handling; pre-flight deliberately requires boolean CMDB approval,
native active status and verified customer/action grants. Reports remain posture
projections rather than a second execution authorization engine.

The shared blueprint evaluator now honors its already-declared CustomerScope
count, provider-origin and assignment-age constraints. Defaults are unchanged;
explicit nondefault policies can yield stricter results on subsequent evaluations.

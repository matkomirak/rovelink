# Pre-flight GATE Decision API

Status: first public-alpha foundation. Rovelink is the governance-first pre-flight
decision layer for infrastructure automation. This API is advisory evidence and
does not launch automation or replace the existing execution-time GATE.

## Contract and scope

`POST /api/v1/gate/evaluate` uses existing authenticated HttpOnly cookie sessions
and server-resolved organization context. No caller-supplied requester or org is
trusted. Machine authentication and AWX/RHAAP/webhook adapters are future work.

```json
{
  "target": { "sourceType": "cmdb", "sourceId": "local-cmdb-id", "objectType": "netbox_vm", "objectId": "local-vm-id" },
  "automation": { "templateId": "local-template-id", "adapter": "local" },
  "freshness": { "maxGovernanceAgeSeconds": 3600 }
}
```

Only cached NetBox VM local IDs from an organization-owned CMDB are supported.
External IDs, provider targets and arbitrary context are deliberately deferred.
Requests are strict runtime-validated; unsupported identities fail conservatively.
Template IDs are optional but, when supplied, must belong to the organization.
No refresh, governance evaluation, inventory generation, launch or writeback occurs.

Responses contain a server-generated correlation ID, timestamp, decision, stable
reason codes, and explicitly selected evidence fields. Evidence includes target
identity, governance run/blueprint IDs, readiness and evaluation timestamp when
available. Raw findings, custom fields, credentials and provider payloads are not
returned. Missing/foreign targets use identical unknown responses. Missing or
foreign templates also have identical behavior.

Known negative governance or missing connection signals return `block`; absent,
stale, inconsistent or unproven execution evidence returns `unknown`. This first
version **never returns allow**, even for governance-ready targets. There is no
adapter authorization, fresh credential verification or atomic launch coupling.
`pending` is reserved for future approvals. Unsupported adapter/freshness policies
are not silently accepted. Successful HTTP evaluation does not authorize a run.

## Future authorization

An allow decision needs current target/customer assignment, approved action and
adapter, scoped credential access, freshness checks and controlled launch paths.
Require latest assignment and critical drift checks only after their semantics
are implemented; drift is analysis-only today. Reevaluate immediately before
launch and bind authorization to immutable evidence, action, requester, adapter,
target, policy version and expiry. See [snapshots](execution-decision-snapshots.md)
and [enforcement boundary](enforcement-boundary.md). Consumers must fail closed
on unknown, pending, transport errors and expired evidence.

# Worker and queue architecture

Status: design only. Today API-triggered operations and the MVP sync worker run
inside application processes; execution is not a durable distributed queue.
Long-running work must outlive HTTP requests and API restarts without losing
tenant ownership, progress, cancellation or authorization evidence.

## First production-hardening step

Start with a PostgreSQL-backed job table and a separate worker process. Postgres
is already required and keeps deployment complexity low. Claim jobs using short
transactions and `FOR UPDATE SKIP LOCKED`; never hold a DB lock while executing.
Use leased ownership, worker heartbeats and an outbox for transactional enqueue.

| Option | Benefits | Costs |
| --- | --- | --- |
| PostgreSQL queue | Transactional job/decision/run linkage; no new service | Implement leases, retry, retention, contention monitoring |
| BullMQ/Redis | Mature delay/retry/progress primitives | Additional Redis durability/operations; DB/outbox consistency still needed |
| External orchestrator | Mature enterprise execution isolation and job lifecycle | Adapter/auth integration; external IDs and evidence reconciliation |

Workers should handle CMDB refresh/import, provider sync, drift comparison,
governance evaluation, Git sync, local Ansible, and future AWX/RHAAP launch/polling.
Keep read APIs fast; submission returns a job ID rather than waiting for completion.

## Lifecycle

States: `queued`, `running`, `succeeded`, `failed`, `cancelled`, `timed_out`.
Each job carries server-derived org/requester IDs, bounded validated input,
idempotency key, attempts, next-attempt time, lease owner/expiry, heartbeat,
deadline, progress and links to existing automation/evaluation/drift runs.
All claims, updates and reads preserve org boundaries; revalidate object ownership
and authorization at execution time. Never serialize credentials into job bodies.
Resolve scoped credentials at dispatch and clean up temporary material afterward.

Use exponential retry with jitter and capped attempts for transient read failures.
Do not blindly retry irreversible launches/import writes: query external job IDs
or reconcile idempotency first. Dead-letter terminal failures for inspection.
Renew heartbeats on a bounded interval; expired leases permit recovery only when
the side effect can be reconciled. At-least-once processing is not exactly-once.

Cancellation is cooperative and authenticated; persist a request, interrupt the
owned subprocess/process group or external job, and record confirmed completion.
Set job-type deadlines, escalation from termination to forced process-tree cleanup,
and explicit orphan handling. Do not claim cancellation while remote work continues.

Publish org-scoped progress events via existing WebSockets or polling; sanitize
logs, bound artifact size, restrict downloads and define retention. A job's status
links to, but does not replace, domain run records. Persist execution decisions
before launch and reevaluate expired/stale decisions after queue delay.

Horizontal workers use leases and per-source concurrency limits. Monitor backlog,
lease expiry, failures and execution capacity; isolate privileged runner workers
from API/read workers. Local development can use one worker with inline submission
for simple demos, but expose the same lifecycle and label its durability limits.
Roll out durable read/sync jobs first, then writes and controlled execution after
recovery, cancellation and authorization tests.

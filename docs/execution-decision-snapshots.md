# Execution decision snapshots

Status: design only for the new pre-flight API; no new table or persistence is
implemented. Existing local automation runs already persist a per-host
`gateSnapshot` during inventory preparation. That is not an immutable,
cross-adapter authorization record and does not eliminate TOCTOU.

## Proposed record

An append-only organization-scoped `execution_decision_snapshots` table should
contain: snapshot ID, correlation/request ID, authenticated requester ID/type,
action/template ID, target source/type/local ID, adapter, decision
(`allow/block/pending/unknown`), stable reason codes, governance run and blueprint
version IDs, customer assignment IDs, readiness/drift evidence if actually used,
source and governance timestamps, policy version, decision time and expiry.
Store only an allowlisted immutable evidence JSON projection; never credentials,
raw provider/custom-field payloads, tokens or arbitrary caller context.

Link launch attempts via a separate append-only event table recording launched,
rejected, failed or expired status and automation-run/external-job ID. Do not
rewrite the original decision to claim it authorized a later action. Restrict
database UPDATE/DELETE permissions, audit administrative access, define retention,
and perform list/detail reads with organization predicates and safe projections.
The first API remains read-only until schema deployment and retention are agreed.

## Freshness and TOCTOU

A snapshot establishes which evidence was used at decision time, not what is
true forever. Compare current policy and evidence versions before dispatch;
reevaluate stale evidence, expired decisions or changed targets. Use a short TTL,
single-use launch binding and idempotency key scoped to org/requester/action.
Persist decision and launch intent transactionally, then use an outbox/worker
handoff. External adapters must verify the same target/action/expiry and report
their actual job ID. Handle retries without reusing stale authorization.

Target infrastructure can still change after evaluation. Atomic authorization
inside Rovelink cannot lock external infrastructure: minimize the interval,
recheck at controlled adapters and retain actual execution evidence. This reduces
ambiguity and supports audit, but does not guarantee prevention of all races.
See [worker architecture](worker-queue-architecture.md).

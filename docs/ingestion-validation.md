# Runtime ingestion validation

Public-alpha validation operates on normalized internal forms with Zod, not on
complete vendor schemas. NetBox cached refresh and import validate positive
integer IDs, source IDs, names, optional IP/CIDR, tags and custom-field shape.
Invalid normalized records are skipped; valid siblings still import. The legacy
import route now requires an organization-owned source; source-less global imports
are rejected. NetBox storage validates again before writes. Tenant IDs must be
positive numeric NetBox identities and names must be bounded, printable strings.
Existing CustomerScope assignment assertions remain authoritative.

Fake/Azure/Proxmox normalized provider sync validates object identity, provider
type, object type, metadata shape and primary IP fields before upsert; storage
checks the normalized schema again. Candidate source/confidence enums and stable
object references are checked before writing. Generic live normalized discovery
is not implemented; it is not claimed as validated coverage. Existing collectors
and normalizers keep their provider-specific conversions.

Secret-shaped values are redacted in bounded metadata projections before provider
and NetBox persistence. Recognizable token/private-key strings are redacted;
never deliberately ingest credentials into descriptive fields. Provider errors
and skips use fixed messages without raw normalization payloads. Existing storage
sanitizers remain in place. Drift IP normalization excludes malformed addresses.

NetBox responses expose records fetched/accepted/skipped and validation-error
counts. Provider responses expose normalized objects fetched/accepted/skipped and
validation errors; object counts differ from collector envelopes, especially Azure
batch discovery. Skips/errors from vendor normalization remain separate. Partial
storage failures do not imply that all accepted objects were persisted.

Remaining work: full normalized drift record schemas, relationship schemas,
legacy provider-sync ingestion parity, stricter external container validation,
and persisted quarantine/replay. Historical invalid records are not automatically
rewritten. The alpha does not claim full vendor schema coverage or production
ingestion hardening. Validate before expanding provider adapters.

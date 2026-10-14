# Command execution hardening review

The reviewed server process paths are `local-runner.ts` and `git-project-sync.ts`.
Both use `spawn` with argument arrays and `shell: false`; no server
`child_process.exec` or shell-enabled process path was found. SSH is delegated to
trusted Ansible using per-run keys, not an interpolated shell command. AWX uses
HTTP. This review is scoped to repository code, not arbitrary checked-out playbooks.

## Controls and changes

- Existing playbook resolver rejects absolute/traversal/non-YAML paths and resolves
  real paths to prevent symlink escapes. It now rejects shell metacharacters and
  control characters as well. Trusted Git synchronization already validates public
  HTTPS URLs, host allowlists, refs and checkout paths; existing tests cover them.
- Local runner arguments are built as arrays. Path flag injection, unsafe limit
  syntax, oversized/deep extra vars and prototype keys are rejected. `ansible_`
  and `rovelink_` extra-var overrides are prohibited, including nested values, to
  keep connection and GATE context under server control. Caller-supplied Jinja
  expressions are rejected to prevent controller-side lookup execution.
- Generated inventory IDs and connection usernames are constrained. IP/DNS
  addresses are validated, invalid targets blocked, YAML connection strings
  quoted using JSON encoding, and duplicate sanitized host aliases are blocked.
- Runner environment uses an operational allowlist rather than inheriting app
  database/session/encryption secrets or caller-controlled Ansible variables.
  Git uses the same operational allowlist, HTTPS-only transport, disabled prompts
  and disabled global/system Git config for public repository synchronization.
- Runner output is buffered by line, bounded, and sanitized before streaming and
  persistence; token patterns, JSON passwords and multiline private keys are
  redacted. Process-start errors use safe messages. Secret values must still use
  Ansible `no_log`; arbitrary playbooks can print sensitive values in forms that
  pattern redaction cannot recognize. Do not pass secrets in generic extra vars.
- Templates, projects and credentials use organization-aware storage lookups.
  Legacy AWX settings remain global and the connector remains outside the verified
  enterprise-enforcement pilot; tenant-specific adapter configuration is future work.

## Remaining alpha risks

Trusted playbooks are executable code, can use modules/lookups/delegation and can
reach anything permitted to the runner host. Argument validation is not a sandbox.
Localhost detection is a lightweight heuristic, not security containment. A project
can change between resolution and launch; pinned checkout/workspaces and decision
snapshots are planned. Process timeout currently terminates the direct child;
durable cancellation and process-tree/orphan recovery remain worker work. Output
redaction is best effort, not a guarantee for arbitrary application secrets.
Environment hardening may require explicit operational configuration for custom
Ansible setups. See [enforcement boundary](enforcement-boundary.md) and
[worker plan](worker-queue-architecture.md).

The decision-only pre-flight verifier also uses fixed argument arrays and
`shell: false` for local Ansible version inspection and SSH known-host lookup.
It suppresses probe output, passes the operational environment allowlist, validates
the address/port, applies a five-second timeout, and never contacts a target or
launches a playbook. Credential parsing is in-memory only.

# Enforcement boundary

Rovelink is an application-layer governance decision and execution-control layer.
Rovelink enforces governance and readiness checks for automation workflows routed
through Rovelink or its integrated execution adapters. It does not replace IAM,
PAM, network-level security, or organizational change management. If users retain
direct SSH or administrative access to infrastructure, they can bypass any
application-layer gate.

The current local execution path evaluates cached target policy during inventory
preparation. Reports and the first pre-flight API are conservative evidence, not
execution permission. The existing AWX connector is an MVP launch/polling path;
it does not establish target-bound enterprise enforcement or verify all external
inventory changes. Future AWX/RHAAP/webhook adapters must bind decisions to their
actual targets and recheck freshness before launch.

## Operating modes

1. **Advisory Mode:** reports and pre-flight evidence; no external enforcement.
2. **Controlled Execution Mode:** workflows routed through controlled Rovelink
   execution paths; GATE can block launches/targets where those paths apply its
   checks. Validate the actual adapter and target binding before relying on it.
3. **Enterprise Enforcement Mode:** a future deployment model in which the
   organization restricts bypass paths and Rovelink forms part of broader
   enforcement. This is not a public-alpha certification or default behavior.

Robust enforcement requires restricted direct infrastructure access, controlled
runner credentials, PAM/Vault/secret management, audited break-glass access and
appropriate IAM/network restrictions. Direct SSH, AWX, Terraform, provider-console
and manual changes remain possible unless restricted outside Rovelink. Audit
exceptions and monitor changes rather than assuming reports prevent them.

Built-in Ansible is intended for local demos, short tests, migrations, and small
controlled environments. It runs trusted playbooks with the runner host's access;
it is not an enterprise sandbox. For enterprise execution, the planned strategy
is pre-flight decisions in front of controlled AWX/RHAAP adapters, with snapshots,
credential controls and durable workers.

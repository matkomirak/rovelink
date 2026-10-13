# Security Policy

Rovelink v0.1.0-alpha is an early alpha and is not production-ready.
Use isolated environments and synthetic data. Security fixes are made on current
main; alpha APIs and schemas may change, and response times are not guaranteed.

## Supported Versions

| Version | Security fixes |
|---|---|
| Current main / v0.1.0-alpha | Best-effort investigation and fixes on main. |
| Older snapshots and releases | No maintained security backport commitment. |

## Report a Vulnerability Privately

Do not report sensitive vulnerabilities in public issues, discussions, or pull
requests. Use GitHub's **Security > Report a vulnerability** on this repository
when private vulnerability reporting is enabled. This sends a private report to
the maintainers.

**Maintainer setup required for public release:** establish and verify a private
reporting channel during the manual launch transition. GitHub documents private
vulnerability reporting for public repositories; while this repo is private,
the control may not be available. If so, add a monitored private contact before
changing visibility, then enable/verify GitHub reporting after the transition
and before announcing the alpha. This policy does not claim that either channel
has been verified. Do not post sensitive details publicly while waiting.
No security email is currently published.

See [GitHub's configuration instructions](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository)
and the [manual launch checklist](docs/public-alpha-checklist.md).

Include the affected commit/version, affected area, impact, and minimal steps
to reproduce with synthetic data. Describe any proposed mitigation.
Do not include real passwords, API keys, tokens, SSH private keys, customer data,
provider configuration, or unredacted logs. Remove identifiers and secrets from
screenshots and sample payloads.

Maintain confidentiality while investigation and coordinated disclosure are in
progress. If a real credential was exposed, revoke or rotate it through its
issuing system; removing it from a report or Git does not revoke it.

## Security-Sensitive Areas

- Provider credentials, API keys, CMDB tokens, and SSH credentials.
- Encrypted credential storage and encryption-key handling.
- HttpOnly authentication cookies and organization/source isolation.
- Automation GATE checks, inventory enforcement, and playbook execution.
- Drift metadata, raw inventory payloads, and logs that may contain sensitive
  identifiers or credential-shaped fields.

Use dedicated test accounts and targets. Do not test against systems you do not
control or have permission to assess. Default local Compose settings are for
isolated demos and must not be exposed as a production service.

# Public Sanitization Audit

Task 17D reviewed the current tracked text/assets and reachable Git history
before public v0.1.0-alpha publication. This is a manual review, not a guarantee
that the repository or every historical binary is free of sensitive data.

## Scan Scope and Results

- Searched credential terms, private-key markers, provider/tenant/subscription
  fields, company references, URLs, emails, and public-readiness claims.
- Pattern scans examined tracked text and added/removed diff lines across all
  486 commits reachable from local refs at the start of the audit.
- No confirmed live token, password, private key, personal contact email,
  non-placeholder full Azure ID, Spirit/21 reference, or Matrix42 reference was
  found in those text scans.
- Private-key markers in credential UI and tests are placeholders or synthetic
  invalid test material. Secret-shaped fixture values test redaction.
  The fake Azure subscription ID is an all-zero synthetic identifier.
- Gitleaks and TruffleHog were not installed/on PATH. Dedicated automated secret
  scanning was unavailable; manual patterns do not replace it.
- Reviewed tracked screenshots and branding images. Two screenshots contained
  environment data: a LAN browser address, and an Azure subscription-ID fragment
  beside VM/IP data. No readable credential was confirmed in those screenshots.

## Current-Tree Sanitization

- Removed the two environment screenshots and unused obsolete-brand artwork/
  screenshot. The application does not reference these removed assets.
- Anonymized old branding in archived briefs and labeled the directory archival.
- Ignored private environment files, bootstrap credentials, runtime directories,
  logs, local DB artifacts, and private-key files; excluded them from Docker context.
- Restricted app/NetBox demo port publishing to host loopback.
- Replaced obsolete production/default-login guidance and retired the legacy
  installer, preserving its tracked executable mode.
- Labeled historical hardening claims as snapshots and clarified synthetic demo
  names, implemented provider support, and analysis-only drift boundaries.

## History and Release Blockers

Current-tree removal does not erase earlier copies. The environment screenshots
remain in history, including commits `6995d03` and `3419fe6`.
These are identifier/privacy findings, not confirmed leaked credentials.
Do not declare all history safe or make the repository public until the maintainer
reviews this exposure and decides whether it must be removed from published refs.

If these details must stay private, a reviewed history cleanup or a sanitized
publication history is needed. No history rewrite, force push, or publication
was performed by this task. Inspect every ref intended for publication,
including backup branches, and historical binaries. A normal deletion commit
does not sanitize those refs.

Run a dedicated full-history scanner before publication. If it finds a real
secret, revoke/rotate it, block release, and plan removal from all published
history. Also verify the private security-reporting channel and complete the
fresh-database demo smoke test in the public alpha checklist.

## Maintainer Review Update

The maintainer accepted the historical screenshot identifier exposure as
non-blocking for v0.1.0-alpha, identifying the Azure screenshot as a test account.
No history rewrite or historical screenshot removal is requested. The maintainer
also approved publication of the Rovelink logos/artwork and their derivatives.
Legacy product branding in the current tree was cleaned in commit `02d5f52`;
remaining bridge terminology is technical or compatibility-related.

The isolated database demo and browser flow were subsequently completed; see
the [verification record](alpha-readiness-verification.md) for results and limits.
The maintainer also accepted the completed manual full-history scan as sufficient
for this alpha, with automated scanning deferred as non-blocking. Private GitHub
vulnerability reporting must still be enabled and verified before publication.
These decisions do not constitute a guarantee that every historical blob is safe.

## Original Task 17D Validation

Typecheck, all 500 default tests, build, and production dependency audit passed
after this cleanup; the audit reported zero vulnerabilities. Build retained the
existing PostCSS warning. Documentation links and ignore rules were checked.
Both Compose files passed configuration parsing; containers were not rebuilt
or smoke-tested with the new loopback bindings. The retired Ubuntu script passed
Bash syntax validation and exited with its intended retirement notice without
performing setup.

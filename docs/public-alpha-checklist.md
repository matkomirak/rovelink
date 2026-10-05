# Public Alpha Checklist

Maintainer release gate for v0.1.0-alpha. Updated after the isolated demo recheck;
see the [verification record](alpha-readiness-verification.md).

- [x] Confirm LICENSE matches README (MIT); maintainer approved Rovelink artwork.
  Contributors remain responsible for permissions on any future contributions.
- [ ] Before public visibility, enable and verify GitHub private vulnerability
  reporting, or add a monitored
  private contact in SECURITY.md.
- [x] Harden ignore rules for private env files, bootstrap credentials, runtime
  state, logs, and local databases; inspect staged files.
- [x] Review tracked screenshots and archived assets for internal data.
  Check historical copies too; deleting a current file does not erase history.
  Maintainer accepted historical screenshot exposure as non-blocking.
- [x] Complete manual full-history scanning; no confirmed real secret found.
  Maintainer accepted this fallback for alpha. Gitleaks/TruffleHog scanning is
  deferred, not completed. Investigate future findings and rotate exposed secrets.
- [x] Restrict local demo port exposure and confirm defaults cannot be mistaken
  for production configuration.
- [x] Run the validation commands below: check/build passed, 500 tests passed,
  production audit reported zero vulnerabilities.
- [x] Run the README demo on a fresh disposable database: login, seed, fake cached
  sync, CMDB/CustomerScopes, governance, and Drift Reports.
- [x] Confirm drift stays analysis-only and provider customer candidates remain hints.
- [x] Document alpha limitations, including retained CustomerScope assignment
  overlap in summaries; no pruning or lifecycle fix is included in this release.
- [ ] In a separately authorized task, create/push the v0.1.0-alpha tag after
  validation and accepted release checks. Publish with limitations only after
  the private reporting channel is verified. Do not tag a failing revision.

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run build
npm.cmd audit --omit=dev
```

Use `npm` on Linux/macOS. Keep generated logs, scanner reports containing secrets,
and runtime artifacts out of Git.

# Public Alpha Checklist

Maintainer release gate for v0.1.0-alpha:

- [ ] Confirm LICENSE attribution and contributor/asset rights.
- [ ] Enable and verify GitHub private vulnerability reporting, or add a monitored
  private contact in SECURITY.md.
- [ ] Harden ignore rules for private env files, bootstrap credentials, runtime
  state, logs, and local databases; inspect staged files.
- [ ] Review tracked screenshots and archived assets for internal data.
  Check historical copies too; deleting a current file does not erase history.
- [ ] Run a full-history secret scanner such as Gitleaks or TruffleHog against
  all refs intended for publication, and investigate results. Rotate any exposed
  credentials. Review binaries separately.
- [ ] Restrict local demo port exposure and confirm defaults cannot be mistaken
  for production configuration.
- [ ] Run the validation commands below.
- [ ] Run the README demo on a fresh disposable database: login, seed, fake cached
  sync, CMDB/CustomerScopes, governance, and Drift Reports.
- [ ] Confirm drift stays analysis-only and provider customer candidates remain hints.
- [ ] Reconcile older setup/support docs and publish known alpha limitations.
- [ ] After these checks pass, explicitly create/push the v0.1.0-alpha tag and
  publish release notes with limitations. Do not tag a failing revision.

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run build
npm.cmd audit --omit=dev
```

Use `npm` on Linux/macOS. Keep generated logs, scanner reports containing secrets,
and runtime artifacts out of Git.

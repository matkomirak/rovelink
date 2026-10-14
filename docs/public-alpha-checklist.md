# Public-alpha launch checklist

Updated 2026-10-13. Code/docs preparation does not change repository visibility,
create a tag/release, publish a website, record video, announce, or push commits.
See [the fresh-demo evidence](alpha-launch-verification.md).

## Candidate checks

- [x] Review Git status/history: report and sidebar commits were already pushed;
  the starting tree was clean and main matched origin/main.
- [x] Review README, concepts, NetBox customer model and exact demo commands.
- [x] Distinguish Governance Ready, Automation Eligible and Execution Allowed;
  explain conservative Unknown and Ready = 0 in Automation Readiness.
- [x] Keep Reports dashboards together, Drift separate, and Automation Runs under Automation.
- [x] Verify a clean tracked-source snapshot with a new Compose project/volumes:
  generated local secrets, empty NetBox, logins, offline provider inventory,
  explicit import, CMDB/customer assignments, governance redirect, reports and drift.
- [x] Verify manual Tenant remove/restore and primary IPv4 edit after refresh/reruns.
- [x] Preserve existing developer/demo volumes; execute no playbooks/remediation.
- [x] Inspect current tracked text for secret-shaped values, private artifacts and
  branding. Findings were UI placeholders/tests and compatibility names only.
- [x] Preserve the maintainer's prior acceptance of historical screenshots/manual
  history scanning. Automated full-history scanners remain deferred; this task
  did not repeat or replace that review or guarantee secret-free history.
- [x] Prepare a [two-minute script](demo-video-script.md) and [website copy](website-copy.md).
- [x] Run typecheck, 546 tests, build and production audit (zero vulnerabilities).
- [x] Check local Markdown destinations/anchors; inspect staged scope before commits.

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run build
npm.cmd audit --omit=dev
git status
git log --oneline -12
```

Use `npm` on Linux/macOS. Rerun these against the exact release candidate if it
changes. Never commit validation logs, resolved Compose config, .env files,
bootstrap credentials, local data or screenshots containing credentials.

## Maintainer launch actions still pending

- [ ] Approve and push the local launch-polish commits in a separately authorized step.
- [ ] Establish a monitored private security-reporting channel. No security email
  is currently published. GitHub documents private vulnerability reporting for
  public repositories; if unavailable while private, add a monitored private
  contact before changing visibility. Do not invent a contact or advertise an
  unverified channel.
- [ ] Record the two-minute video from the prepared synthetic demo, review every
  frame for secrets, publish it, and replace the README/website placeholder with
  a real link. A script is not a completed video.
- [ ] Update the actual website with reviewed copy and working demo/repository/video CTAs.
- [ ] Review visibility consequences and retained Actions logs/artifacts in GitHub.
  Historical screenshot exposure was previously accepted; investigate only new
  evidence rather than implying that acceptance removed history.
- [ ] Manually change the correct repository's visibility when all preconditions
  are satisfied: **Settings > Danger Zone > Change visibility**, review the
  confirmation and consequences, then select public. This task does not perform it.
- [ ] After the visibility transition, enable **Settings > Advanced Security >
  Private vulnerability reporting** as available and verify **Security > Advisories >
  Report a vulnerability** from a non-maintainer view. Verify notification delivery
  without submitting real secrets. Complete this before any announcement.
- [ ] Decide whether to retain the existing `v0.1.0-alpha` tag or create a new
  `v0.1.1-alpha` tag/release through a separately authorized operation. Recommend
  v0.1.1-alpha for the additive demo/reporting/launch milestone; no tag is created here.
- [ ] Check anonymous repository/docs/video access, license/security links and
  demo commands at the chosen commit; state public alpha, local-only demo and no warranty.
- [ ] Prepare announcements with the working URLs, exact alpha revision and known
  limitations. Explicit authorization is needed to send or publish them.

GitHub's current instructions: [visibility](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility)
and [private reporting](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository).
The private-reporting availability caveat is why security setup belongs to the
manual transition rather than a falsely completed code checklist.

## Recommendation

The candidate is ready for final maintainer launch actions after validation.
Publish **after the reviewed video and private-reporting setup**, not as a
production release. Live integrations and actual automation execution were not
part of the offline smoke test; unknown execution signals, retained deleted
reference VMs, heuristic matching and limited IPv6/power-state comparison remain.

## Decision layer and execution boundary

- [ ] Review controlled access and bypass paths against the enforcement boundary.
- [ ] Validate pre-flight evidence without interpreting unknown as authorization.
- [ ] Require immutable decision/launch linkage and tenant-specific credentials
  before claiming enterprise adapter enforcement.
- [ ] Validate command inputs and ingestion summaries before extending adapters.
- [ ] Implement leased durable workers and crash recovery before scaling execution.

Rovelink is the governance-first pre-flight decision layer for infrastructure
automation. Built-in Ansible is intended for local demos, short tests, migrations,
and lightweight controlled environments. It remains available, but is not the
recommended enterprise-scale execution architecture. The enterprise direction is
controlled external AWX/RHAAP/webhook adapters with decision snapshots, scoped
credentials and durable workers; the existing AWX connector is MVP-level.

Checks apply to routed workflows. Direct SSH, provider-console, Terraform and
manual administrative access can bypass an application-layer gate. See the
[enforcement boundary](enforcement-boundary.md) for IAM/PAM, network controls and audited break-glass
requirements. Reports and pre-flight evidence do not grant execution permission.

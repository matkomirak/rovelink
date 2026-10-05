# Alpha Smoke Test

Run on a fresh disposable local database with synthetic data. Follow the
[demo quickstart](demo-quickstart.md). Record revision, date, environment, result
and any blocker privately; do not commit credentials, logs, or runtime state.
Unchecked means not tested, not passed.

## Validation Matrix

| Check | Command or manual procedure | Pass condition |
|---|---|---|
| Typecheck | `npm.cmd run check` | Exit 0 |
| Default tests | `npm.cmd test` | Exit 0, no failures |
| Build | `npm.cmd run build` | Exit 0 |
| Production dependencies | `npm.cmd audit --omit=dev` | Exit 0, zero vulnerabilities |
| Docker, if used | `docker compose ps` | App running; DB healthy; login reachable |
| Browser demo | Checklist below | Supported flow works, boundaries visible |
| Secret scan | Installed Gitleaks/TruffleHog, all publication refs, plus binary review | Investigate every hit; no unresolved sensitive exposure |
| Public docs | Follow quickstart on fresh setup; inspect links/commands/claims | No invented steps, secrets, or production overclaims |

Use `npm` on Linux/macOS. Commands run from the repo root. Default tests do not
replace database integration/browser checks. If a scanner is unavailable, record
that limitation; manual searches are not full-history clearance. Review the
[sanitization audit](public-sanitization-audit.md) and
[public alpha checklist](public-alpha-checklist.md) before publication.

## Browser Checklist

- [ ] Login and Dashboard load in the selected demo organization.
- [ ] Fake provider cached sync succeeds; repeat sync does not duplicate objects.
- [ ] Object type cards, search/filter, and detail sheet work.
- [ ] Provider candidates are hints; no credentials/config appear in detail.
- [ ] Existing live/generated preview remains separate from cached inventory.
- [ ] CMDB cached VM list and detail work; Customer Assignment is visible.
- [ ] CustomerScopes, governance summaries, and not-evaluated state appear.
- [ ] Unassigned is an attention state, never mislabeled Internal.
- [ ] Seeded evaluations are identifiable as fixtures; a live cached evaluation
  is checked separately if a suitable version is explicitly activated.
- [ ] Policy save creates an inactive version; only explicit activation changes
  the active policy. Default visibility-only has no score/readiness/GATE impact.
- [ ] Drift Run button requires both sources; comparison creates a completed run.
- [ ] Run counts and item table/filter/detail work, including unmatched outcomes.
- [ ] Analysis-only/no-writeback/no-Governance-readiness/no-GATE copy is visible.
- [ ] No remediation, auto-fix, or provider/CMDB update control is offered in drift.
- [ ] Automation Inventories, Templates, and Runs load (empty lists are valid).
- [ ] Account menu opens, Settings loads, logout returns to `/login`.

Do not perform real automation or change enforcement settings just to complete
this checklist. Report a failed run or browser exception with sanitized context;
do not hide it by treating fixture data as a successful live evaluation.

## Result Template

```text
Revision/date:
OS/Node/browser and host or Docker:
Fresh disposable DB and chosen demo org/source:
check/test/build/audit:
Browser checklist: passed / failed / not run
Secret scanner/history/binary review: passed / unresolved / unavailable
Docs check:
Blockers and follow-up:
```

No automated browser smoke script is provided in this slice. Completing this
checklist demonstrates a local alpha demo, not production readiness.

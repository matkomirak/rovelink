# Final public-alpha launch verification

Date: **2026-10-13**. Starting revision: `52b5782`, synchronized with origin/main.
Final UI-copy candidate: `ad11c9e`; backend/evaluation/execution logic was unchanged.
The two recent report/navigation commits were already pushed. No visibility,
tag/release, website publication, announcement, video recording or push was done.

## Clean demo method

A `git archive HEAD` snapshot was extracted into a new temporary directory,
without private files or runtime data. The documented `npm.cmd run demo:setup`
generated a fresh private `.env.demo`. Only its ports were changed to 5200/8200;
Compose used project `rovelink-alpha-final`, its own fresh databases/network/volumes,
and the same `docker-compose.demo.yml`. Existing local demos were preserved.
Browser verification used `127.0.0.1` to avoid replacing the existing localhost
app's auth cookie. Candidate UI-copy changes were subsequently built and checked
with the same demo data; they change no evaluation or execution behavior.

Documented commands exercised, with the alternate project/env file selection:

```powershell
npm.cmd run demo:setup
docker compose --env-file .env.demo -f docker-compose.demo.yml config --quiet
docker compose --env-file .env.demo -f docker-compose.demo.yml up -d --build
docker compose --env-file .env.demo -f docker-compose.demo.yml exec -e ROVELINK_DEMO_DATA=true app npm run db:seed:demo-providers
docker compose --env-file .env.demo -f docker-compose.demo.yml exec -e ROVELINK_DEMO_DATA=true app npm run demo:import:proxmox
```

The selected import then used the saved local CMDB ID and exact names
`alpha-web-001,gamma-app-002`, as shown in [quickstart](demo-quickstart.md).
No real provider credentials were used. The manual local NetBox token was
short-lived, kept out of output/docs/screenshots, and needed write permission
only for the explicit import and synthetic reference edits.

## Results

| Step | Result |
| --- | --- |
| Fresh services and logins | Rovelink/Postgres, NetBox/Postgres, Redis/cache and worker healthy; admin and demo-admin logins passed. |
| Empty reference source | Fresh NetBox had zero VMs; manual token, `http://netbox:8080` connection test and confirmed CMDB refresh passed with zero imports. |
| Offline runtime discovery | Demo Proxmox: 4 VMs; Demo Azure: 14 objects; Demo Generic/Fake: 4 VMs. Aggregate cache counts independently verified. |
| Empty-reference drift | Each provider comparison completed with 0 matches and 4 unmatched_provider items. Azure non-VM networks were not VM drift targets. |
| Explicit import | Dry-run listed four offline names without writes; selected import created two NetBox VMs. |
| Customer assignments | Confirmed refresh imported 2 VMs and 2 assignments. ACME GmbH CustomerScope and Derived from: NetBox Tenant appeared. |
| Governance | Standard source-bound blueprint evaluated both. Valid assignments produced no missing-customer finding. Success closed the modal and redirected to the newly created evaluation run. |
| Mixed readiness | Manually assigned demo-web VM role and automatable/provider_state/technical_owner/service_owner custom fields to alpha-web-001. After refresh/evaluation it was Ready, score 100; the other VM remained Needs attention. Report: 2 evaluated, 1 Ready, 1 Needs attention, average 74/100. |
| Inventory/report boundary | Explicit linked inventory included one target. Automation Readiness showed 1 target, 0 Ready, 0 Needs attention, 1 Unknown; address and stored governance readiness were present without claiming Execution Allowed. |
| Manual customer change | Removing alpha-web-001's NetBox Tenant, refreshing and evaluating emitted Customer assignment is required but missing. Restoring Tenant and rerunning cleared it and restored readiness. |
| Manual IP change | Changed its primary IPv4 from synthetic 10.60.239.15 to 10.60.239.99. Refresh/rerun showed reference .99 versus runtime .15 in VM_IP_MISMATCH. Two VMs matched, two remained unmatched_provider. |
| Boundaries | Drift details showed read-only/no writeback/no Governance or GATE changes. No automation run or remediation was executed; isolated runner remained disabled. |

## Scan and validation

- Current tracked-tree scan: no obvious live credential found. Only `.env.example`
  and `.env.netbox.example` are tracked; no private env/runtime/log/database paths.
- Key markers were an input placeholder and synthetic test fixtures; the long
  encryption value was a deterministic test key. Known normal-stack demo defaults
  are clearly local-only. Private generated values remain in ignored/temp configuration.
- Bridge-Default/Bridge are legacy NetBox cluster/type compatibility identities;
  `bridge-ui-theme` is a theme-storage compatibility key. Historical audit notes
  are retained as history, not current product branding. No new branding was added.
- Historical screenshots/manual history-scan acceptance remains unchanged;
  no new full-history or automated scanner guarantee is made.
- Typecheck, **546 tests**, build and production audit passed; zero production
  vulnerabilities. Existing PostCSS warning remains non-fatal.
- Local Markdown paths/anchors and final report/navigation destinations were checked.

## Limits and manual launch gates

This proves offline demo mechanics, not live Azure/Proxmox behavior, actual
playbook execution or production security. The importer preserves existing named
VMs and may leave partial objects on failure. CMDB refresh does not purge upstream
deletions. Runtime IPv6 can cause baseline IP drift; cached reference power state
is limited. Reports need explicit refreshes/reruns, and Ready = 0/Unknown in
Automation Readiness is intentional when execution signals cannot be proven.

The reviewed video, website update, private reporting channel, visibility change,
release/tag decision and announcement remain maintainer actions in
[the launch checklist](public-alpha-checklist.md). Recommend `v0.1.1-alpha` after
these additive demo/reporting improvements, without changing the tag in this task.

# Alpha Readiness Verification

Verification date: 2026-10-05. Release candidate: current main after the
Bridge-to-Rovelink branding cleanup. No release tag or visibility change was made.

## Isolated Database Demo

The disposable `rovelink-fresh-demo` Compose project created during Task 18D was
resumed and rechecked. It uses its own `rovelink-fresh-demo_pg_data` volume and
loopback app port 5001. Original developer app/database volumes were not reset,
seeded, or changed. This recheck reused the isolated demo data; it did not reset
that volume again.

The Docker image uses Node 20 and installs locked dependencies with
`npm ci --ignore-scripts`. Its entrypoint pushes the schema, bootstraps the admin,
and starts the app. App and Postgres health checks passed. The documented
operations were also rerun inside this isolated app container:

```text
npm run db:push
npm run db:seed
ROVELINK_DEMO_DATA=true npm run db:seed:demo-customer-scopes
```

The last line describes the container environment setting, not a Windows shell
command. Use the `docker compose exec -e` example in the demo quickstart.
Schema push passed. Bootstrap seed preserved the existing admin password.
CustomerScope seed completed with four fictional scopes, five assignment
scenarios, and three evaluation fixtures. Local NetBox reference records were
imported read-only; no new NetBox seed or provider writeback was run in this recheck.

## Browser Checks

- Login/logout and Dashboard passed.
- Providers and fake cached inventory sync passed: 20 cached VM objects.
- Inventory search/detail passed; local object IDs and hint-only candidates
  were shown, with the expected empty Relationships section.
- CMDB cached VM browsing, CustomerScopes, and seeded governance summaries loaded.
- Governance blueprint/run pages and all three evaluation fixtures loaded.
  These fixtures are not proof of a live evaluation or operational blocking.
- Drift selectors loaded; comparison was disabled until both sources were chosen.
- A new comparison completed with 120 items: 20 matched, 100 unmatched reference,
  7 drift, 13 no-drift, 107 warning, and 0 critical. Counts depend on demo data.
- Recent runs refreshed; drift filtering and item detail passed.
- Analysis-only/no writeback/no Governance readiness/no GATE impact copy appeared.
- Automation Inventories, Templates, Credentials, Projects, and Runs loaded.
  Fresh-demo empty lists are expected; no playbook execution was attempted.

## Known Demo and Reporting Limits

Retained older unassigned assignments can overlap newer dedicated assignments
in CustomerScope reporting after cache sync and demo seeding. Counts across
scope rows are not guaranteed to be mutually exclusive. This needs a separate
assignment-lifecycle/reporting fix; no pruning or policy changes were made here.
Inspect object assignments rather than treating these summary counts as an
authoritative customer partition.

Live Azure/Proxmox discovery, automation execution, and a persisted failed drift
run were not tested. The existing PostCSS build warning is non-fatal.

## Publication Decisions

LICENSE is MIT, consistent with README and package metadata. It was not changed.

The maintainer accepted historical screenshot identifiers as non-blocking and
approved publication of the Rovelink artwork/logo derivatives. Current committed
screenshots were reviewed; no new readable credentials were observed. No font
files are tracked. This is not a legal guarantee of every asset's provenance.

SECURITY.md uses GitHub private vulnerability reporting and publishes no
placeholder email. Its wording is acceptable; the maintainer must enable and
verify the reporting feature before making the repository public.

Manual history scanning found no confirmed real secret. Gitleaks/TruffleHog were
unavailable; the maintainer explicitly accepted the manual full-history scan as
sufficient for this alpha and deferred automated scanning as non-blocking.
This is risk acceptance, not a guarantee that all history is secret-free.

## Final Validation

- `npm.cmd run check`: passed.
- `npm.cmd test`: 500 tests passed, 0 failed.
- `npm.cmd run build`: passed; existing non-fatal PostCSS warning remains.
- `npm.cmd audit --omit=dev`: 0 vulnerabilities.

The reviewed alpha is ready for a separately authorized tagging task. GitHub
private vulnerability reporting still needs verification before public visibility.

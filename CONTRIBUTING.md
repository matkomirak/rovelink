# Contributing to Rovelink

Rovelink is a governance-first automation control plane for infrastructure and
MSP teams: govern first, automate second. v0.1.0-alpha is an early alpha, not a
production-ready release. APIs, schemas, and UI may change.

## Run Locally

Follow the [README quickstart](README.md#quickstart) for Docker or host development.
It covers dependency installation, private environment setup, schema push,
bootstrap seeding, and Windows-compatible startup commands.
Use [Local Development](LOCAL-DEVELOPMENT.md) for the disposable demo workflow.

Work from the repository root. Host development requires Node.js 20.19+, npm,
and a reachable Postgres database. Use `npm.cmd ci` on Windows or `npm ci`
on Linux/macOS. Host commands must load the private environment explicitly,
as shown in the README.

## Validate Changes

Run before opening a pull request:

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run build
npm.cmd audit --omit=dev
```

Use `npm` instead of `npm.cmd` on Linux/macOS. Add focused tests for changed
behavior, including org/source isolation and error handling where relevant.
For UI changes, manually check loading, empty, error, and normal states.
Report commands not run and remaining test gaps; the default test suite does
not replace fresh-database integration tests or browser smoke validation.

## Coding and Safety Expectations

- Follow existing TypeScript, React/Vite, Express, Drizzle/Postgres patterns.
  See [AGENTS.md](AGENTS.md) for repository instructions.
- Keep changes focused. Explain schema changes and compatibility implications;
  review schema pushes against a disposable database first.
- Preserve HttpOnly cookie authentication and organization isolation in routes,
  queries, mutations, background work, and integration paths.
- CustomerScope is a customer/environment boundary inside a source, not a
  replacement for Rovelink's organization security boundary.
- Never commit credentials, tokens, private keys, `.env`, `.local/`, bootstrap
  credentials, local databases, logs, runtime state, or generated caches.
  Inspect staged files even when ignore rules cover the expected artifacts.
- Use existing encrypted credential helpers and sanitize responses, metadata,
  and logs. Do not copy raw provider configuration into output or fixtures.
- Keep normalized provider inventory read-only toward external systems.
  New write operations require explicit design, review, and tests.
  Existing CMDB-writing pipelines are separate from inventory discovery.
- Provider CustomerScope candidates are hints only. Do not turn them into
  authoritative assignments or GATE inputs implicitly.
- Keep drift reporting analysis-only: no remediation, writeback, readiness
  change, or Automation GATE impact.
- Governance and GATE changes must be explicit and tested. Preserve activation
  semantics, default policy behavior, scoring/readiness boundaries, and
  inventory enforcement modes.
- Constrain filesystem paths through existing safe helpers. Execute commands
  with argument arrays, without shell interpolation of user-controlled values.

## Pull Requests

Open a focused PR describing the problem, resulting behavior, tests, and
material limitations. Include screenshots with synthetic data for visible UI
changes. Reference related issues and identify any migration or configuration
steps. Avoid unrelated refactors and dependency churn.

Use clear conventional commit messages such as `feat:`, `fix:`, or `docs:`.
For sensitive security findings, follow [SECURITY.md](SECURITY.md) instead of
opening a public issue.

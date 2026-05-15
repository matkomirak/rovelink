# Contributing to Rovelink

Thank you for considering a contribution to Rovelink. Please read the guidelines below before opening a pull request.

## Development Workflow

1. Fork the repository and create a branch from `main`.
2. Install dependencies: `npm install`.
3. Copy `.env.example` → `.env` and fill in the required values.
4. Apply the schema: `npm run db:push`.
5. Seed the database: `npm run db:seed`.
6. Start the dev server: `npm run dev`.

## Architecture Rules

### Non-negotiable constraints

These invariants exist for security and correctness. Breaking them will cause your PR to be rejected.

| Invariant | Rationale |
|---|---|
| **Provider sync writes to `external_objects` only.** Never write directly to any CMDB inside a provider sync. | Providers are governance-blind; only pipelines may write to CMDBs. |
| **Gate evaluation is mandatory.** Every inventory generation path must call `evaluateAllGates()` first and read from the gate store. | Skipping the gate is a security violation. |
| **Provider hints must not affect gate decisions.** `evaluateGate()` only accepts CMDB (NetBox) data. Passing `providerHintsUsed = true` throws. | Governance authority resides exclusively in the CMDB. |
| **All secrets are encrypted at rest.** Use `encryptSecret` / `decryptSecret` from `server/services/secrets.ts`. Never store plaintext tokens in the DB. | Protect customer credentials. |
| **Auth tokens are HttpOnly cookies.** Never use `localStorage` for JWT storage. | Prevent XSS-based token theft. |
| **Provider tags are namespaced** before writing to NetBox (e.g. `proxmox_customer/acme`). | Prevent tag collisions between providers and human-managed tags. |

### Adding a new provider

1. Create `server/services/providers/<name>.ts` implementing `IProviderCollector`.
2. Export a `create<Name>Collector(config: any)` factory function.
3. Register the factory in `server/services/providers/registry.ts`.
4. Add form fields in `client/src/pages/providers.tsx` behind a `selectedKind === "<name>"` guard.

### Adding a new CMDB adapter

1. Create `server/services/<name>-adapter.ts` with `test()`, `upsert()`, and `validate()` methods.
2. Add a `case "<kind>"` branch in `getCmdbAdapter()` in `server/routes/pipelines.ts`.
3. Wire it into the CMDB accounts UI in `client/src/pages/cmbds.tsx`.

### Schema changes

1. Edit `shared/schema.ts`.
2. Run `npm run db:push` to apply.
3. If adding a new table, export the insert schema, insert type, and select type at the bottom of the file.

## Code Style

- TypeScript strict mode is enforced — avoid `any` where possible.
- No `console.log` in production paths — use `console.error` / `console.warn` for unexpected conditions.
- React components live in `client/src/pages/` (pages) or `client/src/components/` (shared).
- All interactive HTML elements must have a `data-testid` attribute following the `{action}-{target}` pattern.

## Testing

There are no automated test files yet. When adding features, manually verify:

- The happy path works end to end.
- The error path shows a meaningful toast / error message.
- No secrets appear in API responses (check the Network tab).

## Commit Messages

Use conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`.

## Pull Requests

- Keep PRs focused — one feature or fix per PR.
- Reference any related issue in the PR description.
- Ensure the dev server starts cleanly (`npm run dev`) before opening the PR.

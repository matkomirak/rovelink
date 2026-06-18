# AGENTS.md

Project-specific instructions for Codex and other coding agents working in this repository.

## Project Shape

- This is a TypeScript full-stack application.
- Frontend: React with Vite.
- Backend: Express.
- Data layer: Drizzle ORM with Postgres.
- Prefer existing project patterns, helpers, route structure, schema definitions, and tests before introducing new abstractions.

## Safety Rules

- Never commit secrets, credentials, tokens, private keys, `.env` files, `.local/`, local database files, runtime state, logs, or generated cache data.
- Preserve HttpOnly cookie-based authentication. Do not move auth tokens into localStorage, sessionStorage, query parameters, or client-readable cookies.
- Preserve tenant isolation. Every organization-scoped route, query, mutation, background job, and integration path must maintain organization boundaries.
- Do not bypass automation gate logic. Gate checks are part of the product's safety model and must remain authoritative.
- Do not use arbitrary filesystem paths from client input. Validate, constrain, and resolve paths through existing safe helpers or explicit allowlists.
- Use safe command execution with argument arrays. Do not build shell commands through string interpolation with user-controlled values.

## Verification

Before claiming completion for code changes, run:

```bash
npm run check
npm test
npm run build
```

If any command cannot be run, report why and describe the remaining risk.

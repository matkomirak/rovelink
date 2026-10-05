# Rovelink on Ubuntu: Local Alpha Evaluation

Rovelink v0.1.0-alpha is not production-ready. The historical automated installer
is retired because its database, environment, and bootstrap assumptions are
outdated. `ubuntu-setup.sh` now exits with instructions instead of installing
packages or writing configuration.

Use the [README quickstart](README.md#quickstart) for the supported local workflow.
On Ubuntu, use `npm` instead of `npm.cmd` and `cp .env.example .env` instead of
PowerShell's `Copy-Item`. Install Node.js 20.19+ and provision a reachable
development Postgres database, or use the local Docker stack.

From the repository root, after filling in your private environment:

```bash
npm ci
node --env-file=.env ./node_modules/drizzle-kit/bin.cjs push
node --env-file=.env --import=tsx server/seed.ts
npx --no-install cross-env NODE_ENV=development node --env-file=.env --import=tsx server/index.ts
```

Use `DATABASE_CLIENT=pg` for ordinary Postgres. Open the app at
`http://localhost:5000/login`. Use your configured bootstrap credentials or the
private one-time credentials file. Seeding never resets an existing password.

In another terminal:

```bash
npm run check
npm test
npm run build
npm audit --omit=dev
```

See [Local Development](LOCAL-DEVELOPMENT.md) for optional NetBox and demo data.
Use synthetic data and keep the environment isolated. See [Deployment Status](DEPLOY.md)
for alpha limits and [SECURITY.md](SECURITY.md) for private security reporting.

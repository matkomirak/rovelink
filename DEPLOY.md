# Rovelink Deployment Status

Rovelink v0.1.0-alpha is not production-ready. This file replaces the historical
production deployment guide, which contained outdated bootstrap credentials,
weak database examples, and commands that no longer match the application.

For isolated local evaluation, use the [README quickstart](README.md#quickstart)
and [Local Development](LOCAL-DEVELOPMENT.md). The Compose entrypoint waits for
Postgres, applies the schema, seeds the bootstrap user, and starts the app.
Host development must explicitly load the private environment, as shown in the
README.

The bundled app and optional NetBox Compose ports bind to host loopback only.
Use a disposable database, synthetic inventory, and dedicated test credentials.
Do not expose the demo stack as a public service.

## Bootstrap and Configuration

Set strong private secrets using [.env.example](.env.example).
For host Postgres, set `DATABASE_CLIENT=pg` and a host-reachable `DATABASE_URL`.
A blank `BOOTSTRAP_ADMIN_PASSWORD` generates one-time credentials in
`bootstrap-credentials.txt`; retrieve them privately and remove the file after
login. Compose supplies its own local demo defaults unless overridden.

Seeding does not reset an existing user's password. There is no universal
default password for all installation paths. Do not paste credentials into
issues or use sample SQL to overwrite password hashes.

## Before Any Production Deployment

Passing unit tests, a build, or a dependency audit is not production certification.
Review [Production Hardening](PRODUCTION-HARDENING.md), [SECURITY.md](SECURITY.md),
and the [public alpha checklist](docs/public-alpha-checklist.md).
A production design would need independently reviewed authentication, tenant
isolation, credential lifecycle, TLS, network restrictions, database migrations
and recovery, execution containment, and operational monitoring.

No supported production deployment procedure is provided by this alpha.

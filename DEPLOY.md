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
A blank `BOOTSTRAP_ADMIN_PASSWORD` generates a password. Credentials are displayed
once during setup. Store them securely. No bootstrap credential file is written.
Compose supplies its own local demo defaults unless overridden.

Seeding does not reset an existing user's password. There is no universal
default password for all installation paths. Do not paste credentials into
issues or use sample SQL to overwrite password hashes.

There is no dedicated password-reset command. If you lose the generated password
in the local demo, reset the demo database using the disposable-stack procedure
in [Local Development](LOCAL-DEVELOPMENT.md#lost-local-admin-password).

## Before Any Production Deployment

Passing unit tests, a build, or a dependency audit is not production certification.
Review [Production Hardening](PRODUCTION-HARDENING.md), [SECURITY.md](SECURITY.md),
and the [public alpha checklist](docs/public-alpha-checklist.md).
A production design would need independently reviewed authentication, tenant
isolation, credential lifecycle, TLS, network restrictions, database migrations
and recovery, execution containment, and operational monitoring.

No supported production deployment procedure is provided by this alpha.

## Decision layer and execution boundary

Rovelink is the governance-first pre-flight decision layer for infrastructure
automation. Built-in Ansible is intended for local demos, short tests, migrations,
and lightweight controlled environments. It remains available, but is not the
recommended enterprise-scale execution architecture. The enterprise direction is
controlled external AWX/RHAAP/webhook adapters with decision snapshots, scoped
credentials and durable workers; the existing AWX connector is MVP-level.

Checks apply to routed workflows. Direct SSH, provider-console, Terraform and
manual administrative access can bypass an application-layer gate. See the
[enforcement boundary](docs/enforcement-boundary.md) for IAM/PAM, network controls and audited break-glass
requirements. Reports and pre-flight evidence do not grant execution permission.

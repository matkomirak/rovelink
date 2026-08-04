# Rovelink — Infrastructure Automation Platform

Rovelink is a full-stack infrastructure automation platform that centralises IT operations by combining:

- **Provider Inventory** — sync VM inventories from Proxmox, Azure, VMware vCenter, and a deterministic Fake generator into NetBox.
- **Automation GATE** — an inescapable governance layer that enforces tenant, role, and `automatable` custom-field checks in NetBox before any playbook can run against a VM.
- **Job Templates & Runs** — launch Ansible playbooks with local `ansible-playbook` execution for localhost and reachable Linux SSH targets, with real-time log streaming over WebSockets.
- **Rovelink Data Pipelines (RDP)** — configurable source→CMDB pipelines supporting NetBox, i-doit, and ServiceNow targets with a visual mapping editor, dry-run support, and a rules engine.
- **Automation Inventories** — unified Ansible inventory management (Linked / File / Script) with per-inventory Eligibility Policy.
- **Reports Dashboard** — inventory health widgets, run statistics, and provider sync history.

## Quick Start (Docker Compose)

```bash
cp .env.example .env
# Edit .env and set DATABASE_URL, SESSION_SECRET, JWT_SECRET, and ENCRYPTION_KEY
docker compose up -d
```

The app will be available at **http://localhost:5000**.

On first start, run the seed to create the admin user:

```bash
docker compose exec app npm run db:seed
```

## Development Setup

### Prerequisites

- Node.js 20+
- PostgreSQL 15+ (or a Neon / Supabase connection string)

### Install & Run

```bash
npm install
cp .env.example .env
# Edit .env — minimum: DATABASE_URL, SESSION_SECRET, JWT_SECRET, ENCRYPTION_KEY
npm run db:push   # Apply schema to the database
npm run db:seed   # Create default org and admin user
npm run dev       # Start Express + Vite dev server on port 5000
```

### Environment Variables

See [`.env.example`](.env.example) for a full list. The minimum set required to start:

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `SESSION_SECRET` | 32+ byte random hex string |
| `JWT_SECRET` | 32+ byte random hex string |
| `ENCRYPTION_KEY` | Exactly 64 hex chars (32 bytes AES key) |

## Architecture

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Tailwind CSS, Shadcn UI, Vite |
| Backend | Express.js (TypeScript) |
| Database | PostgreSQL (Neon serverless) + Drizzle ORM |
| Real-time | WebSockets (ws) |
| Auth | JWT (HttpOnly cookies) + bcrypt |

## Provider Support

| Provider | Status |
|---|---|
| Proxmox | Stable |
| Azure | Stable (full subscription discovery) |
| VMware vCenter | Beta (vSphere REST API 6.7u3+) |
| Fake (Generator) | Stable (testing & demo) |

## CMDB Targets

| Target | Pipeline Sync | Connection Test |
|---|---|---|
| NetBox | Full (upsert VMs, IPs, prefixes) | Yes |
| i-doit | Full (JSON-RPC upsert) | Yes |
| ServiceNow | Full (Table API upsert) | Yes |

## Security

- All provider and CMDB tokens are encrypted at rest using AES-256-GCM (`ENCRYPTION_KEY`).
- Secrets are never returned in API responses — all endpoints call `redactForLog` before serialising.
- The automation GATE system is non-optional: no VM can be targeted by automation without explicit governance in NetBox.
- JWT tokens are stored as HttpOnly cookies; `localStorage` is never used for auth state.
- Login and signup responses do not return JWTs in JSON.
- `AUTH_DISABLE` is a dev-only flag that causes HTTP 403 in production.

## Current MVP Limits

- AWX / Ansible Automation Platform execution is out of scope for the current local MVP.
- Git project sync supports public HTTPS repositories only; private Git, SSH Git, Git tokens, and embedded URL credentials are not supported.
- SSH private keys can be stored encrypted for Ansible execution, but SSH key passphrases are not supported yet.
- The local runner must be intentionally enabled with `ROVELINK_LOCAL_RUNNER_ENABLED=true` before production use.
- Remote SSH playbooks require Linux targets reachable from the app container and gate-approved inventory.

## License

MIT
